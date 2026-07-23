const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');

const UpEmoji = '<:up:1383801975233183834>';
const DownEmoji = '<:down:1383801995953180873>';

async function fetchGrowthData(guildId, startDate, endDate) {
    const apiUrl = `https://discord.com/api/v9/guilds/${guildId}/analytics/growth-activation/overview?start=${startDate}&end=${endDate}&interval=1`;

    try {
        const response = await axios.get(apiUrl, {
            headers: {
                'Authorization': process.env.DISCORD_SCRAPE_TOKEN,
                'Content-Type': 'application/json'
            }
        });

        const data = response.data;
        let totalNewMembers = 0;

        if (data && data.length > 0) {
            for (const entry of data) {
                totalNewMembers += entry.new_members || 0;
            }
        }
        return totalNewMembers;
    } catch (error) {
        console.error(`Error fetching growth data for guild ${guildId}:`, error.message);
        return 0;
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('membercount')
        .setDescription('Shows the member count')
        .setIntegrationTypes([0, 1]),

    async execute(interaction, client) {
        await interaction.deferReply({});

        const guild = interaction.guild;
        if (!guild) {
            await interaction.editReply('This command can only be used in a server smart ass');
            return;
        }

        await guild.members.fetch().catch(console.error);

        const currentMemberCount = guild.memberCount;

        const embed = new EmbedBuilder()
            .setTitle('Members')
            .setColor(0xFBE7BD)
            .setDescription(`${currentMemberCount}\n\n`);

        await interaction.editReply({ embeds: [embed] });

        if (guild.id === '1369439484659236954') {
            const now = new Date();
            const endDate = now.toISOString();
            const startDate7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

            const newMembers7d = await fetchGrowthData(guild.id, startDate7d, endDate);

            const change7d = newMembers7d;

            const formatted7d = change7d >= 0
                ? `${change7d} ${UpEmoji}`
                : `${Math.abs(change7d)} ${DownEmoji}`;

            embed.setDescription(
                `**Members:** ${currentMemberCount}\n\n` +
                `**Last 7D:** ${formatted7d}\n\n`
            );

            await interaction.editReply({ embeds: [embed] });
        }
    }
};