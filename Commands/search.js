const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const QuotaPath = path.join(__dirname, '../Data/search_quota.json');
const GoogleConfigPath = path.join(__dirname, '../Data/google.json');

function nextMidnightUTC() {
    const now = new Date();
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0);
}

function formatCountdown(ms) {
    if (ms <= 0) return '0s';
    const s = Math.floor(ms / 1000);
    const days = Math.floor(s / 86400);
    const hours = Math.floor((s % 86400) / 3600);
    const minutes = Math.floor((s % 3600) / 60);
    const seconds = s % 60;
    const parts = [];
    if (days) parts.push(`${days}d`);
    if (hours) parts.push(`${hours}h`);
    if (minutes) parts.push(`${minutes}m`);
    if (seconds || parts.length === 0) parts.push(`${seconds}s`);
    return parts.join(' ');
}

async function loadGoogleConfig() {
    try {
        const raw = await fs.promises.readFile(GoogleConfigPath, 'utf8');
        const obj = JSON.parse(raw || '{}');
        obj.dailyLimit = typeof obj.dailyLimit === 'number' ? obj.dailyLimit : 100;
        return obj;
    } catch {
        return { dailyLimit: 100 };
    }
}

async function loadQuota() {
    try {
        const raw = await fs.promises.readFile(QuotaPath, 'utf8');
        const obj = JSON.parse(raw);
        if (!obj.resetAt || typeof obj.resetAt !== 'number') obj.resetAt = nextMidnightUTC();
        if (Date.now() >= obj.resetAt) {
            obj.used = 0;
            obj.resetAt = nextMidnightUTC();
        }
        const cfg = await loadGoogleConfig();
        obj.limit = isFinite(cfg.dailyLimit) ? cfg.dailyLimit : Infinity;
        return obj;
    } catch {
        const cfg = await loadGoogleConfig();
        return { used: 0, limit: isFinite(cfg.dailyLimit) ? cfg.dailyLimit : Infinity, resetAt: nextMidnightUTC() };
    }
}

async function saveQuota(q) {
    try {
        await fs.promises.mkdir(path.dirname(QuotaPath), { recursive: true });
        await fs.promises.writeFile(QuotaPath, JSON.stringify(q, null, 2), 'utf8');
    } catch {}
}

async function canConsumeQuota(count = 1) {
    const q = await loadQuota();
    if (!isFinite(q.limit)) return { ok: true, used: q.used, limit: q.limit };
    if (q.used + count > q.limit) return { ok: false, resetAt: q.resetAt, used: q.used, limit: q.limit };
    q.used += count;
    await saveQuota(q);
    return { ok: true, used: q.used, limit: q.limit };
}

function decodeBingUrl(bingHref) {
    if (!bingHref) return '';
    if (bingHref.startsWith('http') && !bingHref.includes('bing.com/ck/a')) {
        return bingHref;
    }
    const uMatch = bingHref.match(/[?&]u=a1([^&]+)/);
    if (uMatch) {
        try {
            return Buffer.from(uMatch[1], 'base64').toString('utf8');
        } catch {}
    }
    return bingHref;
}

const UA_LIST = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
];

function getRandomUA() {
    return UA_LIST[Math.floor(Math.random() * UA_LIST.length)];
}

// 1. Bing Search Provider
async function searchBing(query, totalWanted = 10, pageOffset = 0) {
    const firstIndex = pageOffset + 1;
    const res = await axios.get('https://www.bing.com/search', {
        params: {
            q: query,
            first: firstIndex,
            setlang: 'en-US',
            setmkt: 'en-US',
            cc: 'US'
        },
        headers: {
            'User-Agent': getRandomUA(),
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://www.bing.com/'
        },
        timeout: 7000
    });

    const $ = cheerio.load(res.data);
    const results = [];

    $('li.b_algo').each((_, el) => {
        if (results.length >= totalWanted) return false;

        const h2 = $(el).find('h2 a');
        const title = h2.text().trim().replace(/\s+/g, ' ');
        const rawHref = h2.attr('href');
        if (!title || !rawHref) return;

        const link = decodeBingUrl(rawHref);
        if (!link || !link.startsWith('http')) return;

        let displayLink = '';
        try {
            displayLink = new URL(link).host;
        } catch {
            displayLink = link;
        }

        let snippet = $(el).find('.b_caption p, .b_algoSlug, .b_lineclamp2, .b_lineclamp3, .b_lineclamp4, .b_snippet').text().trim().replace(/\s+/g, ' ');
        if (!snippet) {
            snippet = $(el).find('p').first().text().trim().replace(/\s+/g, ' ');
        }

        results.push({
            title,
            link,
            snippet: snippet || 'No description available.',
            displayLink
        });
    });

    return results;
}

