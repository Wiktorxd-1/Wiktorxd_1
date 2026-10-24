const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    AttachmentBuilder
} = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const cheerio = require('cheerio');
const { execSync, execFileSync, execFile } = require('child_process');

const COBALT_INSTANCES = [
    'https://cobalt-api.wiktorxd-1.dev/',
    'https://api-cobalt.eversiege.network/',
    'https://cobalt.canine.tools/',
    'https://api.cobalt.liubquanti.click/'
];

async function requestCobalt(payload) {
    let lastError = null;
    for (let api of COBALT_INSTANCES) {
        try {
            const res = await axios.post(api, payload, {
                headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                timeout: 12000
            });
            if (res.data && res.data.status === 'error') {
                throw new Error(res.data.error?.code || 'unknown_error');
            }
            return { data: res.data, apiUsed: api };
        } catch (e) {
            const errMsg = e.response?.data?.error?.code || e.message;
            lastError = new Error(`Instance ${api} failed: ${errMsg}`);
        }
    }
    throw lastError || new Error('All Cobalt instances failed');
}

function ensureSpotdlConfig() {
    try {
        const homeDir = process.env.HOME || '/home/container';
        const configPath = path.join(homeDir, '.config/spotdl/config.json');
        if (fs.existsSync(configPath)) {
            const raw = fs.readFileSync(configPath, 'utf8');
            const cfg = JSON.parse(raw);
            let changed = false;
            if (cfg.lyrics_providers && cfg.lyrics_providers.length > 0) {
                cfg.lyrics_providers = [];
                changed = true;
            }
            if (cfg.client_id !== null || cfg.client_secret !== null) {
                cfg.client_id = null;
                cfg.client_secret = null;
                changed = true;
            }
            if (cfg.use_cache_file !== false) {
                cfg.use_cache_file = false;
                changed = true;
            }
            if (cfg.threads !== 8) {
                cfg.threads = 8;
                changed = true;
            }
            if (changed) {
                fs.writeFileSync(configPath, JSON.stringify(cfg, null, 4));
            }
        }
    } catch { }
}
const UA_BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const DIRECT_MEDIA_EXTS = new Set([
    'mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'flv',
    'mp3', 'wav', 'm4a', 'ogg', 'opus', 'flac', 'aac',
    'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg'
]);
const VIDEO_EXTS = new Set(['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'flv']);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'm4a', 'ogg', 'opus', 'flac', 'aac']);
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg']);

function isDirectMediaUrl(urlStr) {
    try {
        const u = new URL(urlStr);
        const clean = u.pathname.toLowerCase().split('?')[0];
        const m = clean.match(/\.([a-z0-9]+)$/);
        if (m && DIRECT_MEDIA_EXTS.has(m[1])) return true;
        if ((u.hostname.includes('discordapp.') || u.hostname.includes('discord.com')) && u.pathname.includes('/attachments/')) return true;
    } catch { }
    return false;
}

function getMediaFileName(urlStr, contentType = '') {
    try {
        const u = new URL(urlStr);
        let base = path.posix.basename(u.pathname);
        if (base && base.length > 0) {
            let decoded = decodeURIComponent(base);
            if (decoded.includes('.')) return decoded;
            if (contentType.includes('video/mp4')) return `${decoded}.mp4`;
            if (contentType.includes('video/webm')) return `${decoded}.webm`;
            if (contentType.includes('audio/mpeg')) return `${decoded}.mp3`;
            if (contentType.includes('image/png')) return `${decoded}.png`;
            if (contentType.includes('image/jpeg')) return `${decoded}.jpg`;
            return decoded;
        }
    } catch { }
    return 'media_file.mp4';
}

function probeMediaDuration(urlStr) {
    if (!urlStr || typeof urlStr !== 'string') return 0;
    try {
        const u = new URL(urlStr);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return 0;
    } catch {
        return 0;
    }
    try {
        const out = execFileSync('ffprobe', [
            '-user_agent', UA_BROWSER,
            '-v', 'error',
            '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            urlStr
        ], { timeout: 4500, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
        const num = parseFloat(out);
        if (!isNaN(num) && num > 0) return Math.round(num);
    } catch { }
    return 0;
}

async function checkDirectCdnUrl(urlStr) {
    if (isDirectMediaUrl(urlStr)) return { isDirect: true, contentType: '' };
    try {
        const res = await axios.head(urlStr, {
            headers: { 'User-Agent': UA_BROWSER },
            timeout: 2500,
            maxRedirects: 3
        });
        const ct = (res.headers['content-type'] || '').toLowerCase();
        if (ct.startsWith('video/') || ct.startsWith('audio/') || ct.startsWith('image/')) {
            return { isDirect: true, contentType: ct };
        }
    } catch { }
    return { isDirect: false, contentType: '' };
}

function findLargestMedia($, pageUrl) {
    const IGNORE_REGEX = /(?:avatar|pfp|profile|icon|logo|favicon|emoji|badge|spinner|pixel|spacer|placeholder|thumb_small|nav|footer|button|reaction|reaction-icon|header-logo)/i;

    const videoCandidates = [];
    const ogVideo = $('meta[property="og:video:secure_url"]').attr('content') ||
                    $('meta[property="og:video:url"]').attr('content') ||
                    $('meta[property="og:video"]').attr('content') ||
                    $('meta[name="twitter:player:stream"]').attr('content');
    const ogVideoType = $('meta[property="og:video:type"]').attr('content') || '';
    if (ogVideo) {
        const isDirectStream = /\.(mp4|webm|mov|m4v|mkv)(\?.*)?$/i.test(ogVideo) || ogVideoType.startsWith('video/');
        if (isDirectStream) {
            try {
                videoCandidates.push({
                    url: new URL(ogVideo, pageUrl).href,
                    score: 10000000
                });
            } catch { }
        }
    }

    $('video').each((_, el) => {
        const v = $(el);
        let src = v.attr('src');
        if (!src) {
            const srcEl = v.find('source[src]');
            if (srcEl.length) src = srcEl.attr('src');
        }
        if (src) {
            const w = parseInt(v.attr('width') || '0', 10);
            const h = parseInt(v.attr('height') || '0', 10);
            if (w > 0 && h > 0 && (w < 200 || h < 200)) return;
            const checkStr = `${src} ${v.attr('class') || ''} ${v.attr('id') || ''}`;
            if (IGNORE_REGEX.test(checkStr)) return;
            try {
                const fullUrl = new URL(src, pageUrl).href;
                videoCandidates.push({
                    url: fullUrl,
                    score: (w > 0 && h > 0) ? (w * h) : 5000000
                });
            } catch { }
        }
    });

    if (videoCandidates.length > 0) {
        videoCandidates.sort((a, b) => b.score - a.score);
        return { type: 'video', url: videoCandidates[0].url };
    }

    const imageCandidates = [];
    const ogImage = $('meta[property="og:image:secure_url"]').attr('content') ||
                    $('meta[property="og:image:url"]').attr('content') ||
                    $('meta[property="og:image"]').attr('content') ||
                    $('meta[name="twitter:image"]').attr('content') ||
                    $('meta[name="twitter:image:src"]').attr('content');
    if (ogImage && !IGNORE_REGEX.test(ogImage)) {
        try {
            imageCandidates.push({
                url: new URL(ogImage, pageUrl).href,
                score: 756000
            });
        } catch { }
    }

    $('img').each((_, el) => {
        const img = $(el);
        let src = img.attr('src') || img.attr('data-src') || img.attr('data-original') || img.attr('data-lazy-src');
        const srcset = img.attr('srcset') || img.attr('data-srcset');
        if (srcset) {
            const parts = srcset.split(',').map(s => s.trim()).filter(Boolean);
            let bestW = 0;
            let bestPartUrl = null;
            for (const p of parts) {
                const tokens = p.split(/\s+/);
                if (tokens.length >= 2) {
                    const desc = tokens[1];
                    const wMatch = desc.match(/(\d+)w/);
                    const xMatch = desc.match(/(\d+)x/);
                    let val = 0;
                    if (wMatch) val = parseInt(wMatch[1], 10);
                    else if (xMatch) val = parseInt(xMatch[1], 10) * 500;
                    if (val > bestW) {
                        bestW = val;
                        bestPartUrl = tokens[0];
                    }
                }
            }
            if (bestPartUrl) src = bestPartUrl;
        }

        if (!src || src.startsWith('data:image/svg') || src.startsWith('data:image/gif;base64,R0lGODlhAQ')) return;

        const w = parseInt(img.attr('width') || '0', 10);
        const h = parseInt(img.attr('height') || '0', 10);
        if (w > 0 && h > 0 && (w < 200 || h < 200)) return;

        const checkStr = `${src} ${img.attr('class') || ''} ${img.attr('id') || ''} ${img.attr('alt') || ''} ${img.parent().attr('class') || ''}`;
        if (IGNORE_REGEX.test(checkStr)) return;

        try {
            const fullUrl = new URL(src, pageUrl).href;
            const area = (w > 0 && h > 0) ? (w * h) : 40000;
            imageCandidates.push({ url: fullUrl, score: area });
        } catch { }
    });

    if (imageCandidates.length > 0) {
        imageCandidates.sort((a, b) => b.score - a.score);
        return { type: 'image', url: imageCandidates[0].url };
    }

    return null;
}

async function scrapeGenericPage(url) {
    try {
        const res = await axios.get(url, {
            headers: { 'User-Agent': UA_BROWSER },
            timeout: 6000,
            maxRedirects: 5
        });
        const html = typeof res.data === 'string' ? res.data : '';
        if (!html) return null;
        const $ = cheerio.load(html);

        let title = null;
        let creator = null;
        let thumbnailUrl = null;
        let durationSeconds = 0;
        let oEmbedUrl = null;

        const oembedLink = $('link[type="application/json+oembed"]').attr('href') ||
                           $('link[type="text/json+oembed"]').attr('href');
        if (oembedLink) {
            try { oEmbedUrl = new URL(oembedLink, url).href; } catch { }
        }

        if (oEmbedUrl) {
            try {
                const oeRes = await axios.get(oEmbedUrl, { headers: { 'User-Agent': UA_BROWSER }, timeout: 4000 });
                const oe = oeRes.data;
                if (oe) {
                    if (oe.title) title = oe.title;
                    if (oe.author_name) creator = oe.author_name;
                    if (oe.thumbnail_url) thumbnailUrl = oe.thumbnail_url;
                    if (oe.duration) durationSeconds = parseInt(oe.duration, 10) || 0;
                }
            } catch { }
        }

        $('script[type="application/ld+json"]').each((_, el) => {
            try {
                const raw = $(el).html();
                if (!raw) return;
                const data = JSON.parse(raw.trim());
                const items = Array.isArray(data) ? data : [data];
                for (const item of items) {
                    if (!item || typeof item !== 'object') continue;
                    if (!title && (item.name || item.headline)) title = item.name || item.headline;
                    if (!creator) {
                        const author = item.author || item.creator;
                        if (typeof author === 'string') creator = author;
                        else if (author?.name) creator = author.name;
                    }
                    if (!thumbnailUrl && item.thumbnailUrl) {
                        thumbnailUrl = Array.isArray(item.thumbnailUrl) ? item.thumbnailUrl[0] : item.thumbnailUrl;
                    }
                    if (!durationSeconds && item.duration) {
                        durationSeconds = parseISODuration(item.duration);
                    }
                }
            } catch { }
        });

        const ogTitle = $('meta[property="og:title"]').attr('content') ||
                        $('meta[name="twitter:title"]').attr('content');
        const ogCreator = $('meta[property="og:site_name"]').attr('content') ||
                          $('meta[name="author"]').attr('content') ||
                          $('meta[property="article:author"]').attr('content') ||
                          $('meta[name="twitter:creator"]').attr('content');
        const ogImage = $('meta[property="og:image:secure_url"]').attr('content') ||
                        $('meta[property="og:image:url"]').attr('content') ||
                        $('meta[property="og:image"]').attr('content') ||
                        $('meta[name="twitter:image"]').attr('content') ||
                        $('meta[name="twitter:image:src"]').attr('content');
        const ogDuration = $('meta[property="og:video:duration"]').attr('content') ||
                           $('meta[property="music:duration"]').attr('content');

        if (!title && ogTitle) title = ogTitle;
        if (!title) {
            const dt = $('title').text().trim();
            if (dt) title = dt;
        }

        if (!creator && ogCreator) creator = ogCreator;
        if (!thumbnailUrl && ogImage) {
            try { thumbnailUrl = new URL(ogImage, url).href; } catch { }
        }
        if (!durationSeconds && ogDuration) {
            durationSeconds = parseInt(ogDuration, 10) || 0;
        }

        const largestMedia = findLargestMedia($, url);

        return {
            title,
            creator,
            thumbnailUrl,
            durationSeconds,
            largestMedia
        };
    } catch {
        return null;
    }
}

function videoHasAudio(filePath) {
    try {
        const out = execFileSync('ffprobe', [
            '-v', 'error',
            '-select_streams', 'a',
            '-show_entries', 'stream=codec_type',
            '-of', 'csv=p=0',
            filePath
        ], { timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
        return out.includes('audio');
    } catch {
        return false;
    }
}

function convertVideoToGif(inputPath, outputPath) {
    try {
        execFileSync('ffmpeg', [
            '-y',
            '-threads', '2',
            '-i', inputPath,
            '-vf', 'fps=15,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse',
            outputPath
        ], { timeout: 60000, stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

async function processImage(buffer, targetFormat, qualityPercent) {
    try {
        const fmt = (targetFormat || 'png').toLowerCase();
        let p = sharp(buffer);
        if (fmt === 'jpg' || fmt === 'jpeg') p = p.jpeg({ quality: qualityPercent });
        else if (fmt === 'png') p = p.png();
        else if (fmt === 'webp') p = p.webp({ quality: qualityPercent });
        else if (fmt === 'gif') p = p.gif();
        return await p.toBuffer();
    } catch {
        return buffer;
    }
}

function parseISODuration(iso) {
    if (!iso) return 0;
    const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?/);
    if (!m) return 0;
    return (parseInt(m[1] || 0) * 3600) + (parseInt(m[2] || 0) * 60) + parseFloat(m[3] || 0);
}

function shortcodeToMediaId(shortcode) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let id = BigInt(0);
    for (const char of shortcode) id = id * BigInt(64) + BigInt(alphabet.indexOf(char));
    return id.toString();
}

function formatDuration(secs) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    return h > 0
        ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
        : `${m}:${String(s).padStart(2, '0')}`;
}

function ensureTempDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function tryUnlink(p) {
    try { fs.unlinkSync(p); } catch { }
}

function getExt(urlStr) {
    const clean = urlStr.split('?')[0];
    const m = clean.match(/\.([a-zA-Z0-9]+)$/);
    return m ? m[1] : null;
}

function normalizeUrl(url) {
    if (!url) return url;
    let normalized = url.trim();
    normalized = normalized.replace(/^(https?:\/\/)?([a-z0-9]+\.)?(fxtwitter|fixupx|twittpr|fixvx|girlcockx)\.com/i, '$1$2twitter.com');
    normalized = normalized.replace(/^(https?:\/\/)?([a-z0-9]+\.)?(vxreddit|rxddit)\.com/i, '$1$2reddit.com');
    normalized = normalized.replace(/^(https?:\/\/)?([a-z0-9]+\.)?(vxtiktok|tiktxk)\.com/i, '$1$2tiktok.com');
    normalized = normalized.replace(/^(https?:\/\/)?([a-z0-9]+\.)?ddinstagram\.com/i, '$1$2instagram.com');
    return normalized;
}

function isSpotifyUrl(url) {
    if (!url || typeof url !== 'string') return false;
    try {
        const u = new URL(url);
        if (u.hostname !== 'open.spotify.com' && u.hostname !== 'spotify.com') return false;
        return /^\/(track|album|playlist|episode|show)\/[a-zA-Z0-9]+$/i.test(u.pathname);
    } catch {
        return false;
    }
}

async function fetchSpotifyMetadata(url) {
    const trackMatch = url.match(/open\.spotify\.com\/track\/([A-Za-z0-9]+)/);
    const albumMatch = url.match(/open\.spotify\.com\/album\/([A-Za-z0-9]+)/);
    const playlistMatch = url.match(/open\.spotify\.com\/playlist\/([A-Za-z0-9]+)/);
    const episodeMatch = url.match(/open\.spotify\.com\/episode\/([A-Za-z0-9]+)/);

    let kind = 'track';
    if (albumMatch) kind = 'album';
    else if (playlistMatch) kind = 'playlist';
    else if (episodeMatch) kind = 'episode';

    let title = 'Spotify Track';
    let creator = 'Spotify';
    let thumbnailUrl = null;
    let durationSeconds = 0;

    if (trackMatch) {
        try {
            const embedRes = await axios.get(`https://open.spotify.com/embed/track/${trackMatch[1]}`, {
                headers: { 'User-Agent': UA_BROWSER },
                timeout: 3000
            });
            const scriptMatch = embedRes.data.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
            if (scriptMatch) {
                const data = JSON.parse(scriptMatch[1].trim());
                const entity = data?.props?.pageProps?.state?.data?.entity;
                if (entity) {
                    if (entity.name) title = entity.name;
                    if (Array.isArray(entity.artists) && entity.artists.length > 0) {
                        creator = entity.artists.map(a => a.name).join(', ');
                    }
                    if (entity.duration) durationSeconds = Math.round(entity.duration / 1000);
                    if (entity.visualIdentity?.image?.length) {
                        thumbnailUrl = entity.visualIdentity.image[0].url;
                    }
                }
            }
        } catch { }
    }

    if (title === 'Spotify Track' || creator === 'Spotify') {
        try {
            const oEmbedRes = await axios.get(
                `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`,
                { headers: { 'User-Agent': UA_BROWSER }, timeout: 3000 }
            );
            const oe = oEmbedRes.data;
            if (title === 'Spotify Track' && oe.title) title = oe.title;
            if (!thumbnailUrl && oe.thumbnail_url) thumbnailUrl = oe.thumbnail_url;
        } catch { }
    }

    return {
        title,
        creator,
        thumbnailUrl,
        durationSeconds,
        kind
    };
}

async function processSlideFile(buffer, tempFilePath, ext, isAudio, state, idx, count, safeTitle, tempDir) {
    const isVideo = VIDEO_EXTS.has(ext.toLowerCase());
    let finalFilename = count > 1 ? `${safeTitle}_${idx + 1}.${ext}` : `${safeTitle}.${ext}`;
    let finalPath = tempFilePath;

    if (!isAudio) {
        if (isVideo) {
            const hasAudio = videoHasAudio(tempFilePath);
            if (!hasAudio) {
                const gifFilename = count > 1 ? `${safeTitle}_${idx + 1}.gif` : `${safeTitle}.gif`;
                const gifPath = path.join(tempDir, `temp_${Date.now()}_${idx}_${gifFilename}`);
                if (convertVideoToGif(tempFilePath, gifPath)) {
                    tryUnlink(tempFilePath);
                    finalPath = gifPath;
                    finalFilename = gifFilename;
                    buffer = fs.readFileSync(gifPath);
                }
            }
        } else {
            let fmt = (state.format || 'png').toLowerCase();
            if (fmt === 'mp4' || fmt === 'webm' || fmt === 'mkv') {
                fmt = (ext || 'png').toLowerCase();
            }
            const q = parseInt(state.quality || '100', 10);
            const origExt = (ext || 'png').toLowerCase();
            if (origExt !== fmt || q < 100) {
                buffer = await processImage(buffer, fmt, q);
                tryUnlink(tempFilePath);
                finalFilename = count > 1 ? `${safeTitle}_${idx + 1}.${fmt}` : `${safeTitle}.${fmt}`;
                finalPath = path.join(tempDir, `temp_${Date.now()}_${idx}_${finalFilename}`);
                fs.writeFileSync(finalPath, buffer);
            }
        }
    }

    return { path: finalPath, name: finalFilename };
}

async function fetchInstagramMetadata(url) {
    const postMatch = url.match(/\/(?:p|reel|reels)\/([^/?#]+)/);
    if (!postMatch) return null;
    const shortcode = postMatch[1];
    const sessionId = process.env.INSTAGRAM_SESSION_ID;

    if (sessionId) {
        try {
            const mediaId = shortcodeToMediaId(shortcode);
            const apiRes = await axios.get(`https://i.instagram.com/api/v1/media/${mediaId}/info/`, {
                headers: {
                    'User-Agent': 'Instagram 269.0.0.18.75 Android (26/8.0.0; 480dpi; 1080x1920; OnePlus; 6T; OnePlus6T; qcom; en_US; 314665256)',
                    'Accept-Language': 'en-US',
                    'X-IG-App-ID': '936619743392459',
                    'Cookie': `sessionid=${sessionId}`,
                },
                timeout: 10000,
            });
            const item = apiRes.data?.items?.[0];
            if (item) {
                const caption = item.caption?.text || '';
                const owner = item.user?.username || item.owner?.username || 'Instagram User';
                const firstLine = caption.split('\n')[0].trim();
                const titleText = firstLine.length > 3 ? firstLine.slice(0, 256) : `Instagram Post by @${owner}`;
                let mediaType = 'video';
                let directUrls = [];
                if (item.media_type === 1) {
                    mediaType = 'image';
                    const imgUrl = item.image_versions2?.candidates?.[0]?.url;
                    if (imgUrl) directUrls.push(imgUrl);
                } else if (item.media_type === 8 || (item.carousel_media && item.carousel_media.length > 1)) {
                    mediaType = 'slideshow';
                    for (const sub of item.carousel_media || []) {
                        const u = sub.media_type === 2
                            ? sub.video_versions?.[0]?.url
                            : sub.image_versions2?.candidates?.[0]?.url;
                        if (u) directUrls.push(u);
                    }
                } else if (item.media_type === 2) {
                    const vidUrl = item.video_versions?.[0]?.url;
                    if (vidUrl) directUrls.push(vidUrl);
                }
                const directAudioUrl =
                    item.clips_metadata?.music_info?.music_asset_info?.progressive_download_url ||
                    item.clips_metadata?.original_sound_info?.progressive_download_url || null;
                return {
                    title: titleText,
                    creator: `@${owner}`,
                    thumbnailUrl: item.image_versions2?.candidates?.[0]?.url || null,
                    durationSeconds: item.video_duration || 0,
                    mediaType, directUrls, directAudioUrl
                };
            }
        } catch { }
    }

    const cleanUrl = `https://www.instagram.com/reel/${shortcode}/`;
    const desktopUA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

    try {
        const pageRes = await axios.get(cleanUrl, {
            headers: {
                'User-Agent': desktopUA,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Cache-Control': 'no-cache',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
            },
            timeout: 12000,
        });
        const html = pageRes.data;
        let ldData = null;
        for (const match of [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)]) {
            try {
                const entries = [].concat(JSON.parse(match[1]));
                const found = entries.find(e => e['@type'] === 'VideoObject' || e['@type'] === 'ImageObject');
                if (found) { ldData = found; break; }
            } catch { }
        }
        if (ldData) {
            const name = ldData.name || ldData.headline || '';
            const authorObj = ldData.author || ldData.creator;
            const authorName = typeof authorObj === 'string' ? authorObj : authorObj?.name || '';
            const thumbnailUrl = Array.isArray(ldData.thumbnailUrl) ? ldData.thumbnailUrl[0] : ldData.thumbnailUrl || null;
            return {
                title: name.trim().slice(0, 256) || (authorName ? `Instagram Post by @${authorName}` : 'Instagram Post'),
                creator: authorName ? `@${authorName}` : null,
                thumbnailUrl,
                durationSeconds: parseISODuration(ldData.duration || ''),
                mediaType: ldData['@type'] === 'ImageObject' ? 'image' : 'video'
            };
        }
        const ogTitle = html.match(/<meta property="og:title" content="([^"]+)"/)?.[1] || '';
        const ogDesc = html.match(/<meta property="og:description" content="([^"]+)"/)?.[1] || '';
        const ogImage = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1] || null;
        const authorMeta = html.match(/<meta name="author" content="([^"]+)"/)?.[1] || '';
        if (ogTitle || ogDesc) {
            const rawTitle = (ogTitle || ogDesc).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").slice(0, 256);
            let mediaType = 'video';
            if (html.includes('"media_type":1') || html.includes('instapp:photo') || html.includes('ImageObject')) mediaType = 'image';
            else if (html.includes('"media_type":8') || html.includes('carousel_media')) mediaType = 'slideshow';
            return { title: rawTitle, creator: authorMeta ? `@${authorMeta}` : null, thumbnailUrl: ogImage, durationSeconds: 0, mediaType };
        }
    } catch { }

    try {
        const d = (await axios.get(`https://www.instagram.com/api/v1/oembed/?url=${encodeURIComponent(cleanUrl)}&hidecaption=false`, {
            headers: { 'User-Agent': desktopUA }, timeout: 8000,
        })).data;
        return {
            title: d.title || `Instagram Post by @${d.author_name}`,
            creator: d.author_name ? `@${d.author_name}` : null,
            thumbnailUrl: d.thumbnail_url || null,
            durationSeconds: 0,
            mediaType: d.type === 'photo' ? 'image' : 'video'
        };
    } catch { }

    return null;
}

async function fetchMetadata(url) {
    let title = 'Unknown Video', creator = 'Unknown Creator', thumbnailUrl = null;
    let duration = 'Unknown duration', durationSeconds = 0, maxQuality = 1080;
    let directUrls = [], directAudioUrl = null;

    const directCheck = await checkDirectCdnUrl(url);
    if (directCheck.isDirect) {
        const fileName = getMediaFileName(url, directCheck.contentType);
        const ext = getExt(fileName) || (directCheck.contentType?.includes('image') ? 'png' : (directCheck.contentType?.includes('audio') ? 'mp3' : 'mp4'));
        const isImage = IMAGE_EXTS.has(ext);
        const isAudio = AUDIO_EXTS.has(ext);
        let dur = isImage ? 'Image' : (isAudio ? 'Audio' : 'Video');
        let durSec = 0;
        if (!isImage) {
            durSec = probeMediaDuration(url);
            if (durSec > 0) dur = formatDuration(durSec);
        }
        return {
            title: fileName,
            fileName,
            creator: null,
            thumbnailUrl: isImage ? url : null,
            duration: dur,
            durationSeconds: durSec,
            maxQuality: 1080,
            directUrls: [url],
            directAudioUrl: isAudio ? url : null,
            isDirectCdn: true
        };
    }

    if (isSpotifyUrl(url)) {
        const sp = await fetchSpotifyMetadata(url);
        return {
            title: sp.title,
            creator: sp.creator,
            thumbnailUrl: sp.thumbnailUrl,
            duration: sp.durationSeconds ? formatDuration(sp.durationSeconds) : 'Audio',
            durationSeconds: sp.durationSeconds || 0,
            maxQuality: 1080,
            directUrls: [],
            directAudioUrl: null,
            isSpotify: true,
            spotifyUrl: url,
            spotifyKind: sp.kind
        };
    }

    let targetUrl = url;
    if (url.includes('youtu.be/')) {
        const m = url.match(/youtu\.be\/([^?#]+)/);
        if (m) targetUrl = `https://www.youtube.com/watch?v=${m[1]}`;
    } else if (url.includes('youtube.com/shorts/')) {
        const m = url.match(/youtube\.com\/shorts\/([^?#]+)/);
        if (m) targetUrl = `https://www.youtube.com/watch?v=${m[1]}`;
    } else if (url.includes('m.youtube.com/')) {
        targetUrl = url.replace('m.youtube.com/', 'www.youtube.com/');
    }

    if (targetUrl.includes('instagram.com') || targetUrl.includes('instagr.am')) {
        try {
            const ig = await fetchInstagramMetadata(targetUrl);
            if (ig) {
                if (ig.title) title = ig.title;
                if (ig.creator) creator = ig.creator;
                if (ig.thumbnailUrl) thumbnailUrl = ig.thumbnailUrl;
                if (ig.durationSeconds) durationSeconds = ig.durationSeconds;
                if (ig.directUrls) directUrls = ig.directUrls;
                if (ig.directAudioUrl) directAudioUrl = ig.directAudioUrl;
                if (ig.mediaType === 'slideshow') { duration = 'Slideshow'; durationSeconds = 0; }
                else if (ig.mediaType === 'image') { duration = 'Image'; durationSeconds = 0; }
            }
        } catch { }

        if (title === 'Unknown Video') {
            const postMatch = targetUrl.match(/\/(?:p|reel|reels)\/([^/?#]+)/);
            const userMatch = targetUrl.match(/instagram\.com\/([^/]+)\/(?:p|reel|reels)\//);
            const uname = (userMatch && !['p', 'reel', 'reels', 'tv', 'stories', 'share'].includes(userMatch[1])) ? userMatch[1] : 'Instagram User';
            title = postMatch ? `Instagram Reel by ${uname}` : 'Instagram Post';
            if (creator === 'Unknown Creator') creator = uname;
            if (!thumbnailUrl) thumbnailUrl = 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e7/Instagram_logo_2016.svg/1024px-Instagram_logo_2016.svg.png';
        }
        if (durationSeconds > 0 && duration === 'Unknown duration') duration = formatDuration(durationSeconds);
        return { title, creator, thumbnailUrl, duration, durationSeconds, maxQuality, directUrls, directAudioUrl };
    }

    let oEmbedUrl = null;
    let isTikTokSlideshow = false;
    if (targetUrl.includes('tiktok.com')) {
        if (targetUrl.includes('/photo/')) { isTikTokSlideshow = true; duration = 'Slideshow'; durationSeconds = 0; }
        const oEmbedTargetUrl = targetUrl.replace('/photo/', '/video/');
        oEmbedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(oEmbedTargetUrl)}`;
    } else if (targetUrl.includes('soundcloud.com')) {
        oEmbedUrl = `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(targetUrl)}`;
    } else if (targetUrl.includes('vimeo.com')) {
        oEmbedUrl = `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(targetUrl)}`;
    } else if (targetUrl.includes('twitter.com') || targetUrl.includes('x.com')) {
        oEmbedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(targetUrl)}`;
    } else if (targetUrl.includes('dailymotion.com')) {
        oEmbedUrl = `https://www.dailymotion.com/services/oembed?url=${encodeURIComponent(targetUrl)}`;
    } else if (targetUrl.includes('streamable.com')) {
        oEmbedUrl = `https://api.streamable.com/oembed.json?url=${encodeURIComponent(targetUrl)}`;
    } else if (targetUrl.includes('loom.com')) {
        oEmbedUrl = `https://www.loom.com/v1/oembed?url=${encodeURIComponent(targetUrl)}`;
    } else if (targetUrl.includes('twitch.tv')) {
        oEmbedUrl = `https://www.twitch.tv/oembed?url=${encodeURIComponent(targetUrl)}`;
    } else if (targetUrl.includes('tumblr.com')) {
        oEmbedUrl = `https://www.tumblr.com/oembed/1.0?url=${encodeURIComponent(targetUrl)}`;
    } else if (targetUrl.includes('vk.com')) {
        oEmbedUrl = `https://vk.com/oembed.json?url=${encodeURIComponent(targetUrl)}`;
    } else if (targetUrl.includes('ok.ru')) {
        oEmbedUrl = `https://ok.ru/oembed?url=${encodeURIComponent(targetUrl)}`;
    } else if (targetUrl.includes('youtube.com') || targetUrl.includes('youtu.be')) {
        oEmbedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(targetUrl)}&format=json`;
    } else if (!targetUrl.includes('reddit.com') && !targetUrl.includes('redd.it') &&
               !targetUrl.includes('bilibili.com') && !targetUrl.includes('bsky.app') &&
               !targetUrl.includes('rutube.ru')) {
        oEmbedUrl = `https://noembed.com/embed?url=${encodeURIComponent(targetUrl)}`;
    }

    if (oEmbedUrl) {
        try {
            const oe = (await axios.get(oEmbedUrl, { timeout: 4000 })).data;
            if (oe.title) title = oe.title;
            if (oe.author_name) creator = oe.author_name;
            if (oe.thumbnail_url) thumbnailUrl = oe.thumbnail_url;
            if (oe.duration) durationSeconds = parseInt(oe.duration, 10) || 0;
        } catch { }
    }

    if (targetUrl.includes('youtube.com') || targetUrl.includes('youtu.be')) {
        try {
            const pageRes = await axios.get(targetUrl, { headers: { 'User-Agent': UA_BROWSER }, timeout: 3500 });
            const html = pageRes.data;
            const heights = (html.match(/"height":\s*(\d+)/g) || [])
                .map(m => parseInt(m.match(/\d+/)[0]))
                .filter(h => h > 0 && h <= 4320);
            if (heights.length) maxQuality = Math.max(...heights);
            if (title === 'Unknown Video') {
                const tm = html.match(/<meta property="og:title" content="([^"]+)"/i) ||
                    html.match(/<meta name="title" content="([^"]+)"/i) ||
                    html.match(/<title>([^<]+)<\/title>/i);
                if (tm) title = tm[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
            }
            if (creator === 'Unknown Creator') {
                const cm = html.match(/"channelName"\s*:\s*"([^"]+)"/) ||
                    html.match(/<link itemprop="name" content="([^"]+)"/i) ||
                    html.match(/<meta name="author" content="([^"]+)"/i);
                if (cm) creator = cm[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
            }
            if (!thumbnailUrl) {
                const th = html.match(/<meta property="og:image" content="([^"]+)"/i) ||
                    html.match(/<link itemprop="thumbnailUrl" href="([^"]+)"/i);
                if (th) thumbnailUrl = th[1];
            }
            const lm = html.match(/"lengthSeconds"\s*:\s*"(\d+)"/);
            if (lm) {
                durationSeconds = parseInt(lm[1], 10);
                duration = formatDuration(durationSeconds);
            } else {
                const dm = html.match(/<meta itemprop="duration" content="([^"]+)">/);
                if (dm) {
                    const mm = dm[1].match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
                    if (mm) {
                        durationSeconds = parseInt(mm[1] || 0) * 3600 + parseInt(mm[2] || 0) * 60 + parseInt(mm[3] || 0);
                        duration = formatDuration(durationSeconds);
                    }
                }
            }
        } catch { }
    }

    if (targetUrl.includes('tiktok.com')) {
        try {
            const pageRes = await axios.get(targetUrl, { headers: { 'User-Agent': UA_BROWSER }, timeout: 10000 });
            const scriptMatch =
                pageRes.data.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/) ||
                pageRes.data.match(/<script id="SIGI_STATE"[^>]*>([\s\S]*?)<\/script>/) ||
                pageRes.data.match(/<script id="__INIT_DATA__"[^>]*>([\s\S]*?)<\/script>/);

            if (scriptMatch) {
                const data = JSON.parse(scriptMatch[1].trim());

                const findKey = (obj, key) => {
                    if (!obj || typeof obj !== 'object') return null;
                    if (obj[key] !== undefined) return obj[key];
                    for (const k in obj) {
                        const r = findKey(obj[k], key);
                        if (r !== null) return r;
                    }
                    return null;
                };

                const itemStruct = findKey(data, 'itemStruct');
                let isSlideshow = false, isImage = false;

                if (itemStruct) {
                    if (itemStruct.video?.duration) durationSeconds = itemStruct.video.duration;
                    const imgList = itemStruct.imagePost?.images || (Array.isArray(itemStruct.images) ? itemStruct.images : null);
                    if (imgList) {
                        isSlideshow = imgList.length > 1;
                        isImage = !isSlideshow;
                        directUrls = imgList.map(img => {
                            if (typeof img === 'string') return img;
                            return img.displayImage?.urlList?.[0] || img.imageURL?.urlList?.[0] || img.displayAddr || null;
                        }).filter(Boolean);
                    }
                    if (itemStruct.desc) title = itemStruct.desc;
                    if (itemStruct.author?.nickname) creator = itemStruct.author.nickname;
                    if (itemStruct.music?.playUrl) directAudioUrl = itemStruct.music.playUrl;
                }

                if (!isSlideshow && !isImage) {
                    const imagePost = findKey(data, 'imagePost');
                    if (imagePost) {
                        const imgs = imagePost.images || [];
                        isSlideshow = imgs.length > 1;
                        isImage = !isSlideshow;
                        directUrls = imgs.map(img =>
                            img.displayImage?.urlList?.[0] || img.imageURL?.urlList?.[0] || img.displayAddr || null
                        ).filter(Boolean);
                    }
                }

                if (!directAudioUrl) {
                    const playUrl = findKey(data, 'playUrl');
                    if (playUrl) directAudioUrl = playUrl;
                }

                if (isSlideshow || isTikTokSlideshow) { duration = 'Slideshow'; durationSeconds = 0; }
                else if (isImage) { duration = 'Image'; durationSeconds = 0; }
                else if (!durationSeconds) {
                    const fd = findKey(data, 'duration');
                    if (fd) durationSeconds = fd;
                }

                if (!title || title === 'Unknown Video') {
                    const fd = findKey(data, 'desc');
                    if (fd) title = fd;
                }
                if (creator === 'Unknown Creator') {
                    const fn = findKey(data, 'nickname');
                    if (fn) creator = fn;
                }
            }
        } catch { }
    }

    if (targetUrl.includes('tiktok.com') && (!title || title === 'Unknown Video'))
        title = creator !== 'Unknown Creator' ? `TikTok Video by ${creator}` : 'TikTok Video';

    if (targetUrl.includes('twitter.com') || targetUrl.includes('x.com')) {
        try {
            const statusMatch = targetUrl.match(/\/status\/(\d+)/);
            const userMatch = targetUrl.match(/(?:twitter|x)\.com\/([^/?#]+)\/status/);
            if (statusMatch) {
                const username = userMatch ? userMatch[1] : null;
                const statusId = statusMatch[1];
                let tweet = null;
                try {
                    const fxRes = await axios.get(`https://api.fxtwitter.com/status/${statusId}`, { timeout: 6000 });
                    tweet = fxRes.data?.tweet;
                } catch {
                    try {
                        const vxRes = await axios.get(`https://api.vxtwitter.com/Twitter/status/${statusId}`, { timeout: 6000 });
                        if (vxRes.data) {
                            tweet = {
                                text: vxRes.data.text,
                                author: { name: vxRes.data.user_name || vxRes.data.user_screen_name },
                                media: {
                                    photos: (vxRes.data.media_urls || []).filter(u => u.match(/\.(jpg|jpeg|png|webp)/i)).map(u => ({ url: u })),
                                    videos: vxRes.data.video_url ? [{ duration: 0 }] : []
                                }
                            };
                        }
                    } catch { }
                }
                if (tweet) {
                    if (tweet.text) title = tweet.text.slice(0, 256);
                    if (tweet.author?.name) creator = tweet.author.name;

                    const photos = tweet.media?.photos || [];
                    const videos = tweet.media?.videos || [];

                    if (photos.length > 0 && videos.length === 0) {
                        directUrls = photos.map(p => p.url).filter(Boolean);
                        if (photos.length === 1) {
                            duration = 'Image';
                            durationSeconds = 0;
                            thumbnailUrl = thumbnailUrl || photos[0].url;
                        } else {
                            duration = 'Slideshow';
                            durationSeconds = 0;
                            thumbnailUrl = thumbnailUrl || photos[0].url;
                        }
                    } else {
                        if (!thumbnailUrl && tweet.thumbnail_url) thumbnailUrl = tweet.thumbnail_url;
                        const vid = videos[0];
                        if (vid?.duration) {
                            durationSeconds = Math.round(vid.duration);
                            duration = formatDuration(durationSeconds);
                        } else {
                            duration = 'Video';
                        }
                    }
                }
                if (creator === 'Unknown Creator' && username) creator = `@${username}`;
            }
        } catch { }
    }

    if (targetUrl.includes('reddit.com') || targetUrl.includes('redd.it')) {
        try {
            let redditUrl = targetUrl.split('?')[0].replace(/\/$/, '');
            if (targetUrl.includes('redd.it') || targetUrl.includes('/s/')) {
                try {
                    const res = await axios.get(targetUrl, {
                        maxRedirects: 0,
                        validateStatus: (status) => status >= 300 && status < 400,
                        headers: { 'User-Agent': UA_BROWSER },
                        timeout: 5000
                    });
                    if (res.headers.location) {
                        redditUrl = new URL(res.headers.location, targetUrl).href;
                    }
                } catch { }
            }

            const subMatch = redditUrl.match(/\/r\/([^/]+)/);
            if (subMatch) creator = `r/${subMatch[1]}`;

            const slugMatch = redditUrl.match(/\/comments\/[^/]+\/([^/]+)/);
            if (slugMatch) {
                const slug = slugMatch[1].replace(/[_-]/g, ' ');
                title = slug.charAt(0).toUpperCase() + slug.slice(1);
            }

            try {
                const cleanJsonUrl = redditUrl.split('?')[0].replace(/\/$/, '') + '.json?raw_json=1';
                const headers = {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                };
                if (process.env.REDDIT_COOKIE) {
                    headers['Cookie'] = process.env.REDDIT_COOKIE;
                }
                const jsonRes = await axios.get(cleanJsonUrl, {
                    headers: headers, timeout: 5000
                });
                const post = jsonRes.data?.[0]?.data?.children?.[0]?.data;
                if (post) {
                    if (post.title) title = post.title.slice(0, 256);
                    if (post.author) creator = `u/${post.author}`;
                    if (post.thumbnail && post.thumbnail.startsWith('http')) thumbnailUrl = post.thumbnail;
                    
                    if (post.is_video && post.media?.reddit_video?.duration) {
                        durationSeconds = post.media.reddit_video.duration;
                        duration = formatDuration(durationSeconds);
                    } else if (post.is_gallery && post.gallery_data?.items && post.media_metadata) {
                        duration = 'Slideshow';
                        durationSeconds = 0;
                        directUrls = [];
                        for (const item of post.gallery_data.items) {
                            const mediaId = item.media_id;
                            const meta = post.media_metadata[mediaId];
                            if (meta && meta.status === 'valid') {
                                const mime = meta.m || 'image/png';
                                const ext = mime.split('/')[1] || 'png';
                                directUrls.push(`https://i.redd.it/${mediaId}.${ext}`);
                            }
                        }
                        if (directUrls.length > 0) {
                            thumbnailUrl = thumbnailUrl || directUrls[0];
                        }
                    } else if (post.post_hint === 'image' || post.url_overridden_by_dest?.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
                        duration = 'Image';
                        durationSeconds = 0;
                        directUrls = [post.url_overridden_by_dest];
                        thumbnailUrl = thumbnailUrl || post.url_overridden_by_dest;
                    }
                }
            } catch {
                let embedSuccess = false;
                try {
                    const match = redditUrl.match(/\/r\/([^/]+)\/comments\/([^/]+)/);
                    if (match) {
                        const subreddit = match[1];
                        const postId = match[2];
                        const embedUrl = `https://embed.reddit.com/r/${subreddit}/comments/${postId}`;
                        const embedRes = await axios.get(embedUrl, {
                            headers: {
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                            },
                            timeout: 8000
                        });
                        const embedHtml = embedRes.data;

                        const titleMatch = embedHtml.match(/<h1[^>]*>([^<]+)<\/h1>/i);
                        if (titleMatch) title = titleMatch[1].trim().slice(0, 256);

                        const authorMatch = embedHtml.match(/href=\"https:\/\/www\.reddit\.com\/user\/([^/?\"]+)/i);
                        if (authorMatch) creator = `u/${authorMatch[1].trim()}`;

                        const typeMatch = embedHtml.match(/type&quot;:&quot;(gallery|image|video|gif)&quot;/i) ||
                                          embedHtml.match(/\"type\":\s*\"(gallery|image|video|gif)\"/i);
                        const postType = typeMatch ? typeMatch[1].toLowerCase() : null;

                        if (postType === 'gallery' || postType === 'image') {
                            const imgMatches = [...embedHtml.matchAll(/(https?:\/\/preview\.redd\.it\/[^\s\"\'\>\&]+|https?:\/\/i\.redd\.it\/[^\s\"\'\>\&]+)/gi)];
                            if (imgMatches.length > 0) {
                                const uniqueSet = new Set();
                                for (const m of imgMatches) {
                                    const rawUrl = m[0];
                                    let clean = rawUrl.split('?')[0];
                                    let filename = clean.substring(clean.lastIndexOf('/') + 1);
                                    let mediaPart = filename;
                                    if (filename.includes('-v0-')) {
                                        mediaPart = filename.split('-v0-')[1];
                                    }
                                    uniqueSet.add(`https://i.redd.it/${mediaPart}`);
                                }
                                directUrls = Array.from(uniqueSet);
                                if (directUrls.length > 1) {
                                    duration = 'Slideshow';
                                    durationSeconds = 0;
                                } else if (directUrls.length === 1) {
                                    duration = 'Image';
                                    durationSeconds = 0;
                                }
                                if (directUrls.length > 0) {
                                    thumbnailUrl = thumbnailUrl || directUrls[0];
                                }
                                embedSuccess = true;
                            }
                        }
                    }
                } catch { }

                if (!embedSuccess) {
                    try {
                        const rssUrl = redditUrl.split('?')[0].replace(/\/$/, '') + '.rss';
                        const rssRes = await axios.get(rssUrl, {
                            headers: { 'User-Agent': 'WiktorxdRedditCrawler/1.0.0 (contact: admin@wiktorxd-1.dev)' }, timeout: 5000
                        });
                        const rssHtml = rssRes.data;
                        const entryParts = rssHtml.split('<entry>');
                        if (entryParts.length > 1) {
                            const entryHtml = entryParts[1];
                            const titleMatch = entryHtml.match(/<title>([^<]+)<\/title>/);
                            if (titleMatch) title = titleMatch[1].trim().slice(0, 256);

                            const authorMatch = entryHtml.match(/<author>\s*<name>([^<]+)<\/name>/);
                            if (authorMatch) creator = authorMatch[1].trim();

                            const contentMatch = entryHtml.match(/<content[^>]*>([\s\S]*?)<\/content>/);
                            const content = contentMatch ? contentMatch[1] : '';

                            const linkMatch = content.match(/&lt;span&gt;&lt;a href=&quot;([^&]+)&quot;&gt;\[link\]&lt;\/a&gt;&lt;/i) ||
                                              content.match(/&lt;a href=&quot;([^&]+)&quot;&gt;\[link\]&lt;\/a&gt;/i);
                            const origLink = linkMatch ? linkMatch[1].replace(/&amp;/g, '&') : '';

                            if (origLink) {
                                if (origLink.includes('reddit.com/gallery/')) {
                                    duration = 'Slideshow';
                                    durationSeconds = 0;
                                } else if (origLink.includes('v.redd.it')) {
                                    duration = 'Video';
                                } else if (origLink.match(/\.(jpg|jpeg|png|gif|webp)$/i) || origLink.includes('i.redd.it') || origLink.includes('preview.redd.it')) {
                                    duration = 'Image';
                                    durationSeconds = 0;
                                    directUrls = [origLink];
                                    thumbnailUrl = thumbnailUrl || origLink;
                                }
                            }
                        }
                    } catch { }
                }
            }

            if (duration === 'Unknown duration') {
                if (redditUrl.includes('/gallery/')) {
                    duration = 'Slideshow';
                    durationSeconds = 0;
                } else if (redditUrl.match(/\.(jpg|jpeg|png|gif|webp)$/i) || redditUrl.includes('i.redd.it') || redditUrl.includes('preview.redd.it')) {
                    duration = 'Image';
                    durationSeconds = 0;
                    if (redditUrl.startsWith('http')) {
                        directUrls = [redditUrl];
                        thumbnailUrl = thumbnailUrl || redditUrl;
                    }
                }
            }
        } catch { }
    }

    if (targetUrl.includes('bilibili.com')) {
        try {
            const bvidMatch = targetUrl.match(/\/video\/(BV[a-zA-Z0-9]+)/i);
            const avidMatch = targetUrl.match(/\/video\/av(\d+)/i);
            if (bvidMatch || avidMatch) {
                const apiUrl = bvidMatch
                    ? `https://api.bilibili.com/x/web-interface/view?bvid=${bvidMatch[1]}`
                    : `https://api.bilibili.com/x/web-interface/view?aid=${avidMatch[1]}`;
                const res = await axios.get(apiUrl, {
                    headers: { 'User-Agent': UA_BROWSER, 'Referer': 'https://www.bilibili.com/' }, timeout: 8000
                });
                const d = res.data?.data;
                if (d) {
                    if (d.title) title = d.title.slice(0, 256);
                    if (d.owner?.name) creator = d.owner.name;
                    if (d.pic) thumbnailUrl = d.pic.startsWith('http') ? d.pic : `https:${d.pic}`;
                    if (d.duration) { durationSeconds = d.duration; duration = formatDuration(durationSeconds); }
                }
            }
        } catch { }
    }

    if (targetUrl.includes('bsky.app')) {
        try {
            const m = targetUrl.match(/bsky\.app\/profile\/([^/]+)\/post\/([^/?#]+)/);
            if (m) {
                const handle = m[1];
                const rkey = m[2];
                const resolveRes = await axios.get(`https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`, { timeout: 5000 });
                const did = resolveRes.data?.did;
                if (did) {
                    const postRes = await axios.get(`https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(`at://${did}/app.bsky.feed.post/${rkey}`)}`, { timeout: 8000 });
                    const post = postRes.data?.thread?.post;
                    if (post) {
                        if (post.record?.text) title = post.record.text.slice(0, 256);
                        if (post.author?.displayName) creator = post.author.displayName;
                        else if (post.author?.handle) creator = `@${post.author.handle}`;
                        const imgs = post.record?.embed?.images;
                        if (imgs?.length > 0) {
                            const did2 = post.author?.did || did;
                            directUrls = imgs.map(img => `https://cdn.bsky.app/img/feed_fullsize/plain/${did2}/${img.image?.ref?.$link}@jpeg`).filter(u => u.includes('/'));
                            duration = imgs.length === 1 ? 'Image' : 'Slideshow';
                            durationSeconds = 0;
                            if (!thumbnailUrl && directUrls[0]) thumbnailUrl = directUrls[0];
                        } else if (post.embed?.thumbnail) {
                            thumbnailUrl = post.embed.thumbnail;
                        }
                    }
                }
            }
        } catch { }
    }

    if (targetUrl.includes('rutube.ru')) {
        try {
            const m = targetUrl.match(/rutube\.ru\/video\/([a-f0-9]+)/i);
            if (m) {
                const res = await axios.get(`https://rutube.ru/api/video/${m[1]}/?format=json`, { timeout: 8000 });
                const d = res.data;
                if (d) {
                    if (d.title) title = d.title.slice(0, 256);
                    if (d.author?.name) creator = d.author.name;
                    if (d.thumbnail_url) thumbnailUrl = d.thumbnail_url;
                    if (d.duration) { durationSeconds = d.duration; duration = formatDuration(durationSeconds); }
                }
            }
        } catch { }
    }

    if (targetUrl.includes('pinterest.com') || targetUrl.includes('pin.it')) {
        try {
            let pinUrl = targetUrl;
            if (targetUrl.includes('pin.it')) {
                let currentUrl = targetUrl;
                const maxRedirects = 10;
                for (let i = 0; i < maxRedirects; i++) {
                    if (currentUrl.includes('pinterest.com/pin/') || currentUrl.includes('pinterest.com/amp/pin/')) {
                        pinUrl = currentUrl;
                        break;
                    }
                    try {
                        const res = await axios.get(currentUrl, {
                            maxRedirects: 0,
                            validateStatus: (status) => status >= 300 && status < 400,
                            headers: { 'User-Agent': UA_BROWSER },
                            timeout: 5000
                        });
                        if (res.headers.location) {
                            currentUrl = new URL(res.headers.location, currentUrl).href;
                        } else {
                            break;
                        }
                    } catch {
                        break;
                    }
                }
                pinUrl = currentUrl;
            }
            
            const pinIdMatch = pinUrl.match(/pinterest\.com\/(?:amp\/)?pin\/(\d+)/);
            let pinId = pinIdMatch ? pinIdMatch[1] : null;
            if (pinId) {
                pinUrl = `https://www.pinterest.com/pin/${pinId}/`;
            }

            const oe = (await axios.get(`https://www.pinterest.com/oembed.json?url=${encodeURIComponent(pinUrl)}`, {
                headers: { 'User-Agent': UA_BROWSER }, timeout: 8000
            })).data;
            if (oe.author_name) creator = oe.author_name;
            if (oe.thumbnail_url) {
                const origUrl = oe.thumbnail_url.replace(/\/\d+x\d*\//, '/originals/');
                thumbnailUrl = origUrl;
                directUrls = [origUrl];
                duration = 'Image';
                durationSeconds = 0;
            }

            let pinTitle = '';
            if (pinId) {
                try {
                    const widgetRes = await axios.get(`https://widgets.pinterest.com/v3/pidgets/pins/info/?pin_ids=${pinId}`, {
                        headers: { 'User-Agent': UA_BROWSER }, timeout: 5000
                    });
                    const pinData = widgetRes.data?.data?.[0];
                    if (pinData) {
                        pinTitle = (pinData.title || pinData.description || '').trim();
                        if (!pinTitle && pinData.board?.name) {
                            pinTitle = `Pin from board "${pinData.board.name}"`;
                        }
                    }
                } catch { }
            }

            if (!pinTitle && oe.title && oe.title.trim()) {
                pinTitle = oe.title.trim();
            }

            title = pinTitle || (creator !== 'Unknown Creator' ? `Pinterest pin by ${creator}` : 'Pinterest pin');
        } catch { }
    }

    if (targetUrl.includes('twitch.tv')) {
        try {
            const oe = (await axios.get(`https://www.twitch.tv/oembed?url=${encodeURIComponent(targetUrl)}`, {
                headers: { 'User-Agent': UA_BROWSER }, timeout: 5000
            })).data;
            if (oe) {
                if (oe.title) title = oe.title;
                if (oe.author_name) creator = oe.author_name;
                if (oe.thumbnail_url) thumbnailUrl = oe.thumbnail_url;
            }
        } catch { }
    }

    const isSpecialPlatform = targetUrl.includes('youtube.com') || targetUrl.includes('youtu.be') ||
                              targetUrl.includes('instagram.com') || targetUrl.includes('instagr.am') ||
                              targetUrl.includes('tiktok.com') || targetUrl.includes('twitter.com') ||
                              targetUrl.includes('x.com') || targetUrl.includes('reddit.com') ||
                              targetUrl.includes('redd.it') || targetUrl.includes('bilibili.com') ||
                              targetUrl.includes('bsky.app') || targetUrl.includes('rutube.ru') ||
                              targetUrl.includes('pinterest.com') || targetUrl.includes('pin.it');

    if (!isSpecialPlatform) {
        const pageData = await scrapeGenericPage(targetUrl);
        if (pageData) {
            if (title === 'Unknown Video' && pageData.title) title = pageData.title;
            if (creator === 'Unknown Creator' && pageData.creator) creator = pageData.creator;
            if (!thumbnailUrl && pageData.thumbnailUrl) thumbnailUrl = pageData.thumbnailUrl;
            if (!durationSeconds && pageData.durationSeconds) {
                durationSeconds = pageData.durationSeconds;
                duration = formatDuration(durationSeconds);
            }
            if (directUrls.length === 0 && pageData.largestMedia) {
                if (pageData.largestMedia.type === 'video') {
                    directUrls = [pageData.largestMedia.url];
                    if (duration === 'Unknown duration') {
                        const probed = probeMediaDuration(pageData.largestMedia.url);
                        if (probed > 0) {
                            durationSeconds = probed;
                            duration = formatDuration(durationSeconds);
                        } else {
                            duration = 'Video';
                        }
                    }
                } else if (pageData.largestMedia.type === 'image') {
                    directUrls = [pageData.largestMedia.url];
                    duration = 'Image';
                    durationSeconds = 0;
                    if (!thumbnailUrl) thumbnailUrl = pageData.largestMedia.url;
                }
            }
        }
    } else if (title === 'Unknown Video' || creator === 'Unknown Creator' || !thumbnailUrl) {
        const pageData = await scrapeGenericPage(targetUrl);
        if (pageData) {
            if (title === 'Unknown Video' && pageData.title) title = pageData.title;
            if (creator === 'Unknown Creator' && pageData.creator) creator = pageData.creator;
            if (!thumbnailUrl && pageData.thumbnailUrl) thumbnailUrl = pageData.thumbnailUrl;
            if (!durationSeconds && pageData.durationSeconds) {
                durationSeconds = pageData.durationSeconds;
                duration = formatDuration(durationSeconds);
            }
        }
    }

    if (durationSeconds > 0 && (duration === 'Unknown duration' || !duration)) {
        duration = formatDuration(durationSeconds);
    }
    if (duration === 'Unknown duration') {
        duration = 'Video';
    }
    if (creator === 'Unknown Creator') {
        try {
            const u = new URL(targetUrl);
            const hostParts = u.hostname.replace(/^www\./, '').split('.');
            creator = hostParts[0].charAt(0).toUpperCase() + hostParts[0].slice(1);
        } catch {
            creator = null;
        }
    }
    if (!title || title === 'Unknown Video') {
        try {
            const u = new URL(targetUrl);
            const hostParts = u.hostname.replace(/^www\./, '').split('.');
            const sName = hostParts[0].charAt(0).toUpperCase() + hostParts[0].slice(1);
            title = `${duration || 'Media'} from ${sName}`;
        } catch {
            title = 'Media Download';
        }
    }

    return { title, creator, thumbnailUrl, duration, durationSeconds, maxQuality, directUrls, directAudioUrl, isDirectCdn: false };
}

function getComponents(state, maxQuality = 1080, duration = '') {
    const rows = [];
    const isMedia = duration === 'Image' || duration === 'Slideshow';

    if (state.view === 'basic') {
        if (state.type === 'audio' || duration === 'Audio') {
            const bitrateOptions = [
                { label: '320 kbps (Best)', value: '320', default: state.audioBitrate === '320' },
                { label: '256 kbps', value: '256', default: state.audioBitrate === '256' },
                { label: '160 kbps (Fast)', value: '160', default: state.audioBitrate === '160' },
                { label: '128 kbps', value: '128', default: state.audioBitrate === '128' },
                { label: '96 kbps', value: '96', default: state.audioBitrate === '96' },
                { label: '64 kbps', value: '64', default: state.audioBitrate === '64' }
            ];
            if (!bitrateOptions.some(o => o.default)) { bitrateOptions[2].default = true; state.audioBitrate = '160'; }
            if (duration !== 'Audio' && duration !== 'Slideshow' && duration !== 'Image') {
                rows.push(new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder().setCustomId('dl_type').setPlaceholder('Type...').addOptions([
                        { label: 'Video', value: 'video', description: 'Download video with audio' },
                        { label: 'Video (muted)', value: 'video_muted', description: 'Download video without audio' },
                        { label: 'Audio', value: 'audio', description: 'Download audio only', default: true }
                    ])
                ));
            }
            rows.push(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('dl_bitrate').setPlaceholder('Audio Bitrate...').addOptions(bitrateOptions)
            ));
            rows.push(new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('dl_start').setLabel('Download').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('dl_to_advanced').setLabel('Advanced').setStyle(ButtonStyle.Secondary)
            ));
            return rows;
        }
        let typeOptions;
        if (duration === 'Image') {
            typeOptions = [
                { label: 'Image', value: 'image', description: 'Download image', default: state.type === 'image' },
                { label: 'Audio', value: 'audio', description: 'Download audio only', default: state.type === 'audio' }
            ];
        } else if (duration === 'Slideshow') {
            typeOptions = [
                { label: 'Slideshow', value: 'slideshow', description: 'Download slideshow', default: state.type === 'slideshow' },
                { label: 'Audio', value: 'audio', description: 'Download audio only', default: state.type === 'audio' }
            ];
        } else {
            typeOptions = [
                { label: 'Video', value: 'video', description: 'Download video with audio', default: state.type === 'video' },
                { label: 'Video (muted)', value: 'video_muted', description: 'Download video without audio', default: state.type === 'video_muted' },
                { label: 'Audio', value: 'audio', description: 'Download audio only', default: state.type === 'audio' }
            ];
        }
        rows.push(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId('dl_type').setPlaceholder('Type...').addOptions(typeOptions)
        ));

        let qualityOptions;
        if (isMedia) {
            qualityOptions = [
                { label: '100% (Best)', value: '100', default: state.quality === '100' },
                { label: '90%', value: '90', default: state.quality === '90' },
                { label: '80%', value: '80', default: state.quality === '80' },
                { label: '50%', value: '50', default: state.quality === '50' }
            ];
            if (!qualityOptions.some(o => o.default)) { qualityOptions[0].default = true; state.quality = '100'; }
            rows.push(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('dl_quality').setPlaceholder('Quality...').addOptions(qualityOptions)
            ));
        } else if (state.type === 'audio') {
            const bitrateOptions = [
                { label: '320 kbps', value: '320', default: state.audioBitrate === '320' },
                { label: '256 kbps', value: '256', default: state.audioBitrate === '256' },
                { label: '128 kbps', value: '128', default: state.audioBitrate === '128' },
                { label: '96 kbps', value: '96', default: state.audioBitrate === '96' },
                { label: '64 kbps', value: '64', default: state.audioBitrate === '64' },
                { label: '8 kbps', value: '8', default: state.audioBitrate === '8' }
            ];
            if (!bitrateOptions.some(o => o.default)) { bitrateOptions[0].default = true; state.audioBitrate = '320'; }
            rows.push(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('dl_bitrate').setPlaceholder('Audio Bitrate...').addOptions(bitrateOptions)
            ));
        } else {
            const base = [
                { label: '2160p (4K)', value: '2160' }, { label: '1440p (2K)', value: '1440' },
                { label: '1080p', value: '1080' }, { label: '720p', value: '720' },
                { label: '480p', value: '480' }, { label: '360p', value: '360' },
                { label: '240p', value: '240' }, { label: '144p', value: '144' }
            ].filter(q => parseInt(q.value) <= maxQuality);
            qualityOptions = [{ label: `Max Quality (${maxQuality}p)`, value: 'max', default: state.quality === 'max' }];
            base.forEach(q => qualityOptions.push({ label: q.label, value: q.value, default: state.quality === q.value }));
            if (!qualityOptions.some(o => o.default)) { qualityOptions[0].default = true; state.quality = qualityOptions[0].value; }
            rows.push(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('dl_quality').setPlaceholder('Quality...').addOptions(qualityOptions)
            ));
        }
        rows.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('dl_start').setLabel('Download').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('dl_to_advanced').setLabel('Advanced').setStyle(ButtonStyle.Secondary)
        ));
    } else {
        if (isMedia) {
            const formatOptions = [
                { label: 'png', value: 'png', default: state.format === 'png' },
                { label: 'jpg', value: 'jpg', default: state.format === 'jpg' },
                { label: 'webp', value: 'webp', default: state.format === 'webp' },
                { label: 'gif', value: 'gif', default: state.format === 'gif' }
            ];
            if (!formatOptions.some(o => o.default)) { formatOptions[0].default = true; state.format = 'png'; }
            rows.push(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('dl_format').setPlaceholder('File Format...').addOptions(formatOptions)
            ));
            rows.push(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('dl_filename').setPlaceholder('Filename Style...').addOptions([
                    { label: 'Pretty', value: 'pretty', description: 'Never Gonna Give You Up - Rick Astley', default: state.filename === 'pretty' },
                    { label: 'Classic', value: 'classic', description: 'youtube_dQw4w9WgXcQ_1920x1080_h264', default: state.filename === 'classic' },
                    { label: 'Basic', value: 'basic', description: 'Never Gonna Give You Up (4K Remaster)', default: state.filename === 'basic' },
                    { label: 'Nerdy', value: 'nerdy', description: 'Never Gonna Give You Up - Rick Astley (dQw4w9WgXcQ)', default: state.filename === 'nerdy' }
                ])
            ));
        } else if (state.type === 'audio') {
            rows.push(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('dl_filename').setPlaceholder('Filename Style...').addOptions([
                    { label: 'Pretty', value: 'pretty', description: 'Artist - Title', default: state.filename === 'pretty' },
                    { label: 'Classic', value: 'classic', description: 'Source ID style', default: state.filename === 'classic' },
                    { label: 'Basic', value: 'basic', description: 'Title only', default: state.filename === 'basic' }
                ])
            ));
            rows.push(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('dl_format').setPlaceholder('File Format...').addOptions([
                    { label: 'mp3 (Standard)', value: 'mp3', default: state.format === 'mp3' },
                    { label: 'm4a (Fastest / Native)', value: 'm4a', default: state.format === 'm4a' },
                    { label: 'opus', value: 'opus', default: state.format === 'opus' },
                    { label: 'wav', value: 'wav', default: state.format === 'wav' },
                    { label: 'flac', value: 'flac', default: state.format === 'flac' }
                ])
            ));
            rows.push(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('dl_bitrate').setPlaceholder('Audio Bitrate...').addOptions([
                    { label: '320 kbps (Best)', value: '320', default: state.audioBitrate === '320' },
                    { label: '256 kbps', value: '256', default: state.audioBitrate === '256' },
                    { label: '160 kbps (Fast)', value: '160', default: state.audioBitrate === '160' },
                    { label: '128 kbps', value: '128', default: state.audioBitrate === '128' },
                    { label: '96 kbps', value: '96', default: state.audioBitrate === '96' },
                    { label: '64 kbps', value: '64', default: state.audioBitrate === '64' }
                ])
            ));
        } else {
            rows.push(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('dl_codec').setPlaceholder('Codec...').addOptions([
                    { label: 'h264 + aac', value: 'h264_aac', description: 'Maximum compatibility', default: state.codec === 'h264_aac' },
                    { label: 'av1 + opus', value: 'av1_opus', description: 'Best quality & efficiency', default: state.codec === 'av1_opus' },
                    { label: 'vp9 + opus', value: 'vp9_opus', description: 'High quality & HDR', default: state.codec === 'vp9_opus' }
                ])
            ));
            rows.push(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('dl_filename').setPlaceholder('Filename Style...').addOptions([
                    { label: 'Pretty', value: 'pretty', description: 'Never Gonna Give You Up (4K Remaster) - Rick Astley (1080p, h264).mp4', default: state.filename === 'pretty' },
                    { label: 'Classic', value: 'classic', description: 'youtube_dQw4w9WgXcQ_1920x1080_h264.mp4', default: state.filename === 'classic' },
                    { label: 'Basic', value: 'basic', description: 'Never Gonna Give You Up (1080p, h264).mp4', default: state.filename === 'basic' },
                    { label: 'Nerdy', value: 'nerdy', description: 'Never Gonna Give You Up - Rick Astley (1080p, dQw4w9WgXcQ).mp4', default: state.filename === 'nerdy' }
                ])
            ));
            rows.push(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('dl_format').setPlaceholder('File Format...').addOptions([
                    { label: 'mp4', value: 'mp4', default: state.format === 'mp4' },
                    { label: 'webm', value: 'webm', default: state.format === 'webm' },
                    { label: 'mkv', value: 'mkv', default: state.format === 'mkv' }
                ])
            ));
            rows.push(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('dl_bitrate').setPlaceholder('Audio Bitrate...').addOptions([
                    { label: '320 kbps (Best)', value: '320', default: state.audioBitrate === '320' },
                    { label: '256 kbps', value: '256', default: state.audioBitrate === '256' },
                    { label: '160 kbps (Fast)', value: '160', default: state.audioBitrate === '160' },
                    { label: '128 kbps', value: '128', default: state.audioBitrate === '128' },
                    { label: '96 kbps', value: '96', default: state.audioBitrate === '96' },
                    { label: '64 kbps', value: '64', default: state.audioBitrate === '64' }
                ])
            ));
        }
        rows.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('dl_start').setLabel('Download').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('dl_to_basic').setLabel('Back').setStyle(ButtonStyle.Secondary)
        ));
    }
    return rows;
}

