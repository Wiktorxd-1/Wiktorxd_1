const { SlashCommandBuilder, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reload')
        .setDescription('Reloads all commands')
        .setIntegrationTypes([0, 1])
        .setContexts([0, 1, 2]),

    async execute(interaction) {
        if (process.env.BOT_OWNER_ID && interaction.user.id !== process.env.BOT_OWNER_ID) {
            return interaction.reply({ content: 'You do not have permission to reload commands.', flags: 64 });
        }

        const client = interaction.client;
        const commands = [];
        const commandsPath = path.join(__dirname, '..', 'Commands');
        const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

        client.commands = new Collection();

        let replied = false;
        for (const file of commandFiles) {
            const filePath = path.join(commandsPath, file);
            delete require.cache[require.resolve(filePath)];
            let command;
            try {
                command = require(filePath);
            } catch (error) {
                console.error(`Error loading command file ${file}:`, error);
                if (!replied) {
                    await interaction.reply({ content: `Error loading command: \`${file}\`. Check console for details.`, flags: 64 });
                    replied = true;
                } else {
                    await interaction.followUp({ content: `Error loading command: \`${file}\`. Check console for details.`, flags: 64 });
                }
                continue;
            }
            if (command.data && command.data.name && command.execute) {
                if (client.commands.has(command.data.name)) {
                    console.error(`Duplicate command name found: "${command.data.name}" in file: ${file}`);
                    if (!replied) {
                        await interaction.reply({ content: `Duplicate command name found: \`${command.data.name}\` in file: \`${file}\`. Please fix this.`, flags: 64 });
                        replied = true;
                    } else {
                        await interaction.followUp({ content: `Duplicate command name found: \`${command.data.name}\` in file: \`${file}\`. Please fix this.`, flags: 64 });
                    }
                }
                client.commands.set(command.data.name, command);
                commands.push(command.data.toJSON());
            } else {
                console.warn(`The command at ${filePath} is missing a required "data" or "execute" property.`);
                if (!replied) {
                    await interaction.reply({ content: `The command file \`${file}\` is missing 'data' or 'execute'.`, flags: 64 });
                    replied = true;
                } else {
                    await interaction.followUp({ content: `The command file \`${file}\` is missing 'data' or 'execute'.`, flags: 64 });
                }
            }
        }

        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        const ClientId = process.env.CLIENT_ID;

        try {
            await rest.put(
                Routes.applicationCommands(ClientId),
                { body: commands },
            );
            if (!replied) {
                await interaction.reply({ content: 'Commands reloaded!', flags: 64 });
            } else {
                await interaction.followUp({ content: 'Commands reloaded!', flags: 64 });
            }
        } catch (error) {
            console.error('Error during command deployment:', error);
            if (!replied) {
                await interaction.reply({ content: 'Failed to reload commands. Check console for details.', flags: 64 });
            } else {
                await interaction.followUp({ content: 'Failed to reload commands. Check console for details.', flags: 64 });
            }
        }
    }
};
