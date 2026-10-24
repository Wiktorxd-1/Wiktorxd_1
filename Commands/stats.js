const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const { execFile, execFileSync } = require('child_process');
const os = require('os');
require('dotenv').config();

const STATS_JSON = path.join(__dirname, '../Data/stats.json');
const AppId = process.env.DISCORD_CLIENT_ID || process.env.CLIENT_ID || '1235222783592497232';
const token = process.env.DISCORD_TOKEN || process.env.BOT_TOKEN || process.env.TOKEN || process.env.token || null;

function formatBytes(bytes) {
  if (!isFinite(bytes) || bytes <= 0) return 'N/A';
  const units = ['B','KB','MB','GB','TB'];
  let i = 0;
  let v = Number(bytes);
  while (v >= 1024 && i < units.length-1) { v /= 1024; i++; }
  return `${v.toFixed(2)} ${units[i]}`;
}

function readCgroupMemoryLimit() {
  const candidates = [
    '/sys/fs/cgroup/memory/memory.limit_in_bytes', 
    '/sys/fs/cgroup/memory.max',                    
  ];
  for (const p of candidates) {
    try {
      const raw = require('fs').readFileSync(p, 'utf8').trim();
      if (!raw) continue;
      if (raw === 'max') continue;
      const n = Number(raw);
      if (!isFinite(n) || n <= 0) continue;
      if (n > 1e15) continue;
      return n;
    } catch (e) {  }
  }
  return null;
}

async function getDiskUsage() {
  try {
    if (typeof fs.statfs === 'function') {
      const stats = await fs.statfs(process.cwd());
      const bsize = stats.bsize || 4096;
      const totalBytes = Number(stats.blocks) * bsize;
      const freeBytes = Number(stats.bavail) * bsize;
      const usedBytes = Math.max(0, totalBytes - freeBytes);
      const usePerc = totalBytes > 0 ? `${((usedBytes / totalBytes) * 100).toFixed(1)}%` : 'N/A';
      return {
        used: formatBytes(usedBytes),
        size: formatBytes(totalBytes),
        usePerc
      };
    }
  } catch {}

  return new Promise(resolve => {
    execFile('df', ['-h', process.cwd()], { timeout: 2000 }, (err, stdout) => {
      if (err || !stdout) return resolve({ used: 'N/A', size: 'N/A', usePerc: 'N/A' });
      const lines = stdout.trim().split('\n');
      if (lines.length < 2) return resolve({ used: 'N/A', size: 'N/A', usePerc: 'N/A' });
      const parts = lines[1].trim().split(/\s+/); 
      const size = parts[1] || 'N/A';
      const used = parts[2] || 'N/A';
      const usePerc = parts[4] || 'N/A';
      resolve({ used, size, usePerc });
    });
  });
}

function getServerMemory() {
  try {
    const raw = require('fs').readFileSync('/proc/meminfo', 'utf8');
    const get = (key) => {
      const m = raw.match(new RegExp(`^${key}:\\s+(\\d+)\\s+kB`, 'm'));
      return m ? Number(m[1]) * 1024 : null;
    };
    const total = get('MemTotal');
    const available = get('MemAvailable');
    if (total && available) return { used: total - available, total };
  } catch {}

  try {
    const total = os.totalmem();
    const free = os.freemem();
    if (total > 0) return { used: Math.max(0, total - free), total };
  } catch {}

  return null;
}

async function getTotalCommits(repoOwner, repoName, githubToken) {
  const urlBase = `https://api.github.com/repos/${repoOwner}/${repoName}`;
  const headers = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'Wiktorxd-stats-script',
    ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {})
  };

  try {
    const repoRes = await axios.get(urlBase, { headers, validateStatus: s => s >= 200 && s < 500, timeout: 4000 });
    if (!repoRes || repoRes.status >= 400) {
      return 0;
    }

    const commitsUrl = `${urlBase}/commits`;
    const res = await axios.get(commitsUrl, {
      headers,
      params: { per_page: 1, sha: repoRes.data.default_branch || 'main' },
      validateStatus: s => s >= 200 && s < 500,
      timeout: 4000
    });

    if (!res || res.status >= 400) {
      return 0;
    }

    const link = res.headers && (res.headers.link || res.headers.Link);
    if (link) {
      const m = link.match(/[&?]page=(\d+)[^>]*>\s*;\s*rel="?last"?/i) || link.match(/<[^>]*[&?]page=(\d+)[^>]*>;\s*rel="last"/i);
      if (m) return Number(m[1]) || 0;
    }

    const commits = Array.isArray(res.data) ? res.data : [];
    return commits.length;
  } catch (err) {
    return 0;
  }
}

