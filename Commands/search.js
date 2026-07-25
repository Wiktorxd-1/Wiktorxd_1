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

async function googleSearch(q, totalWanted = 5, pageOffset = 0) {
    const quotaCheck = await loadQuota();
    if (isFinite(quotaCheck.limit) && quotaCheck.used + 1 > quotaCheck.limit) {
        return { error: 'QUOTA_EXCEEDED', neededRequests: 1, quota: quotaCheck };
    }

    const uas_list = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/119.0",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36"
    ];
    const userAgent = uas_list[Math.floor(Math.random() * uas_list.length)];

    let results = [];

    // 1. Try Google Search Scraping
    try {
        const response = await axios.get("https://www.google.com/search", {
            params: {
                q: q,
                hl: "en",
                gl: "us",
                gbv: "1",
                udm: "14", // Disable AI Overviews and force standard web results
                start: pageOffset
            },
            headers: {
                "User-Agent": userAgent,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.5"
            },
            timeout: 10000
        });

        const $ = cheerio.load(response.data);

        // Parse desktop layout results
        $(".tF2Cxc, div.g").each((index, element) => {
            if (results.length >= totalWanted) return false;

            const titleElem = $(element).find(".DKV0Md, h3").first();
            const linkElem = $(element).find(".yuRUbf a, a[href^='http']").first();
            const snippetElem = $(element).find(".VwiC3b, .lEBKkf span, .MUFIy").first();

            const title = titleElem.text().trim();
            let link = linkElem.attr("href");
            const snippet = snippetElem.text().trim();

            if (title && link) {
                if (link.startsWith('/url?q=')) {
                    try {
                        const parsedUrl = new URL('https://www.google.com' + link);
                        link = parsedUrl.searchParams.get('q') || link;
                    } catch {}
                }

                if (link.startsWith('http')) {
                    let displayLink = '';
                    try {
                        displayLink = new URL(link).host;
                    } catch {
                        displayLink = link;
                    }

                    results.push({
                        title,
                        link,
                        snippet: snippet || 'No description available.',
                        displayLink
                    });
                }
            }
        });

        // Fallback to classic/mobile layout if no results found
        if (results.length === 0) {
            $("h3").each((index, element) => {
                if (results.length >= totalWanted) return false;

                const parentAnchor = $(element).closest("a");
                if (parentAnchor.length > 0) {
                    let link = parentAnchor.attr("href");
                    const title = $(element).text().trim();

                    if (link && title) {
                        if (link.startsWith('/url?q=')) {
                            try {
                                const parsedUrl = new URL('https://www.google.com' + link);
                                link = parsedUrl.searchParams.get('q') || link;
                            } catch {}
                        }

                        if (link.startsWith('http')) {
                            let snippet = '';
                            let current = parentAnchor.parent();
                            for (let depth = 0; depth < 3; depth++) {
                                if (!current.length) break;
                                const possibleSnippet = current.next().find(".BNeawe, .VwiC3b, .AP7goc, span").first();
                                if (possibleSnippet.length > 0) {
                                    snippet = possibleSnippet.text().trim();
                                    if (snippet) break;
                                }
                                current = current.parent();
                            }

                            let displayLink = '';
                            try {
                                displayLink = new URL(link).host;
                            } catch {
                                displayLink = link;
                            }

                            results.push({
                                title,
                                link,
                                snippet: snippet || 'No description available.',
                                displayLink
                            });
                        }
                    }
                }
            });
        }
    } catch (err) {
        console.error('Google search scraping failed:', err.message);
    }

    // 2. Fallback to Yahoo Search Scraping if Google returned no results
    if (results.length === 0) {
        try {
            const response = await axios.get("https://search.yahoo.com/search", {
                params: {
                    p: q,
                    b: pageOffset + 1
                },
                headers: {
                    "User-Agent": userAgent,
                    "Accept-Language": "en-US,en;q=0.9"
                },
                timeout: 10000
            });

            const $ = cheerio.load(response.data);

            $(".algo").each((index, element) => {
                if (results.length >= totalWanted) return false;

                const h3 = $(element).find("h3");
                const titleElem = h3.find("a").length > 0 ? h3.find("a").first() : $(element).find("a").first();

                let title = h3.text().trim().replace(/\s+/g, ' ');
                let link = titleElem.attr("href");
                const snippetElem = $(element).find(".compText, .compText p, p").first();
                const snippet = snippetElem.text().trim().replace(/\s+/g, ' ');

                if (title && link) {
                    const ruMatch = link.match(/\/RU=([^/]+)/);
                    if (ruMatch) {
                        link = decodeURIComponent(ruMatch[1]);
                    }

                    if (link.startsWith('http')) {
                        let displayLink = '';
                        try {
                            displayLink = new URL(link).host;
                        } catch {
                            displayLink = link;
                        }

                        results.push({
                            title,
                            link,
                            snippet: snippet || 'No description available.',
                            displayLink
                        });
                    }
                }
            });
        } catch (err) {
            console.error('Yahoo fallback search scraping failed:', err.message);
        }
    }

    await canConsumeQuota(1);

    return { items: results };
}