// 2. Google Custom Search API (if key configured) or Scraping
async function searchGoogle(query, totalWanted = 10, pageOffset = 0) {
    const cfg = await loadGoogleConfig();
    const apiKey = cfg.apiKey || process.env.GOOGLE_SEARCH_API_KEY || process.env.GOOGLE_API_KEY;
    const cseId = cfg.cx || cfg.cseId || process.env.GOOGLE_CSE_ID || process.env.GOOGLE_SEARCH_ENGINE_ID;

    if (apiKey && cseId) {
        const res = await axios.get('https://www.googleapis.com/customsearch/v1', {
            params: {
                key: apiKey,
                cx: cseId,
                q: query,
                start: pageOffset + 1,
                num: Math.min(10, totalWanted)
            },
            timeout: 6000
        });
        if (res.data?.items) {
            return res.data.items.map(it => ({
                title: it.title,
                link: it.link,
                snippet: it.snippet || 'No description available.',
                displayLink: it.displayLink || (new URL(it.link).host),
                pagemap: it.pagemap
            }));
        }
    }
    return [];
}

// 3. Wikipedia Search API
async function searchWikipedia(query, totalWanted = 10) {
    const res = await axios.get('https://en.wikipedia.org/w/api.php', {
        params: {
            action: 'query',
            list: 'search',
            srsearch: query,
            format: 'json',
            srlimit: totalWanted,
            utf8: 1
        },
        headers: { 'User-Agent': 'WiktorxdBot/1.0 (admin@wiktorxd-1.dev)' },
        timeout: 5000
    });

    const items = res.data?.query?.search || [];
    return items.map(it => {
        const snippet = cheerio.load(it.snippet || '').text().trim();
        return {
            title: it.title,
            link: `https://en.wikipedia.org/wiki/${encodeURIComponent(it.title.replace(/ /g, '_'))}`,
            snippet: snippet || 'Wikipedia article',
            displayLink: 'en.wikipedia.org'
        };
    });
}

// Multi-provider orchestrator
async function performSearch(query, totalWanted = 10, pageOffset = 0) {
    const quotaCheck = await loadQuota();
    if (isFinite(quotaCheck.limit) && quotaCheck.used + 1 > quotaCheck.limit) {
        return { error: 'QUOTA_EXCEEDED', neededRequests: 1, quota: quotaCheck };
    }

    let items = [];

    // 1. Try Google API if configured
    try {
        items = await searchGoogle(query, totalWanted, pageOffset);
    } catch (e) {
        // Continue to Bing
    }

    // 2. Try Bing (high speed, accurate, rich snippets)
    if (!items || items.length === 0) {
        try {
            items = await searchBing(query, totalWanted, pageOffset);
        } catch (e) {
            console.error('Bing search failed:', e.message);
        }
    }

    // 3. Fallback to Wikipedia if no items found
    if (!items || items.length === 0) {
        try {
            items = await searchWikipedia(query, totalWanted);
        } catch (e) {
            console.error('Wikipedia search fallback failed:', e.message);
        }
    }

    await canConsumeQuota(1);

    return { items: items || [] };
}

function faviconFor(domainOrHost) {
    if (!domainOrHost) return null;
    return `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(domainOrHost)}`;
}