let cachedAppStats = null;
let lastAppStatsFetch = 0;

async function getApplicationStats(client) {
  const now = Date.now();
  if (cachedAppStats !== null && now - lastAppStatsFetch < 300_000) {
    return cachedAppStats;
  }
  const botToken = token || client?.token;
  if (!botToken) {
    return null;
  }

  try {
    const res = await axios.get(
      'https://discord.com/api/v10/applications/@me',
      { headers: { Authorization: `Bot ${botToken}` }, timeout: 4000, validateStatus: s => s >= 200 && s < 500 }
    );
    if (res && res.status === 200 && res.data) {
      cachedAppStats = res.data;
      lastAppStatsFetch = now;
      return cachedAppStats;
    }
  } catch {}

  if (AppId) {
    try {
      const res = await axios.get(
        `https://discord.com/api/v10/applications/${AppId}`,
        { headers: { Authorization: `Bot ${botToken}` }, timeout: 4000, validateStatus: s => s >= 200 && s < 500 }
      );
      if (res && res.status === 200 && res.data) {
        cachedAppStats = res.data;
        lastAppStatsFetch = now;
        return cachedAppStats;
      }
    } catch {}
  }

  return cachedAppStats;
}

async function getApproximateUserInstallCount(client) {
  try {
    const app = await getApplicationStats(client);
    return typeof app?.approximate_user_install_count === 'number' ? app.approximate_user_install_count : null;
  } catch {
    return null;
  }
}

let cachedCommits = null;
let lastCommitsFetch = 0;
let cachedUserInstalls = null;
let lastUserInstallsFetch = 0;

