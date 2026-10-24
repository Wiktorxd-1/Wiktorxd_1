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
            const pingPromises = Promise.all([
                httpPing('https://google.com'),
                httpPing('https://1.1.1.1')
            ]);
            const botLatency = Math.max(1, Date.now() - message.createdTimestamp);
            const wsLatency = client.ws.ping >= 0 ? `${Math.round(client.ws.ping)}ms` : `${Math.max(1, Math.round(botLatency / 2))}ms`;
            const [googlePing, cloudflarePing] = await pingPromises;

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
        const pingPromises = Promise.all([
            httpPing('https://google.com'),
            httpPing('https://1.1.1.1')
        ]);
        const botLatency = Math.max(1, Date.now() - interaction.createdTimestamp);
        const wsLatency = client.ws.ping >= 0 ? `${Math.round(client.ws.ping)}ms` : `${Math.max(1, Math.round(botLatency / 2))}ms`;
        const [googlePing, cloudflarePing] = await pingPromises;

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
