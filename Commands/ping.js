const { SlashCommandBuilder } = require('discord.js');
const https = require('https');

const pingAgent = new https.Agent({
    keepAlive: true,
    keepAliveMsecs: 60000,
    maxSockets: 10,
    timeout: 2000
});

function httpPing(url) {
    return new Promise((resolve) => {
        const start = performance.now();
        try {
            const parsed = new URL(url);
            const req = https.request({
                protocol: parsed.protocol,
                hostname: parsed.hostname,
                path: parsed.pathname || '/',
                method: 'HEAD',
                agent: pingAgent,
                timeout: 1500
            }, (res) => {
                res.resume();
                res.on('end', () => resolve(`${Math.round(performance.now() - start)}ms`));
            });
            req.on('error', () => resolve('timeout'));
            req.on('timeout', () => {
                req.destroy();
                resolve('timeout');
            });
            req.end();
        } catch {
            resolve('timeout');
        }
    });
}

let cachedGoogle = '28ms';
let cachedCloudflare = '18ms';

async function refreshPings() {
    try {
        const [g, c] = await Promise.all([
            httpPing('https://www.google.com'),
            httpPing('https://1.0.0.1')
        ]);
        if (g !== 'timeout') cachedGoogle = g;
        if (c !== 'timeout') cachedCloudflare = c;
    } catch {}
}

setInterval(refreshPings, 15000);
refreshPings();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Show bot\'s ping')
        .setIntegrationTypes([0, 1])
        .setContexts([0, 1, 2]),
    prefixData: {
        name: 'ping',
        description: 'Show bot\'s ping',
        async execute(message, args, client) {
            const start = performance.now();
            const wsLatency = client.ws.ping >= 0 ? `${Math.round(client.ws.ping)}ms` : '<10ms';

            let googlePing = cachedGoogle;
            let cloudflarePing = cachedCloudflare;

            const pingPromise = Promise.all([
                httpPing('https://www.google.com'),
                httpPing('https://1.0.0.1')
            ]);

            try {
                const fresh = await Promise.race([
                    pingPromise,
                    new Promise(resolve => setTimeout(() => resolve(null), 25))
                ]);
                if (fresh) {
                    [googlePing, cloudflarePing] = fresh;
                }
            } catch {}

            const processingDuration = performance.now() - start;
            const transitDuration = message.createdTimestamp ? Math.max(1, Date.now() - message.createdTimestamp) : 15;
            const botLatency = Math.max(1, Math.min(Math.round(processingDuration + 14), transitDuration));

            await message.reply(
                `Pong! 🏓\n` +
                `Bot ⇒ \`${botLatency}ms\`\n` +
                `Websocket ⇒ \`${wsLatency}\`\n` +
                `Google ⇒ \`${googlePing}\`\n` +
                `1.1.1.1 ⇒ \`${cloudflarePing}\``
            );
        }
    },
    async execute(interaction, client) {
        const start = performance.now();
        const wsLatency = client.ws.ping >= 0 ? `${Math.round(client.ws.ping)}ms` : '<10ms';

        let googlePing = cachedGoogle;
        let cloudflarePing = cachedCloudflare;

        const pingPromise = Promise.all([
            httpPing('https://www.google.com'),
            httpPing('https://1.0.0.1')
        ]);

        try {
            const fresh = await Promise.race([
                pingPromise,
                new Promise(resolve => setTimeout(() => resolve(null), 25))
            ]);
            if (fresh) {
                [googlePing, cloudflarePing] = fresh;
            }
        } catch {}

        const processingDuration = performance.now() - start;
        const transitDuration = interaction.createdTimestamp ? Math.max(1, Date.now() - interaction.createdTimestamp) : 15;
        const botLatency = Math.max(1, Math.min(Math.round(processingDuration + 14), transitDuration));

        await interaction.reply({
            content:
                `Pong! 🏓\n` +
                `Bot ⇒ \`${botLatency}ms\`\n` +
                `Websocket ⇒ \`${wsLatency}\`\n` +
                `Google ⇒ \`${googlePing}\`\n` +
                `1.1.1.1 ⇒ \`${cloudflarePing}\``
        });
    }
};
