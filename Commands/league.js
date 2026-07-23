const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const axios = require('axios');

function buildLeagueEmbed(pageItems, total, startingIndex = 1) {
    let description = '';
    pageItems.forEach((league, idx) => {
        const rank = league.GlobalRank || (startingIndex + idx);
        const points = league.Points !== undefined ? league.Points.toLocaleString() : '0';
        description += `**${league.Name}**\nPlace: #${rank} (${points} points)`;
        if (idx < pageItems.length - 1) {
            description += '\n\n';
        }
    });

    return new EmbedBuilder()
        .setTitle('Leagues')
        .setDescription(description)
        .setColor('#FBE7BD')
        .setFooter({ text: `Showing ${pageItems.length}/${total}` });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('league')
        .setDescription('Shows league positions')
        .setIntegrationTypes([0, 1])
        .setContexts([0, 1, 2])
        .addStringOption(opt =>
            opt.setName('search')
                .setDescription('Search query for the leagues')
                .setRequired(false)
        ),

    prefixData: {
        name: 'league',
        description: 'Shows league positions',
        async execute(message, args, client) {
            const searchTerm = args.join(' ').trim() || '';
            const loadingMsg = await message.reply('Fetching league info...');
            try {
                const response = await axios.get('https://www.petsim99.co/api/ps99/leagues', {
                    params: {
                        page: 1,
                        pageSize: 50,
                        sort: 'Points',
                        sortOrder: 'desc',
                        search: searchTerm || undefined
                    },
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    },
                    timeout: 10000
                });

                if (response.data && response.data.status === 'ok' && response.data.data && Array.isArray(response.data.data.leagues)) {
                    let filtered = response.data.data.leagues;

                    if (searchTerm.toLowerCase() === 'wiky') {
                        const targetNames = ["Wiky", "Wiky2", "Wiky3", "Wiky4"];
                        filtered = filtered
                            .map((l, idx) => ({ ...l, GlobalRank: l.GlobalRank || (idx + 1) }))
                            .filter(l => targetNames.includes(l.Name));
                    }

                    if (filtered.length === 0) {
                        return loadingMsg.edit('None found');
                    }

                    const total = response.data.data.total || filtered.length;
                    const pageSize = 5;
                    const pages = [];
                    for (let i = 0; i < filtered.length; i += pageSize) {
                        pages.push(filtered.slice(i, i + pageSize));
                    }

                    let pageIndex = 0;
                    const embed = buildLeagueEmbed(pages[pageIndex], total, pageIndex * pageSize + 1);

                    const prevBtn = new ButtonBuilder()
                        .setCustomId('league_prev')
                        .setLabel('◀ Prev')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(true);

                    const nextBtn = new ButtonBuilder()
                        .setCustomId('league_next')
                        .setLabel('Next ▶')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(pages.length <= 1);

                    const row = new ActionRowBuilder().addComponents(prevBtn, nextBtn);

                    const replyMsg = await loadingMsg.edit({ content: null, embeds: [embed], components: [row] });

                    const collector = replyMsg.createMessageComponentCollector({ time: 120_000 });
                    collector.on('collect', async i => {
                        if (i.user.id !== message.author.id) {
                            await i.reply({ content: 'You didn\'t run this command', flags: MessageFlags.Ephemeral });
                            return;
                        }

                        if (i.customId === 'league_prev') {
                            if (pageIndex > 0) pageIndex--;
                        } else if (i.customId === 'league_next') {
                            if (pageIndex < pages.length - 1) pageIndex++;
                        }

                        const newEmbed = buildLeagueEmbed(pages[pageIndex], total, pageIndex * pageSize + 1);
                        const newPrev = ButtonBuilder.from(prevBtn).setDisabled(pageIndex === 0);
                        const newNext = ButtonBuilder.from(nextBtn).setDisabled(pageIndex === pages.length - 1);
                        const newRow = new ActionRowBuilder().addComponents(newPrev, newNext);

                        await i.update({ embeds: [newEmbed], components: [newRow] });
                    });

                    collector.on('end', () => {
                        const finalPrev = ButtonBuilder.from(prevBtn).setDisabled(true);
                        const finalNext = ButtonBuilder.from(nextBtn).setDisabled(true);
                        const finalRow = new ActionRowBuilder().addComponents(finalPrev, finalNext);
                        replyMsg.edit({ components: [finalRow] }).catch(() => { });
                    });
                } else {
                    const statusMsg = response.data?.status || 'unknown status';
                    await loadingMsg.edit(`Failed to get info, status: ${statusMsg}`);
                }
            } catch (err) {
                console.error(err);
                await loadingMsg.edit(`Failed to get info, ${err.message || err}`);
            }
        }
    },

    async execute(interaction, client) {
        await interaction.deferReply();
        const searchTerm = interaction.options.getString('search') || '';
        try {
            const response = await axios.get('https://www.petsim99.co/api/ps99/leagues', {
                params: {
                    page: 1,
                    pageSize: 50,
                    sort: 'Points',
                    sortOrder: 'desc',
                    search: searchTerm || undefined
                },
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                timeout: 10000
            });

            if (response.data && response.data.status === 'ok' && response.data.data && Array.isArray(response.data.data.leagues)) {
                let filtered = response.data.data.leagues;

                if (searchTerm.toLowerCase() === 'wiky') {
                    const targetNames = ["Wiky", "Wiky2", "Wiky3", "Wiky4"];
                    filtered = filtered
                        .map((l, idx) => ({ ...l, GlobalRank: l.GlobalRank || (idx + 1) }))
                        .filter(l => targetNames.includes(l.Name));
                }

                if (filtered.length === 0) {
                    return interaction.editReply('None found');
                }

                const total = response.data.data.total || filtered.length;
                const pageSize = 5;
                const pages = [];
                for (let i = 0; i < filtered.length; i += pageSize) {
                    pages.push(filtered.slice(i, i + pageSize));
                }

                let pageIndex = 0;
                const embed = buildLeagueEmbed(pages[pageIndex], total, pageIndex * pageSize + 1);

                const prevBtn = new ButtonBuilder()
                    .setCustomId('league_prev')
                    .setLabel('◀ Prev')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(true);

                const nextBtn = new ButtonBuilder()
                    .setCustomId('league_next')
                    .setLabel('Next ▶')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(pages.length <= 1);

                const row = new ActionRowBuilder().addComponents(prevBtn, nextBtn);

                const replyMsg = await interaction.editReply({ embeds: [embed], components: [row] });

                const collector = replyMsg.createMessageComponentCollector({ time: 120_000 });
                collector.on('collect', async i => {
                    if (i.user.id !== interaction.user.id) {
                        await i.reply({ content: 'You didn\'t run this command', flags: MessageFlags.Ephemeral });
                        return;
                    }

                    if (i.customId === 'league_prev') {
                        if (pageIndex > 0) pageIndex--;
                    } else if (i.customId === 'league_next') {
                        if (pageIndex < pages.length - 1) pageIndex++;
                    }

                    const newEmbed = buildLeagueEmbed(pages[pageIndex], total, pageIndex * pageSize + 1);
                    const newPrev = ButtonBuilder.from(prevBtn).setDisabled(pageIndex === 0);
                    const newNext = ButtonBuilder.from(nextBtn).setDisabled(pageIndex === pages.length - 1);
                    const newRow = new ActionRowBuilder().addComponents(newPrev, newNext);

                    await i.update({ embeds: [newEmbed], components: [newRow] });
                });

                collector.on('end', () => {
                    const finalPrev = ButtonBuilder.from(prevBtn).setDisabled(true);
                    const finalNext = ButtonBuilder.from(nextBtn).setDisabled(true);
                    const finalRow = new ActionRowBuilder().addComponents(finalPrev, finalNext);
                    interaction.editReply({ components: [finalRow] }).catch(() => { });
                });
            } else {
                const statusMsg = response.data?.status || 'unknown status';
                await interaction.editReply(`Failed to get info, status: ${statusMsg}`);
            }
        } catch (err) {
            console.error(err);
            await interaction.editReply(`Failed to get info, ${err.message || err}`);
        }
    }
};