const { SlashCommandBuilder } = require('discord.js');

function getTimestampFromSnowflake(snowflake) {
    const discordEpoch = 1420070400000n;
    try {
        const id = BigInt(snowflake);
        return Number((id >> 22n) + discordEpoch);
    } catch {
        return null;
    }
}

function formatTimeDiff(ms) {
    const absMs = Math.abs(ms);
    const sign = ms < 0 ? '-' : '';

    const seconds = Math.floor(absMs / 1000) % 60;
    const minutes = Math.floor(absMs / (1000 * 60)) % 60;
    const hours = Math.floor(absMs / (1000 * 60 * 60)) % 24;
    const days = Math.floor(absMs / (1000 * 60 * 60 * 24)) % 30;
    const months = Math.floor(absMs / (1000 * 60 * 60 * 24 * 30.44)) % 12;
    const years = Math.floor(absMs / (1000 * 60 * 60 * 24 * 365.25));

    const parts = [];
    const pushUnit = (value, name) => {
        if (!value && value !== 0) return;
        if (value === 0) return;
        parts.push(`${value} ${name}${value === 1 ? '' : 's'}`);
    };

    pushUnit(years, 'year');
    pushUnit(months, 'month');
    pushUnit(days, 'day');
    pushUnit(hours, 'hour');
    pushUnit(minutes, 'minute');

    if (seconds || parts.length === 0) {
        parts.push(`${seconds} ${seconds === 1 ? 'second' : 'seconds'}`);
    }

    return sign + parts.join(' ');
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('timediff')
        .setDescription('Time between messages')
        .setIntegrationTypes([0, 1])
        .setContexts([0, 1, 2])
        .addStringOption(option =>
            option.setName('id1')
                .setDescription('First id')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('id2')
                .setDescription('Second id (null for time ago for id 1)')
                .setRequired(true)),
    async execute(interaction) {
        const id1 = interaction.options.getString('id1');
        let id2 = interaction.options.getString('id2');
        const ts1 = getTimestampFromSnowflake(id1);

        let ts2, diffMs, diffStr, reply;
        if (!ts1) {
            return interaction.reply({ content: 'Wrong format' });
        }

        if (id2.toLowerCase() === 'null') {
            ts2 = Date.now();
            diffMs = ts2 - ts1;
            diffStr = formatTimeDiff(diffMs);
            reply = `Message was: ${diffStr} ago`;
        } else {
            ts2 = getTimestampFromSnowflake(id2);
            if (!ts2) {
                return interaction.reply({ content: 'Wrong format'});
            }
            diffMs = ts2 - ts1;
            diffStr = formatTimeDiff(diffMs);
            reply = `Time difference between the messages: ${diffStr}`;
        }

        await interaction.reply({
            content: reply
        });
    },
};