async function fetchOgImage(url) {
    try {
        const res = await axios.get(url, { timeout: 4000, responseType: 'text', maxContentLength: 100000 });
        const html = res.data;
        const m = html.match(/<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
            || html.match(/<meta[^>]+name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i);
        return m ? m[1] : null;
    } catch {
        return null;
    }
}

function faviconFor(domainOrHost) {
    if (!domainOrHost) return null;
    return `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(domainOrHost)}`;
}

function makeEmbedForResult(item) {
    const title = item.title || item.displayLink || 'Result';
    const desc = item.snippet || '';
    const link = item.link || '';
    const display = item.displayLink || (() => {
        try { return new URL(link).host; } catch { return 'site'; }
    })();
    const image = item.pagemap?.cse_image?.[0]?.src || item.pagemap?.metatags?.[0]?.['og:image'] || null;
    const embed = new EmbedBuilder()
        .setTitle(title)
        .setURL(link)
        .setDescription(desc)
        .setAuthor({ name: display, iconURL: faviconFor(display) })
        .setColor(0x2f3136);
    if (image) embed.setThumbnail(image);
    return embed;
}

const TotalWanted = 5;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('search')
        .setIntegrationTypes([0, 1])
        .setContexts([0, 1, 2])
        .setDescription('Look something up on google')
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
            const result = await googleSearch(query, TotalWanted);
            if (result.error === 'QUOTA_EXCEEDED') {
                const msLeft = Math.max(0, result.quota.resetAt - Date.now());
                await interaction.editReply(`Bot can't do searches for today anymore, try again in ${formatCountdown(msLeft)}`);
                return;
            }
            let items = result.items || [];
            if (!items.length) {
                await interaction.editReply('No results found');
                return;
            }

            let index = 0;
            let pageOffset = 0;
            let embeds = items.map(makeEmbedForResult);

            const openButton = new ButtonBuilder()
                .setLabel('Open')
                .setStyle(ButtonStyle.Link)
                .setURL(items[index].link || items[index].formattedUrl || '#');

            const prev = new ButtonBuilder()
                .setCustomId('search_prev')
                .setLabel('◀ Prev')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(true);

            const next = new ButtonBuilder()
                .setCustomId('search_next')
                .setLabel('Next ▶')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(items.length <= 1);

            const navRow = new ActionRowBuilder().addComponents(prev, next, openButton);

            const message = await interaction.editReply({ embeds: [embeds[index]], components: [navRow] });

            const collector = message.createMessageComponentCollector({ time: 120_000 });

            collector.on('collect', async i => {
                if (i.user.id !== interaction.user.id) {
                    await i.reply({ content: 'You didn\'t run this command', flags: MessageFlags.Ephemeral });
                    return;
                }
                if (i.customId === 'search_prev') {
                    if (index > 0) index--;
                } else if (i.customId === 'search_next') {
                    if (index < embeds.length - 1) {
                        index++;
                    }

                    // Scrape another 5 results once user reads 3, 8, 13 etc (index % 5 === 3)
                    if (index % 5 === 3) {
                        pageOffset += 5;
                        try {
                            const newResults = await googleSearch(query, 5, pageOffset);
                            if (newResults.items && newResults.items.length > 0) {
                                items.push(...newResults.items);
                                embeds.push(...newResults.items.map(makeEmbedForResult));
                            }
                        } catch (err) {
                            console.error('Asynchronous pagination search failed:', err.message);
                        }
                    }

                    // Discard first 5 results when reaching index 15 to keep sliding window of max 15
                    if (index >= 15) {
                        items = items.slice(5);
                        embeds = embeds.slice(5);
                        index -= 5;
                    }
                } else {
                    await i.deferUpdate().catch(() => {});
                    return;
                }

                let embed = embeds[index];
                if ((!embed.thumbnail || !embed.thumbnail.url) && items[index].link) {
                    const og = await fetchOgImage(items[index].link);
                    if (og) {
                        embed = EmbedBuilder.from(embed).setThumbnail(og);
                        embeds[index] = embed;
                    }
                }

                const openBtn = ButtonBuilder.from(openButton).setURL(items[index].link || '#');
                const prevBtn = ButtonBuilder.from(prev).setDisabled(index === 0);
                const nextBtn = ButtonBuilder.from(next).setDisabled(index === embeds.length - 1);
                const row = new ActionRowBuilder().addComponents(prevBtn, nextBtn, openBtn);

                await i.update({ embeds: [embed], components: [row] });
            });

            collector.on('end', () => {
                const prevBtn = ButtonBuilder.from(prev).setDisabled(true);
                const nextBtn = ButtonBuilder.from(next).setDisabled(true);
                const openBtn = ButtonBuilder.from(openButton).setURL(items[index].link || '#');
                const row = new ActionRowBuilder().addComponents(prevBtn, nextBtn, openBtn);
                message.edit({ components: [row] }).catch(() => {});
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