const { Client } = require('discord.js-selfbot-v13');
const selfbot = new Client({
    checkUpdate: false,
    ws: {
        properties: {
            $os: 'Windows',
            $browser: 'Discord Client',
            $device: ''
        }
    }
});

let started = false;

function startSelfbot(discordClient) {
    if (started) return selfbot;
    started = true;

    selfbot.on('ready', () => {
        console.log(`[Selfbot] Logged in as ${selfbot.user.tag}`);
    });

    selfbot.on('error', (err) => {
        console.error('[Selfbot] Client error:', err);
    });

    if (process.env.DISCORD_SCRAPE_TOKEN) {
        selfbot.login(process.env.DISCORD_SCRAPE_TOKEN)
            .catch(err => console.error('[Selfbot] Login failed:', err));
    } else {
        console.error('[Selfbot] DISCORD_SCRAPE_TOKEN is missing!');
    }

    return selfbot;
}

module.exports = { startSelfbot, selfbot };
