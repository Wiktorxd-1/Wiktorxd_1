const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

const LogFile = path.join(__dirname, '../Data/logs.json');

function logYapAction(action) {
    let logs = [];
    try {
        if (fs.existsSync(LogFile)) {
            logs = JSON.parse(fs.readFileSync(LogFile, 'utf8')) || [];
        }
    } catch (e) {
        console.error("Error reading logs.json:", e);
        logs = [];
    }
    logs.push(action);
    fs.writeFileSync(LogFile, JSON.stringify(logs, null, 2));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('yap')
        .setDescription('Yap using the bot')
        .setIntegrationTypes([0, 1])
        .setContexts([0, 1, 2])
        .addStringOption(option =>
            option.setName('message')
                .setDescription('Message to yap')
                .setRequired(true))
        .addAttachmentOption(option =>
            option.setName('file')
                .setDescription('file to attach'))
        .addStringOption(option =>
            option.setName('reply')
                .setDescription('gib me id')
                .setRequired(false)),

    async execute(interaction) {
        const user = interaction.user;
        const channel = interaction.channel;
        const guild = interaction.guild;
        const message = interaction.options.getString('message');
        const file = interaction.options.getAttachment('file');
        const replyToMessageId = interaction.options.getString('reply');

        if (guild && guild.id === '1369439484659236954') {
            await interaction.reply({ content: "Kys (keep yourself safe, this is only meant for wiktor btw)", flags: 64 });
            return;
        }

        await interaction.deferReply({ flags: 64 });

        if (
            message.includes('@everyone') ||
            message.includes('@here') ||
            /<@&\d+>/.test(message)
        ) {
            return interaction.followUp({
                content: "Nice try, but you can't ping @everyone, @here, or roles.",
                flags: 64
            });
        }

        let sentContent = message;
        const attachments = [];

        if (sentContent === '{empty}') {
            if (file) {
                sentContent = '';
            } else {
                sentContent = '\u200B';
            }
        } else {
            sentContent = sentContent.replace(/\\n/g, '\n');
        }

        if (file) {
            attachments.push(file);
        }

        try {
            const messageOptions = { content: sentContent };
            if (replyToMessageId) {
                messageOptions.reply = { messageReference: replyToMessageId, failIfNotExists: false };
            }
            if (attachments.length > 0) {
                messageOptions.files = attachments;
            }

            if (guild) {
                await channel.send(messageOptions);
                await interaction.editReply({ content: "✅", flags: 64 });
            } else {
                await interaction.editReply({ content: "✅", flags: 64 });
                const dmOptions = { content: sentContent };
                if (attachments.length > 0) dmOptions.files = attachments;
                await interaction.followUp(dmOptions);
            }

            const log_info = {
                commandName: 'yap',
                status: 'success',
                by: { id: user.id, tag: user.tag },
                channel: channel ? { id: channel.id, name: channel.name || channel.id } : null,
                message: message,
                time: new Date().toISOString()
            };
            if (file) {
                log_info.attachment = file.url;
            }
            if (replyToMessageId) {
                log_info.repliedTo = replyToMessageId;
            }
            logYapAction(log_info);

        } catch (e) {
            logYapAction({
                commandName: "yap",
                status: "error",
                by: { id: user.id, tag: user.tag },
                channel: channel ? { id: channel.id, name: channel.name || channel.id } : null,
                message: message,
                error: String(e),
                time: new Date().toISOString()
            });
            console.error("Error executing yap command:", e);

            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: "There was an error trying to send your message!", flags: 64 });
            } else {
                await interaction.reply({ content: "There was an error trying to send your message!", flags: 64 });
            }
        }
    }
};