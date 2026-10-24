const userRequestTimestamps = new Map();
const LIMIT_WINDOW_MS = 10000;
const MAX_REQUESTS = 3;

function checkRateLimit(userId) {
    if (!userId) return { limited: false };
    const now = Date.now();
    const history = userRequestTimestamps.get(userId) || [];
    const valid = history.filter(t => now - t < LIMIT_WINDOW_MS);

    if (valid.length >= MAX_REQUESTS) {
        const oldest = valid[0];
        const waitSec = Math.max(1, Math.ceil((LIMIT_WINDOW_MS - (now - oldest)) / 1000));
        userRequestTimestamps.set(userId, valid);
        return { limited: true, retryAfter: waitSec };
    }

    valid.push(now);
    userRequestTimestamps.set(userId, valid);
    return { limited: false };
}

const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [userId, timestamps] of userRequestTimestamps.entries()) {
        const valid = timestamps.filter(t => now - t < LIMIT_WINDOW_MS);
        if (valid.length === 0) {
            userRequestTimestamps.delete(userId);
        } else {
            userRequestTimestamps.set(userId, valid);
        }
    }
}, 5 * 60 * 1000);

if (cleanupTimer.unref) cleanupTimer.unref();

module.exports = { checkRateLimit };
