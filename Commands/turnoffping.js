const { SlashCommandBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

const DisabledPingsPath = path.join(__dirname, '../Data/disabled_pings.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('turnoffping')
        .setDescription('Disable/Enable pings for yourself')
        .setIntegrationTypes([0])
        .setContexts([0, 1, 2]),

    async execute(interaction) {
        if (interaction.guildId && interaction.guildId !== '1369439484659236954') {
            await interaction.reply({
                content: `This command can only be used in the [bubbler discord server](https://discord.gg/4zXsCpqF3m)`,
                flags: 64
            });
            return;
        }

        const userId = interaction.user.id;
        let disabledPings = new Set();

        try {
            if (fs.existsSync(DisabledPingsPath)) {
                const data = fs.readFileSync(DisabledPingsPath, 'utf8');
                const parsedData = JSON.parse(data);

                if (Array.isArray(parsedData)) {
                    disabledPings = new Set(parsedData.map(item => item.id).filter(id => typeof id === 'string'));
                } else {
                    console.warn(`[TurnOffPing] disabled_pings.json content is not an array. Starting with an empty set.`);
                }
            }
        } catch (error) {
            console.error(`[TurnOffPing] Error loading disabled pings from ${DisabledPingsPath}:`, error);
            disabledPings = new Set();
        }

        let replyContent;

        if (disabledPings.has(userId)) {
            disabledPings.delete(userId);
            replyContent = 'You have **enabled** pings. You will get pinged again!';
        } else {
            disabledPings.add(userId);
            replyContent = 'You have **disabled** pings. You won\'t get pinged anymore!';
        }

        try {
            const arrayToSave = Array.from(disabledPings).map(id => ({ id: id }));
            fs.writeFileSync(DisabledPingsPath, JSON.stringify(arrayToSave, null, 2), 'utf8');
        } catch (error) {
            console.error(`[TurnOffPing] Error saving disabled pings to ${DisabledPingsPath}:`, error);
            replyContent = 'There was an error saving your preference. Please try again.';
        }

        await interaction.reply({ content: replyContent });
    },
};