function estimateFileSize(durationSeconds, state, url) {
    if (!durationSeconds || isNaN(durationSeconds)) return 0;
    const isYT = url.includes('youtube.com') || url.includes('youtu.be');
    const bitrates = isYT
        ? { max: 4500, '2160': 20000, '1440': 10000, '1080': 4500, '720': 2500, '480': 1000, '360': 600, '240': 300, '144': 100 }
        : { max: 2500, '2160': 8000, '1440': 5000, '1080': 2500, '720': 1500, '480': 800, '360': 400, '240': 200, '144': 80 };
    let vbr = bitrates[state.quality] || 4500;
    if (state.codec === 'av1_opus') vbr *= 0.5;
    else if (state.codec === 'vp9_opus') vbr *= 0.7;
    let abr = (state.type === 'video' || state.type === 'audio') ? parseInt(state.audioBitrate, 10) || 128 : 0;
    if (state.type === 'audio') vbr = 0;
    else if (state.type === 'video_muted') abr = 0;
    return ((vbr + abr) * 1000 * durationSeconds) / 8;
}

function getSafeVideoQuality(quality, maxQuality) {
    const allowed = ["max", "4320", "2160", "1440", "1080", "720", "480", "360", "240", "144"];
    let target = quality === 'max' ? String(maxQuality || 1080) : quality;
    if (allowed.includes(target)) return target;
    
    const targetNum = parseInt(target, 10);
    if (isNaN(targetNum)) return "1080";
    
    const numericAllowed = [4320, 2160, 1440, 1080, 720, 480, 360, 240, 144];
    for (const res of numericAllowed) {
        if (targetNum >= res) {
            return String(res);
        }
    }
    return "144";
}

