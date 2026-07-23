const fs = require('fs');
const path = require('path');
const readline = require('readline');
const axios = require('axios');
const secretsModule = require('./secrets'); 

module.exports = function(client) {
    client.on('guildMemberUpdate', async (oldMember, newMember) => {
        const hadRole = oldMember.roles.cache.has('1369702338968686804');
        const hasRole = newMember.roles.cache.has('1369702338968686804');

        if (!hadRole && hasRole) {
            const discordId = newMember.id;
            const guildId = newMember.guild.id;

            let robloxUsername = null;

            const roverUntil = typeof secretsModule.getRoverRateLimitUntil === 'function'
                ? secretsModule.getRoverRateLimitUntil()
                : 0;
            if (Date.now() < roverUntil) {

                if (typeof secretsModule.waitForRoverAvailable === 'function') {
                    try {
                        await secretsModule.waitForRoverAvailable();
                    } catch (e) {
                        console.error('Error waiting for RoVer availability:', e);
                        return;
                    }
                } else {
                    return;
                }
            }

            try {
                const url = `https://registry.rover.link/api/guilds/${guildId}/discord-to-roblox/${discordId}`;
                const response = await axios.get(url, {
                    headers: { 'Authorization': `Bearer ${process.env.ROVER_API_KEY}` }
                });
                robloxUsername = response.data?.cachedUsername || null;
            } catch (error) {
                console.error('Error fetching from Rover:', error?.response?.data || error);
                return;
            }

            if (!robloxUsername) {
                return;
            }

            const ndjsonPath = path.join(__dirname, '../Data/secrets.ndjson');
            const tempPath = ndjsonPath + '.tmp';
            let foundCount = 0;

            const rl = readline.createInterface({
                input: fs.createReadStream(ndjsonPath),
                crlfDelay: Infinity
            });

            const tempStream = fs.createWriteStream(tempPath);

            for await (const line of rl) {
                if (!line.trim()) continue;
                try {
                    const entry = JSON.parse(line);
                    let entryUsername = null;
                    const match = entry.hatchedBy?.match(/\(@([a-zA-Z0-9_]+)\)/);
                    if (match && match[1]) {
                        entryUsername = match[1];
                    } else if (entry.hatchedBy) {
                        entryUsername = entry.hatchedBy.split(' ')[0];
                    }
                    if (
                        entryUsername &&
                        robloxUsername &&
                        entryUsername.trim().toLowerCase() === robloxUsername.trim().toLowerCase()
                    ) {
                        foundCount++;
                        entry.discordUserId = discordId;
                        tempStream.write(JSON.stringify(entry) + '\n');
                    } else {
                        tempStream.write(line + '\n');
                    }
                } catch (err) {
                    console.error('Error parsing line:', err);
                    tempStream.write(line + '\n');
                }
            }
            rl.close();
            tempStream.end();

            tempStream.on('finish', () => {
                if (foundCount > 0) {
                    fs.renameSync(tempPath, ndjsonPath);
                } else {
                    if (fs.existsSync(tempPath)) {
                        fs.unlinkSync(tempPath);
                    }
                }
            });
        }
    });
};