function makeEmbedForResult(item, index, total) {
    const title = item.title || item.displayLink || 'Result';
    const desc = item.snippet || 'No description available.';
    const link = item.link || '';
    const display = item.displayLink || (() => {
        try { return new URL(link).host; } catch { return 'web'; }
    })();
    const image = item.pagemap?.cse_image?.[0]?.src || item.pagemap?.metatags?.[0]?.['og:image'] || null;

    const embed = new EmbedBuilder()
        .setTitle(title.length > 256 ? title.slice(0, 253) + '...' : title)
        .setURL(link.length <= 512 ? link : null)
        .setDescription(desc.length > 4096 ? desc.slice(0, 4093) + '...' : desc)
        .setAuthor({ name: display, iconURL: faviconFor(display) })
        .setColor(0xFBE7BD)
        .setFooter({ text: `Result ${index + 1} of ${total}` });

    if (image && image.startsWith('http')) {
        embed.setThumbnail(image);
    }
    return embed;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('search')
        .setIntegrationTypes([0, 1])
        .setContexts([0, 1, 2])
        .setDescription('Look something up on the web')
        .addStringOption(opt => opt.setName('query').setDescription('Search query').setRequired(true)),

    async execute(interaction) {
        const query = interaction.options.getString('query', true).trim();
        await interaction.deferReply();

        const q = await loadQuota();
        if (isFinite(q.limit) && q.used >= q.limit) {
            const msLeft = Math.max(0, q.resetAt - Date.now());
            await interaction.editReply(`Bot can't do searches for today anymore, try again in ${formatCountdown(msLeft)}`);
            return;
        }

        try {
            const result = await performSearch(query, 10, 0);
            if (result.error === 'QUOTA_EXCEEDED') {
                const msLeft = Math.max(0, result.quota.resetAt - Date.now());
                await interaction.editReply(`Bot can't do searches for today anymore, try again in ${formatCountdown(msLeft)}`);
                return;
            }
            let items = result.items || [];
            if (!items.length) {
                await interaction.editReply(`No results found for "${query}"`);
                return;
            }

            let index = 0;
            const getSafeUrl = (link) => (!link || link.length > 512) ? 'https://www.bing.com' : link;

            const updateEmbeds = () => items.map((item, idx) => makeEmbedForResult(item, idx, items.length));
            let embeds = updateEmbeds();

            const createButtons = (currentIndex) => {
                const openButton = new ButtonBuilder()
                    .setLabel('Open')
                    .setStyle(ButtonStyle.Link)
                    .setURL(getSafeUrl(items[currentIndex].link));

                const prev = new ButtonBuilder()
                    .setCustomId('search_prev')
                    .setLabel('◀ Prev')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(currentIndex === 0);

                const next = new ButtonBuilder()
                    .setCustomId('search_next')
                    .setLabel('Next ▶')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(currentIndex >= items.length - 1);

                return new ActionRowBuilder().addComponents(prev, next, openButton);
            };

            const message = await interaction.editReply({
                embeds: [embeds[index]],
                components: [createButtons(index)]
            });

            const collector = message.createMessageComponentCollector({ time: 180_000 });

            collector.on('collect', async i => {
                if (i.user.id !== interaction.user.id) {
                    await i.reply({ content: 'You didn\'t run this command', flags: MessageFlags.Ephemeral });
                    return;
                }

                if (i.customId === 'search_prev') {
                    if (index > 0) index--;
                } else if (i.customId === 'search_next') {
                    if (index < items.length - 1) {
                        index++;
                    }
                } else {
                    await i.deferUpdate().catch(() => {});
                    return;
                }

                await i.update({
                    embeds: [embeds[index]],
                    components: [createButtons(index)]
                }).catch(() => {});
            });

            collector.on('end', () => {
                const disabledRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('search_prev').setLabel('◀ Prev').setStyle(ButtonStyle.Primary).setDisabled(true),
                    new ButtonBuilder().setCustomId('search_next').setLabel('Next ▶').setStyle(ButtonStyle.Primary).setDisabled(true),
                    new ButtonBuilder().setLabel('Open').setStyle(ButtonStyle.Link).setURL(getSafeUrl(items[index].link))
                );
                message.edit({ components: [disabledRow] }).catch(() => {});
            });
        } catch (err) {
            const status = err?.response?.status;
            if (status === 403 || status === 429) {
                const q2 = await loadQuota();
                q2.used = q2.limit;
                const resetHeader = err?.response?.headers?.['x-ratelimit-reset'] || err?.response?.headers?.['retry-after'];
                if (resetHeader) {
                    const parsed = parseFloat(resetHeader);
                    if (!isNaN(parsed)) q2.resetAt = Date.now() + Math.ceil(parsed) * 1000;
                }
                await saveQuota(q2);
                const msLeft = Math.max(0, q2.resetAt - Date.now());
                await interaction.editReply(`Bot can't do searches for today anymore, try again in ${formatCountdown(msLeft)}`);
                return;
            }
            await interaction.editReply(`Search failed: ${err.message || String(err)}`);
        }
    }
};