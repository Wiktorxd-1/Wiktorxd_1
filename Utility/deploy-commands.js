const { REST, Routes } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config();

const Token = process.env.DISCORD_TOKEN;
const DiscordClientId = process.env.DISCORD_CLIENT_ID;

if (!Token) {
    console.error("DISCORD_TOKEN is not set in your .env file.");
    process.exit(1);
}

if (!DiscordClientId) {
    console.error("DiscordClientId is not set in your .env file.");
    process.exit(1);
}

const commands = [];

const commandsPath = path.join(__dirname, '../Commands');
let commandFiles = [];
try {
    commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
} catch (err) {
    console.error(`Error reading commands directory: ${err.message}`);
    process.exit(1);
}

for (const file of commandFiles) {
    try {
        const command = require(path.join(commandsPath, file));
        if (command.data && command.execute) {
            commands.push(command.data.toJSON());
        } else {
            console.warn(`[WARNING] The command at ${path.join(commandsPath, file)} is missing a required "data" or "execute" property.`);
        }
    } catch (err) {
        console.error(`Error loading command file ${file}: ${err.message}`);
    }
}

const rest = new REST({ version: '10' }).setToken(Token);

(async () => {
    try {
        console.log(`Started refreshing ${commands.length} application (/) commands.`);
        const data = await rest.put(
            Routes.applicationCommands(DiscordClientId),
            { body: commands },
        );
        console.log(`Successfully reloaded ${data.length} application (/) commands.`);

        data.forEach(cmd => console.log(`- ${cmd.name}`));
    } catch (error) {
        console.error(error);
    }
})();