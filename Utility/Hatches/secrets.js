require('dotenv').config();

const { EmbedBuilder } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

let inMemoryCache = [];
let secretsWatcherStarted = false;

let hatchesEnabledCached = true;
let lastFlagsCheck = 0;

function isHatchesEnabled() {
    const now = Date.now();
    if (now - lastFlagsCheck > 10000) {
        lastFlagsCheck = now;
        fs.promises.readFile(path.join(__dirname, '../../flags.txt'), 'utf8')
            .then(data => {
                const lines = data.split('\n');
                let found = false;
                for (const line of lines) {
                    const [key, value] = line.split('=');
                    if (key && key.trim() === 'hatches') {
                        hatchesEnabledCached = value && value.trim().toLowerCase() === 'true';
                        found = true;
                        break;
                    }
                }
                if (!found) hatchesEnabledCached = true;
            })
            .catch(() => {});
    }
    return hatchesEnabledCached;
}

const DataDir = path.resolve(__dirname, '../../Data');
const DisabledPingsPath = path.join(DataDir, 'disabled_pings.json');
const LastIdPath = path.join(DataDir, 'last_processed_id.txt');
const last_id_2 = path.join(DataDir, 'last_processed_id_2.txt');
const TrackedPath = path.join(DataDir, 'tracked.json');
const EarlierSecretsPath = path.join(DataDir, 'earlier_secrets.json');
const BackupPath = path.join(DataDir, 'secrets_backup.ndjson');

const NdjsonPath = path.join(DataDir, 'secrets.ndjson');

async function flushAllBackupsToDatabase() {
    const filesToFlush = [BackupPath, NdjsonPath];
    for (const filePath of filesToFlush) {
        if (!fs.existsSync(filePath)) continue;
        try {
            const raw = await fs.promises.readFile(filePath, 'utf8');
            const lines = raw.split('\n').filter(l => l.trim());
            if (lines.length === 0) continue;

            console.log(`[Database] Found ${lines.length} secrets in ${path.basename(filePath)}. Flushing to database...`);

            const insertQuery = `
                INSERT INTO secrets (id, name, timestamp, imageUrl, totalHatched, rarity, hatchedBy, discordUserId)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    name = VALUES(name),
                    timestamp = VALUES(timestamp),
                    imageUrl = VALUES(imageUrl),
                    totalHatched = VALUES(totalHatched),
                    rarity = VALUES(rarity),
                    hatchedBy = VALUES(hatchedBy),
                    discordUserId = VALUES(discordUserId)
            `;

            for (const line of lines) {
                let secret;
                try {
                    secret = JSON.parse(line);
                } catch(e) { continue; } // skip malformed lines

                let timestamp = null;
                if (secret.timestamp) {
                    try {
                        const parsed = new Date(secret.timestamp);
                        if (!Number.isNaN(parsed.getTime())) {
                            timestamp = parsed.toISOString().slice(0, 19).replace('T', ' ');
                        }
                    } catch {}
                }
                const id = secret.id || (secret.name + '-' + secret.timestamp);
                const name = secret.name || 'Unknown';
                const imageUrl = secret.imageUrl || null;
                const totalHatched = secret.totalHatched || 0;
                const rarity = secret.rarity || 'Unknown';
                const hatchedBy = secret.hatchedBy || 'Unknown';
                const discordUserId = secret.discordUserId !== undefined ? String(secret.discordUserId) : null;

                await pool.query(insertQuery, [id, name, timestamp, imageUrl, totalHatched, rarity, hatchedBy, discordUserId]);
            }

            // Only clear the file if all inserts succeed
            await fs.promises.writeFile(filePath, '', 'utf8');
            console.log(`[Database] ${path.basename(filePath)} successfully flushed to database and cleared locally.`);
        } catch (err) {
            console.error(`[Database] Failed to flush ${path.basename(filePath)} to database:`, err.message);
        }
    }
}

const ScrapeHeaders = {
    'Authorization': process.env.DISCORD_SCRAPE_TOKEN,
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
};
const RoverApiKey = process.env.ROVER_API_KEY;

const preference = require('./preference');
const dmSupport = require('./dm_support');

const disabledPings = new Set();
let roverRateLimitUntil = 0;
let roverRateLimitTimeout = null;
const channelOriginalTopics = new Map();
let discordTopicRateLimitUntil = 0;

