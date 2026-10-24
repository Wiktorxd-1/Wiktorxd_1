const fs = require('fs');
const path = require('path');

const DataDir = path.join(__dirname, '../Data');
const MAX_AGE_MS = 30 * 60 * 1000;

function sweepTempData() {
    try {
        if (!fs.existsSync(DataDir)) return;
        const entries = fs.readdirSync(DataDir);
        const now = Date.now();

        for (const entry of entries) {
            const isTemp = entry.startsWith('temp_') ||
                           entry.startsWith('embed_') ||
                           entry.startsWith('spotify_') ||
                           entry.startsWith('test_') ||
                           entry.startsWith('stream_') ||
                           entry.endsWith('.tmp');
            if (!isTemp) continue;

            const fullPath = path.join(DataDir, entry);
            try {
                const stat = fs.statSync(fullPath);
                if (now - stat.mtimeMs > MAX_AGE_MS) {
                    fs.rmSync(fullPath, { recursive: true, force: true });
                }
            } catch {}
        }
    } catch {}
}

function startTempCleaner() {
    sweepTempData();
    const timer = setInterval(sweepTempData, 5 * 60 * 1000);
    if (timer.unref) timer.unref();
}

module.exports = { startTempCleaner, sweepTempData };
