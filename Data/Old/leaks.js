const fs = require('fs');
const path = require('path');
const { AttachmentBuilder } = require('discord.js');
const axios = require('axios');

function startMessageForwarder(client) {
    function loadProcessedMessageIds() {
        const filePath = './Data/leaks.json';
        if (!fs.existsSync(path.dirname(filePath))) {
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
        }
        try {
            if (fs.existsSync(filePath)) {
                const data = fs.readFileSync(filePath, 'utf8');
                const idsArray = JSON.parse(data);
                if (Array.isArray(idsArray)) return new Set(idsArray);
            }
        } catch {}
        return new Set();
    }

    function saveProcessedMessageIds(processedMessageIds) {
        const filePath = './Data/leaks.json';
        if (!fs.existsSync(path.dirname(filePath))) {
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
        }
        try {
            fs.writeFileSync(filePath, JSON.stringify(Array.from(processedMessageIds), null, 2), 'utf8');
        } catch {}
    }

    function processMessage(message) {
        if (!message.author || !message.author.bot) return null;
        let processedContent = (message.content || '')
            .replace(/@BGSI News/g, '')
            .replace(/@everyone/g, '')
            .replace(/@here/g, '')
            .replace(/\.gg\/\w+/g, '')
            .trim();
        if (!processedContent && message.attachments.length === 0) return null;
        processedContent += `\n-# Credit: [The Watcher](<https://tinyurl.com/thewatcherdiscord>)`;
        const files = [];
        if (message.attachments && Array.isArray(message.attachments)) {
            for (const attachment of message.attachments) {
                files.push(new AttachmentBuilder(attachment.url, { name: attachment.filename }));
            }
        }
        return { content: processedContent, files };
    }

    async function fetchAndForwardMessages() {
        const processedMessageIds = loadProcessedMessageIds();
        try {
            const targetChannel = await client.channels.fetch('1369797325156913242');
            if (!targetChannel) return;
            const url = 'https://discord.com/api/v9/channels/1386397861373022239/messages?limit=50';
            const headers = {
                'Authorization': process.env.DISCORD_SCRAPE_TOKEN,
                'Content-Type': 'application/json'
            };
            let messages;
            try {
                const res = await axios.get(url, { headers });
                messages = res.data;
            } catch (err) {
                if (
                    err.code === 'EAI_AGAIN' ||
                    err.code === 'ECONNRESET' ||
                    (err.cause && (err.cause.code === 'ECONNRESET' || err.cause.code === 'EAI_AGAIN'))
                ) {
                    if (!fetchAndForwardMessages.lastNetworkError || Date.now() - fetchAndForwardMessages.lastNetworkError > 300000) {
                        console.warn('Network error in fetchAndForwardMessages:', err.code || err.message);
                        fetchAndForwardMessages.lastNetworkError = Date.now();
                    }
                    setTimeout(fetchAndForwardMessages, 10000);
                    return;
                }
                return;
            }
            const messagesToProcess = messages.filter(msg => !processedMessageIds.has(msg.id)).reverse();
            for (const message of messagesToProcess) {
                const processed = processMessage(message);
                if (processed) {
                    try {
                        await targetChannel.send({
                            content: processed.content,
                            files: processed.files,
                        });
                        processedMessageIds.add(message.id);
                    } catch (sendErr) {
                        console.error(`[Discord] Failed to send embed for message ${message.id}:`, sendErr);
                    }
                } else {
                    processedMessageIds.add(message.id);
                }
            }
            saveProcessedMessageIds(processedMessageIds);
        } catch (error) {
            if (
                error.code === 'EAI_AGAIN' ||
                error.code === 'ECONNRESET' ||
                (error.cause && (error.cause.code === 'ECONNRESET' || error.cause.code === 'EAI_AGAIN'))
            ) {
                if (!fetchAndForwardMessages.lastNetworkError || Date.now() - fetchAndForwardMessages.lastNetworkError > 300000) {
                    console.warn('Network error in fetchAndForwardMessages:', error.code || error.message);
                    fetchAndForwardMessages.lastNetworkError = Date.now();
                }
                setTimeout(fetchAndForwardMessages, 10000);
                return;
            }
            console.error(error);
        }
    }

    fetchAndForwardMessages();
    setInterval(fetchAndForwardMessages, 6000);
}

module.exports = startMessageForwarder;
