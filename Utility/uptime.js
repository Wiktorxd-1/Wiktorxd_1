
function formatUptime(uptimeMilliseconds) {
    let seconds = Math.floor(uptimeMilliseconds / 1000);
    const periods = [
        { name: 'year', seconds: 60 * 60 * 24 * 365 },
        { name: 'month', seconds: 60 * 60 * 24 * 30 },
        { name: 'day', seconds: 60 * 60 * 24 },
        { name: 'hour', seconds: 60 * 60 },
        { name: 'minute', seconds: 60 },
        { name: 'second', seconds: 1 }
    ];

    const strings = [];
    for (const { name, seconds: periodSeconds } of periods) {
        if (seconds >= periodSeconds) {
            const periodValue = Math.floor(seconds / periodSeconds);
            seconds %= periodSeconds;
            if (periodValue > 0) {
                strings.push(`${periodValue} ${name}${periodValue > 1 ? 's' : ''}`);
            }
        }
    }

    if (strings.length === 0 && uptimeMilliseconds > 0) {
        return '1 second';
    }
    return strings.length > 0 ? strings.join(', ') : '0 seconds';
}


function startUptimeUpdater(client, getStartTime) {
    async function updateLoop() {
        while (true) {
            const now = Date.now();
            const uptime = now - getStartTime();
            const uptimeStr = `Uptime: ${formatUptime(uptime)}`;
            try {
                await client.user.setActivity(uptimeStr, { type: 2 });
            } catch (e) {
                console.error(`Error updating presence: ${e.message}`);
            }
            await new Promise(res => setTimeout(res, 3000));
        }
    }
    updateLoop();
}

module.exports = { formatUptime, startUptimeUpdater };