function buildCobaltPayload(url, state, maxQuality) {
    const isAudio = state.type === 'audio';
    const isVideo = state.type === 'video' || state.type === 'video_muted' || state.type === 'slideshow';
    const payload = {
        url,
        filenameStyle: state.filename,
    };
    
    if (isAudio) {
        payload.downloadMode = 'audio';
        payload.audioBitrate = state.audioBitrate;
        payload.audioFormat = ['mp3', 'ogg', 'wav', 'opus', 'best'].includes(state.format) ? state.format : 'mp3';
    } else if (isVideo) {
        payload.videoQuality = getSafeVideoQuality(state.quality, maxQuality);
        payload.audioBitrate = state.audioBitrate;
        payload.youtubeVideoContainer = ['mp4', 'webm', 'mkv', 'auto'].includes(state.format) ? state.format : 'auto';
        if (state.type === 'video_muted') { payload.downloadMode = 'mute'; }
        else { payload.downloadMode = 'auto'; }
        if (state.codec === 'av1_opus') { payload.youtubeVideoCodec = 'av1'; payload.audioFormat = 'opus'; }
        else if (state.codec === 'vp9_opus') { payload.youtubeVideoCodec = 'vp9'; payload.audioFormat = 'opus'; }
        else {
            const targetQualityNum = getSafeVideoQuality(state.quality, maxQuality);
            const targetQuality = parseInt(targetQualityNum, 10) || 1080;
            if (targetQuality > 1080) {
                payload.youtubeVideoCodec = 'vp9';
            } else {
                payload.youtubeVideoCodec = 'h264';
            }
            payload.audioFormat = 'best';
        }
    } else {
        payload.downloadMode = 'auto';
        payload.videoQuality = 'max';
    }
    return payload;
}

