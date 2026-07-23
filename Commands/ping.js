const { SlashCommandBuilder } = require('discord.js');
const https = require('https');

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

            function httpPing(url) {
                return new Promise((resolve) => {
                    const start = Date.now();
                    const req = https.get(url, res => {
                        res.on('data', () => {});
                        res.on('end', () => resolve(`${Date.now() - start}ms`));
                    });
                    req.on('error', () => resolve('timeout'));
                    req.setTimeout(2000, () => {
                        req.destroy();
                        resolve('timeout');
                    });
                });
            }

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
        await interaction.reply({ content: 'Pinging...' });
        const sent = await interaction.fetchReply();

        const botLatency = sent.createdTimestamp - interaction.createdTimestamp;
        const wsLatency = client.ws.ping >= 0 ? `${client.ws.ping}ms` : 'N/A';

        function httpPing(url) {
            return new Promise((resolve) => {
                const start = Date.now();
                const req = https.get(url, res => {
                    res.on('data', () => {});
                    res.on('end', () => resolve(`${Date.now() - start}ms`));
                });
                req.on('error', () => resolve('timeout'));
                req.setTimeout(2000, () => {
                    req.destroy();
                    resolve('timeout');
                });
            });
        }

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
}