async function getCachedTotalCommits() {
  const now = Date.now();
  if (cachedCommits !== null && now - lastCommitsFetch < 300_000) {
    return cachedCommits;
  }

  try {
    const stdout = execFileSync('git', ['rev-list', '--count', 'HEAD'], { timeout: 1500, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const localCount = parseInt(stdout.trim(), 10);
    if (!isNaN(localCount) && localCount > 0) {
      cachedCommits = localCount;
      lastCommitsFetch = now;
      return cachedCommits;
    }
  } catch {}

  try {
    const tokenForGit = process.env.GITHUB_TOKEN || null;
    const count = await getTotalCommits('Wiktorxd-1', 'Wiktorxd_1', tokenForGit);
    if (count > 0 || cachedCommits === null) {
      cachedCommits = count;
      lastCommitsFetch = now;
    }
  } catch {}

  return cachedCommits || 0;
}

getCachedTotalCommits().catch(() => {});

async function getCachedUserInstalls(client) {
  const now = Date.now();
  if (cachedUserInstalls !== null && now - lastUserInstallsFetch < 300_000) {
    return cachedUserInstalls;
  }
  let count = null;
  try {
    count = await getApproximateUserInstallCount(client);
  } catch {}
  if (count == null) {
    count = client?.users?.cache?.size ?? 0;
  }
  cachedUserInstalls = count;
  lastUserInstallsFetch = now;
  return count;
}

let cachedCpu = { botCpu: '0.00 %', serverCpu: '0.00 %' };
let lastUsage = process.cpuUsage();
let lastHr = process.hrtime.bigint();
let lastStat = null;

function readProcStat() {
  try {
    const line = require('fs').readFileSync('/proc/stat', 'utf8').split('\n')[0];
    const vals = line.trim().split(/\s+/).slice(1).map(Number);
    const idle = vals[3];
    const total = vals.reduce((a, b) => a + b, 0);
    return { idle, total };
  } catch {
    return null;
  }
}

function updateCpuMetrics() {
  try {
    const endUsage = process.cpuUsage();
    const endHr = process.hrtime.bigint();
    const currentStat = readProcStat();

    const usedMicro = (endUsage.user - lastUsage.user) + (endUsage.system - lastUsage.system);
    const elapsedMicro = Number(endHr - lastHr) / 1000;
    const cpuCount = os.cpus().length || 1;
    let botCpu = '0.00 %';
    if (elapsedMicro > 0) {
      const percent = (usedMicro / (elapsedMicro * cpuCount)) * 100;
      botCpu = `${percent.toFixed(2)} %`;
    }

    let serverCpu = '0.00 %';
    if (lastStat && currentStat) {
      const totalDiff = currentStat.total - lastStat.total;
      const idleDiff = currentStat.idle - lastStat.idle;
      if (totalDiff > 0) {
        serverCpu = `${((1 - idleDiff / totalDiff) * 100).toFixed(2)} %`;
      }
    }

    cachedCpu = { botCpu, serverCpu };
    lastUsage = endUsage;
    lastHr = endHr;
    lastStat = currentStat;
  } catch {}
}

setInterval(updateCpuMetrics, 3000);
updateCpuMetrics();

async function measureCpuUsageBoth() {
  return cachedCpu;
}

async function generateStatsEmbed(client, ping) {
  const [storedResult, userInstalls, cpuResult, disk, commits] = await Promise.all([
    fs.readFile(STATS_JSON, 'utf8').then(raw => JSON.parse(raw || '{}')).catch(() => ({})),
    getCachedUserInstalls(client).catch(() => client?.users?.cache?.size ?? 0),
    measureCpuUsageBoth().catch(() => ({ botCpu: 'N/A', serverCpu: 'N/A' })),
    getDiskUsage().catch(() => ({ used: 'N/A', size: 'N/A', usePerc: 'N/A' })),
    getCachedTotalCommits().catch(() => 0)
  ]);

  const guildCount = client?.guilds?.cache?.size ?? 0;
  const mem = process.memoryUsage();
  const rssBytes = mem.rss || 0;
  const memLimit = readCgroupMemoryLimit() || os.totalmem();
  const memDisplay = `${formatBytes(rssBytes)} / ${formatBytes(memLimit)}`;

  const cpuPerc = cpuResult.botCpu;
  const serverCpu = cpuResult.serverCpu;
  const serverMem = getServerMemory();

  let botVersion = storedResult.version;
  if (!botVersion) {
    try {
      const pkg = require('../package.json');
      botVersion = pkg.version || '1.0.0';
    } catch {
      botVersion = '1.0.0';
    }
  }
  const botVersionDisplay = `${botVersion}.${commits || 0}`;

  let djsVer = 'unknown';
  try {
    const djs = require('discord.js');
    djsVer = djs?.version || 'unknown';
  } catch (err) {
    djsVer = 'unknown';
  }
  const nodeVer = process.version;

  const serverMemDisplay = serverMem && serverMem.total > 0
    ? `${formatBytes(serverMem.used)} / ${formatBytes(serverMem.total)} (${((serverMem.used / serverMem.total) * 100).toFixed(1)}%)`
    : memDisplay;

  return new EmbedBuilder()
    .setTitle('Bot stats')
    .setColor(0xFBE7BD)
    .setDescription('Stats of the bot!')
    .addFields(
      { name: '👥 Users:', value: `Servers: ${guildCount}\nUser installs: ${userInstalls}`, inline: false },
      { name: '🏓 Ping:', value: `Ping: ${ping} ms`, inline: false },
      { name: '🖥️ Server stats:', value: `Memory: ${serverMemDisplay}\nCPU: ${serverCpu}\nDisk: ${disk.used} / ${disk.size} (${disk.usePerc})`, inline: false },
      { name: '⚙️ Usage (bot):', value: `Memory: ${memDisplay}\nCPU: ${cpuPerc}`, inline: false },
      { name: '💿 Versions:', value: `Bot: ${botVersionDisplay}\nDiscord.js: ${djsVer}\nNode.js: ${nodeVer}`, inline: false }
    )
    .setFooter({ text: 'Made by wiktorxd_1' });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Show bot stats')
    .setIntegrationTypes([0, 1])
    .setContexts([0, 1, 2]),

  prefixData: {
    name: 'stats',
    description: 'Show bot stats',
    async execute(message, args, client) {
      const loadingMsg = await message.reply('Loading stats...');
      let ping = 0;
      if (client.ws && typeof client.ws.ping === 'number' && isFinite(client.ws.ping) && client.ws.ping >= 0) {
        ping = Math.round(client.ws.ping);
      }
      try {
        const embed = await generateStatsEmbed(client, ping);
        await loadingMsg.edit({ content: null, embeds: [embed] });
      } catch (err) {
        console.error('Error executing stats prefix command:', err);
        await loadingMsg.edit('Failed to load stats.');
      }
    }
  },

  async execute(interaction, client) {
    let ping = 0;
    if (client.ws && typeof client.ws.ping === 'number' && isFinite(client.ws.ping) && client.ws.ping >= 0) {
      ping = Math.round(client.ws.ping);
    } else {
      try { ping = Math.max(0, Date.now() - (interaction.createdTimestamp || Date.now())); } catch { ping = 0; }
    }
    try {
      const embed = await generateStatsEmbed(client, ping);
      await interaction.reply({ embeds: [embed] });
    } catch (err) {
      console.error('Error executing stats slash command:', err);
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: 'Failed to load stats.', flags: 64 });
        } else {
          await interaction.reply({ content: 'Failed to load stats.', flags: 64 });
        }
      } catch {}
    }
  }
};
