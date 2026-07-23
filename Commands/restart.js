const { spawn } = require('child_process');
const path = require('path');
const { SlashCommandBuilder } = require('discord.js');

module.exports = {

    data: new SlashCommandBuilder()
        .setName('restart') 
        .setDescription('Restarts the bot!')
        .setIntegrationTypes([0, 1])
        .setContexts([0, 1, 2]),


    async execute(interaction) {

        const BotOwnerId = process.env.BOT_OWNER_ID;


        if (interaction.user.id !== BotOwnerId) {
            return interaction.reply({
                content: 'Only the bot owner can restart the bot 💔',
            });
        }

        try {

            await interaction.reply('Restarting...');
            console.log('Restarting...');

            const scriptPath = path.resolve(__dirname, '..', 'index.js'); 

            const child = spawn(process.argv[0], [scriptPath], {
                detached: true,
                stdio: 'inherit'
            });

            child.unref();

            process.exit(0);

        } catch (error) {
            console.error('Error during bot restart process:', error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: 'Failed to restart.'}).catch(err => console.error('Error sending restart failure message:', err));
            } else {
                await interaction.followUp({ content: 'Failed to restart.'}).catch(err => console.error('Error sending restart failure message:', err));
            }
        }
    },
};
