const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

async function sendBumpCommand(headers, applicationId, channelId, sessionId) {
    const url = "https://discord.com/api/v9/interactions";
    const bumpPayload = {
        "type": 2,
        "application_id": applicationId,
        "guild_id": "1369439484659236954",
        "channel_id": channelId,
        "session_id": sessionId,
        "data": {
            "version": "1051151064008769576",
            "id": "947088344167366698",
            "name": "bump",
            "type": 1,
            "options": [],
            "application_command": {
                "id": "947088344167366698",
                "type": 1,
                "application_id": "302050872383242240",
                "version": "1051151064008769576",
                "name": "bump",
                "description": "Pushes your server to the top of all your server's tags and the front page",
                "description_default": "Pushes your server to the top of all your server's tags and the front page",
                "dm_permission": true,
                "integration_types": [0],
                "global_popularity_rank": 1,
                "options": [],
                "description_localized": "Bump this server.",
                "name_localized": "bump"
            },
            "attachments": []
        },
        "nonce": uuidv4().replace(/-/g, '').substring(0, 32),
        "analytics_location": "slash_ui"
    };

    try {
        const response = await axios.post(url, bumpPayload, { headers });

        if (response.status === 204) {
            return true;
        } else {
            console.error(`Failed to send /bump: ${response.status} - ${JSON.stringify(response.data)}`);
            return false;
        }
    } catch (error) {
        if (error.response) {
            console.error(`Error sending /bump command: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
        } else {
            console.error(`Error sending /bump command: ${error.message}`);
        }
        return false;
    }
}

async function main() {
    const headers = {
        "Authorization": process.env.DISCORD_SCRAPE_TOKEN,
        "Content-Type": "application/json",
        "Accept": "*/*",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        "Origin": "https://discord.com",
        "Referer": "https://discord.com/channels/1369439484659236954/1387388874950578249",
        "X-Discord-Locale": "en-US",
        "X-Discord-Timezone": "Europe/Amsterdam",
    };

    const applicationId = "302050872383242240";
    const channelId = "1387388874950578249";
    const sessionId = "fcdffc508dfe6071f97027ed74c13caf";
    const twoHoursInMs = 2 * 60 * 60 * 1000;

    while (true) {
        try {
            const bumpSent = await sendBumpCommand(headers, applicationId, channelId, sessionId);
            if (bumpSent) {
                const nextBumpTime = new Date(Date.now() + twoHoursInMs);
                await new Promise(resolve => setTimeout(resolve, twoHoursInMs));
            } else {
                console.log("Failed to send /bump command. Retrying in 5 minutes.");
                await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000));
            }

        } catch (error) {
            console.error(`An unexpected error occurred: ${error.message}`);
            console.log("An error occurred. Retrying in 5 minutes.");
            await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000));
        }
    }
}

main();

module.exports = { main };