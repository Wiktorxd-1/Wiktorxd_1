const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const ms = require('ms');
const {
    loadReminders,
    saveReminders,
    formatTimeDifference,
    startReminderChecker,
    buildReminderEmbed 
} = require('../Utility/reminders');


function parseTime(str) {
    if (!str) return undefined;

    const MsPerSecond = 1000;
    const MsPerMinute = 60 * MsPerSecond;
    const MsPerHour = 60 * MsPerMinute;
    const MsPerDay = 24 * MsPerHour;
    const MsPerMonth = MsPerDay * 30.44;
    const max = 190 * MsPerDay;
    const min = MsPerSecond;

    const s = String(str).trim().toLowerCase();
    const regex = /^(\d+(?:\.\d+)?)\s*(years?|yrs?|y|months?|mos?|mo|weeks?|w|days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)$/i;
    const m = s.match(regex);

    let valMs;
    if (m) {
        const num = parseFloat(m[1]);
        const unit = m[2].toLowerCase();

        if (/^y/.test(unit)) valMs = Math.round(num * 365.25 * MsPerDay);
        else if (/^(months?|mos?|mo)$/.test(unit)) valMs = Math.round(num * MsPerMonth);
        else if (/^w/.test(unit)) valMs = Math.round(num * 7 * MsPerDay);
        else if (/^d/.test(unit)) valMs = Math.round(num * MsPerDay);
        else if (/^h/.test(unit)) valMs = Math.round(num * MsPerHour);
        else if (/^(minutes?|mins?|m)$/.test(unit)) valMs = Math.round(num * MsPerMinute);
        else if (/^s/.test(unit)) valMs = Math.round(num * MsPerSecond);
    } else {
        const compact = s.replace(/\s+/g, '');
        valMs = ms(compact);
    }

    if (!valMs || valMs < min || valMs > max) return undefined;
    return valMs;
}

function filterPings(str) {
    return str
        .replace(/@everyone/gi, '[everyone]')
        .replace(/@here/gi, '[here]')
        .replace(/<@&\d+>/g, '[role]');
}


async function handleRemindCommand(interactionOrMessage, client, timeString, reminderText, attachment) {
    const userId = interactionOrMessage.author ? interactionOrMessage.author.id : interactionOrMessage.user.id;
    const timeInMs = parseTime(timeString);

    if (!timeInMs) {
        const replyContent = "Provide a valid time up to 6 months.";
        if (interactionOrMessage.reply) {
            if (interactionOrMessage.deferred || interactionOrMessage.replied) {
                return interactionOrMessage.editReply({ content: replyContent, flags: 64 });
            } else {
                return interactionOrMessage.reply({ content: replyContent, flags: 64 });
            }
        } else {
            return interactionOrMessage.channel.send(replyContent);
        }
    }

    if (
        typeof interactionOrMessage.deferReply === 'function' &&
        !(interactionOrMessage.deferred || interactionOrMessage.replied)
    ) {
        await interactionOrMessage.deferReply({});
    }

    const createdAt = Date.now();
    const timeTarget = createdAt + timeInMs;

    const newReminder = {
        user: userId,
        reminder: reminderText,
        time_input: timeString,
        time_target: timeTarget,
        created_at: createdAt,
        attachment: attachment ? {
            url: attachment.url,
            name: attachment.name,
            contentType: attachment.contentType
        } : null,
    };

    const reminders = await loadReminders();
    reminders.push(newReminder);
    await saveReminders(reminders);

    const filteredReminder = filterPings(reminderText);
    const confirmationMessage = `Okay, I'll remind you about "${filteredReminder}" in **${formatTimeDifference(timeInMs)}**!`;

    let sentMsg;
    if (typeof interactionOrMessage.editReply === 'function') {
        sentMsg = await interactionOrMessage.editReply({ content: confirmationMessage });
    } else if (typeof interactionOrMessage.reply === 'function') {
        sentMsg = await interactionOrMessage.reply(confirmationMessage);
    } else if (interactionOrMessage.channel && typeof interactionOrMessage.channel.send === 'function') {
        sentMsg = await interactionOrMessage.channel.send(confirmationMessage);
    }


}


module.exports = {
    data: new SlashCommandBuilder()
        .setName('remindme')
        .setDescription('Set a reminder!')
        .setIntegrationTypes([0, 1])
        .setContexts([0, 1, 2])
        .addStringOption(option =>
            option.setName('time')
                .setDescription('Time to remind you in?')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reminder')
                .setDescription('What reminder do you want the reminder to be?')
                .setRequired(true))
        .addAttachmentOption(option =>
            option.setName('file')
                .setDescription('Attach a file')),

    prefixData: {
        name: 'remindme',
        description: 'Sets a reminder for yourself. Usage: ?remindme {time} {reminder_text} [file_attachment]',
        async execute(message, args, client) {
            let timeString = '';
            let reminderStartIndex = -1;

            for (let i = 0; i < args.length; i++) {
                const potentialTimeString = args.slice(0, i + 1).join(' ');
                if (parseTime(potentialTimeString)) {
                    timeString = potentialTimeString;
                    reminderStartIndex = i + 1;
                } else {
                    if (timeString) break;
                }
            }

            if (!timeString || reminderStartIndex === -1 || reminderStartIndex >= args.length) {
                return message.reply('Usage: `?remindme {time} {reminder_text} [file]`. Example: `?remindme 1h get infinity elixirs` or `?remindme 10 hours get infinity elixirs`');
            }

            const reminderText = args.slice(reminderStartIndex).join(' ');

            let attachment = null;
            if (message.attachments.size > 0) {
                attachment = message.attachments.first();
            }
            
            try {
                await handleRemindCommand(message, client, timeString, reminderText, attachment);
            } catch (err) {
                console.error('remindme prefix error:', err);
                message.reply('There was an error setting your reminder!');
            }
        }
    },

    async execute(interaction, client) {
        const timeString = interaction.options.getString('time');
        const reminderText = interaction.options.getString('reminder');
        const fileAttachment = interaction.options.getAttachment('file');
        await handleRemindCommand(interaction, client, timeString, reminderText, fileAttachment);
    },

    startChecker: startReminderChecker
};