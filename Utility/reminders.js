const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const ms = require('ms');
const { EmbedBuilder } = require('discord.js');

const RemindersFile = path.resolve(__dirname, '..', 'Data', 'reminders.json');

let cachedReminders = null;

function loadReminders() {
    if (cachedReminders !== null) return cachedReminders;
    const file = path.join(__dirname, '../Data/reminders.json');
    try {
        if (!fs.existsSync(file)) {
            cachedReminders = [];
            return cachedReminders;
        }
        const data = fs.readFileSync(file, 'utf8');
        if (!data.trim()) {
            cachedReminders = [];
            return cachedReminders;
        }
        cachedReminders = JSON.parse(data);
        return cachedReminders;
    } catch (e) {
        console.error('Error loading reminders:', e);
        cachedReminders = [];
        return cachedReminders;
    }
}

async function saveReminders(reminders) {
    cachedReminders = reminders;
    try {
        await fsp.writeFile(RemindersFile, JSON.stringify(reminders, null, 2), 'utf8');
    } catch (error) {
        console.error('Error saving reminders:', error);
    }
}

const MsPerSecond = 1000;
const MsPerMinute = 60 * MsPerSecond;
const MsPerHour = 60 * MsPerMinute;
const MsPerDay = 24 * MsPerHour;
const MsPerMonth = MsPerDay * 30.44;

function parseTime(timeString) {
    if (!timeString) return null;
    const s = String(timeString).trim().toLowerCase();

    const regex = /^(\d+(?:\.\d+)?)\s*(years?|yrs?|y|months?|mos?|mo|weeks?|w|days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)$/i;
    const m = s.match(regex);
    let timeInMs = null;
    const max = 6 * MsPerMonth;

    if (m) {
        const num = parseFloat(m[1]);
        const unit = m[2].toLowerCase();

        if (/^y/.test(unit)) {
            timeInMs = Math.round(num * 365.25 * MsPerDay);
        } else if (/^(months?|mos?|mo)$/.test(unit)) {
            timeInMs = Math.round(num * MsPerMonth);
        } else if (/^w/.test(unit)) {
            timeInMs = Math.round(num * 7 * MsPerDay);
        } else if (/^d/.test(unit)) {
            timeInMs = Math.round(num * MsPerDay);
        } else if (/^h/.test(unit)) {
            timeInMs = Math.round(num * MsPerHour);
        } else if (/^(minutes?|mins?|m)$/.test(unit)) {
            timeInMs = Math.round(num * MsPerMinute);
        } else if (/^s/.test(unit)) {
            timeInMs = Math.round(num * MsPerSecond);
        }
    } else {
        const compact = s.replace(/\s+/g, '');
        const viaMs = ms(compact);
        if (typeof viaMs === 'number') timeInMs = viaMs;
    }

    if (!timeInMs || timeInMs <= 0 || timeInMs > max) return null;
    return timeInMs;
}

function formatTimeDifference(ms) {
    const abs = Math.abs(ms);

    if (abs >= MsPerMonth) {
        const months = Math.round(abs / MsPerMonth);
        return `${months} month${months === 1 ? '' : 's'}`;
    }
    if (abs >= MsPerDay) {
        const days = Math.round(abs / MsPerDay);
        return `${days} day${days === 1 ? '' : 's'}`;
    }
    if (abs >= MsPerHour) {
        const hours = Math.round(abs / MsPerHour);
        return `${hours} hour${hours === 1 ? '' : 's'}`;
    }
    if (abs >= MsPerMinute) {
        const minutes = Math.round(abs / MsPerMinute);
        return `${minutes} minute${minutes === 1 ? '' : 's'}`;
    }
    const seconds = Math.round(abs / MsPerSecond) || 0;
    return `${seconds} second${seconds === 1 ? '' : 's'}`;
}

async function sendReminder(client, reminder) {
    const user = await client.users.fetch(reminder.user).catch(() => null);
    if (!user) {
        console.warn(`Could not find user with ID ${reminder.user} to send reminder.`);
        return false;
    }

    const currentTime = Date.now();
    const timeSinceCreated = currentTime - (reminder.created_at || reminder.time_target);
    const footerText = `Reminder from ${formatTimeDifference(timeSinceCreated)} ago`;

    const embed = new EmbedBuilder()
        .setTitle('Reminder')
        .setDescription(reminder.reminder)
        .setColor('#FBE7BD')
        .setFooter({ text: footerText });


    if (reminder.attachment && reminder.attachment.url) {
        embed.setImage(reminder.attachment.url);
    } else if (reminder.image) {
        embed.setImage(reminder.image);
    }


    let files = [];
    if (reminder.attachment && reminder.attachment.url && reminder.attachment.name) {
        files.push({
            attachment: reminder.attachment.url,
            name: reminder.attachment.name
        });
    } else if (reminder.file && reminder.file.url && reminder.file.name) {
        files.push({
            attachment: reminder.file.url,
            name: reminder.file.name
        });
    }

    try {
        if (files.length > 0) {
            await user.send({ embeds: [embed], files });
        } else {
            await user.send({ embeds: [embed] });
        }
        console.log(`Sent reminder to ${user.tag} for "${reminder.reminder}"`);
        return true;
    } catch (error) {
        console.error(`Could not send reminder to ${user.tag} (ID: ${reminder.user}):`, error);
        return false;
    }
}

let reminderInterval = null;
let reminderCheckerStarted = false;

async function startReminderChecker(client) {
    if (reminderCheckerStarted) {
        return;
    }
    reminderCheckerStarted = true;

    const checkReminders = async () => {
        let reminders = await loadReminders();
        const now = Date.now();
        const sentReminderIndices = [];

        for (let i = 0; i < reminders.length; i++) {
            const reminder = reminders[i];
            if (now >= reminder.time_target) {
                const sent = await sendReminder(client, reminder);
                if (sent) {
                    sentReminderIndices.push(i);
                }
            }
        }

        if (sentReminderIndices.length > 0) {
            for (let i = sentReminderIndices.length - 1; i >= 0; i--) {
                reminders.splice(sentReminderIndices[i], 1);
            }
            await saveReminders(reminders);
        }
    };

    await checkReminders();
    reminderInterval = setInterval(checkReminders, 2000);
}

function buildReminderEmbed(reminder) {
    const now = Date.now();
    const embed = new EmbedBuilder()
        .setTitle('⏰ Reminder')
        .setDescription(reminder.reminder)
        .setColor(0xFBE7BD)
        .setFooter({
            text: `Set ${timeAgo(reminder.created_at, now)}`
        });
    if (reminder.attachment) {
        embed.setImage(reminder.attachment.url);
    }
    return embed;
}


function timeAgo(from, to) {
    const diff = to - from;
    if (diff < 0) return 'in the future (WHAT)';
    if (diff < 60000) return `${Math.floor(diff / 1000)} second(s) ago`;
    if (diff < 3600000) return `${Math.floor(diff / 60000)} minute(s) ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} hour(s) ago`;
    return `${Math.floor(diff / 86400000)} day(s) ago`;
}

module.exports = {
    loadReminders,
    saveReminders,
    parseTime,
    formatTimeDifference,
    sendReminder,
    startReminderChecker,
    buildReminderEmbed
};