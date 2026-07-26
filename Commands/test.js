const axios = require('axios');
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const ROVER_API_KEY = process.env.ROVER_API_KEY;
const GUILD_ID = '1369439484659236954';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('test')
        .setDescription('Test RoVer access request for schiedamwikto')
        .setIntegrationTypes([0])
        .setContexts([0]),

    async execute(interaction) {
        await interaction.deferReply();

        try {
            const members = await interaction.guild.members.fetch();
            const targetMember = members.find(m => 
                m.id === '697047593334603837' || 
                m.user.username.toLowerCase().includes('schiedam') ||
                m.user.username.toLowerCase().includes('wiktor')
            );

            if (!targetMember) {
                return interaction.editReply('Could not find member "schiedamwikto" or "Wiktor" in this guild.');
            }

            const url = `https://registry.rover.link/api/guilds/${GUILD_ID}/access-requests/${targetMember.id}`;
            const response = await axios.put(url, {}, {
                headers: { 'Authorization': `Bearer ${ROVER_API_KEY}` }
            });

            const embed = new EmbedBuilder()
                .setTitle('RoVer Access Request Test')
                .setDescription(`Sent access request to user: **${targetMember.user.tag}** (${targetMember.id})`)
                .addFields(
                    { name: 'Status Code', value: `${response.status} ${response.statusText}`, inline: true },
                    { name: 'Response Data', value: `\`\`\`json\n${JSON.stringify(response.data, null, 2)}\n\`\`\`` }
                )
                .setColor(0x00FF00);

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            const embed = new EmbedBuilder()
                .setTitle('RoVer Access Request Test Error')
                .setDescription('An error occurred while calling the RoVer API.')
                .addFields(
                    { name: 'Status Code', value: `${error.response?.status || 'N/A'}`, inline: true },
                    { name: 'Error Message', value: `${error.message}`, inline: true },
                    { name: 'Response Data', value: `\`\`\`json\n${JSON.stringify(error.response?.data || {}, null, 2)}\n\`\`\`` }
                )
                .setColor(0xFF0000);

            await interaction.editReply({ embeds: [embed] });
        }
    }
};
