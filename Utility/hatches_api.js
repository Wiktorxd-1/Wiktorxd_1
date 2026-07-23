const http = require('http');
const fs = require('fs');
const url = require('url');
const path = require('path');
const axios = require('axios');
const mysql = require('mysql2/promise');

const DataDir = path.join(__dirname, '..', 'Data');
const NdjsonPath = path.join(DataDir, 'secrets.ndjson');
const BountiesPath = path.join(DataDir, 'bounties.json');
const BountiesUrl = 'https://api.bgsi.gg/api/bounties/current';

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

const RateLimit = 10;
let requestTimestamps = [];

function rateLimited(res) {
    const now = Date.now();
    requestTimestamps = requestTimestamps.filter(ts => now - ts < 1000);
    if (requestTimestamps.length >= RateLimit) {
        res.writeHead(429, { 'Content-Type': 'text/plain' });
        res.end('api is rate limited');
        return true;
    }
    requestTimestamps.push(now);
    return false;
}

function parseQueryParams(reqUrl) {
    let queryString = reqUrl.split('?').slice(1).join('?');
    let params = {};
    if (queryString) {
        for (const part of queryString.split(/[?&]/)) {
            if (!part) continue;
            const [key, ...rest] = part.split('=');
            params[decodeURIComponent(key)] = rest.length > 0 ? decodeURIComponent(rest.join('=')) : '';
        }
    }
    let num = 21;
    if (params.num !== undefined) {
        const parsedNum = parseInt(params.num, 10);
        if (!isNaN(parsedNum)) {
            num = Math.max(1, Math.min(100, parsedNum));
        }
    }
    const oldest = 'oldest' in params;
    let afterId = null;
    if (params.after) {
        afterId = String(params.after);
    }
    const verified = 'verified' in params;
    const username = params.username ? String(params.username).toLowerCase() : null;
    const pet = params.pet ? String(params.pet).toLowerCase() : null;
    return { num, oldest, afterId, verified, username, pet };
}

async function streamHatches(res, { num, oldest, afterId, verified, username, pet }) {
    try {
        let query = 'SELECT * FROM secrets WHERE 1=1';
        let queryParams = [];

        if (afterId) {
            if (oldest) {
                query += ' AND CAST(id AS UNSIGNED) > CAST(? AS UNSIGNED)';
            } else {
                query += ' AND CAST(id AS UNSIGNED) < CAST(? AS UNSIGNED)';
            }
            queryParams.push(afterId);
        }

        if (verified) {
            query += " AND hatchedBy IS NOT NULL AND TRIM(hatchedBy) != '' AND LOWER(TRIM(hatchedBy)) != 'private user'";
        }

        if (username && pet) {
            query += " AND (LOWER(hatchedBy) LIKE ? OR LOWER(name) LIKE ?)";
            queryParams.push(`%${username}%`, `%${pet}%`);
        } else {
            if (username) {
                query += " AND LOWER(hatchedBy) LIKE ?";
                queryParams.push(`%${username}%`);
            }
            if (pet) {
                query += " AND LOWER(name) LIKE ?";
                queryParams.push(`%${pet}%`);
            }
        }

        if (oldest) {
            query += ' ORDER BY CAST(id AS UNSIGNED) ASC';
        } else {
            query += ' ORDER BY CAST(id AS UNSIGNED) DESC';
        }

        query += ' LIMIT ?';
        queryParams.push(num);

        const [rows] = await pool.query(query, queryParams);
        
        let results = rows;
        if (oldest) {
            results = results.reverse();
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(results));
    } catch (e) {
        console.error('[API] Database query error:', e);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Database query error.');
    }
}

function setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function fetchAndCacheBounties() {
    try {
        const r = await axios.get(BountiesUrl, { timeout: 8000 });

        let source = null;
        if (r.data && Array.isArray(r.data.schedule)) {
            source = r.data.schedule;
        } else if (Array.isArray(r.data)) {
            source = r.data;
        }

        if (!source) {
            console.error('Bounties API returned unexpected shape. Keeping old cache.');
            return;
        }

        const mapped = source.map(item => {
            return {
                Pet: item.name || item.pet || '',
                Egg: item.egg || item.Egg || '',
                Chance: typeof item.chance !== 'undefined' ? item.chance : (item.chances || ''),
                Time: item.date || item.Time || ''
            };
        });

        fs.mkdirSync(DataDir, { recursive: true });
        

        fs.writeFileSync(BountiesPath, JSON.stringify(mapped, null, 2));

    } catch (err) {
        console.error('Failed to fetch or cache bounties:', err.message);
    }
}

function scheduleUtcMidnightRefresh() {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setUTCHours(24, 0, 0, 0);
    
    const msUntilMidnight = midnight.getTime() - now.getTime();
    
    setTimeout(async () => {
        await fetchAndCacheBounties();
        scheduleUtcMidnightRefresh();
    }, msUntilMidnight);
}


