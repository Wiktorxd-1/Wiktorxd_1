const { Client, IntentsBitField, ActivityType, Collection, REST, Routes } = require('discord.js');
require('dotenv').config();
const fs = require('fs');
const { startUptimeUpdater } = require('./Utility/uptime');
const startDevMsgWatcher = require('./Utility/dev_msgs.js');
const startSecretsWatcher = require('./Utility/Hatches/secrets.js');
require('./Utility/deploy-commands.js');
const startOnMember = require('./Utility/Hatches/on_member.js');
const startUpdatesMonitor = require('./Utility/updates.js');
const { startHatchesApi } = require('./Utility/hatches_api.js');
const { initializeDailyPerks, handleDailyPerkInteraction } = require('./Utility/daily_perks.js');
const Events = require('events');


Events.EventEmitter.defaultMaxListeners = 20;

const client = new Client({
    intents: [
        IntentsBitField.Flags.Guilds,
        IntentsBitField.Flags.GuildMembers,
        IntentsBitField.Flags.GuildModeration,
        IntentsBitField.Flags.GuildEmojisAndStickers,
        IntentsBitField.Flags.GuildIntegrations,
        IntentsBitField.Flags.GuildWebhooks,
        IntentsBitField.Flags.GuildInvites,
        IntentsBitField.Flags.GuildVoiceStates,
        IntentsBitField.Flags.GuildPresences,
        IntentsBitField.Flags.GuildMessages,
        IntentsBitField.Flags.GuildMessageReactions,
        IntentsBitField.Flags.GuildMessageTyping,
        IntentsBitField.Flags.DirectMessages,
        IntentsBitField.Flags.DirectMessageReactions,
        IntentsBitField.Flags.DirectMessageTyping,
        IntentsBitField.Flags.MessageContent,
        IntentsBitField.Flags.GuildScheduledEvents,
        IntentsBitField.Flags.AutoModerationConfiguration,
        IntentsBitField.Flags.AutoModerationExecution
    ],
    rest: {
        timeout: 300000 // 5 minutes
    }
});

client.setMaxListeners(20);

client.commands = new Collection();
client.prefixCommands = new Collection();

let remindmeCommandModule = null;

const Prefix = process.env.PREFIX || '?';

let startTime;

async function onClientReady(readyClient) {
    const path = require('path');
    const commandsPath = path.join(__dirname, 'Commands');
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);

        if (command.data && command.execute) {
            readyClient.commands.set(command.data.name, command);
            if (command.data.name === 'remindme') {
                remindmeCommandModule = command;
            }
        } else {
            console.warn(`The command at ${filePath} is missing a required "data" or "execute" property for Slash Commands.`);
        }

        if (command.prefixData && command.prefixData.name && command.prefixData.execute) {
            readyClient.prefixCommands.set(command.prefixData.name, command.prefixData);
        }
    }

    console.log(`Logged in as ${readyClient.user.tag}!`);
    startTime = Date.now();
    startUptimeUpdater(readyClient, () => startTime);

    if (remindmeCommandModule && remindmeCommandModule.startChecker) {
        await remindmeCommandModule.startChecker(readyClient);
    } else {
        console.warn('remindme command module or its startChecker function not found. Reminders will not function.');
    }

    const { startSelfbot } = require('./Utility/selfbot.js');
    startSelfbot(readyClient);

    startDevMsgWatcher(readyClient);
    startSecretsWatcher(readyClient);

    startUpdatesMonitor(readyClient);
    startOnMember(readyClient);
    startHatchesApi(readyClient);
    initializeDailyPerks(readyClient);


    const startAutoRoleAssigner = require('./Utility/auto_role.js');
    startAutoRoleAssigner(readyClient);


    const startEventsWatcher = require('./Utility/events.js');
    startEventsWatcher(readyClient);
    const MessageCacheClearIntervalMs = 10 * 60 * 1000;

    function clearMessageCaches() {
        try {
            for (const guild of readyClient.guilds.cache.values()) {
                try {
                    for (const channel of guild.channels.cache.values()) {
                        try {
                            if (channel?.messages?.cache && typeof channel.messages.cache.clear === 'function') {
                                channel.messages.cache.clear();
                            }
                        } catch (e) {}
                    }
                } catch (e) {}
            }
            try {
                if (readyClient?.channels?.cache) {
                    for (const ch of readyClient.channels.cache.values()) {
                        try {
                            if (ch?.messages?.cache && typeof ch.messages.cache.clear === 'function') {
                                ch.messages.cache.clear();
                            }
                        } catch (e) {}
                    }
                }
            } catch (e) {}
        } catch (err) {
            console.error('Error clearing message caches:', err);
        }
    }

    clearMessageCaches();
    setInterval(clearMessageCaches, MessageCacheClearIntervalMs);
}

client.once('clientReady', onClientReady);

client.on('error', error => {
    console.error('A client error has occurred:', error);
});

client.on('warn', info => {
    console.warn('A client warning has occurred:', info);
});

client.on('interactionCreate', async interaction => {
    
    if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);

        if (!command) return;

        try {
            await command.execute(interaction, client);
        } catch (error) {
            console.error(error);
            try {
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ content: 'There was an error executing this command!', flags: 64 });
                } else {
                    await interaction.reply({ content: 'There was an error executing this command!', flags: 64 });
                }
            } catch (replyError) {
                // Interaction expired or already acknowledged
            }
        }
    } else if (interaction.isStringSelectMenu()) {
        handleDailyPerkInteraction(interaction);
    }
});

client.on('messageCreate', async message => {
    if (message.author.bot || !message.content.startsWith(Prefix)) return;

    const args = message.content.slice(Prefix.length).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();

    const command = client.prefixCommands.get(commandName);

    if (!command) return;

    try {
        await command.execute(message, args, client);
    } catch (error) {
        console.error('Prefix command error:', error);
        message.reply('There was an error executing this prefix command!');
    }
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Promise Rejection:', reason);
});



client.login(process.env.DISCORD_TOKEN);