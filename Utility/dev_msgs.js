const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const path = require('path');
const axios = require('axios');


const devs = [
    '248462746717388802',
    '1092270202953142352',
    '385861959343669280',
    '478695604738981898',
    '332902199103586326',
    '736993523986858124'
];

const contributors = [
    '790776133632917514',
    '630094927786934274'
];

const IgnoredChannels = [
    '1366538523876004011', '1366538381017878691', '1369760895756140574', '1366616480786944000',
    '1362861800181465098', '1366896038975111228', '1362398623094018048', '1361370195020484799',
    '1366658482299998228', '1360505111125823639', '1360509147057229964', '404040793720881154',
    '546227832326455306', '754150552874778734', '590249507044851715', '768403294715510826',
    '685592644428103744', '1223409821995241514', '1231850372725735485', '515584816100540427',
    '1212849311331909702', '590249311476908033', '922734290943504385', '404036514473836554',
    '608482797644152833', '1312221291884974202', '778765446110773310', '688897875345932365',
    '404014472533901312', '676981397763653632', '444932987881259028', '963289210503176242',
    '779548671263113217', '709115544468455474', '455877130367139866', '404014312651489292',
    '404014351893266432', '404014099920453633', '455405157216157716', '1214842766035517510',
    '775874980981768234', '1360355812756951120', '1213740016455524392', '1214431678559428628',
    '998201172995358890', '515591846693568513', '515585258356211732', '515585149140860930',
    '558467995299741696', '789580541845962783', '1046506754747404398', '1199439681293656226',
    '1373637048119988294'
];


let processedCache = null;

function loadProcessedMessages() {
    if (processedCache !== null) return processedCache;
    try {
        const filePath = path.join(__dirname, '../Data/messages.json');
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            processedCache = JSON.parse(data) || [];
            return processedCache;
        }
    } catch (e) { }
    processedCache = [];
    return processedCache;
}

async function saveProcessedMessages(arr) {
    processedCache = arr;
    try {
        await fs.promises.writeFile(path.join(__dirname, '../Data/messages.json'), JSON.stringify(arr, null, 2), 'utf8');
    } catch (e) {
        console.error('[dev_msgs] Error saving processed messages:', e);
    }
}

function clearPings(content) {
    content = content.replace(/@everyone/g, '[everyone]');
    content = content.replace(/@here/g, '[here]');
    content = content.replace(/<@&\d+>/g, '[role]');
    content = content.replace(/<@!?(\d+)>/g, '[user]');
    return content;
}

function formatAndSplitDevMessage({ username, tag, content, imageUrl, messageUrl, referencedMessage, roleType = 'developer' }) {
    const title = roleType === 'contributor' ? 'New message by a contributor' : 'New message by a developer';
    let baseMsg = `## ${title}\n\n`;

    if (referencedMessage) {
        const replyContent = referencedMessage.content || '[No content]';
        const replyAuthor = referencedMessage.author?.global_name || referencedMessage.author?.username || '[unknown]';
        const replyNick = referencedMessage.author?.username || '[unknown]';
        baseMsg += `**Reply to:** ${replyAuthor} (${replyNick})\n> ${replyContent}\n\n`;
    }

    baseMsg += `**Message from:** ${username} (${tag})\n> ${content}\n\n`;
    baseMsg += `**Message link:** [Here](${messageUrl})`;

    const chunks = [];
    let msg = baseMsg;
    while (msg.length > 2000) {
        let splitAt = msg.lastIndexOf('\n', 2000);
        if (splitAt === -1) splitAt = msg.lastIndexOf(' ', 2000);
        if (splitAt === -1) splitAt = 2000;
        chunks.push(msg.slice(0, splitAt));
        msg = msg.slice(splitAt);
    }
    if (msg.length > 0) chunks.push(msg);


    if (chunks.length > 1) {
        return chunks.map((chunk, i) => `**Part ${i + 1}/${chunks.length}**\n${chunk}`);
    } else {
        return chunks;
    }
}

const { selfbot } = require('./selfbot.js');