let hatchesApiStarted = false;
function startHatchesApi(discordClient) {
    if (hatchesApiStarted) return;
    hatchesApiStarted = true;

    try {
        fs.mkdirSync(DataDir, { recursive: true });
    } catch (err) {
        console.error('Could not create data directory:', err);
    }

    fetchAndCacheBounties();

    setInterval(fetchAndCacheBounties, 10 * 60 * 1000);

    scheduleUtcMidnightRefresh();


    const server = http.createServer((req, res) => {
        setCorsHeaders(res);
        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }
        
        if (req.url.startsWith('/hatches')) {
            if (rateLimited(res)) return;
            const params = parseQueryParams(req.url);
            streamHatches(res, params);

        } else if (req.url.startsWith('/bounties')) {
            if (rateLimited(res)) return;
            
            fs.readFile(BountiesPath, 'utf8', (err, data) => {
                if (err) {
                    console.error('Error reading bounties file:', err);
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    res.end('Error retrieving bounties.');
                    return;
                }
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(data);
            });

        } else if (req.url.startsWith('/inf_egg')) {
            if (rateLimited(res)) return;
            axios.get('https://bgs-infinity.fandom.com/wiki/Infinity_Egg', { timeout: 10000, responseType: 'text' })
                .then(wikiRes => {
                    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                    res.end(wikiRes.data);
                })
                .catch(err => {
                    console.error('Failed to fetch Infinity Egg page:', err && err.message ? err.message : err);
                    res.writeHead(502, { 'Content-Type': 'text/plain' });
                    res.end('Failed to fetch Infinity Egg page.');
                });

        } else if (req.url.startsWith('/status')) {
            if (rateLimited(res)) return;
            if (!discordClient) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Discord client not initialized.');
                return;
            }

            const userId = '697047593334603837';
            discordClient.users.fetch(userId)
                .then(async (user) => {
                    let presence = null;
                    let isSelfbotPresence = false;

                    // 1. Try fetching presence from selfbot to get sessionId (needed for button metadata)
                    try {
                        const { selfbot } = require('./selfbot');
                        if (selfbot && selfbot.readyAt) {
                            // Force gateway presence update via WS member fetch
                            await Promise.all(
                                Array.from(selfbot.guilds.cache.values()).map(guild =>
                                    guild.members.fetch({ user: userId, withPresences: true }).catch(() => null)
                                )
                            );

                            for (const guild of selfbot.guilds.cache.values()) {
                                const m = guild.members.cache.get(userId);
                                if (m && m.presence) {
                                    presence = m.presence;
                                    isSelfbotPresence = true;
                                    break;
                                }
                            }
                        }
                    } catch (err) {}

                    // 2. Fallback to main client presence if selfbot didn't have it
                    if (!presence) {
                        for (const guild of discordClient.guilds.cache.values()) {
                            const m = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
                            if (m && m.presence) {
                                presence = m.presence;
                                break;
                            }
                        }
                    }

                    const activitiesMapped = [];
                    if (presence && presence.activities) {
                        for (const activity of presence.activities) {
                            try {
                                let buttonUrls = [];
                                let spotifyMetadata = null;
                                // Only fetch metadata if we got the presence from selfbot (which parses sessionId)
                                if (isSelfbotPresence && activity.sessionId && process.env.DISCORD_SCRAPE_TOKEN) {
                                    try {
                                        const appId = activity.applicationId || '0';
                                        const metadataUrl = `https://discord.com/api/v9/users/${userId}/sessions/${activity.sessionId}/activities/${appId}/metadata`;
                                        const metadataRes = await axios.get(metadataUrl, {
                                            headers: {
                                                'Authorization': process.env.DISCORD_SCRAPE_TOKEN
                                            },
                                            timeout: 2000
                                        });
                                        if (metadataRes.data) {
                                            if (Array.isArray(metadataRes.data.button_urls)) {
                                                buttonUrls = metadataRes.data.button_urls;
                                            }
                                            if (activity.name === 'Spotify') {
                                                spotifyMetadata = {
                                                    albumId: metadataRes.data.album_id || null,
                                                    artistIds: metadataRes.data.artist_ids || [],
                                                    contextUri: metadataRes.data.context_uri || null
                                                };
                                            }
                                        }
                                    } catch (err) {
                                        // Ignore failures
                                    }
                                }

                                activitiesMapped.push({
                                    name: activity.name,
                                    type: activity.type,
                                    url: activity.url,
                                    details: activity.details,
                                    state: activity.state,
                                    applicationId: activity.applicationId,
                                    timestamps: activity.timestamps,
                                    syncId: activity.syncId,
                                    buttons: activity.buttons || [],
                                    buttonUrls: buttonUrls,
                                    spotifyMetadata: spotifyMetadata,
                                    assets: activity.assets ? {
                                        largeText: activity.assets.largeText,
                                        smallText: activity.assets.smallText,
                                        largeImageUrl: activity.assets.largeImageURL(),
                                        smallImageUrl: activity.assets.smallImageURL()
                                    } : null,
                                    emoji: activity.emoji ? {
                                        name: activity.emoji.name,
                                        id: activity.emoji.id,
                                        animated: activity.emoji.animated,
                                        url: activity.emoji.url
                                    } : null
                                });
                            } catch (e) {
                                console.error(`[API Status] Error mapping activity ${activity.name}:`, e.message);
                            }
                        }
                    }

                    const responseData = {
                        user: {
                            id: user.id,
                            username: user.username,
                            discriminator: user.discriminator,
                            tag: user.tag,
                            avatarUrl: user.displayAvatarURL({ dynamic: true, size: 512 }),
                            bannerUrl: user.bannerURL({ dynamic: true, size: 1024 }) || null,
                            accentColor: user.accentColor,
                            bot: user.bot,
                            createdAt: user.createdAt
                        },
                        presence: presence ? {
                            status: presence.status,
                            clientStatus: presence.clientStatus,
                            activities: activitiesMapped
                        } : null
                    };

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(responseData, null, 2));
                })
                .catch(err => {
                    console.error('Failed to fetch user status details:', err);
                    res.writeHead(502, { 'Content-Type': 'text/plain' });
                    res.end('Failed to fetch user status details.');
                });

        } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found.');
        }
    });

    const port = process.env.SERVER_PORT || 2011;
    server.listen(port, () => {
        console.log(`Hatches API running on port ${port}`);
    });
}

module.exports = { startHatchesApi };