function buildEmbed(metadata, state) {
    const isSlideshow = metadata.duration === 'Slideshow' || metadata.duration === 'Image';
    const displayDuration = (state.type === 'audio' && isSlideshow) ? 'Audio' : metadata.duration;
    let embedTitle = metadata.title || '';
    if (!embedTitle || embedTitle === 'Unknown Video') {
        embedTitle = metadata.fileName || 'Media Download';
    }
    if (embedTitle.length > 256) {
        embedTitle = embedTitle.slice(0, 253) + '...';
    }
    const embed = new EmbedBuilder()
        .setTitle(embedTitle)
        .setColor(0xFBE7BD);

    const validDuration = (displayDuration && displayDuration !== 'Unknown duration')
        ? displayDuration
        : (state.type === 'audio' ? 'Audio' : (state.type === 'image' ? 'Image' : (state.type === 'slideshow' ? 'Slideshow' : 'Video')));

    if (metadata.isDirectCdn) {
        const fileLabel = metadata.fileName || metadata.title || 'File';
        embed.setDescription(`${validDuration} • \`${fileLabel}\`\n\nUse the buttons below to continue`);
    } else {
        const validCreator = (metadata.creator && metadata.creator !== 'Unknown Creator') ? metadata.creator : null;
        const descHeader = validCreator ? `${validDuration} • ${validCreator}` : validDuration;
        embed.setDescription(`${descHeader}\n\nUse the buttons below to continue`);
    }

    if (metadata.thumbnailUrl) embed.setThumbnail(metadata.thumbnailUrl);
    return embed;
}

