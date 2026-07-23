const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const { EmbedBuilder } = require('discord.js');

const EventsFile = path.join(__dirname, 'Data', 'events.json');

const EventDefs = [
  { Name: 'Double Luck', Id: '2685862794', Icon: 'https://static.wikia.nocookie.net/bgs-infinity/images/1/1f/Gamepass_-_Double_Luck.png/revision/latest', Color: '#27cc69' },
  { Name: 'Double Shiny Chance', Id: '3402000569', Icon: 'https://static.wikia.nocookie.net/bgs-infinity/images/1/10/Shiny.png/revision/latest', Color: '#ffd011' },
  { Name: 'Double Mythic Chance', Id: '3402000665', Icon: 'https://static.wikia.nocookie.net/bgs-infinity/images/e/ec/Mythic.png/revision/latest', Color: '#4102c4' },
  { Name: 'Double Secret Chance', Id: '3337610800', Icon: 'https://static.wikia.nocookie.net/bgs-infinity/images/a/a1/Secret_Luck_Icon.png/revision/latest', Color: '#d409e9' },
  { Name: 'Double Bubbles', Id: '3337605164', Icon: 'https://static.wikia.nocookie.net/bgs-infinity/images/0/0c/Bubbles.png/revision/latest', Color: '#ff65c5' },
  { Name: '200% Hatch Speed', Id: '2693818681', Icon: 'https://static.wikia.nocookie.net/bgs-infinity/images/8/89/Multi_Egg_Icon.png/revision/latest', Color: '#8c58fc' },
  { Name: 'Double Infinity Luck', Id: '3482150211', Icon: 'https://static.wikia.nocookie.net/bgs-infinity/images/b/bd/Infinity_Icon.png/revision/latest', Color: '#e80f10' },
  { Name: 'All Eggs', Id: '3485042719', Icon: 'https://wiktorxd-1.github.io/bgsi-chances/Images/Icons/XL_Pet.webp', Color: '#ff8566' }
];

let eventsCache = null;

async function readEventsFile() {
  if (eventsCache !== null) return eventsCache;
  try {
    const raw = await fs.readFile(EventsFile, 'utf8');
    eventsCache = JSON.parse(raw);
    return eventsCache;
  } catch {
    eventsCache = {};
    return eventsCache;
  }
}

async function writeEventsFile(data) {
  eventsCache = data;
  try {
    await fs.mkdir(path.dirname(EventsFile), { recursive: true });
    await fs.writeFile(EventsFile, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('[events] Error writing events file:', e);
  }
}

function parseTimestamp(str) {
  if (!str) return null;
  str = String(str).trim();

  const tag = str.match(/<t:(\d+)(?::[tRfFd])?>/i);
  if (tag) return parseInt(tag[1], 10);

  if (/^\d{9,}$/.test(str)) {
    const n = parseInt(str, 10);
    return n > 1e12 ? Math.floor(n / 1000) : n;
  }

  const iso = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z?$/);
  if (iso) {
    const year = parseInt(iso[1], 10);
    const month = parseInt(iso[2], 10);
    const day = parseInt(iso[3], 10);
    const hour = parseInt(iso[4], 10);
    const minute = parseInt(iso[5], 10);
    const second = parseInt(iso[6], 10);
    const ms = Date.UTC(year, month - 1, day, hour, minute, second);
    if (Number.isNaN(ms)) return null;
    return Math.floor(ms / 1000);
  }

  const t = Date.parse(str);
  return Number.isNaN(t) ? null : Math.floor(t / 1000);
}

let lastPingTime = 0;

async function pollEvents(client) {
  const prev = await readEventsFile();
  const isFirstRun = Object.keys(prev).length === 0;
  const now = Date.now();
  let changedEvents = [];
  let newData = {};
  let hasChanges = false;

  for (const def of EventDefs) {
    try {
      const url = `https://apis.roblox.com/developer-products/v1/developer-products/${def.Id}/details`;
      const res = await axios.get(url, { timeout: 8000 });
      const data = res.data;
      const desc = data.DisplayDescription || data.Description || '';
      const created = data.Created || '';
      const updated = data.Updated || '';

      if (!created) {
        newData[def.Id] = prev[def.Id] || { timestamp: null, desc: '' };
        continue;
      }

      const prevEntry = prev[def.Id];
      if (prevEntry && prevEntry.updated === updated) {
        newData[def.Id] = prevEntry;
        continue;
      }

      const timestamp = parseTimestamp(desc);
      newData[def.Id] = { timestamp, desc, created, updated };
      hasChanges = true;

      const prevTs = prevEntry ? prevEntry.timestamp : null;
      if (!isFirstRun && timestamp && timestamp !== prevTs) {
        changedEvents.push({ def, timestamp });
      }
    } catch (e) {
      newData[def.Id] = prev[def.Id] || { timestamp: null, desc: '' };
    }
  }

  if (hasChanges) await writeEventsFile(newData);
  if (changedEvents.length === 0) return;

  let pinged = false;
  if (now - lastPingTime > 120000) {
    pinged = true;
    lastPingTime = now;
  }

  let first = true;
  for (const { def, timestamp } of changedEvents) {
    const embed = new EmbedBuilder()
      .setTitle(`${def.Name} has been activated!`)
      .setDescription(`Ends <t:${timestamp}:R> (<t:${timestamp}:f>)\n\nMay take a while to activate on all servers!`)
      .setColor(def.Color)
      .setThumbnail(def.Icon)
      .setFooter({ text: '.gg/MS2xuxEKJ3', iconURL: 'https://media.discordapp.net/attachments/1369439484659236955/1383514274110115971/3b5268975ace36ff416a836731632c35-removebg-preview-removebg-previeww_1.png?ex=68f87a53&is=68f728d3&hm=5fdfcf9e0648e708d2c98b6c7e648fe6354527d4f424c1294bc57604f41d2695' });

    const channel = await client.channels.fetch('1430510331083489290').catch(() => null);
    if (channel) {
      let content = '';
      if (pinged && first) {
        content = '<@&1430522447891005481>';
        first = false;
      }
      await channel.send({ content, embeds: [embed] }).catch(() => {});
    }
  }
}

function msToNextUtcMidnight() {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
  return next.getTime() - now.getTime();
}

let pollInterval = null;
let midnightTimeout = null;

async function startEventsWatcher(client) {
  if (pollInterval) clearInterval(pollInterval);
  if (midnightTimeout) clearTimeout(midnightTimeout);
  await pollEvents(client);
  pollInterval = setInterval(() => pollEvents(client), 40 * 1000);

  function scheduleMidnight() {
    const ms = msToNextUtcMidnight();
    if (midnightTimeout) clearTimeout(midnightTimeout);
    midnightTimeout = setTimeout(async () => {
      await pollEvents(client);
      scheduleMidnight();
    }, ms);
  }

  scheduleMidnight();
}

module.exports = startEventsWatcher;