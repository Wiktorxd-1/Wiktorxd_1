const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const DataDir = path.resolve(__dirname, '../Data');
const TrackedPath = path.join(DataDir, 'tracked.json');
const preference = require('../Utility/Hatches/preference');

async function ensureDataDir() {
    try { await fs.promises.mkdir(DataDir, { recursive: true }); } catch {}
}

async function loadTrackedArray() {
    try {
        const raw = await fs.promises.readFile(TrackedPath, 'utf8');
        return JSON.parse(raw);
    } catch (e) {
        return [];
    }
}

async function saveTrackedArray(arr) {
    try {
        await ensureDataDir();
        await fs.promises.writeFile(TrackedPath, JSON.stringify(arr, null, 2), 'utf8');
    } catch (e) {
        throw e;
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('addhatchping')
        .setDescription('Track someone\'s hatches')
        .addStringOption(o => o.setName('username')
            .setDescription('roblox username')
            .setRequired(true)
        ),

    async execute(interaction) {
        await interaction.deferReply();

        const raw = interaction.options.getString('username');
        const username = String(raw).trim();
        if (!username) return interaction.editReply({ content: 'Invalid username'});

        let targetUserId = null;
        let targetUsername = username;

        try {
            const userResponse = await axios.post(`https://users.roblox.com/v1/usernames/users`, {
                usernames: [username],
                excludeBannedUsers: true
            }, { timeout: 10000 });

            if (userResponse.data && userResponse.data.data && userResponse.data.data.length > 0) {
                targetUserId = userResponse.data.data[0].id;
                targetUsername = userResponse.data.data[0].name;
            } else {
                return interaction.editReply({ content: `username \`${username}\` not found`});
            }
        } catch (err) {
            console.error('[addhatchping] roblox lookup failed', err && err.message);
            return interaction.editReply({ content: 'failed to get username, try again'});
        }

        const discordId = interaction.user.id;
        let arr = await loadTrackedArray();

        const normalized = targetUsername.toLowerCase();
        const already = arr.find(e =>
            e.username && String(e.username).toLowerCase() === normalized && e.discordId === discordId
        );

        if (already) {
            const filtered = arr.filter(e => !(e.username && String(e.username).toLowerCase() === normalized && e.discordId === discordId));
            try {
                await saveTrackedArray(filtered);
            } catch (e) {
                console.error('[addhatchping] failed to save tracked.json', e);
                return interaction.editReply({ content: 'Failed to remove you from the pinging, please try again later'});
            }
            const stoppedEmbed = new EmbedBuilder()
                .setTitle(`Stopped tracking ${targetUsername}`)
                .setDescription(`You have stopped tracking \`${targetUsername}\``)
                .setColor(0xFBE7BD);
            return interaction.editReply({ embeds: [stoppedEmbed]});
        }

        arr.push({ discordId, username: targetUsername, robloxId: targetUserId });
        try {
            await saveTrackedArray(arr);

            const baseDesc = `You'll get pinged if \`${targetUsername}\` hatches a secret, if you want to stop getting pinged for \`${targetUsername}\` run the command again`;

            let warning = '';

            const usedInGuild = Boolean(interaction.guildId);
            const usedLocationLabel = usedInGuild ? 'this server' : 'this DM';

            if (interaction.guildId === '1369439484659236954') {
                warning = '';
            } else {
                let isMemberInBubbler = false;
                const bubblerGuild = interaction.client.guilds.cache.get('1369439484659236954');
                if (bubblerGuild) {
                    if (bubblerGuild.members.cache.has(discordId)) {
                        isMemberInBubbler = true;
                    } else {
                        try {
                            await bubblerGuild.members.fetch(discordId);
                            isMemberInBubbler = true;
                        } catch {}
                    }
                }
                if (isMemberInBubbler) {
                    warning = `⚠️ You have started following ${targetUsername}, you will be pinged in <#1383484997318480013> not in ${usedLocationLabel}`;
                } else {
                    try {
                        const pref = await preference.getPreferenceByDiscordId(discordId);
                        if (pref && Number(pref.type) === 1) {
                            warning = `⚠️ You have started following ${targetUsername}, you have DMs notifications enabled so you will receive a DM when they hatch something`;
                        } else {
                            warning = `⚠️ You have started following ${targetUsername}, but you aren't in the [bubbler discord server](https://discord.gg/4zXsCpqF3m), you will be pinged there.\n\nOr use </preferences:1433506632343752936> to get DM'd!`;
                        }
                    } catch (e) {
                        warning = `⚠️ You have started following ${targetUsername}, but you aren't in the [bubbler discord server](https://discord.gg/4zXsCpqF3m), you will be pinged there.\n\nOr use </preferences:1433506632343752936> to get DM'd!`;
                    }
                }
            }

            const desc = warning ? `${baseDesc}\n\n${warning}` : baseDesc;

            const startedEmbed = new EmbedBuilder()
                .setTitle(`Started tracking ${targetUsername}`)
                .setDescription(desc)
                .setColor(0xFBE7BD);

            return interaction.editReply({ embeds: [startedEmbed]});
        } catch (e) {
            console.error('[addhatchping] failed to save tracked.json', e);
            return interaction.editReply({ content: `Failed to make you get pinged for ${targetUsername}, please try again later` });
        }
    }
};