async function initializeDatabase() {
    const createTableQuery = `
        CREATE TABLE IF NOT EXISTS secrets (
            id VARCHAR(50) PRIMARY KEY,
            name VARCHAR(255),
            timestamp DATETIME,
            imageUrl VARCHAR(512),
            totalHatched VARCHAR(50),
            rarity VARCHAR(100),
            hatchedBy VARCHAR(100),
            discordUserId VARCHAR(50)
        );
    `;
    try {
        await pool.query(createTableQuery);
        console.log('[Database] Secrets table initialized.');
    } catch (err) {
        console.error('[Database] Failed to initialize secrets table:', err);
    }
}

async function patchChannelTopicViaApi(channelId, topic) {
    const token = process.env.DISCORD_TOKEN;
    if (!token) {
        console.error('[RateLimit] DISCORD_TOKEN not set; cannot patch channel topic via API.');
        return false;
    }

    if (Date.now() < discordTopicRateLimitUntil) {
        const waitSec = Math.ceil((discordTopicRateLimitUntil - Date.now()) / 1000);
        console.warn(`[RateLimit] Didnt update topic, still rate limited by discord for ${waitSec}s`);
        return false;
    }

    try {
        await axios.patch(
            `https://discord.com/api/v9/channels/${channelId}`,
            { topic },
            {
                headers: {
                    Authorization: `${process.env.DISCORD_SCRAPE_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            }
        );
        return true;
    } catch (err) {
        const resp = err.response;
        if (resp && (resp.status === 429 || resp.data?.retry_after)) {
            const retrySeconds = parseFloat(resp.data?.retry_after || resp.headers?.['retry-after'] || 60);
            discordTopicRateLimitUntil = Date.now() + Math.ceil(retrySeconds * 1000);
            console.warn(`[RateLimit] discord rate limited the self bot for ${Math.ceil(retrySeconds)}s`);
            return false;
        }

        console.error('[RateLimit] Failed to patch channel topic via API:', resp?.data || err.message || err);
        return false;
    }
}

async function fetchChannelInfoViaApi(channelId) {
    const token = process.env.DISCORD_TOKEN;
    if (!token) {
        console.error('[RateLimit] DISCORD_TOKEN not set; cannot fetch channel info via API.');
        return null;
    }
    try {
        const res = await axios.get(`https://discord.com/api/v9/channels/${channelId}`, {
            headers: { Authorization: `Bot ${token}` },
            timeout: 10000
        });
        return res.data || null;
    } catch (err) {
        console.error('[RateLimit] Failed to fetch channel info via API:', err.response?.data || err.message || err);
        return null;
    }
}

async function setChannelTopicOnRateLimit(channelOrId, untilTimestamp) {
    try {
        const channelId = typeof channelOrId === 'string' ? channelOrId : (channelOrId?.id || '1383484997318480013');
        if (!channelOriginalTopics.has(channelId)) {
            const info = await fetchChannelInfoViaApi(channelId);
            const currentTopic = info && typeof info.topic === 'string' ? info.topic : '';
            channelOriginalTopics.set(channelId, currentTopic);
        }
        const topicText = `Bot is rate limited for: <t:${Math.floor(untilTimestamp / 1000)}:R>`;
        const ok = await patchChannelTopicViaApi(channelId, topicText);
        if (!ok) console.warn('[RateLimit] patchChannelTopicViaApi returned false when setting topic');
    } catch (e) {
        console.error('Failed to set channel topic on rate limit (api):', e);
    }
}

async function clearChannelTopic(channelOrId) {
    try {
        const channelId = typeof channelOrId === 'string' ? channelOrId : (channelOrId?.id || '1383484997318480013');
        const original = channelOriginalTopics.has(channelId) ? channelOriginalTopics.get(channelId) : '';
        const ok = await patchChannelTopicViaApi(channelId, original || '');
        if (!ok) console.warn('[RateLimit] patchChannelTopicViaApi returned false when clearing topic');
        channelOriginalTopics.delete(channelId);
    } catch (e) {
        console.error('Failed to clear channel topic (api):', e);
    }
}

async function handleRoverRateLimit(channelOrId, retryAfterMs) {
    const until = Date.now() + retryAfterMs;
    roverRateLimitUntil = until;
    if (roverRateLimitTimeout) clearTimeout(roverRateLimitTimeout);

    const channelId = typeof channelOrId === 'string' ? channelOrId : (channelOrId?.id || '1383484997318480013');

    try {
        await setChannelTopicOnRateLimit(channelId, until);
    } catch (e) {
        console.error('Failed to set channel topic on rate limit via API:', e);
    }

    const remainingMs = Math.max(0, until - Date.now());
    roverRateLimitTimeout = setTimeout(async () => {
        roverRateLimitUntil = 0;
        try {
            await clearChannelTopic(channelId);
        } catch (e) {
            console.error('Failed to restore channel topic via API after rate limit expired:', e);
        }
    }, remainingMs);
}

async function ensureDataDirectoryExists() {
    try {
        await fs.promises.mkdir(DataDir, { recursive: true });
    } catch (error) {
        console.error(`[Config] FATAL ERROR: Could not create data directory at ${DataDir}:`, error);
        process.exit(1);
    }
}

async function ensureCacheIsFresh() {
    if (inMemoryCache.length === 0) {
        try {
            const [rows] = await pool.query('SELECT * FROM secrets ORDER BY timestamp DESC LIMIT 10000');
            inMemoryCache = rows.reverse().map(row => ({
                id: row.id,
                name: row.name,
                timestamp: row.timestamp ? new Date(row.timestamp).toISOString().replace(/\.\d{3}Z$/, '') : null,
                imageUrl: row.imageUrl,
                totalHatched: row.totalHatched,
                rarity: row.rarity,
                hatchedBy: row.hatchedBy,
                discordUserId: row.discordUserId
            }));
        } catch (e) {
            console.error('[Database] Failed to refresh cache from database:', e);
            try {
                if (fs.existsSync(EarlierSecretsPath)) {
                    const raw = fs.readFileSync(EarlierSecretsPath, 'utf8').trim();
                    if (raw) {
                        const data = JSON.parse(raw);
                        if (Array.isArray(data)) {
                            inMemoryCache = data.slice(-10000);
                            console.log(`[Database Fallback] Loaded ${inMemoryCache.length} secrets from earlier_secrets.json to memory cache.`);
                        }
                    } else {
                        console.log('[Database Fallback] earlier_secrets.json is empty, skipping cache load.');
                    }
                }
            } catch (err) {
                console.error('[Database Fallback] Failed to load earlier_secrets.json cache:', err.message);
            }
        }
    }
}

async function* iterateAllEntries() {
    try {
        const [rows] = await pool.query('SELECT * FROM secrets ORDER BY timestamp ASC');
        for (const row of rows) {
            yield {
                id: row.id,
                name: row.name,
                timestamp: row.timestamp ? new Date(row.timestamp).toISOString().replace(/\.\d{3}Z$/, '') : null,
                imageUrl: row.imageUrl,
                totalHatched: row.totalHatched,
                rarity: row.rarity,
                hatchedBy: row.hatchedBy,
                discordUserId: row.discordUserId
            };
        }
    } catch (e) {
        console.error('[Database] Failed to iterate entries from database:', e);
    }
}

async function loadDisabledPings() {
    await ensureDataDirectoryExists();
    try {
        const data = await fs.promises.readFile(DisabledPingsPath, 'utf8');
        const disabledUsers = JSON.parse(data);
        disabledPings.clear();
        if (Array.isArray(disabledUsers)) {
            disabledUsers.forEach(user => user.id && disabledPings.add(user.id));
        }
    } catch (e) {
        if (e.code !== 'ENOENT') {
            console.error(`[Config] Error reading or parsing ${DisabledPingsPath}:`, e);
        }
    }
}

async function getTrackersForUsername(username) {
    if (!username) return [];
    try {
        await ensureDataDirectoryExists();
        const raw = await fs.promises.readFile(TrackedPath, 'utf8');
        const arr = raw && raw.length ? JSON.parse(raw) : [];
        const uname = String(username).toLowerCase();
        const out = [];
        if (Array.isArray(arr)) {
            for (const item of arr) {
                if (!item || !item.username || !item.discordId) continue;
                if (String(item.username).toLowerCase() === uname) out.push(String(item.discordId));
            }
        }
        return out;
    } catch (e) {
        return [];
    }
}

function extractRobloxUsername(hatchedByString) {
    const match = hatchedByString.match(/\(@(.*?)\)/);
    if (match && match[1]) return match[1];
    const firstWordMatch = hatchedByString.match(/^[^(\s@]+/);
    return firstWordMatch ? firstWordMatch[0].replace('@', '') : null;
}

async function getRobloxId(username) {
    try {
        const response = await axios.post(`https://users.roblox.com/v1/usernames/users`, {
            "usernames": [username], "excludeBannedUsers": true
        });
        return response.data?.data?.[0]?.id || null;
    } catch {
        return null;
    }
}

async function getDiscordIdFromRobloxId(robloxId, guildId) {
    while (Date.now() < roverRateLimitUntil) {
        const timeLeft = roverRateLimitUntil - Date.now();
        console.warn(`[RoVer API] Waiting ${Math.ceil(timeLeft / 1000)}s before retrying for Roblox ID: ${robloxId}`);
        await new Promise(r => setTimeout(r, timeLeft + 100));
    }

    if (!guildId) {
        console.warn(`[RoVer API] No guild ID provided for Roblox ID: ${robloxId}. Cannot fetch Discord ID.`);
        return null;
    }

    try {
        const url = `https://registry.rover.link/api/guilds/${guildId}/roblox-to-discord/${robloxId}`;
        const response = await axios.get(url, { headers: { 'Authorization': `Bearer ${RoverApiKey}` } });

        if (response.headers['x-ratelimit-remaining'] === '0') {
            const waitSec = parseFloat(response.headers['x-ratelimit-reset-after'] || response.headers['retry-after'] || '60');
            roverRateLimitUntil = Date.now() + waitSec * 1000;
            console.warn(`[RoVer API] Rate limited. Pausing requests for ${waitSec}s.`);
            await new Promise(r => setTimeout(r, waitSec * 1000));
        }

        if (response.data && response.data.discordUsers && response.data.discordUsers.length > 0) {
            const discordUser = response.data.discordUsers[0];
            if (discordUser.user && discordUser.user.id) {
                return discordUser.user.id;
            } else {
                console.warn(`[RoVer API] Didnt find discord id`);
                return null;
            }
        } else {
            return null;
        }
    } catch (error) {
        if (error.response) {
            if (error.response.status === 429) {
                const retryAfter = (error.response.headers['retry-after'] ? parseInt(error.response.headers['retry-after']) : 60) * 1000;
                roverRateLimitUntil = Date.now() + retryAfter;
                console.warn(`[Rover] Rover rate limited the bot for ${retryAfter / 1000}s`);
                try {
                    await handleRoverRateLimit('1383484997318480013', retryAfter);
                } catch (e) {
                    console.error('Failed to handle rover rate limit:', e);
                }
                await new Promise(r => setTimeout(r, retryAfter));
                return getDiscordIdFromRobloxId(robloxId, guildId);
            } else if (error.response.status === 404) {
                return null;
            } else if (error.response.status === 401 || error.response.status === 403) {
                console.error(`[RoVer API] Authorization error (${error.response.status}) for RoVer API. Check RoverApiKey. Error: ${error.message}`);
            } else {
                console.error(`[RoVer API] Error fetching Discord ID for Roblox ID ${robloxId} (HTTP Status: ${error.response.status}): ${error.response.data?.message || error.message}`);
            }
        } else if (error.request) {
            console.error(`[RoVer API] No response received when fetching Discord ID for Roblox ID ${robloxId}: ${error.message}`);
        } else {
            console.error(`[RoVer API] Request setup error for Roblox ID ${robloxId}: ${error.message}`);
        }
        return null;
    } finally {
        await new Promise(resolve => setTimeout(resolve, 100));
    }
}

function parseHatchMessage(msg) {
    if (!msg.embeds?.[0]?.title || !msg.embeds?.[0]?.description) return null;
    const embed = msg.embeds[0];
    let rawEmbedClone = null;
    try {
        rawEmbedClone = embed ? JSON.parse(JSON.stringify(embed)) : null;
    } catch {
        rawEmbedClone = null;
    }
    const desc = embed.description;

    const secret = {
        id: msg.id,
        name: embed.title,
        timestamp: msg.createdAt || msg.timestamp || msg.createdTimestamp || null,
        imageUrl: embed.thumbnail?.url || embed.image?.url || null,
    };
    if (rawEmbedClone) {
        secret.rawEmbed = rawEmbedClone;
    }

    secret.totalHatched =
        desc.match(/\*\*Total Hatched:\*\* `?([\d,]+)`?/)?.[1] ||
        desc.match(/Total Hatched: `?([\d,]+)`?/)?.[1] ||
        null;

    secret.rarity =
        desc.match(/rarity of hatching this pet is \*\*(.*?)\*\*/)?.[1] ||
        desc.match(/rarity of hatching this pet is (.*?)\n/)?.[1] ||
        null;

    secret.hatchedBy =
        desc.match(/\*\*Hatched by\*\* `([^`]+)`/)?.[1] ||
        desc.match(/Hatched by\*\* ([^\n]+)/)?.[1]?.replace(/`/g, '').trim() ||
        desc.match(/Hatched by:?\s*([^\n]+)/)?.[1]?.replace(/`/g, '').trim() ||
        null;

    return secret;
}

async function appendSecretToFile(secret) {
    try {
        const id = secret.id || null;
        const name = secret.name || null;
        let timestamp = null;
        if (secret.timestamp) {
            try {
                const parsed = new Date(secret.timestamp);
                if (!Number.isNaN(parsed.getTime())) {
                    timestamp = parsed.toISOString().slice(0, 19).replace('T', ' ');
                }
            } catch {}
        }
        const imageUrl = secret.imageUrl || null;
        const totalHatched = secret.totalHatched || null;
        const rarity = secret.rarity || null;
        const hatchedBy = secret.hatchedBy || null;
        const discordUserId = secret.discordUserId !== undefined ? String(secret.discordUserId) : null;

        const minimalSecret = {
            id,
            name,
            timestamp: secret.timestamp || null,
            imageUrl,
            totalHatched,
            rarity,
            hatchedBy,
            discordUserId
        };

        inMemoryCache.push(minimalSecret);
        if (inMemoryCache.length > 10000) inMemoryCache.shift();

        // Always ensure the Data directory exists before writing state files
        await ensureDataDirectoryExists();

        const backupCache = inMemoryCache.slice(-2000);
        // Write to a temp file first, then rename atomically to prevent partial writes from corrupting state
        const tmpPath = EarlierSecretsPath + '.tmp';
        fs.promises.writeFile(tmpPath, JSON.stringify(backupCache, null, 2), 'utf8')
            .then(() => fs.promises.rename(tmpPath, EarlierSecretsPath))
            .catch(err => {
                console.error('[SaveState] Failed to save earlier_secrets.json:', err.message);
            });

        const insertQuery = `
            INSERT INTO secrets (id, name, timestamp, imageUrl, totalHatched, rarity, hatchedBy, discordUserId)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                name = VALUES(name),
                timestamp = VALUES(timestamp),
                imageUrl = VALUES(imageUrl),
                totalHatched = VALUES(totalHatched),
                rarity = VALUES(rarity),
                hatchedBy = VALUES(hatchedBy),
                discordUserId = VALUES(discordUserId)
        `;
        await pool.query(insertQuery, [id, name, timestamp, imageUrl, totalHatched, rarity, hatchedBy, discordUserId]);
        flushAllBackupsToDatabase().catch(err => {
            console.error('[Database] Async flush backups failed:', err.message);
        });
    } catch (e) {
        console.error('[Database] Error appending secret:', e);
        console.log('[Database] Appending secret to local backup file due to DB failure...');
        // Append to backup — never overwrite it, so no data is lost even on repeated failures
        fs.promises.appendFile(BackupPath, JSON.stringify(secret) + '\n', 'utf8')
            .catch(err => {
                console.error('[Database] Error writing to backup file:', err);
            });
    }
}

async function updateLastProcessedId(id) {
    try {
        await fs.promises.writeFile(LastIdPath, id, 'utf8');
    } catch (e) {
        console.error(`[SaveState] Error saving last processed ID:`, e);
    }
}

async function updateLastProcessedId2(id) {
    try {
        await fs.promises.writeFile(last_id_2, id, 'utf8');
    } catch (e) {
        console.error(`[SaveState] Error saving last processed ID (channel 2):`, e);
    }
}

async function sendHatchEmbed(hatchData, client) {
    const mainChannel = client.channels.cache.get('1383484997318480013');
    if (!mainChannel) return;

    const robloxUsername = hatchData.hatchedBy ? extractRobloxUsername(hatchData.hatchedBy) : null;

    const hatcheeId = (hatchData.discordUserId && !disabledPings.has(hatchData.discordUserId)) ? String(hatchData.discordUserId) : null;
    const trackerIds = (hatchData.trackers || []).filter(tid => tid && !disabledPings.has(tid) && tid !== hatcheeId).map(String);
    const allUserIds = [...new Set([hatcheeId, ...trackerIds].filter(Boolean))];
    const preferences = new Map();
    for (const userId of allUserIds) {
        try {
            const p = await preference.getPreferenceByDiscordId(userId);
            if (p) preferences.set(userId, p);
        } catch (e) {
            console.error(`[preference] Error reading preference for ${userId}:`, e);
        }
    }
    if (robloxUsername && !preferences.has(hatcheeId)) {
        try {
            const p = await preference.getPreferenceByRobloxUsername(robloxUsername);
            if (p) preferences.set(hatcheeId, p);
        } catch (e) {
             console.error(`[preference] Error reading preference for ${robloxUsername}:`, e);
        }
    }

    const toDm = new Map();
    const toCustomChannel = new Map();
    const toMainChannelPing = [];

    const hatcheePref = hatcheeId ? preferences.get(hatcheeId) : null;
    if (hatcheeId) {
        if (hatcheePref?.type === 1) {
            toDm.set(hatcheeId, hatcheePref.messageType || 2);
        } else if (hatcheePref?.type === 2 && hatcheePref.channelId) {
            if (!toCustomChannel.has(hatcheePref.channelId)) toCustomChannel.set(hatcheePref.channelId, []);
            toCustomChannel.get(hatcheePref.channelId).push(hatcheeId);
        } else {
            toMainChannelPing.push(hatcheeId);
        }
    }

    for (const trackerId of trackerIds) {
        const trackerPref = preferences.get(trackerId);
        if (trackerPref?.type === 1) {
            toDm.set(trackerId, trackerPref.messageType || 2);
        } else if (trackerPref?.type === 2 && trackerPref.channelId) {
            if (!toCustomChannel.has(trackerPref.channelId)) toCustomChannel.set(trackerPref.channelId, []);
            toCustomChannel.get(trackerPref.channelId).push(trackerId);
        } else {
            toMainChannelPing.push(trackerId);
        }
    }

    const unixTimestamp = Math.floor(new Date(hatchData.timestamp).getTime() / 1000);
    const embed = new EmbedBuilder()
        .setTitle(hatchData.name || 'Unknown Pet')
        .setDescription(
            `<:user:1383493798138478732> **Hatched by:** ${hatchData.hatchedBy || 'Unknown'}\n` +
            `<:luck:1383493796876259379> **Exists:** ${hatchData.totalHatched || 'Unknown'}\n` +
            `<:paw:1383493795152265297> **Rarity:** ${hatchData.rarity || 'Unknown'}\n` +
            `<:clock:1383493793772208221> **Time:** <t:${unixTimestamp}:R>`
        )
        .setThumbnail(hatchData.imageUrl)
        .setColor(0xFBE7BD)
        .setTimestamp();

    const hatcheeIsInServer = hatcheeId && (await mainChannel.guild.members.fetch(hatcheeId).catch(() => null));
    if (hatcheeIsInServer && toMainChannelPing.includes(hatcheeId)) {
        embed.setFooter({ text: 'To not get pinged, run /turnoffping in bot commands' });
    } else if (hatcheePref?.type === 1) {
        let hatcheeDisplay = hatchData.hatchedBy || 'Unknown';
        const finalHatcheeId = hatcheePref.discordId || hatcheeId;
        if (finalHatcheeId) {
            try {
                const user = await client.users.fetch(finalHatcheeId);
                hatcheeDisplay = user.username;
            } catch (e) {
                console.error(`[Footer] Could not fetch user ${finalHatcheeId} for footer display name:`, e);
            }
        }
        embed.setFooter({ text: `Hatched by ${hatcheeDisplay}` });
    }

    for (const [userId, messageType] of toDm.entries()) {
        try {
            await dmSupport.sendHatchDM(client, userId, hatchData, messageType, hatchData.rawEmbed);
        } catch (e) {
            console.error(`[sendHatchEmbed] Failed to send DM to user ${userId}:`, e);
        }
    }

    try {
        const mainContent = toMainChannelPing.length > 0 ? toMainChannelPing.map(id => `<@${id}>`).join(' ') : '';
        await mainChannel.send({ content: mainContent, embeds: [embed] });
    } catch (error) {
        console.error(`[Discord] Failed to send main embed for message ${hatchData.id}:`, error);
    }

    for (const [channelId, userIds] of toCustomChannel.entries()) {
        try {
            const customCh = await client.channels.fetch(channelId).catch(() => null);
            if (customCh) {
                const customContent = userIds.length > 0 ? userIds.map(id => `<@${id}>`).join(' ') : '';
                await customCh.send({ content: customContent, embeds: [embed] }).catch((e) => {
                     console.error(`[Discord] Failed to send to custom channel ${channelId}:`, e);
                });
            }
        } catch (err) {
            console.error(`[sendHatchEmbed] Failed to process custom channel ${channelId}:`, err);
        }
    }
}

async function loadEarlierSecrets() {
    try {
        const raw = await fs.promises.readFile(EarlierSecretsPath, 'utf8');
        return JSON.parse(raw);
    } catch {
        return [];
    }
}

async function saveEarlierSecrets(data) {
    await fs.promises.writeFile(EarlierSecretsPath, JSON.stringify(data, null, 2), 'utf8');
}

async function findDiscordIdFromEarlierSecrets(username) {
    const secrets = await loadEarlierSecrets();
    username = String(username).toLowerCase();
    const entry = secrets.find(e => String(e.username).toLowerCase() === username && e.discordId && /^\d+$/.test(e.discordId));
    return entry ? entry.discordId : null;
}

async function updateEarlierSecrets(username, discordId, increment = 1) {
    if (!discordId || !/^\d+$/.test(discordId)) return;
    const secrets = await loadEarlierSecrets();
    username = String(username).toLowerCase();
    let entry = secrets.find(e => String(e.username).toLowerCase() === username);
    if (entry) {
        entry.discordId = discordId;
        entry.amount = (entry.amount || 0) + increment;
    } else {
        secrets.push({ username, discordId, amount: increment });
    }
    await saveEarlierSecrets(secrets);
}

const { selfbot } = require('../selfbot.js');

async function handleSecretMessage(msg, client, channelIndex) {
    if (!msg.embeds || !msg.embeds.length) return;

    const secret = parseHatchMessage(msg);
    if (!secret) return;

    let robloxUsername = null;
    if (secret.hatchedBy) {
        robloxUsername = extractRobloxUsername(secret.hatchedBy);
        if (robloxUsername) {
            let discordId = null;
            if (Date.now() < roverRateLimitUntil) {
                try {
                    discordId = await findDiscordIdFromEarlierSecrets(robloxUsername);
                } catch (e) {
                    console.error('[Secrets] Error reading earlier_secrets during rover rate limit:', e);
                    discordId = null;
                }

                if (discordId && /^\d+$/.test(discordId)) {
                    try { await updateEarlierSecrets(robloxUsername, discordId, 1); } catch {}
                } else {
                    discordId = null;
                }
            } else {
                try {
                    const robloxId = await getRobloxId(robloxUsername);
                    if (robloxId) {
                        const sendingChannel = client.channels.cache.get('1383484997318480013');
                        const guildId = sendingChannel?.guild.id;
                        if (guildId) {
                            try {
                                discordId = await getDiscordIdFromRobloxId(robloxId, guildId);
                                if (discordId && /^\d+$/.test(discordId)) {
                                    try { await updateEarlierSecrets(robloxUsername, discordId, 1); } catch {}
                                }
                            } catch (e) {
                                console.error('[Secrets] RoVer lookup failed:', e);
                                discordId = null;
                            }
                        }
                    }
                } catch (e) {
                    console.error('[Secrets] Error during normal RoVer flow:', e);
                    discordId = null;
                }
            }

            secret.discordUserId = discordId || null;
        }
    }
    if (robloxUsername) {
        secret.trackers = await getTrackersForUsername(robloxUsername);
    } else {
        secret.trackers = [];
    }

    await appendSecretToFile(secret);
    await sendHatchEmbed(secret, client);

    if (channelIndex === 1) {
        await updateLastProcessedId(msg.id);
    } else if (channelIndex === 2) {
        await updateLastProcessedId2(msg.id);
    }
}

async function catchUpChannel(selfbotClient, client, channelId, lastId, channelIndex) {
    if (!lastId || !/^\d+$/.test(lastId)) return lastId;

    console.log(`[Secrets] Catching up channel ${channelId} starting after message ID ${lastId}...`);
    let currentAfter = lastId;
    let hasMore = true;

    while (hasMore) {
        try {
            const channel = await selfbotClient.channels.fetch(channelId);
            if (!channel) break;

            const messages = await channel.messages.fetch({ limit: 100, after: currentAfter });
            if (!messages || messages.size === 0) {
                hasMore = false;
                break;
            }

            const sortedMessages = [...messages.values()].sort((a, b) => BigInt(a.id) > BigInt(b.id) ? 1 : -1);
            for (const msg of sortedMessages) {
                currentAfter = msg.id;
                await handleSecretMessage(msg, client, channelIndex);
            }
        } catch (e) {
            console.error(`[Secrets] Error during catch-up for channel ${channelId}:`, e.message);
            await new Promise(r => setTimeout(r, 5000));
        }
    }

    return currentAfter;
}

process.on('uncaughtException', error => {
    console.error('UNCAUGHT EXCEPTION:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('UNHANDLED PROMISE REJECTION:', reason, promise);
});

async function startSecretsWatcher(discordClient) {
    if (secretsWatcherStarted) return;
    secretsWatcherStarted = true;

    globalThis.discordClient = discordClient;

    if (!process.env.DISCORD_SCRAPE_TOKEN || !process.env.ROVER_API_KEY) {
        console.error("[Startup] FATAL: DISCORD_SCRAPE_TOKEN or RoverApiKey is missing from your .env file.");
        process.exit(1);
    }

    await ensureDataDirectoryExists();
    await initializeDatabase();
    await flushAllBackupsToDatabase();
    setInterval(flushAllBackupsToDatabase, 60 * 1000);
    await loadDisabledPings();
    setInterval(loadDisabledPings, 60 * 1000);

    await ensureCacheIsFresh();

    try {
        const sendingChannel = await discordClient.channels.fetch('1383484997318480013', { force: true });
        if (!sendingChannel || !sendingChannel.guild) {
            throw new Error("Could not fetch sending channel or its guild. Ensure channel ID is correct and bot has VIEW_CHANNEL permissions.");
        }
    } catch (e) {
        process.exit(1);
    }

    // Wait until selfbot is ready before initiating catch-up and event binding
    if (selfbot.readyAt) {
        initSelfbotSecrets();
    } else {
        selfbot.once('ready', initSelfbotSecrets);
    }

    async function initSelfbotSecrets() {
        console.log('[Secrets] Selfbot is ready. Starting catch-up process...');
        
        let afterId = '895843630881849394';
        try {
            const lastIdFromFile = await fs.promises.readFile(LastIdPath, 'utf8');
            if (/^\d+$/.test(lastIdFromFile)) {
                afterId = lastIdFromFile.trim();
            }
        } catch (e) {
            if (e.code !== 'ENOENT') console.error(`[Startup] Error reading ${LastIdPath}:`, e);
        }

        let afterId2 = '1453167036032094242';
        try {
            const lastId2FromFile = await fs.promises.readFile(last_id_2, 'utf8');
            if (/^\d+$/.test(lastId2FromFile)) {
                afterId2 = lastId2FromFile.trim();
            }
        } catch (e) {
            if (e.code !== 'ENOENT') console.error(`[Startup] Error reading ${last_id_2}:`, e);
        }

        // Perform Catch-up scans on startup
        try {
            await catchUpChannel(selfbot, discordClient, '791552625866833960', afterId, 1);
            await catchUpChannel(selfbot, discordClient, '1453166507331944600', afterId2, 2);
        } catch (err) {
            console.error('[Secrets] Catch-up failed:', err);
        }

        console.log('[Secrets] Catch-up finished. Listening to real-time events...');

        // Bind real-time event listener
        selfbot.on('messageCreate', async (msg) => {
            if (!isHatchesEnabled()) return;

            if (msg.channel.id === '791552625866833960') {
                try {
                    await handleSecretMessage(msg, discordClient, 1);
                } catch (err) {
                    console.error('[Secrets] Error handling live message (channel 1):', err);
                }
            } else if (msg.channel.id === '1453166507331944600') {
                try {
                    await handleSecretMessage(msg, discordClient, 2);
                } catch (err) {
                    console.error('[Secrets] Error handling live message (channel 2):', err);
                }
            }
        });
    }
}

module.exports = startSecretsWatcher;

module.exports.getRoverRateLimitUntil = function() {
    return roverRateLimitUntil || 0;
};

module.exports.ensureCacheIsFresh = ensureCacheIsFresh;
module.exports.getCache = () => inMemoryCache;
module.exports.iterateAllEntries = iterateAllEntries;

module.exports.waitForRoverAvailable = async function(timeoutMs = 10 * 60 * 1000) {
    const start = Date.now();
    while (Date.now() < (roverRateLimitUntil || 0)) {
        const waitFor = Math.min((roverRateLimitUntil || 0) - Date.now(), 1000);
        if (waitFor > 0) await new Promise(r => setTimeout(r, waitFor));
        if (Date.now() - start > timeoutMs) break;
    }
};