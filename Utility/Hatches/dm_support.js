const { EmbedBuilder } = require('discord.js');

const AllowedEmbedKeys = new Set([
	'type',
	'title',
	'description',
	'url',
	'timestamp',
	'color',
	'footer',
	'image',
	'thumbnail',
	'author',
	'fields'
]);

const NestedKeyWhitelist = {
	author: ['name', 'url', 'icon_url', 'proxy_icon_url'],
	footer: ['text', 'icon_url', 'proxy_icon_url'],
	thumbnail: ['url', 'proxy_url', 'height', 'width'],
	image: ['url', 'proxy_url', 'height', 'width']
};

function sanitizeBgsEmbed(rawEmbed) {
	if (!rawEmbed || typeof rawEmbed !== 'object') return null;

	const safeEmbed = {};

	for (const key of Object.keys(rawEmbed)) {
		if (!AllowedEmbedKeys.has(key)) continue;

		if (key === 'color') {
			const colorValue = rawEmbed.color;
			if (typeof colorValue === 'number') {
				safeEmbed.color = colorValue;
			} else if (typeof colorValue === 'string') {
				const parsed = parseInt(colorValue, 10);
				if (!Number.isNaN(parsed)) safeEmbed.color = parsed;
			}
			continue;
		}

		if (key === 'fields' && Array.isArray(rawEmbed.fields)) {
			safeEmbed.fields = rawEmbed.fields
				.filter(field => field && typeof field === 'object')
				.map(field => ({
					name: typeof field.name === 'string' ? field.name : '\u200b',
					value: typeof field.value === 'string' ? field.value : '\u200b',
					inline: Boolean(field.inline)
				}))
				.slice(0, 25);
			continue;
		}

		if (NestedKeyWhitelist[key] && rawEmbed[key] && typeof rawEmbed[key] === 'object') {
			const allowed = NestedKeyWhitelist[key];
			const nested = {};
			for (const nestedKey of allowed) {
				if (rawEmbed[key][nestedKey] !== undefined) {
					nested[nestedKey] = rawEmbed[key][nestedKey];
				}
			}
			if (Object.keys(nested).length > 0) {
				safeEmbed[key] = nested;
			}
			continue;
		}

		safeEmbed[key] = rawEmbed[key];
	}

	if (!safeEmbed.type) safeEmbed.type = 'rich';

	return safeEmbed;
}

function buildDefaultEmbed(hatchData) {
	const embed = new EmbedBuilder()
		.setTitle(hatchData.name || 'Unknown Pet')
		.setDescription(
			`<:user:1383493798138478732> **Hatched by:** ${hatchData.hatchedBy || 'Unknown'}\n` +
			`<:luck:1383493796876259379> **Exists:** ${hatchData.totalHatched || 'Unknown'}\n` +
			`<:paw:1383493795152265297> **Rarity:** ${hatchData.rarity || 'Unknown'}\n` +
			`<:clock:1383493793772208221> **Time:** ${formatRelativeTime(hatchData.timestamp)}`
		)
		.setColor(0xFBE7BD);

	if (hatchData.imageUrl) {
		embed.setThumbnail(hatchData.imageUrl);
	}

	const timestampDate = parseTimestamp(hatchData.timestamp);
	if (timestampDate) {
		embed.setTimestamp(timestampDate);
	}

	return embed;
}

function parseTimestamp(value) {
	if (!value) return null;
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatRelativeTime(value) {
	const parsed = parseTimestamp(value);
	if (!parsed) return 'Unknown';
	const unix = Math.floor(parsed.getTime() / 1000);
	return `<t:${unix}:R>`;
}

async function sendHatchDM(client, userId, hatchData, messageType, rawBgsEmbed) {
	if (!client || !userId) return;

	const user = await client.users.fetch(userId).catch(() => null);
	if (!user) {
		throw new Error(`Unable to fetch user ${userId} for hatch DM`);
	}

	if (messageType === 1 && rawBgsEmbed) {
		const sanitized = sanitizeBgsEmbed(rawBgsEmbed);
		if (sanitized) {
			await user.send({ embeds: [sanitized] });
			return;
		}
	}

	const embed = buildDefaultEmbed(hatchData);
	await user.send({ embeds: [embed] });
}

module.exports = {
	sendHatchDM
};