function ensureEmbeddableVideo(inputPath, originalFilename, tempDir, maxSizeBytes = 24 * 1024 * 1024) {
    const cleanBase = (originalFilename || 'video')
        .replace(/\.[^/.]+$/, '')
        .replace(/[",;`$\r\n\t]/g, '')
        .trim()
        .slice(0, 70) || 'video';
    const finalFilename = `${cleanBase}.mp4`;
    const safeOutputBasename = `embed_${Date.now()}_${cleanBase.replace(/[^a-zA-Z0-9_-]/g, '_')}.mp4`;
    const outputPath = path.join(tempDir, safeOutputBasename);

    let vCodec = null;
    let aCodec = null;
    let pixFmt = null;
    let durationSec = 0;

    try {
        const vInfo = execFileSync('ffprobe', [
            '-v', 'error',
            '-select_streams', 'v:0',
            '-show_entries', 'stream=codec_name,pix_fmt,duration',
            '-of', 'json',
            inputPath
        ], { timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
        const vParsed = JSON.parse(vInfo);
        if (vParsed.streams && vParsed.streams[0]) {
            vCodec = vParsed.streams[0].codec_name;
            pixFmt = vParsed.streams[0].pix_fmt;
            durationSec = parseFloat(vParsed.streams[0].duration) || 0;
        }
    } catch { }

    try {
        const aInfo = execFileSync('ffprobe', [
            '-v', 'error',
            '-select_streams', 'a:0',
            '-show_entries', 'stream=codec_name',
            '-of', 'json',
            inputPath
        ], { timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
        const aParsed = JSON.parse(aInfo);
        if (aParsed.streams && aParsed.streams[0]) {
            aCodec = aParsed.streams[0].codec_name;
        }
    } catch { }

    const inSize = fs.existsSync(inputPath) ? fs.statSync(inputPath).size : 0;
    const isH264 = vCodec === 'h264';
    const isYuv420p = pixFmt === 'yuv420p';
    const isAacOrNone = !aCodec || aCodec === 'aac';
    const isUnderLimit = inSize > 0 && inSize <= maxSizeBytes;

    if (isH264 && isYuv420p && isAacOrNone && isUnderLimit) {
        try {
            execFileSync('ffmpeg', [
                '-y',
                '-threads', '2',
                '-i', inputPath,
                '-c', 'copy',
                '-movflags', '+faststart',
                outputPath
            ], { timeout: 30000, stdio: 'ignore' });
            if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
                tryUnlink(inputPath);
                return { path: outputPath, name: finalFilename };
            }
        } catch { }
    }

    const ffmpegArgs = [
        '-y',
        '-threads', '2',
        '-i', inputPath,
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-preset', 'veryfast'
    ];
    if (!isUnderLimit && durationSec > 0 && durationSec < 600) {
        const targetBits = (maxSizeBytes * 8 * 0.90);
        const totalKbps = Math.floor(targetBits / durationSec / 1000);
        const vKbps = Math.max(200, totalKbps - 128);
        ffmpegArgs.push('-b:v', `${vKbps}k`, '-maxrate', `${Math.floor(vKbps * 1.5)}k`, '-bufsize', `${vKbps * 2}k`);
        if (vKbps < 700) {
            ffmpegArgs.push('-vf', "scale='min(1280,iw)':-2");
        }
    } else {
        ffmpegArgs.push('-crf', '23');
    }
    ffmpegArgs.push('-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', outputPath);

    try {
        execFileSync('ffmpeg', ffmpegArgs, { timeout: 120000, stdio: 'ignore' });
        if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
            tryUnlink(inputPath);
            return { path: outputPath, name: finalFilename };
        }
    } catch { }

    return { path: inputPath, name: finalFilename };
}

async function downloadFromCDN(urls, isAudio, state, metadata, interaction, tempDir, startIndex = 0, endIndex = urls.length) {
    const rawName = metadata.fileName ? path.posix.basename(metadata.fileName, path.posix.extname(metadata.fileName)) : (metadata.title || 'download');
    const safeTitle = rawName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50) || 'download';
    const promises = [];

    for (let idx = startIndex; idx < endIndex; idx++) {
        const currentIdx = idx;
        const dlUrl = urls[currentIdx];
        promises.push((async () => {
            let ext = isAudio ? (state.format || 'mp3') : (getExt(metadata.fileName || dlUrl) || 'mp4');
            const res = await axios({ url: dlUrl, method: 'GET', responseType: 'arraybuffer', timeout: 60000, headers: { 'User-Agent': UA_BROWSER } });
            if (res.status < 200 || res.status >= 300) throw new Error(`CDN returned ${res.status}`);

            let buffer = Buffer.from(res.data);
            let finalFilename = urls.length > 1 ? `${safeTitle}_${currentIdx + 1}.${ext}` : `${safeTitle}.${ext}`;
            let tempFilePath = path.join(tempDir, `temp_${Date.now()}_${currentIdx}_${finalFilename}`);
            fs.writeFileSync(tempFilePath, buffer);

            if (isAudio) {
                const origExt = (getExt(metadata.fileName || dlUrl) || '').toLowerCase();
                if (VIDEO_EXTS.has(origExt) || origExt === 'mp4' || origExt === 'webm' || origExt === 'mov') {
                    const audioFilename = urls.length > 1 ? `${safeTitle}_${currentIdx + 1}.mp3` : `${safeTitle}.mp3`;
                    const audioPath = path.join(tempDir, `temp_${Date.now()}_${currentIdx}_${audioFilename}`);
                    try {
                        const safeBitrate = parseInt(state.audioBitrate, 10) || 160;
                        execFileSync('ffmpeg', [
                            '-y',
                            '-threads', '2',
                            '-i', tempFilePath,
                            '-vn',
                            '-c:a', 'libmp3lame',
                            '-b:a', `${safeBitrate}k`,
                            audioPath
                        ], { timeout: 60000, stdio: 'ignore' });
                        tryUnlink(tempFilePath);
                        return { path: audioPath, name: audioFilename };
                    } catch { }
                }
                return { path: tempFilePath, name: finalFilename };
            }

            if (!isAudio && (state.type === 'image' || state.type === 'slideshow')) {
                return await processSlideFile(buffer, tempFilePath, ext, false, state, currentIdx, urls.length, safeTitle, tempDir);
            } else {
                const opt = ensureEmbeddableVideo(tempFilePath, finalFilename, tempDir);
                return { path: opt.path, name: opt.name };
            }
        })());
    }
    return Promise.all(promises);
}

async function downloadFromPicker(pickerItems, audioUrl, isAudio, state, tempDir, startIndex = 0, endIndex = pickerItems.length) {
    const items = isAudio
        ? [{ url: audioUrl, type: 'audio' }]
        : pickerItems.map(i => ({ url: i.url, type: i.type || 'image' }));

    const start = isAudio ? 0 : startIndex;
    const limit = isAudio ? items.length : endIndex;
    const promises = [];

    for (let idx = start; idx < limit; idx++) {
        const currentIdx = idx;
        const item = items[currentIdx];
        promises.push((async () => {
            let ext = getExt(item.url) || (item.type === 'audio' ? 'mp3' : 'mp4');
            const res = await axios({ url: item.url, method: 'GET', responseType: 'arraybuffer', timeout: 60000, headers: { 'User-Agent': UA_BROWSER } });
            if (res.status < 200 || res.status >= 300) throw new Error(`Picker returned ${res.status}`);

            let buffer = Buffer.from(res.data);
            let finalFilename = `slide_${currentIdx + 1}.${ext}`;
            let tempFilePath = path.join(tempDir, `temp_${Date.now()}_${currentIdx}_${finalFilename}`);
            fs.writeFileSync(tempFilePath, buffer);

            if (!isAudio) {
                return await processSlideFile(buffer, tempFilePath, ext, false, state, currentIdx, items.length, `slide`, tempDir);
            } else {
                return { path: tempFilePath, name: finalFilename };
            }
        })());
    }
    return Promise.all(promises);
}

async function handleBatchDownload(batchIndex, urls, pickerItems, audioUrl, isAudio, state, metadata, interaction, tempDir) {
    const total = isAudio ? 1 : (urls ? urls.length : pickerItems.length);
    const batchStart = batchIndex * 10;
    const batchEnd = Math.min(batchStart + 10, total);

    let downloadedFiles = [];
    try {
        if (urls) {
            downloadedFiles = await downloadFromCDN(urls, isAudio, state, metadata, interaction, tempDir, batchStart, batchEnd);
        } else {
            downloadedFiles = await downloadFromPicker(pickerItems, audioUrl, isAudio, state, tempDir, batchStart, batchEnd);
        }

        if (downloadedFiles.length > 0 && fs.existsSync(downloadedFiles[0].path)) {
            const actualSize = fs.statSync(downloadedFiles[0].path).size;
            if (actualSize > 300 * 1024 * 1024) {
                const totalSizeMB = (actualSize / 1048576).toFixed(1);
                const fileUrl = urls ? urls[0] : (pickerItems ? pickerItems[0]?.url : null);
                const errorPayload = {
                    content: `❌ **File is too large (${totalSizeMB} MB) to upload directly (> 300 MB).**\nPlease download it directly here:`,
                    embeds: [],
                    components: fileUrl ? [new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Download File').setStyle(ButtonStyle.Link).setURL(fileUrl))] : [],
                    files: []
                };
                if (batchIndex === 0) await interaction.editReply(errorPayload);
                else await interaction.followUp(errorPayload);
                return;
            }
        }

        const filenamesList = downloadedFiles.map(f => `📄 \`${f.name}\``).join('\n');
        const imagesLeft = total - batchEnd;
        let contentText = filenamesList;

        let row = null;
        if (!isAudio && imagesLeft > 0) {
            const nextBatchSize = Math.min(10, imagesLeft);
            contentText += `\n\nDownloaded ${batchEnd}/${total} images, if you want to download the rest, use the "Download batch ${batchIndex + 2}" button to download the next ${nextBatchSize}`;
            row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`dl_batch_${batchIndex + 1}`)
                    .setLabel(`Download batch ${batchIndex + 2}`)
                    .setStyle(ButtonStyle.Primary)
            );
        } else if (total > 1 && !isAudio) {
            contentText += `\n\nDownloaded all ${total} images.`;
        } else if (isAudio) {
            contentText += `\n\nDownloaded audio.`;
        }

        const replyPayload = {
            content: contentText,
            files: downloadedFiles.map(f => new AttachmentBuilder(f.path, { name: f.name })),
            embeds: [],
            components: row ? [row] : []
        };

        const message = batchIndex === 0
            ? await interaction.editReply(replyPayload)
            : await interaction.followUp(replyPayload);

        if (row) {
            const batchCollector = message.createMessageComponentCollector({ time: 300_000 });
            batchCollector.on('collect', async i => {
                if (i.user.id !== interaction.user.id) {
                    await i.reply({ content: 'You did not run this command', flags: MessageFlags.Ephemeral });
                    return;
                }
                await i.update({ content: `${i.message.content}\n\nDownloading batch ${batchIndex + 2}... <a:loading:1524146146937667784>`, components: [] });
                batchCollector.stop('next');
                await handleBatchDownload(batchIndex + 1, urls, pickerItems, audioUrl, isAudio, state, metadata, interaction, tempDir);
            });
        }
    } catch (e) {
        const errorContent = { content: `❌ ${batchIndex === 0 ? 'Download' : 'Batch download'} failed: \`${e.message}\``, embeds: [], components: [] };
        if (batchIndex === 0) await interaction.editReply(errorContent);
        else await interaction.followUp(errorContent);
    } finally {
        downloadedFiles.forEach(f => { if (fs.existsSync(f.path)) tryUnlink(f.path); });
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('download')
        .setDescription('Download something using cobalt.tools')
        .setIntegrationTypes([0, 1])
        .setContexts([0, 1, 2])
        .addStringOption(option =>
            option.setName('url').setDescription('Link to video to download').setRequired(true)),

    async execute(interaction) {
        await interaction.reply({ 
            content: 'Processing... <a:loading:1524146146937667784>', 
            flags: 0 
        });

        let url = interaction.options.getString('url');
        url = normalizeUrl(url);
        const metadata = await fetchMetadata(url);

        const isMedia = metadata.duration === 'Image' || metadata.duration === 'Slideshow';
        const isSpotify = metadata.isSpotify === true;
        const isAudioDefault = isSpotify || metadata.duration === 'Audio';
        const state = {
            type: isAudioDefault ? 'audio' : (metadata.duration === 'Image' ? 'image' : metadata.duration === 'Slideshow' ? 'slideshow' : 'video'),
            quality: isMedia ? '100' : 'max',
            codec: 'h264_aac',
            filename: 'pretty',
            format: isAudioDefault ? 'mp3' : (isMedia ? 'png' : 'mp4'),
            audioBitrate: isSpotify ? '160' : '320',
            view: 'basic'
        };

        const replyMsg = await interaction.editReply({ 
            content: null, 
            embeds: [buildEmbed(metadata, state)], 
            components: getComponents(state, metadata.maxQuality, metadata.duration)
        });
        const collector = replyMsg.createMessageComponentCollector({ time: 300_000 });

        collector.on('collect', async i => {
            if (i.user.id !== interaction.user.id) {
                await i.reply({ content: 'You did not run this command', flags: MessageFlags.Ephemeral });
                return;
            }

            const stateMap = {
                dl_to_advanced: () => { state.view = 'advanced'; },
                dl_to_basic: () => { state.view = 'basic'; },
                dl_type: () => { state.type = i.values[0]; },
                dl_quality: () => { state.quality = i.values[0]; },
                dl_codec: () => { state.codec = i.values[0]; },
                dl_filename: () => { state.filename = i.values[0]; },
                dl_format: () => { state.format = i.values[0]; },
                dl_bitrate: () => { state.audioBitrate = i.values[0]; }
            };

            if (stateMap[i.customId]) {
                stateMap[i.customId]();
                await i.update({ 
                    embeds: [buildEmbed(metadata, state)], 
                    components: getComponents(state, metadata.maxQuality, metadata.duration)
                });
                return;
            }

            if (i.customId !== 'dl_start') return;
            if (activeDownloads.has(interaction.user.id)) {
                return i.reply({
                    content: '⚠️ **Download in progress:** You already have an active download running. Please wait for it to complete before starting a new one.',
                    flags: 64
                });
            }
            activeDownloads.add(interaction.user.id);
            collector.stop('started');

            try {
            const isAudio = state.type === 'audio';
            const tempDir = path.join(__dirname, '../Data');
            ensureTempDir(tempDir);

            if (metadata.isSpotify) {
                await i.update({ content: 'Downloading from Spotify... <a:loading:1524146146937667784>', embeds: [], components: [] });
                const spotdlPath = '/home/container/.local/bin/spotdl';
                const util = require('util');
                const execFileAsync = util.promisify(execFile);
                
                if (!fs.existsSync(spotdlPath)) {
                    await interaction.editReply({ content: 'Installing required dependencies (this will take a moment)... <a:loading:1524146146937667784>', embeds: [], components: [] });
                    try {
                        const { exec } = require('child_process');
                        const execAsync = util.promisify(exec);
                        await execAsync('curl -sS https://bootstrap.pypa.io/get-pip.py -o /tmp/get-pip.py && python3 /tmp/get-pip.py --break-system-packages && python3 -m pip install spotdl --break-system-packages', { timeout: 180000 });
                    } catch (e) {
                        console.error('Failed to install spotdl:', e);
                        await interaction.editReply({ content: `❌ Spotify download failed: Could not automatically install spotdl dependencies.`, embeds: [], components: [] });
                        return;
                    }
                    await interaction.editReply({ content: 'Downloading from Spotify... <a:loading:1524146146937667784>', embeds: [], components: [] });
                }

                ensureSpotdlConfig();

                const spotifyTrackDir = path.join(tempDir, `spotify_${Date.now()}`);
                ensureTempDir(spotifyTrackDir);
                try {
                    const format = (state.format === 'm4a' || state.format === 'opus') ? state.format : 'mp3';
                    const safeBitrate = parseInt(state.audioBitrate, 10) || 160;
                    const spotdlArgs = [
                        'download',
                        metadata.spotifyUrl,
                        '--output', spotifyTrackDir,
                        '--format', format,
                        '--bitrate', (format === 'm4a' || format === 'opus') ? 'disable' : `${safeBitrate}k`,
                        '--audio', 'youtube-music', 'youtube',
                        '--threads', '2',
                        '--dont-filter-results',
                        '--max-retries', '1',
                        '--overwrite', 'force',
                        '--log-level', 'ERROR'
                    ];
                    await execFileAsync(spotdlPath, spotdlArgs, { timeout: 180000 });
                    const audioFiles = fs.readdirSync(spotifyTrackDir).filter(f => f.endsWith(`.${format}`) || f.endsWith('.mp3') || f.endsWith('.m4a') || f.endsWith('.opus'));
                    if (!audioFiles.length) throw new Error('spotdl finished but no audio file found in output directory');
                    audioFiles.sort((a, b) => fs.statSync(path.join(spotifyTrackDir, b)).mtimeMs - fs.statSync(path.join(spotifyTrackDir, a)).mtimeMs);
                    const audioFile = audioFiles[0];
                    const audioPath = path.join(spotifyTrackDir, audioFile);
                    await interaction.editReply({
                        content: `📄 \`${audioFile}\``,
                        embeds: [],
                        files: [new AttachmentBuilder(audioPath, { name: audioFile })],
                        components: []
                    }).catch(() => null);
                    tryUnlink(audioPath);
                    try { fs.rmdirSync(spotifyTrackDir); } catch {}
                } catch (e) {
                    try { fs.rmSync(spotifyTrackDir, { recursive: true, force: true }); } catch {}
                    await interaction.editReply({ content: `❌ Spotify download failed: \`${e.message}\``, components: [], files: [] });
                }
                return;
            }

            if ((isAudio && (metadata.directAudioUrl || metadata.directUrls?.length > 0)) || (!isAudio && metadata.directUrls?.length > 0)) {
                await i.update({ content: 'Downloading... <a:loading:1524146146937667784>', embeds: [], components: [] });
                const urls = (isAudio && metadata.directAudioUrl) ? [metadata.directAudioUrl] : metadata.directUrls;
                await handleBatchDownload(0, urls, null, null, isAudio, state, metadata, interaction, tempDir);
                return;
            }

            const payload = buildCobaltPayload(url, state, metadata.maxQuality);

            if (estimateFileSize(metadata.durationSeconds, state, url) > 800 * 1024 * 1024) {
                await i.update({ content: 'Generating direct download link <a:loading:1524146146937667784>', embeds: [], components: [] });
                try {
                    const { data: d } = await requestCobalt(payload);
                    if (d?.status === 'redirect' || d?.status === 'tunnel') {
                        await interaction.editReply({
                            content: '❌ **File is too big (> 800 MB) to upload to Discord**\nPlease download it directly here:',
                            embeds: [],
                            components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Download File').setStyle(ButtonStyle.Link).setURL(d.url))],
                            files: []
                        });
                    } else throw new Error('Failed to obtain fresh link from Cobalt');
                } catch (e) {
                    await interaction.editReply({ content: `❌ File is too big, and failed to generate a download link: \`${e.message}\``, embeds: [], components: [], files: [] });
                }
                return;
            }

            await i.update({ content: 'Downloading... <a:loading:1524146146937667784>', embeds: [], components: [] });

            let attempt = 0;
            const maxAttempts = 3;
            let tempFilePath;

            while (attempt < maxAttempts) {
                attempt++;
                try {
                    console.error(`Cobalt download attempt ${attempt}/${maxAttempts}`);
                    const { data: d } = await requestCobalt(payload);

                    if (d?.status === 'picker') {
                        if (isAudio && !d.audio) throw new Error('No audio track available for this slideshow.');
                        await interaction.editReply({ content: 'Downloading... <a:loading:1524146146937667784>', embeds: [], components: [] });
                        await handleBatchDownload(0, null, d.picker || [], d.audio, isAudio, state, metadata, interaction, tempDir);
                        return;
                    }

                    if (d?.status === 'redirect' || d?.status === 'tunnel') {
                        const cancelToken = axios.CancelToken.source();
                        let lastStep = -1;
                        let lastEditTime = 0;
                        const estimatedTotal = estimateFileSize(metadata.durationSeconds, state, url) || 100 * 1024 * 1024;
                        
                        const res = await axios({
                            url: d.url, method: 'GET', responseType: 'stream', maxRedirects: 10,
                            timeout: 180000, cancelToken: cancelToken.token
                        });
                        if (res.status < 200 || res.status >= 300) throw new Error(`Server returned ${res.status}`);

                        const estLength = parseInt(res.headers['estimated-content-length'] || res.headers['content-length'], 10) || estimatedTotal;

                        let finalFilename = d.filename || 'download';
                        const rawStreamBasename = `stream_${Date.now()}_${finalFilename.replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
                        tempFilePath = path.join(tempDir, rawStreamBasename);
                        const writeStream = fs.createWriteStream(tempFilePath);
                        let loaded = 0;

                        await new Promise((resolve, reject) => {
                            res.data.on('data', chunk => {
                                loaded += chunk.length;

                                if (loaded > 300 * 1024 * 1024) {
                                    cancelToken.cancel('FILE_TOO_LARGE');
                                    res.data.destroy();
                                    writeStream.destroy();
                                    return;
                                }

                                const pct = Math.min(99, Math.floor((loaded / estLength) * 100));
                                const step = Math.min(20, Math.floor(pct / 5));
                                const now = Date.now();
                                if (step > lastStep && now - lastEditTime > 1500) {
                                    lastStep = step;
                                    lastEditTime = now;
                                    const filled = '█'.repeat(step);
                                    const empty = '░'.repeat(20 - step);
                                    const loadedMB = (loaded / 1048576).toFixed(1);
                                    const totalMB = (estLength / 1048576).toFixed(1);
                                    interaction.editReply({
                                        content: `Downloading file... (${loadedMB} MB / ${totalMB} MB)\n\`${filled}${empty}\` **${pct}%**`,
                                        embeds: [],
                                        components: []
                                    }).catch(() => null);
                                }
                            });
                            res.data.pipe(writeStream);
                            writeStream.on('finish', () => resolve());
                            writeStream.on('error', err => reject(err));
                            res.data.on('error', err => reject(err));
                            cancelToken.token.promise.then(cancel => {
                                writeStream.destroy();
                                reject(cancel);
                            });
                        });

                        if (!fs.existsSync(tempFilePath) || fs.statSync(tempFilePath).size === 0) {
                            throw new Error('Downloaded file is empty (0 bytes)');
                        }

                        if (state.type === 'image' || state.type === 'slideshow') {
                            const buffer = fs.readFileSync(tempFilePath);
                            const fmt = state.format || 'png';
                            let processedBuffer = await processImage(buffer, fmt, parseInt(state.quality || '100', 10));
                            const base = finalFilename.lastIndexOf('.') !== -1 ? finalFilename.substring(0, finalFilename.lastIndexOf('.')) : finalFilename;
                            finalFilename = `${base}.${fmt}`;
                            const processedPath = path.join(tempDir, `temp_${Date.now()}_${finalFilename}`);
                            fs.writeFileSync(processedPath, processedBuffer);
                            tryUnlink(tempFilePath);
                            tempFilePath = processedPath;
                        } else if (state.type === 'audio') {
                            const audioPath = path.join(tempDir, `temp_${Date.now()}_${finalFilename}`);
                            fs.renameSync(tempFilePath, audioPath);
                            tempFilePath = audioPath;
                        } else {
                            const opt = ensureEmbeddableVideo(tempFilePath, finalFilename, tempDir);
                            tempFilePath = opt.path;
                            finalFilename = opt.name;
                        }

                        const actualSize = fs.statSync(tempFilePath).size;
                        const totalSizeMB = (actualSize / 1048576).toFixed(1);
                        const uploadLimit = 300 * 1024 * 1024;

                        if (actualSize > uploadLimit) {
                            await interaction.editReply({
                                content: `❌ **File is too large (${totalSizeMB} MB) to upload directly (> 300 MB).**\nPlease download it directly here:`,
                                embeds: [],
                                components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Download File').setStyle(ButtonStyle.Link).setURL(d.url))],
                                files: []
                            });
                            if (fs.existsSync(tempFilePath)) tryUnlink(tempFilePath);
                            return;
                        }

                        const filled = '█'.repeat(20);
                        await interaction.editReply({
                            content: `Downloading file... (${totalSizeMB} MB / ${totalSizeMB} MB)\n\`${filled}\` **100%**\n\nUploading \`${finalFilename}\` to Discord... <a:loading:1524146146937667784>`,
                            embeds: [],
                            components: []
                        }).catch(() => null);

                        await interaction.editReply({
                            content: `📄 \`${finalFilename}\``,
                            embeds: [],
                            files: [new AttachmentBuilder(tempFilePath, { name: finalFilename })],
                            components: []
                        }).catch(() => null);
                        if (fs.existsSync(tempFilePath)) tryUnlink(tempFilePath);
                        return;
                    }

                    throw new Error(d?.error?.code || 'unknown_api_error');

                } catch (e) {
                    console.error(`Cobalt attempt ${attempt} failed:`, e.message);
                    
                    if (tempFilePath && fs.existsSync(tempFilePath)) {
                        tryUnlink(tempFilePath);
                    }

                    if (axios.isCancel(e) && e.message === 'FILE_TOO_LARGE') {
                        await interaction.editReply({ content: 'Generating fresh download link... <a:loading:1524146146937667784>', embeds: [], components: [] });
                        try {
                            const { data: r2 } = await requestCobalt(payload);
                            if (r2?.status === 'redirect' || r2?.status === 'tunnel') {
                                await interaction.editReply({
                                    content: '❌ **File is too large (> 300 MB) to upload directly.**\nPlease download it directly here:',
                                    embeds: [],
                                    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Download File').setStyle(ButtonStyle.Link).setURL(r2.url))],
                                    files: []
                                });
                            } else throw new Error('Failed to get fresh link');
                        } catch (err) {
                            await interaction.editReply({ content: `❌ File is too large, and failed to generate a download link: \`${err.message}\``, embeds: [], components: [], files: [] });
                        }
                        return;
                    }

                    if (attempt >= maxAttempts) {
                        const errMsg = e.response?.data?.error?.code || e.message;
                        await interaction.editReply({ content: `❌ Failed to download after ${maxAttempts} attempts: \`${errMsg}\``, embeds: [], components: [], files: [] });
                        return;
                    }
                    
                    await new Promise(resolve => setTimeout(resolve, 1500));
                }
            }
            } finally {
                activeDownloads.delete(interaction.user.id);
            }
        });

        collector.on('end', (_, reason) => {
            if (reason !== 'started') {
                interaction.editReply({ content: 'Interaction timed out.', embeds: [], components: [] }).catch(() => { });
            }
        });
    }
};
