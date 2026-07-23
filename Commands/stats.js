const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const { execFile } = require('child_process');
const os = require('os');
require('dotenv').config();

const STATS_JSON = path.join(__dirname, '../Data/stats.json');
const AppId = process.env.DISCORD_CLIENT_ID || '1235222783592497232';
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

function getDiskUsage() {
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
    if (!total || !available) return null;
    return { used: total - available, total };
  } catch { return null; }
}

async function getServerCpu() {
  try {
    const readStat = () => {
      const line = require('fs').readFileSync('/proc/stat', 'utf8').split('\n')[0];
      const vals = line.trim().split(/\s+/).slice(1).map(Number);
      const idle = vals[3];
      const total = vals.reduce((a, b) => a + b, 0);
      return { idle, total };
    };
    const s1 = readStat();
    await new Promise(r => setTimeout(r, 300));
    const s2 = readStat();
    const totalDiff = s2.total - s1.total;
    const idleDiff = s2.idle - s1.idle;
    if (totalDiff <= 0) return 'N/A';
    return `${((1 - idleDiff / totalDiff) * 100).toFixed(2)} %`;
  } catch { return 'N/A'; }
}

async function getTotalCommits(repoOwner, repoName, githubToken) {
  const urlBase = `https://api.github.com/repos/${repoOwner}/${repoName}`;
  const headers = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'Wiktorxd-stats-script',
    ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {})
  };

  try {
    const repoRes = await axios.get(urlBase, { headers, validateStatus: s => s >= 200 && s < 500, timeout: 5000 });
    if (!repoRes || repoRes.status >= 400) {
      console.error('getTotalCommits: repo check failed', repoRes && repoRes.status, repoRes && repoRes.data && repoRes.data.message);
      return 0;
    }

    const commitsUrl = `${urlBase}/commits`;
    const res = await axios.get(commitsUrl, {
      headers,
      params: { per_page: 1, sha: repoRes.data.default_branch || 'main' },
      validateStatus: s => s >= 200 && s < 500,
      timeout: 5000
    });

    if (!res || res.status >= 400) {
      console.error('getTotalCommits: commits request failed', res && res.status, res && res.data && res.data.message);
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
    console.error('getTotalCommits error:', err && err.message ? err.message : err);
    return 0;
  }
}

async function getApplicationStats() {
  if (!token || !AppId) {
    console.warn('getApplicationStats: missing token or AppId');
    return null;
  }
  try {
    const res = await axios.get(
      `https://discord.com/api/v10/applications/${AppId}`,
      { headers: { Authorization: `Bot ${token}` }, timeout: 5000, validateStatus: s => s >= 200 && s < 500 }
    );
    if (!res || res.status >= 400) {
      console.error('getApplicationStats: non-200', res && res.status, res && res.data);
      return null;
    }
    return res.data;
  } catch (error) {
    console.error('Error fetching application stats:', error && error.message ? error.message : error);
    return null;
  }
}

async function getApproximateUserInstallCount() {
  const app = await getApplicationStats();
  return typeof app?.approximate_user_install_count === 'number' ? app.approximate_user_install_count : null;
}

async function generateStatsEmbed(client, ping) {
  let stored = {};
  try {
    const raw = await fs.readFile(STATS_JSON, 'utf8');
    stored = JSON.parse(raw || '{}');
  } catch (e) {
    stored = {};
  }

  const guildCount = client.guilds.cache.size ?? 0;
  let userInstalls = await getApproximateUserInstallCount();
  if (userInstalls == null) userInstalls = client.users.cache?.size ?? 0;

  const mem = process.memoryUsage();
  const rssBytes = mem.rss || 0;
  const memLimit = readCgroupMemoryLimit() || os.totalmem();
  const memDisplay = `${formatBytes(rssBytes)} / ${formatBytes(memLimit)}`;

  const cpuPerc = await (async () => {
    try {
      const startUsage = process.cpuUsage();
      const startHr = process.hrtime.bigint();
      await new Promise(r => setTimeout(r, 300));
      const endUsage = process.cpuUsage();
      const endHr = process.hrtime.bigint();
      const usedMicro = (endUsage.user - startUsage.user) + (endUsage.system - startUsage.system);
      const elapsedMicro = Number(endHr - startHr) / 1000;
      const cpuCount = os.cpus().length || 1;
      const percent = elapsedMicro > 0 ? (usedMicro / (elapsedMicro * cpuCount)) * 100 : 0;
      return `${percent.toFixed(2)} %`;
    } catch { return 'N/A'; }
  })();

  const disk = await getDiskUsage();
  const serverMem = getServerMemory();
  const serverCpu = await getServerCpu();

  let botVersion = stored.version;
  if (!botVersion) {
    try {
      const pkg = require('../package.json');
      botVersion = pkg.version || '1.0.0';
    } catch {
      botVersion = '1.0.0';
    }
  }
  let commits = 0;
  try {
    const tokenForGit = process.env.GITHUB_TOKEN || null;
    commits = await getTotalCommits('Wiktorxd-1', 'Wiktorxd_1', tokenForGit);
  } catch (e) {
    console.error('commits fetch failed:', e && e.message ? e.message : e);
  }
  const botVersionDisplay = `${botVersion}.${commits}`;

  let djsVer = 'unknown';
  try {
    const djs = require('discord.js');
    djsVer = djs?.version || 'unknown';
  } catch (err) {
    djsVer = 'unknown';
  }
  const nodeVer = process.version;

  const serverMemDisplay = serverMem
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
        console.error(err);
        await loadingMsg.edit('Failed to load stats.');
      }
    }
  },

  async execute(interaction, client) {
    await interaction.deferReply();
    let ping = 0;
    if (client.ws && typeof client.ws.ping === 'number' && isFinite(client.ws.ping) && client.ws.ping >= 0) {
      ping = Math.round(client.ws.ping);
    } else {
      try { ping = Math.max(0, Date.now() - (interaction.createdTimestamp || Date.now())); } catch { ping = 0; }
    }
    try {
      const embed = await generateStatsEmbed(client, ping);
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error(err);
      await interaction.editReply('Failed to load stats.');
    }
  }
};
