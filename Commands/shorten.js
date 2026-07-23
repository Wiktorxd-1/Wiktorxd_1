const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const axios = require('axios');
const path = require('node:path');
const fs = require('node:fs');

function normalizeUrl(rawUrl) {
    let trimmed = rawUrl.trim();
    trimmed = trimmed.replace(/^["'`<\(\[\{\s]+/, '');
    trimmed = trimmed.replace(/["'`>\)\]\}\s]+$/, '');
    trimmed = trimmed.trim();

    const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed);
    const candidate = hasScheme ? trimmed : `https://${trimmed}`;

    try {
        const url = new URL(candidate);
        if (!['http:', 'https:'].includes(url.protocol)) return trimmed;
        return url.toString();
    } catch {
        return trimmed;
    }
}

function resolveApiUrl(apiUrl) {
    if (!apiUrl || typeof apiUrl !== 'string') return apiUrl;
    const trimmed = apiUrl.trim();
    try {
        const url = new URL(trimmed);
        if (['http:', 'https:'].includes(url.protocol)) return url.toString();
    } catch {
        
    }

    const exists = fs.existsSync(trimmed);
    if (!exists) return trimmed;

    const stats = fs.statSync(trimmed);
    let dirPath = trimmed;
    if (stats.isFile()) {
        const fileName = path.basename(trimmed).toLowerCase();
        if (fileName === 'api.php') {
            dirPath = path.dirname(trimmed);
        }
    }

    const baseName = path.basename(dirPath);
    return `http://localhost/${encodeURIComponent(baseName)}/api.php`;
}

function isValidUrl(value) {
    try {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol);
    } catch {
        return false;
    }
}

function validateAlias(value) {
    return /^[a-z0-9_-]+$/.test(value);
}

async function requestShortUrl(apiUrl, apiKey, payload) {
    const body = new URLSearchParams(payload).toString();
    const response = await axios.post(apiUrl, body, {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-API-KEY': apiKey
        },
        timeout: 10000
    });
    return response.data;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('shorten')
        .setDescription('Shorten any link')
        .setIntegrationTypes([0, 1])
        .setContexts([0, 1, 2])
        .addStringOption(option =>
            option.setName('url')
                .setDescription('Link to shorten')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('alias')
                .setDescription('Custom path')
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option.setName('duration')
                .setDescription('Expiration in hours (defualts to 720h)')
                .setRequired(false)
        )
        .addIntegerOption(option =>
            option.setName('uses')
                .setDescription('Maximum number of uses (defualts to unlimited)')
                .setRequired(false)
        ),

    async execute(interaction) {
        const rawApiUrl = process.env.SHORTEN_API_URL || process.env.URL_SHORTENER_API_URL || 'http://localhost/R/api.php';
        const apiUrl = resolveApiUrl(rawApiUrl);
        const apiKey = process.env.SHORTEN_API_KEY || process.env.URL_SHORTENER_API_KEY;

        if (!apiUrl || !apiKey) {
            return interaction.reply({
                content: 'Command not set up yet, please wait.',
                flags: MessageFlags.Ephemeral
            });
        }

        const rawUrl = interaction.options.getString('url', true);
        const rawAlias = interaction.options.getString('alias', true);
        const durationHours = interaction.options.getInteger('duration');
        const uses = interaction.options.getInteger('uses') ?? 0;
        const normalizedUrl = normalizeUrl(rawUrl);

        if (!isValidUrl(normalizedUrl)) {
            return interaction.reply({
                content: 'Invalid link, try again',
                flags: MessageFlags.Ephemeral
            });
        }

        const alias = rawAlias ? rawAlias.trim().toLowerCase() : null;
        if (!alias) {
            return interaction.reply({
                content: 'You must provide a custom alias ',
                flags: MessageFlags.Ephemeral
            });
        }
        if (!validateAlias(alias)) {
            return interaction.reply({
                content: 'Invalid format, try again',
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.deferReply();

        const expiresHours = interaction.user.id === '697047593334603837' ? undefined : '720';
        const customPath = alias;
        let attempts = 0;
        let lastError = null;

        while (attempts < 5) {
            attempts += 1;
            const payload = {
                api_key: apiKey,
                path: customPath,
                url: encodeURI(normalizedUrl),
                uses: String(uses)
            };
            if (durationHours !== null) {
                if (!(interaction.user.id === '697047593334603837' && durationHours === 0)) {
                    payload.expires_hours = String(durationHours);
                }
            } else if (expiresHours) {
                payload.expires_hours = expiresHours;
            }

            try {
                const result = await requestShortUrl(apiUrl, apiKey, payload);
                if (result && result.success && result.short_url) {
                    return interaction.editReply(`Shortened link: ${result.short_url}`);
                }

                lastError = result && result.error ? result.error : 'Unknown shortener error';
                break;
            } catch (error) {
                if (error.response && error.response.data && error.response.data.error) {
                    lastError = error.response.data.error;
                } else {
                    lastError = error.message || 'Unknown request error';
                }
                break;
            }
        }

        const replyMessage = `Failed to create a shortened link using the alias: \`${alias}\`: ${lastError}`;

        return interaction.editReply({ content: replyMessage });
    }
};