async function handleDevMessage(msg, client) {
    if (!msg.guild || msg.guild.id !== '350467905391034391') return;
    if (IgnoredChannels.includes(msg.channel.id)) return;

    const isDev = msg.author && devs.includes(String(msg.author.id));
    const isContributor = msg.author && contributors.includes(String(msg.author.id));
    if (!isDev && !isContributor) return;

    let processed = loadProcessedMessages();
    if (processed.find(m => m.id === msg.id && m.channel === msg.channel.id)) return;

    const now = Date.now();
    const msgTimestamp = new Date(msg.timestamp).getTime();
    const diffMs = now - msgTimestamp;
    if (diffMs > 86400000) return;

    const username = msg.author.username;
    const tag = msg.author.discriminator && msg.author.discriminator !== "0"
        ? `${msg.author.username}#${msg.author.discriminator}`
        : (msg.author.global_name ? `${msg.author.global_name}` : msg.author.username);
    const content = clearPings(msg.content || '');
    const messageUrl = `https://discord.com/channels/350467905391034391/${msg.channel.id}/${msg.id}`;
    let imageUrl = null;
    if (msg.attachments && msg.attachments.size > 0) {
        const img = [...msg.attachments.values()].find(a => a.contentType && a.contentType.startsWith('image/'));
        if (img) imageUrl = img.url;
    }

    const roleType = isContributor ? 'contributor' : 'developer';
    const devMessages = formatAndSplitDevMessage({
        username,
        tag,
        content,
        imageUrl,
        messageUrl,
        referencedMessage: msg.referencedMessage || null,
        roleType
    });

    const targetChannelId = isContributor ? '1428395746927050784' : '1383389926535729254';
    const discordChannel = await client.channels.fetch(targetChannelId).catch(() => null);
    if (discordChannel) {
        for (const devMsg of devMessages) {
            try {
                if (imageUrl && devMsg === devMessages[0]) {
                    await discordChannel.send({
                        content: devMsg,
                        files: [imageUrl]
                    });
                } else {
                    await discordChannel.send(devMsg);
                }
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (sendError) {
                if (sendError.code === 50001 || sendError.code === 50013) {
                } else if (sendError.code === 429) {
                    const retryAfter = sendError.headers && sendError.headers['retry-after'] ? sendError.headers['retry-after'] : 1;
                    await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
                    await discordChannel.send(devMsg);
                }
            }
        }
    }

    processed.push({ id: msg.id, channel: msg.channel.id });
    await saveProcessedMessages(processed);
}

async function catchUpDevMessages(client) {
    console.log('[dev_msgs] Performing startup developer messages catch-up...');
    try {
        const guild = await selfbot.guilds.fetch('350467905391034391').catch(() => null);
        if (!guild) {
            console.error('[dev_msgs] Selfbot could not fetch Big Games guild.');
            return;
        }

        const channels = await guild.channels.fetch().catch(() => new Map());
        for (const channel of channels.values()) {
            if (IgnoredChannels.includes(channel.id)) continue;
            if (channel.type !== 'GUILD_TEXT' && channel.type !== 'GUILD_NEWS' && channel.type !== 0 && channel.type !== 5) continue;

            try {
                const messages = await channel.messages.fetch({ limit: 30 }).catch(() => new Map());
                const msgList = [...messages.values()];
                
                // Clear any processed messages from cache that are no longer in the last 30 messages of the channel
                let processed = loadProcessedMessages();
                const messageIds = msgList.map(m => m.id);
                let overallChanged = false;

                for (let i = processed.length - 1; i >= 0; i--) {
                    if (processed[i].channel === channel.id && !messageIds.includes(processed[i].id)) {
                        processed.splice(i, 1);
                        overallChanged = true;
                    }
                }
                if (overallChanged) {
                    await saveProcessedMessages(processed);
                }

                // Process messages from oldest to newest
                for (const msg of msgList.reverse()) {
                    await handleDevMessage(msg, client);
                }
            } catch (chanErr) {
                console.error(`[dev_msgs] Failed to fetch channel messages for catch-up ${channel.id}:`, chanErr.message);
            }
            // Small delay between channels to avoid rate limit
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        console.log('[dev_msgs] Startup catch-up complete.');
    } catch (e) {
        console.error('[dev_msgs] Error during startup catch-up:', e);
    }
}

let devMsgWatcherStarted = false;

module.exports = function startDevMsgWatcher(client) {
    if (devMsgWatcherStarted) return;
    devMsgWatcherStarted = true;

    if (selfbot.readyAt) {
        initSelfbotDevMsgs();
    } else {
        selfbot.once('ready', initSelfbotDevMsgs);
    }

    async function initSelfbotDevMsgs() {
        // Asynchronously catch up on startup
        catchUpDevMessages(client).catch(err => console.error('[dev_msgs] Catch-up error:', err));

        // Bind real-time gateway listener
        selfbot.on('messageCreate', async (msg) => {
            try {
                await handleDevMessage(msg, client);
            } catch (err) {
                console.error('[dev_msgs] Error handling live message:', err);
            }
        });
    }
}