const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const axios = require('axios');

class Window {}
class HTMLCanvasElement {}
class CanvasRenderingContext2D {
    fillText(text, x, y) {}
    set font(v) {}
    set textBaseline(v) {}
}

let wasmInitialized = false;
let imgDataModule = null;

function ensureBrowserGlobals() {
    if (global.window && wasmInitialized) return;

    const mockCanvas = new HTMLCanvasElement();
    mockCanvas.width = 300;
    mockCanvas.height = 150;
    const mockCtx = new CanvasRenderingContext2D();
    mockCanvas.getContext = () => mockCtx;
    mockCanvas.toDataURL = () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    const mockStorage = {
        store: {},
        getItem(k) { return this.store[k] || null; },
        setItem(k, v) { this.store[k] = String(v); }
    };

    const mockBody = { getAttribute: () => null };

    const mockWindow = new Window();
    mockWindow.screen = { width: 1920, height: 1080, colorDepth: 24 };
    mockWindow.navigator = {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        platform: 'Win32',
        language: 'en-US'
    };
    mockWindow.localStorage = mockStorage;
    mockWindow.document = {
        body: mockBody,
        createElement(tag) {
            if (tag.toLowerCase() === 'canvas') return mockCanvas;
            return {};
        },
        getElementsByTagName(tag) {
            if (tag.toLowerCase() === 'body') return [mockBody];
            return [];
        }
    };
    mockWindow.performance = { now: () => 3500.5 };

    global.Window = Window;
    global.HTMLCanvasElement = HTMLCanvasElement;
    global.CanvasRenderingContext2D = CanvasRenderingContext2D;
    global.window = mockWindow;
    global.document = mockWindow.document;
    global.screen = mockWindow.screen;
    try {
        Object.defineProperty(globalThis, 'navigator', { value: mockWindow.navigator, configurable: true, writable: true });
    } catch {
        global.navigator = mockWindow.navigator;
    }
    global.localStorage = mockStorage;

    imgDataModule = require('./img_data.js');
    const wasmPath = path.join(__dirname, 'img_data_bg.wasm');
    const wasmBuffer = fs.readFileSync(wasmPath);
    imgDataModule.initSync({ module: wasmBuffer });
    wasmInitialized = true;
}

const DUTCH_CF_IPS = ['104.16.0.1', '104.17.0.1', '104.18.0.1', '104.19.0.1'];
const API_HOST = 'plsdontscrapemelove.flixer.gd';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function isFlixerUrl(url) {
    if (!url || typeof url !== 'string') return false;
    return /(?:flixer\.su|flixer\.gd|flixor\.ru|cineby\.su)\/watch\/(?:movie|tv)\/(\d+)/i.test(url.trim());
}

function parseFlixerUrl(url) {
    if (!url || typeof url !== 'string') return null;
    const movieMatch = url.match(/(?:flixer\.su|flixer\.gd|flixor\.ru|cineby\.su)\/watch\/movie\/(\d+)/i);
    if (movieMatch) {
        return { type: 'movie', tmdbId: movieMatch[1] };
    }
    const tvMatch = url.match(/(?:flixer\.su|flixer\.gd|flixor\.ru|cineby\.su)\/watch\/tv\/(\d+)(?:\/(\d+)\/(\d+))?/i);
    if (tvMatch) {
        return {
            type: 'tv',
            tmdbId: tvMatch[1],
            season: tvMatch[2] || '1',
            episode: tvMatch[3] || '1'
        };
    }
    return null;
}

