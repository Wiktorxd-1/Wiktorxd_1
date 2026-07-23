const fs = require('fs');
const path = require('path');

const PreferredPath = path.join(__dirname, '../../Data', 'Hatches', 'prefered.json');

async function ensureDir() {
    try {
        await fs.promises.mkdir(path.dirname(PreferredPath), { recursive: true });
    } catch (e) {}
}

async function readPreferences() {
    await ensureDir();
    try {
        const raw = await fs.promises.readFile(PreferredPath, 'utf8');
        return raw && raw.length ? JSON.parse(raw) : [];
    } catch (e) {
        return [];
    }
}

async function writePreferences(arr) {
    await ensureDir();
    await fs.promises.writeFile(PreferredPath, JSON.stringify(arr, null, 2), 'utf8');
}

async function getPreferenceByRobloxUsername(username) {
    if (!username) return null;
    const arr = await readPreferences();
    const uname = String(username).toLowerCase();
    return arr.find(e => e.username && String(e.username).toLowerCase() === uname) || null;
}

async function getPreferenceByDiscordId(discordId) {
    if (!discordId) return null;
    const arr = await readPreferences();
    return arr.find(e => e.discordId && String(e.discordId) === String(discordId)) || null;
}

async function setPreference(entry) {
    if (!entry || (!entry.discordId && !entry.username)) throw new Error('Must provide discordId or username when setting preference');
    const arr = await readPreferences();
    const filtered = arr.filter(e => {
        if (entry.discordId && e.discordId && String(e.discordId) === String(entry.discordId)) return false;
        if (entry.username && e.username && String(e.username).toLowerCase() === String(entry.username).toLowerCase()) return false;
        return true;
    });
    filtered.push(entry);
    await writePreferences(filtered);
    return entry;
}

async function removePreference({ discordId, username }) {
    const arr = await readPreferences();
    const filtered = arr.filter(e => {
        if (discordId && e.discordId && String(e.discordId) === String(discordId)) return false;
        if (username && e.username && String(e.username).toLowerCase() === String(username).toLowerCase()) return false;
        return true;
    });
    await writePreferences(filtered);
}

module.exports = {
    getPreferenceByRobloxUsername,
    getPreferenceByDiscordId,
    setPreference,
    removePreference,
};
