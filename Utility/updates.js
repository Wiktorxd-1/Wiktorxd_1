const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const { isEqual } = require('lodash');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

async function readLastBgsiUpdateTime() {
    try {
        const timestampStr = await fs.readFile(path.join(__dirname, '../Data', 'updates.txt'), 'utf8');
        const timestamp = new Date(timestampStr.trim());
        if (isNaN(timestamp.getTime())) return null;
        return timestamp;
    } catch (error) {
        return null;
    }
}

async function writeLastBgsiUpdateTime(timestamp) {
    try {
        const filePath = path.join(__dirname, '../Data', 'updates.txt');
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, timestamp.toISOString(), 'utf8');
    } catch {}
}

async function loadJsonFile(fileName) {
    try {
        const fileContent = await fs.readFile(path.join(__dirname, '../Data', fileName), 'utf8');
        const data = JSON.parse(fileContent);
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
}

async function saveJsonFile(fileName, data) {
    try {
        const filePath = path.join(__dirname, '../Data', fileName);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch {}
}

function highlightDiff(oldStr, newStr) {
    if (typeof oldStr !== 'string' || typeof newStr !== 'string') return `\`${oldStr}\`\n→ \`${newStr}\``;
    let i = 0, j = 0;
    while (i < oldStr.length && i < newStr.length && oldStr[i] === newStr[i]) i++;
    while (j < oldStr.length - i && j < newStr.length - i && oldStr[oldStr.length - 1 - j] === newStr[newStr.length - 1 - j]) j++;
    const oldCore = oldStr.substring(i, oldStr.length - j);
    const newCore = newStr.substring(i, newStr.length - j);
    const prefix = oldStr.substring(0, i);
    const suffix = oldStr.substring(oldStr.length - j);
    return `\`${prefix}**${oldCore}**${suffix}\`\n→ \`${prefix}**${newCore}**${suffix}\``;
}

function formatUpdateTime(timeStr) {
    if (!timeStr) return "None";
    const date = new Date(timeStr);
    if (isNaN(date.getTime())) return "Invalid date";
    return `<t:${Math.floor(date.getTime() / 1000)}:F>`;
}

function formatRelativeTime(timeStr) {
    if (!timeStr) return "N/A";
    const date = new Date(timeStr);
    if (isNaN(date.getTime())) return "Invalid date";
    return `<t:${Math.floor(date.getTime() / 1000)}:R>`;
}

async function fetchGameData(apiUrl) {
    try {
        const response = await axios.get(apiUrl);
        if (response.data && response.data.data && response.data.data.length > 0) return response.data.data[0];
        return null;
    } catch (error) {
        if (error.response && (error.response.status === 502 || error.response.status === 503)) return null;
        return null;
    }
}

async function fetchGameImageUrl(universeId) {
    try {
        const response = await axios.get(`https://thumbnails.roblox.com/v1/games/icons?universeIds=${universeId}&returnPolicy=PlaceHolder&size=512x512&format=Png&isCircular=false`);
        if (response.data && response.data.data && response.data.data.length > 0) return response.data.data[0].imageUrl;
        return null;
    } catch (error) {
        if (error.response && (error.response.status === 502 || error.response.status === 503)) return null;
        return null;
    }
}

function getFormattedChanges(oldData, newData) {
    const changes = [];
    const mapping = {
        "title": "Title",
        "subtitle": "Subtitle",
        "description": "Description",
        "eventTime.startUtc": "Start Time",
        "eventTime.endUtc": "End Time"
    };
    const ignore = ["displayTitle", "displaySubtitle", "displayDescription"];
    const getNested = (obj, path) => path.split('.').reduce((acc, part) => (acc && acc[part] !== undefined) ? acc[part] : undefined, obj);
    for (const key in mapping) {
        if (ignore.some(f => key.includes(f))) continue;
        const oldValue = getNested(oldData, key);
        const newValue = getNested(newData, key);
        if (!isEqual(oldValue, newValue)) {
            if (oldValue === undefined && newValue !== undefined) changes.push(`**${mapping[key]} added:**\n\`${newValue}\``);
            else if (oldValue !== undefined && newValue === undefined) changes.push(`**${mapping[key]} removed:**\n\`${oldValue}\``);
            else changes.push(`**${mapping[key]}:**\n${highlightDiff(String(oldValue), String(newValue))}`);
        }
    }
    return changes;
}

async function checkBgsiUpdates(discordClient = null) {
    const gameDataBgsi = await fetchGameData("https://games.roblox.com/v1/games?universeIds=6504986360");
    if (!gameDataBgsi) return null;
    const updatedTimeString = gameDataBgsi.updated;
    if (!updatedTimeString) return null;
    let newUpdateTime = new Date(updatedTimeString);
    if (isNaN(newUpdateTime.getTime())) return null;
    let lastStoredUpdateTime = await readLastBgsiUpdateTime();
    await writeLastBgsiUpdateTime(newUpdateTime);

    const now = Date.now();
    if (Math.abs(now - newUpdateTime.getTime()) > 5 * 60 * 1000) { 
        return null;
    }

    if (lastStoredUpdateTime === null || lastStoredUpdateTime.getTime() < newUpdateTime.getTime()) {
        const embed = {
            title: `${gameDataBgsi.name || 'Unknown Game'} Update`,
            color: parseInt('ffcb8d', 16),
            image: (await fetchGameImageUrl(6504986360)) ? { url: await fetchGameImageUrl(6504986360) } : undefined,
            fields: [
                { name: "⌛ Last Update", value: formatRelativeTime(updatedTimeString), inline: false },
                { name: "📅 Date", value: formatUpdateTime(updatedTimeString), inline: false },
                { name: "🎮 Players", value: `${(gameDataBgsi.playing || 'N/A').toLocaleString()}`, inline: true },
                { name: "⭐ Favorites", value: `${(gameDataBgsi.favoritedCount || 'N/A').toLocaleString()}`, inline: true },
                { name: "➡️ Visits", value: `${(gameDataBgsi.visits || 'N/A').toLocaleString()}`, inline: true }
            ],
            footer: { text: "Made by Wiktorxd_1 :3" }
        };
        if (discordClient) {
            try {
                const channel = await discordClient.channels.fetch("1370048231165399101");
                if (channel) await channel.send({ embeds: [embed] });
            } catch {}
        }
        return embed;
    }
    return null;
}

const missingEventsCount = new Map();

async function checkForChanges(discordClient = null) {
    let currentApiData = [];
    try {
        const response = await axios.get("https://apis.roblox.com/virtual-events/v1/universes/6504986360/virtual-events", {
            headers: {
                "Authorization": process.env.ROBLOSECURITY
            }
        });
        currentApiData = response.data.data || [];
        if (currentApiData.length === 0) return;
    } catch {
        return;
    }
    const oldList = await loadJsonFile("last_event_data.json");
    const blacklist = await loadJsonFile("event_blacklist.json");
    
    // First run initialization: do not post notifications, just persist state
    if (oldList.length === 0) {
        await saveJsonFile("last_event_data.json", currentApiData);
        return;
    }

    const oldMap = new Map(oldList.map(e => [e.id, e]));
    const curMap = new Map(currentApiData.map(e => [e.id, e]));
    let eventsToBlacklistAdd = [];
    const sendEmbed = async (embed) => {
        if (discordClient) {
            try {
                const channel = await discordClient.channels.fetch("1370098955450585130");
                if (channel) await channel.send({ embeds: [embed] });
            } catch {}
        }
    };
    for (const [eid, curEvent] of curMap.entries()) {
        if (!oldMap.has(eid) && !blacklist.includes(eid)) {
            const mapping = {
                "title": "Title",
                "subtitle": "Subtitle",
                "description": "Description",
                "eventTime.startUtc": "Start Time",
                "eventTime.endUtc": "End Time"
            };
            const embed = {
                title: `New event: ${curEvent.title || 'Unknown Title'}`,
                color: parseInt('ffcb8d', 16),
                fields: [],
                footer: { text: `Made by Wiktorxd_1 :3 | ID: ${eid}` }
            };
            for (const k in mapping) {
                const disp = mapping[k];
                let value = curEvent;
                for (const part of k.split('.')) {
                    if (value && typeof value === 'object' && value[part] !== undefined) value = value[part];
                    else { value = undefined; break; }
                }
                if (value !== undefined && value !== null && value !== "") {
                    if (disp.includes("Time")) {
                        embed.fields.push({ name: `**${disp}:**`, value: `${formatUpdateTime(value)}\n${formatRelativeTime(value)}`, inline: false });
                    } else if (["Title", "Subtitle", "Description"].includes(disp)) {
                        embed.fields.push({ name: `**${disp}:**`, value: String(value), inline: false });
                    } else {
                        embed.fields.push({ name: `**${disp}:**`, value: `\`${value}\``, inline: false });
                    }
                }
            }
            const thumbnails = curEvent.thumbnails || [];
            if (thumbnails.length > 0 && thumbnails[0].mediaId) embed.image = { url: `https://biggamesapi.io/image/${thumbnails[0].mediaId}` };
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel('View event')
                    .setStyle(ButtonStyle.Link)
                    .setURL(`https://www.roblox.com/events/${eid}`)
            );
            if (discordClient) {
                try {
                    const channel = await discordClient.channels.fetch("1370098955450585130");
                    if (channel) await channel.send({ embeds: [embed], components: [row] });
                } catch {}
            }
        }
    }
    for (const [eid, oldEvent] of oldMap.entries()) {
        if (!curMap.has(eid) && !blacklist.includes(eid)) {
            // Track consecutive missing times to debounce flakiness
            const count = (missingEventsCount.get(eid) || 0) + 1;
            missingEventsCount.set(eid, count);

            if (count >= 3) {
                const embed = {
                    title: `Event removed: ${oldEvent.title || 'Unknown Title'}`,
                    color: parseInt('ffcb8d', 16),
                    footer: { text: `Made by @Wiktorxd_1 :3 | ID: ${eid}` }
                };
                await sendEmbed(embed);
                eventsToBlacklistAdd.push(eid);
                missingEventsCount.delete(eid);
            }
        } else {
            // Reappeared or still present: reset counter
            missingEventsCount.delete(eid);
        }
    }
    
    // Cleanup missing counts for events no longer in old list
    for (const eid of missingEventsCount.keys()) {
        if (!oldMap.has(eid)) {
            missingEventsCount.delete(eid);
        }
    }
    for (const eid of curMap.keys()) {
        if (oldMap.has(eid)) {
            const oldEvent = oldMap.get(eid);
            const curEvent = curMap.get(eid);
            if (!isEqual(oldEvent, curEvent)) {
                const oldStartTime = oldEvent.eventTime?.startUtc;
                const oldEndTime = oldEvent.eventTime?.endUtc;
                const curStartTime = curEvent.eventTime?.startUtc;
                const curEndTime = curEvent.eventTime?.endUtc;
                const startTimeChanged = oldStartTime !== curStartTime && oldStartTime !== undefined && curStartTime !== undefined;
                const endTimeChanged = oldEndTime !== curEndTime && oldEndTime !== undefined && curEndTime !== undefined;
                if (startTimeChanged || endTimeChanged) {
                    const embed = {
                        title: `🕒 Time Changed: ${curEvent.title || 'Unknown Title'}`,
                        color: parseInt('00ffff', 16),
                        fields: [],
                        footer: { text: `Made by @Wiktorxd_1 :3 | ID: ${eid}` }
                    };
                    if (startTimeChanged) {
                        embed.fields.push({
                            name: "**Start Time Changed:**",
                            value: `From: ${formatUpdateTime(oldStartTime)}\nTo: ${formatUpdateTime(curStartTime)}\n(${formatRelativeTime(curStartTime)})`,
                            inline: false
                        });
                    }
                    if (endTimeChanged) {
                        embed.fields.push({
                            name: "**End Time Changed:**",
                            value: `From: ${formatUpdateTime(oldEndTime)}\nTo: ${formatUpdateTime(curEndTime)}\n(${formatRelativeTime(curEndTime)})`,
                            inline: false
                        });
                    }
                    const thumbnails = curEvent.thumbnails || [];
                    if (thumbnails.length > 0 && thumbnails[0].mediaId) embed.image = { url: `https://biggamesapi.io/image/${thumbnails[0].mediaId}` };
                    await sendEmbed(embed);
                }
                const generalChanges = getFormattedChanges(oldEvent, curEvent)
                    .filter(change => !change.includes("Start Time:") && !change.includes("End Time:"));
                if (generalChanges.length > 0) {
                    const embed = {
                        title: `Event updated: ${curEvent.title || 'Unknown Title'}`,
                        color: parseInt('ffcb8d', 16),
                        fields: [],
                        footer: { text: `Made by @Wiktorxd_1 :3 | ID: ${eid}` }
                    };
                    for (const change of generalChanges.slice(0, 10)) {
                        embed.fields.push({ name: "\u200b", value: change, inline: false });
                    }
                    if (generalChanges.length > 10) {
                        embed.fields.push({ name: "More Changes", value: `${generalChanges.length - 10} more...`, inline: false });
                    }
                    const thumbnails = curEvent.thumbnails || [];
                    if (thumbnails.length > 0 && thumbnails[0].mediaId) embed.image = { url: `https://biggamesapi.io/image/${thumbnails[0].mediaId}` };
                    await sendEmbed(embed);
                }
            }
        }
    }
    const updatedBlacklist = Array.from(new Set([...blacklist, ...eventsToBlacklistAdd]));
    await saveJsonFile("event_blacklist.json", updatedBlacklist);
    await saveJsonFile("last_event_data.json", currentApiData);
}

let updatesMonitorStarted = false;

async function startUpdatesMonitor(discordClient) {
    if (updatesMonitorStarted) return;
    updatesMonitorStarted = true;
    setInterval(() => checkBgsiUpdates(discordClient), 60 * 1000);
    setInterval(() => checkForChanges(discordClient), 30 * 1000);
}

module.exports = startUpdatesMonitor;