function fetchViaDutchCloudflare(pathName, headers = {}) {
    return new Promise((resolve, reject) => {
        let ipIndex = 0;
        function tryNextIp() {
            if (ipIndex >= DUTCH_CF_IPS.length) {
                return reject(new Error('All Dutch Cloudflare Anycast IPs failed'));
            }
            const currentIp = DUTCH_CF_IPS[ipIndex++];
            const req = https.request({
                hostname: currentIp,
                port: 443,
                path: pathName,
                method: 'GET',
                timeout: 8000,
                headers: {
                    'Host': API_HOST,
                    'User-Agent': USER_AGENT,
                    'Origin': 'https://flixer.gd',
                    'Referer': 'https://flixer.gd/',
                    ...headers
                },
                servername: API_HOST
            }, res => {
                if (res.statusCode === 451) {
                    return tryNextIp();
                }
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => {
                    resolve({ status: res.statusCode, headers: res.headers, body: data });
                });
            });
            req.on('timeout', () => {
                req.destroy();
                tryNextIp();
            });
            req.on('error', () => {
                tryNextIp();
            });
            req.end();
        }
        tryNextIp();
    });
}

function generateNonce() {
    const e = new Uint8Array(16);
    crypto.getRandomValues(e);
    return Buffer.from(e).toString('base64').replace(/[/+=]/g, '').substring(0, 22);
}

function generateClientFingerprint() {
    const e = { width: 1920, height: 1080, colorDepth: 24 };
    const r = { userAgent: USER_AGENT, platform: 'Win32', language: 'en-US' };
    const s = 'iVBORw0KGgoAAAANSUhEUgAA';
    const o = `${e.width}x${e.height}:${e.colorDepth}:${r.userAgent.substring(0, 50)}:${r.platform}:${r.language}:${(new Date).getTimezoneOffset()}:${s}`;
    let a = 0;
    for (let i = 0; i < o.length; i++) {
        a = (a << 5) - a + o.charCodeAt(i);
        a &= a;
    }
    return Math.abs(a).toString(36);
}

function generateRequestSignature(key, timestamp, nonce, pathname) {
    const payload = `${key}:${timestamp}:${nonce}:${pathname}`;
    return crypto.createHmac('sha256', key).update(payload).digest('base64');
}

async function fetchFlixerMetadata(url) {
    const parsed = parseFlixerUrl(url);
    if (!parsed) throw new Error('Invalid Flixer URL');

    let title = parsed.type === 'movie' ? `Movie ${parsed.tmdbId}` : `TV Show ${parsed.tmdbId} S${parsed.season}E${parsed.episode}`;
    let thumbnailUrl = null;
    let durationSeconds = 0;

    try {
        const metadataRes = await fetchViaDutchCloudflare(`/api/tmdb/${parsed.type}/${parsed.tmdbId}`, {
            'accept': 'application/json, text/plain, */*'
        });
        if (metadataRes.status === 200 && metadataRes.body) {
            const data = JSON.parse(metadataRes.body);
            if (data.title || data.name) {
                title = data.title || data.name;
                if (parsed.type === 'tv') {
                    title += ` - S${parsed.season}E${parsed.episode}`;
                }
            }
            if (data.poster_path) {
                thumbnailUrl = `https://image.tmdb.org/t/p/w500${data.poster_path}`;
            } else if (data.backdrop_path) {
                thumbnailUrl = `https://image.tmdb.org/t/p/w500${data.backdrop_path}`;
            }
            if (data.runtime) {
                durationSeconds = data.runtime * 60;
            }
        }
    } catch {}

    const formatDuration = sec => {
        if (!sec) return 'Movie';
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    };

    return {
        title,
        creator: 'Flixer',
        thumbnailUrl,
        duration: formatDuration(durationSeconds),
        durationSeconds,
        maxQuality: 1080,
        directUrls: [],
        directAudioUrl: null,
        isFlixer: true,
        flixerUrl: url,
        flixerType: parsed.type,
        tmdbId: parsed.tmdbId,
        season: parsed.season,
        episode: parsed.episode
    };
}

