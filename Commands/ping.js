const { SlashCommandBuilder } = require('discord.js');
const https = require('https');

function httpPing(url) {
    return new Promise((resolve) => {
        const start = Date.now();
        try {
            const parsed = new URL(url);
            const req = https.request({
                protocol: parsed.protocol,
                hostname: parsed.hostname,
                path: parsed.pathname || '/',
                method: 'HEAD',
                timeout: 2000
            }, (res) => {
                res.resume();
                res.on('end', () => resolve(`${Date.now() - start}ms`));
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
            const sent = await message.reply('Checking...');
            const botLatency = sent.createdTimestamp - message.createdTimestamp;
            const wsLatency = client.ws.ping >= 0 ? `${client.ws.ping}ms` : 'N/A';

            const [googlePing, cloudflarePing] = await Promise.all([
                httpPing('https://google.com'),
                httpPing('https://1.1.1.1')
            ]);

            await sent.edit(
                `Pong! 🏓\n` +
                `Bot ⇒ \`${botLatency}ms\`\n` +
                `Websocket ⇒ \`${wsLatency}\`\n` +
                `Google ⇒ \`${googlePing}\`\n` +
                `1.1.1.1 ⇒ \`${cloudflarePing}\``
            );
        }
    },
    async execute(interaction, client) {
        const sent = await interaction.reply({ content: 'Pinging...', fetchReply: true });

        const botLatency = sent.createdTimestamp - interaction.createdTimestamp;
        const wsLatency = client.ws.ping >= 0 ? `${client.ws.ping}ms` : 'N/A';

        const [googlePing, cloudflarePing] = await Promise.all([
            httpPing('https://google.com'),
            httpPing('https://1.1.1.1')
        ]);

        await interaction.editReply({
            content:
                `Pong! 🏓\n` +
                `Bot ⇒ \`${botLatency}ms\`\n` +
                `Websocket ⇒ \`${wsLatency}\`\n` +
                `Google ⇒ \`${googlePing}\`\n` +
                `1.1.1.1 ⇒ \`${cloudflarePing}\``
        });
    }
};