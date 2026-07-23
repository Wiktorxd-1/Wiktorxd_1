const { SlashCommandBuilder } = require('discord.js');
const axios = require('axios');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('verify')
    .setIntegrationTypes([0, 1])
    .setContexts([0, 1, 2])
    .setDescription('Verify guy2 macro using a single command!')
    .addStringOption(opt => opt.setName('key').setDescription('verification key').setRequired(true)),

  async execute(interaction) {
    const key = interaction.options.getString('key', true).trim();
    await interaction.deferReply();

    try {
      const ApiBase = 'https://discordbot-production-914b.up.railway.app';

      function randomUserAgent() {
        const major = 120 + Math.floor(Math.random() * 31);
        return {
          ua: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`,
          major: String(major),
        };
      }

      function getRequestHeaders() {
        const { ua, major } = randomUserAgent();
        return {
          accept: '*/*',
          'accept-encoding': 'gzip, deflate, br, zstd',
          'accept-language': 'en-US,en;q=0.9,pl;q=0.8',
          'content-type': 'application/json',
          origin: 'https://guy2-macros.com',
          referer: 'https://guy2-macros.com/',
          'sec-ch-ua': `"Google Chrome";v="${major}", "Not?A_Brand";v="8", "Chromium";v="${major}"`,
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"',
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'cross-site',
          'user-agent': ua,
        };
      }

      let respBody = null;
      try {
        const tokenRes = await axios.get(`${ApiBase}/api/website-verify-token`, {
          params: { token: key },
          timeout: 8000,
          headers: getRequestHeaders(),
        });
        respBody = tokenRes && tokenRes.data ? tokenRes.data : null;
      } catch (err) {
        respBody = null;
      }
      if (!respBody || respBody.success !== true) {
        const res = await axios.post(
          `${ApiBase}/api/website-verify-code`,
          { code: key },
          { headers: getRequestHeaders(), timeout: 8000 }
        );
        respBody = res && res.data ? res.data : null;
      }
      if (!respBody || respBody.success !== true) {
        await interaction.editReply('Something went wrong, try again later').catch(()=>{});
        return;
      }
      let expiresMs = null;
      if (typeof respBody.expires_in === 'number') {
        expiresMs = respBody.expires_in * 1000;
      } else if (typeof respBody.expires === 'string') {
        const t = Date.parse(respBody.expires);
        if (!Number.isNaN(t)) expiresMs = t - Date.now();
      }

      let parsedMinutes = null;
      if (expiresMs == null && typeof respBody.message === 'string') {
        const minMatch = respBody.message.match(/(\d+)\s*(?:-|\s)?\s*minute(s)?\b/i);
        if (minMatch) {
          parsedMinutes = Number(minMatch[1]);
          expiresMs = parsedMinutes * 60 * 1000;
        } else {
          const secMatch = respBody.message.match(/(\d+)\s*(?:s|sec|secs|second|seconds)\b/i);
          if (secMatch) {
            expiresMs = Number(secMatch[1]) * 1000;
          } else {
            const m = respBody.message.match(/(\d+)\s*(?:-|\s)?\s*(hour|hr|h|day|d|month|mo|m)/i);
            if (m) {
              const n = Number(m[1]);
              const unit = (m[2] || '').toLowerCase();
              const mul = unit.startsWith('h') ? 3600e3 : unit.startsWith('d') ? 86400e3 : (unit.startsWith('mo')||unit==='m') ? 30*86400e3 : 3600e3;
              expiresMs = n * mul;
            }
          }
        }
      }

      if (expiresMs == null) {
        expiresMs = 24 * 3600e3;
      }

      const expireTs = Math.floor((Date.now() + expiresMs) / 1000);
      await interaction.editReply(`Verification went correct! You have access for <t:${expireTs}:R>.`).catch(()=>{});
    } catch (err) {
      console.error('verify command error:', err && err.message ? err.message : err);
      await interaction.editReply('Something went wrong, try again later').catch(()=>{});
    }
  }
};