async function extractFlixerHls(url) {
    const parsed = parseFlixerUrl(url);
    if (!parsed) throw new Error('Invalid Flixer URL');

    ensureBrowserGlobals();
    const wasmKey = imgDataModule.get_img_key();
    if (!wasmKey || typeof wasmKey !== 'string') {
        throw new Error('Failed to generate Flixer WASM key');
    }

    const timeRes = await fetchViaDutchCloudflare(`/api/time?t=${Date.now()}`);
    let timeVal = Math.floor(Date.now() / 1000);
    try {
        const timeData = JSON.parse(timeRes.body);
        if (timeData.timestamp) timeVal = timeData.timestamp;
    } catch {}

    const pathname = parsed.type === 'movie'
        ? `/api/tmdb/movie/${parsed.tmdbId}/images`
        : `/api/tmdb/tv/${parsed.tmdbId}/season/${parsed.season}/episode/${parsed.episode}/images`;

    const nonce = generateNonce();
    const signature = generateRequestSignature(wasmKey, timeVal, nonce, pathname);
    const fingerprint = generateClientFingerprint();

    const baseHeaders = {
        'X-Api-Key': wasmKey,
        'X-Request-Timestamp': timeVal.toString(),
        'X-Request-Nonce': nonce,
        'X-Request-Signature': signature,
        'X-Client-Fingerprint': fingerprint,
        'x-fingerprint-lite': 'b4f8a1fc72e8O5d63e',
        'bW90aGFmYWth': '1',
        'Accept': 'text/plain'
    };

    const serversRes = await fetchViaDutchCloudflare(pathname, baseHeaders);
    if (serversRes.status !== 200 || !serversRes.body) {
        throw new Error(`Failed to fetch Flixer servers: status ${serversRes.status}`);
    }

    const decryptedServersRaw = await imgDataModule.process_img_data(serversRes.body, wasmKey);
    const serversData = JSON.parse(decryptedServersRaw);
    const availableSources = Array.isArray(serversData?.sources) ? serversData.sources : [];
    if (availableSources.length === 0) {
        throw new Error('No streaming servers available for this title');
    }

    const nonce2 = generateNonce();
    const signature2 = generateRequestSignature(wasmKey, timeVal, nonce2, pathname);

    const sourceHeaders = {
        'X-Api-Key': wasmKey,
        'X-Request-Timestamp': timeVal.toString(),
        'X-Request-Nonce': nonce2,
        'X-Request-Signature': signature2,
        'X-Client-Fingerprint': fingerprint,
        'x-fingerprint-lite': 'b4f8a1fc72e8O5d63e',
        'X-Only-Sources': '1',
        'X-Server': 'sources',
        'Accept': 'text/plain'
    };

    const sourceRes = await fetchViaDutchCloudflare(pathname, sourceHeaders);
    if (sourceRes.status !== 200 || !sourceRes.body) {
        throw new Error(`Failed to fetch Flixer source stream: status ${sourceRes.status}`);
    }

    const decryptedSourceRaw = await imgDataModule.process_img_data(sourceRes.body, wasmKey);
    const sourceData = JSON.parse(decryptedSourceRaw);
    const streamSource = Array.isArray(sourceData?.sources) ? sourceData.sources.find(s => s.url) : null;
    if (!streamSource || !streamSource.url) {
        throw new Error('Could not resolve stream playback URL');
    }

    const rawPlaylistUrl = streamSource.url;
    const playlistFetch = await axios.get(rawPlaylistUrl, {
        headers: {
            'User-Agent': USER_AGENT,
            'Referer': 'https://flixer.gd/'
        },
        timeout: 10000
    });

    const playlistText = playlistFetch.data;
    const rewrittenPlaylist = playlistText.split('\n').map(line => {
        const trimmed = line.trim();
        if (trimmed.startsWith('https://')) {
            return trimmed + '&.ts';
        }
        return line;
    }).join('\n');

    return {
        playlistText: rewrittenPlaylist,
        streamUrl: rawPlaylistUrl,
        server: streamSource.server || 'delta'
    };
}

async function writeFlixerPlaylist(url, destM3u8Path) {
    const { playlistText, streamUrl, server } = await extractFlixerHls(url);
    fs.writeFileSync(destM3u8Path, playlistText, 'utf8');
    return { streamUrl, server, m3u8Path: destM3u8Path };
}

module.exports = {
    isFlixerUrl,
    parseFlixerUrl,
    fetchFlixerMetadata,
    extractFlixerHls,
    writeFlixerPlaylist
};
