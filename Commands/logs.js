require('dotenv').config();
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');

function loadLogs() {
    const LogFile = path.join(__dirname, '../Data/logs.json');
    try {
        if (fs.existsSync(LogFile)) {
            return JSON.parse(fs.readFileSync(LogFile, 'utf8')) || [];
        }
    } catch (e) {}
    return [];
}

function getAllCommandNames() {
    const logs = loadLogs();
    const commandNames = new Set();
    for (const log of logs) {
        if (log.commandName) commandNames.add(log.commandName);
    }
    return Array.from(commandNames);
}

function formatLogEntry(entry, index) {
    const commandText = entry.commandName ? `\`${entry.commandName}\`` : '`Unknown`';
    const user = entry.by || entry.user;
    const userName = user ? (user.tag ? user.tag : `<@${user.id}>`) : 'Unknown user';
    const userId = user ? user.id : 'N/A';
    const channelText = entry.channel ? `<#${entry.channel.id}> (${entry.channel.name || entry.channel.id})` : 'Unknown channel';
    const rawMessage = entry.message || entry.reason || '';
    const truncatedMessage = rawMessage ? rawMessage.replace(/\s+/g, ' ').trim().slice(0, 200) + (rawMessage.length > 200 ? '...' : '') : 'None';
    const timestamp = entry.time ? Math.floor(new Date(entry.time).getTime() / 1000) : null;
    const timeText = timestamp ? `<t:${timestamp}:F>` : 'Unknown';

    return {
        name: `#${index + 1} • ${commandText}`,
        value: `**User:** ${userName} (ID: ${userId})\n**Channel:** ${channelText}\n**Time:** ${timeText}\n**Message:** ${truncatedMessage}`,
        inline: false
    };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('logs')
        .setDescription('Show logz')
        .setIntegrationTypes([0, 1])
        .setContexts([0, 1, 2])
        .addStringOption(option => {
            const commandNames = getAllCommandNames();
            option.setName('command')
                .setDescription('What command?')
                .setRequired(false);
            commandNames.forEach(name => {
                option.addChoices({ name: name, value: name });
            });
            return option;
        }),

    async execute(interaction) {
        const authorizedUsers = [process.env.BOT_OWNER_ID, '1051938084507365397', '743455055193047142'];

        if (!authorizedUsers.includes(interaction.user.id)) {
            return interaction.reply({
                content: 'You do not have permission to use this command.',
                flags: 64
            });
        }

        const commandFilter = interaction.options.getString('command');
        const logs = loadLogs();

        const filteredLogs = commandFilter
            ? logs.filter(log => log.commandName && log.commandName.toLowerCase() === commandFilter.toLowerCase())
            : logs;

        if (!filteredLogs.length) {
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle("Logs")
                        .setDescription(commandFilter ? `No logs found for command: \`${commandFilter}\`` : "No logs found.")
                        .setColor(0xFBE7BD)
                ]
            });
        }

        function paginateLogs(logsToPaginate) {
            const entriesPerPage = 6;
            const pages = [];

            for (let pageStart = 0; pageStart < logsToPaginate.length; pageStart += entriesPerPage) {
                const pageEmbed = new EmbedBuilder()
                    .setTitle('Logs')
                    .setColor(0xFBE7BD);
                const pageLogs = logsToPaginate.slice(pageStart, pageStart + entriesPerPage);

                pageLogs.forEach((entry, offset) => {
                    const index = pageStart + offset;
                    pageEmbed.addFields(formatLogEntry(entry, index));
                });

                pages.push(pageEmbed);
            }

            return pages;
        }

        const pages = paginateLogs(filteredLogs.reverse());
        let currentPageIndex = 0;

        function getComponents(index, totalPages) {
            const row = new ActionRowBuilder();
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId('first_log_page')
                    .setLabel('First')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(index === 0),
                new ButtonBuilder()
                    .setCustomId('previous_log_page')
                    .setLabel('Previous')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(index === 0),
                new ButtonBuilder()
                    .setCustomId('next_log_page')
                    .setLabel('Next')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(index === totalPages - 1),
                new ButtonBuilder()
                    .setCustomId('last_log_page')
                    .setLabel('Last')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(index === totalPages - 1),
            );
            return totalPages > 1 ? [row] : [];
        }

        const replyOptions = {
            embeds: [pages[currentPageIndex].setFooter({ text: `Page ${currentPageIndex + 1}/${pages.length}` })],
            components: getComponents(currentPageIndex, pages.length),
            fetchReply: true
        };

        const message = await interaction.reply(replyOptions);

        if (pages.length > 1) {
            const ButtonTimeout = 5 * 60 * 1000;
            const collector = message.createMessageComponentCollector({
                filter: i => i.user.id === interaction.user.id,
                time: ButtonTimeout
            });

            collector.on('collect', async i => {
                if (i.customId === 'first_log_page') {
                    currentPageIndex = 0;
                } else if (i.customId === 'previous_log_page') {
                    currentPageIndex = Math.max(0, currentPageIndex - 1);
                } else if (i.customId === 'next_log_page') {
                    currentPageIndex = Math.min(pages.length - 1, currentPageIndex + 1);
                } else if (i.customId === 'last_log_page') {
                    currentPageIndex = pages.length - 1;
                }

                await i.update({
                    embeds: [pages[currentPageIndex].setFooter({ text: `Page ${currentPageIndex + 1}/${pages.length}` })],
                    components: getComponents(currentPageIndex, pages.length)
                });
            });

            collector.on('end', async () => {
                const disabledComponents = getComponents(currentPageIndex, pages.length).map(row => {
                    row.components.forEach(button => button.setDisabled(true));
                    return row;
                });
                try {
                    await message.edit({ components: disabledComponents });
                } catch (err) {
                }
            });
        }
    }
};
