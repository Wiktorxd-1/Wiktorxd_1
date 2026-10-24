const { Client, IntentsBitField, ActivityType, Collection, Options } = require('discord.js');
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const dns = require('dns');
const { Agent } = require('undici');
const { startUptimeUpdater } = require('./Utility/uptime');
const startDevMsgWatcher = require('./Utility/dev_msgs.js');
const startSecretsWatcher = require('./Utility/Hatches/secrets.js');
const startOnMember = require('./Utility/Hatches/on_member.js');
const startUpdatesMonitor = require('./Utility/updates.js');
const { startHatchesApi } = require('./Utility/hatches_api.js');
const { initializeDailyPerks, handleDailyPerkInteraction } = require('./Utility/daily_perks.js');
const { startTempCleaner } = require('./Utility/storage_cleaner.js');
const { checkRateLimit } = require('./Utility/rate_limiter.js');
const Events = require('events');

dns.setDefaultResultOrder('ipv4first');

const restAgent = new Agent({
    keepAliveTimeout: 60000,
    keepAliveMaxTimeout: 300000,
    pipelining: 1,
    connect: {
        keepAlive: true,
        keepAliveInitialDelay: 10000,
        noDelay: true
    }
});

Events.EventEmitter.defaultMaxListeners = 20;
startTempCleaner();

if (process.env.DEPLOY_COMMANDS === 'true' || process.argv.includes('--deploy')) {
    const { deployCommands } = require('./Utility/deploy-commands.js');
    deployCommands().catch(err => console.error('Command deployment error:', err));
}

const client = new Client({
    intents: [
        IntentsBitField.Flags.Guilds,
        IntentsBitField.Flags.GuildMembers,
        IntentsBitField.Flags.GuildPresences,
        IntentsBitField.Flags.GuildMessages,
        IntentsBitField.Flags.DirectMessages,
        IntentsBitField.Flags.MessageContent
    ],
    makeCache: Options.cacheWithLimits({
        MessageManager: 25,
        ThreadMemberManager: 0,
        StageInstanceManager: 0,
        ReactionUserManager: 0,
        VoiceStateManager: 0,
        GuildScheduledEventManager: 0,
        AutoModerationRuleManager: 0
    }),
    sweepers: {
        messages: {
            interval: 300,
            lifetime: 60
        }
    },
    ws: {
        large_threshold: 50
    },
    rest: {
        agent: restAgent,
        offset: 0,
        timeout: 15000
    }
});

client.setMaxListeners(20);

client.commands = new Collection();
client.prefixCommands = new Collection();

let remindmeCommandModule = null;
const Prefix = process.env.PREFIX || '?';
let startTime;

async function onClientReady(readyClient) {
    const commandsPath = path.join(__dirname, 'Commands');
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        try {
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
        } catch (err) {
            console.error(`Failed to load command file ${file}:`, err);
        }
    }

    console.log(`Logged in as ${readyClient.user.tag}!`);
    readyClient.rest.get('/gateway').catch(() => {});
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

    const MessageCacheClearIntervalMs = 30 * 60 * 1000;
    function clearMessageCaches() {
        try {
            for (const guild of readyClient.guilds.cache.values()) {
                for (const channel of guild.channels.cache.values()) {
                    if (channel?.messages?.cache && typeof channel.messages.cache.clear === 'function') {
                        channel.messages.cache.clear();
                    }
                }
            }
            if (readyClient?.channels?.cache) {
                for (const ch of readyClient.channels.cache.values()) {
                    if (ch?.messages?.cache && typeof ch.messages.cache.clear === 'function') {
                        ch.messages.cache.clear();
                    }
                }
            }
        } catch (err) {
            console.error('Error clearing message caches:', err);
        }
    }

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
        const isOwner = interaction.user.id === process.env.BOT_OWNER_ID;
        if (!isOwner) {
            const rl = checkRateLimit(interaction.user.id);
            if (rl.limited) {
                return interaction.reply({
                    content: `⏳ **Slow down!** You can only run up to 3 commands every 10 seconds. Please wait **${rl.retryAfter}s** before trying again.`,
                    flags: 64
                });
            }
        }
        const command = client.commands.get(interaction.commandName);

        if (!command) return;

        try {
            await command.execute(interaction, client);
        } catch (error) {
            console.error(`Error executing /${interaction.commandName}:`, error);
            try {
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ content: 'There was an error executing this command!', flags: 64 });
                } else {
                    await interaction.reply({ content: 'There was an error executing this command!', flags: 64 });
                }
            } catch {}
        }
    } else if (interaction.isStringSelectMenu()) {
        handleDailyPerkInteraction(interaction);
    }
});

client.on('messageCreate', async message => {
    if (message.author.bot || !message.content.startsWith(Prefix)) return;

    const isOwner = message.author.id === process.env.BOT_OWNER_ID;
    if (!isOwner) {
        const rl = checkRateLimit(message.author.id);
        if (rl.limited) {
            return message.reply(`⏳ **Slow down!** You can only run up to 3 commands every 10 seconds. Please wait **${rl.retryAfter}s** before trying again.`).catch(() => {});
        }
    }

    const args = message.content.slice(Prefix.length).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();

    const command = client.prefixCommands.get(commandName);
    if (!command) return;

    try {
        await command.execute(message, args, client);
    } catch (error) {
        console.error(`Error executing prefix command ${Prefix}${commandName}:`, error);
        message.reply('There was an error executing this prefix command!').catch(() => {});
    }
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Promise Rejection:', reason);
});

process.on('uncaughtException', error => {
    console.error('Uncaught Exception:', error);
});

client.login(process.env.DISCORD_TOKEN);
