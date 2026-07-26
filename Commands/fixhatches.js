const axios = require('axios');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { 
    SlashCommandBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    EmbedBuilder, 
    UserSelectMenuBuilder, 
    RoleSelectMenuBuilder, 
    ComponentType 
} = require('discord.js');

const ROVER_API_KEY = process.env.ROVER_API_KEY;
const GUILD_ID = '1369439484659236954';
const ADMIN_ID = '697047593334603837';

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

async function resolveUserRoblox(discordId) {
    try {
        const url = `https://registry.rover.link/api/guilds/${GUILD_ID}/discord-to-roblox/${discordId}`;
        const response = await axios.get(url, { headers: { 'Authorization': `Bearer ${ROVER_API_KEY}` } });
        if (response.data && response.data.robloxId) {
            return {
                robloxId: response.data.robloxId,
                username: response.data.cachedUsername
            };
        }
    } catch (e) {}

    try {
        const prefPath = path.join(__dirname, '../Data/Hatches/prefered.json');
        if (fs.existsSync(prefPath)) {
            const prefs = JSON.parse(await fs.promises.readFile(prefPath, 'utf8'));
            const pref = prefs.find(p => p.discordId && String(p.discordId) === String(discordId));
            if (pref && pref.username) {
                const robloxId = await getRobloxId(pref.username);
                if (robloxId) return { robloxId, username: pref.username };
            }
        }
    } catch (e) {}

    try {
        const earlierPath = path.join(__dirname, '../Data/earlier_secrets.json');
        if (fs.existsSync(earlierPath)) {
            const earlier = JSON.parse(await fs.promises.readFile(earlierPath, 'utf8'));
            const entry = earlier.find(e => e.discordId && String(e.discordId) === String(discordId));
            if (entry && entry.username) {
                const robloxId = await getRobloxId(entry.username);
                if (robloxId) return { robloxId, username: entry.username };
            }
        }
    } catch (e) {}

    return null;
}

async function getRobloxId(username) {
    try {
        const rRes = await axios.post(`https://users.roblox.com/v1/usernames/users`, {
            "usernames": [username], "excludeBannedUsers": true
        });
        return rRes.data?.data?.[0]?.id || null;
    } catch(e) {
        return null;
    }
}

async function fixUserHatches(discordId, robloxUsername) {
    const [result] = await pool.query(
        "UPDATE secrets SET discordUserId = ? WHERE (discordUserId IS NULL OR discordUserId = 'null') AND (hatchedBy = ? OR hatchedBy LIKE ? OR hatchedBy LIKE ?)",
        [discordId, robloxUsername, `%(@${robloxUsername})%`, `${robloxUsername} (@%)`]
    );
    return result.affectedRows;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('fixhatches')
        .setDescription('Link your Discord ID to your hatches in the database')
        .setIntegrationTypes([0])
        .setContexts([0]),
    
    async execute(interaction) {
        if (interaction.user.id !== ADMIN_ID) {
            await interaction.deferReply({ ephemeral: true });
            const resolved = await resolveUserRoblox(interaction.user.id);
            if (!resolved) {
                return interaction.editReply({
                    content: "Could not find your verified Roblox account. Please verify with RoVer in this server!"
                });
            }
            const count = await fixUserHatches(interaction.user.id, resolved.username);
            return interaction.editReply({
                content: `Successfully linked your Discord ID to **${count}** of your hatches! (Roblox: \`${resolved.username}\`)`
            });
        }

        await interaction.deferReply();

        const embed = new EmbedBuilder()
            .setTitle('Fix Hatches Controls')
            .setDescription('Select an option below to perform a fix action.')
            .setColor(0x5865F2);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('fix_my_own').setLabel('Fix My Hatches').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('fix_user_btn').setLabel('Fix a User').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('fix_role_btn').setLabel('Fix a Role').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('fix_all_btn').setLabel('Fix All Hatches').setStyle(ButtonStyle.Danger)
        );

        const reply = await interaction.editReply({ embeds: [embed], components: [row] });

        const filter = i => i.user.id === interaction.user.id;
        const collector = reply.createMessageComponentCollector({ filter, time: 300000 });

        collector.on('collect', async i => {
            if (i.customId === 'fix_my_own') {
                await i.deferUpdate();
                const resolved = await resolveUserRoblox(interaction.user.id);
                if (!resolved) {
                    return i.editReply({ content: 'Could not find your verified Roblox account.', embeds: [], components: [] });
                }
                const count = await fixUserHatches(interaction.user.id, resolved.username);
                return i.editReply({ content: `Successfully linked your Discord ID to **${count}** of your hatches! (Roblox: \`${resolved.username}\`)`, embeds: [], components: [] });
            }

            if (i.customId === 'fix_user_btn') {
                await i.deferUpdate();
                const userSelectRow = new ActionRowBuilder().addComponents(
                    new UserSelectMenuBuilder().setCustomId('select_user').setPlaceholder('Select a user')
                );
                const userReply = await i.editReply({ content: 'Select a user to fix:', embeds: [], components: [userSelectRow] });
                
                const selectMenuCollector = userReply.createMessageComponentCollector({
                    componentType: ComponentType.UserSelect,
                    filter,
                    time: 60000,
                    max: 1
                });

                selectMenuCollector.on('collect', async selectInteraction => {
                    await selectInteraction.deferUpdate();
                    const targetUser = selectInteraction.users.first();
                    const resolved = await resolveUserRoblox(targetUser.id);
                    if (!resolved) {
                        return selectInteraction.editReply({ content: `Could not find verified Roblox account for ${targetUser.username}.`, components: [] });
                    }
                    const count = await fixUserHatches(targetUser.id, resolved.username);
                    return selectInteraction.editReply({ content: `Successfully linked ${targetUser.username}'s Discord ID to **${count}** hatches! (Roblox: \`${resolved.username}\`)`, components: [] });
                });
            }

            if (i.customId === 'fix_role_btn') {
                await i.deferUpdate();
                const roleSelectRow = new ActionRowBuilder().addComponents(
                    new RoleSelectMenuBuilder().setCustomId('select_role').setPlaceholder('Select a role')
                );
                const roleReply = await i.editReply({ content: 'Select a role to fix:', embeds: [], components: [roleSelectRow] });

                const selectMenuCollector = roleReply.createMessageComponentCollector({
                    componentType: ComponentType.RoleSelect,
                    filter,
                    time: 60000,
                    max: 1
                });

                selectMenuCollector.on('collect', async selectInteraction => {
                    await selectInteraction.deferUpdate();
                    const targetRole = selectInteraction.roles.first();
                    await selectInteraction.editReply({ content: `Starting update for role **${targetRole.name}**...`, components: [] });
                    
                    const roleMembers = await interaction.guild.members.fetch();
                    const members = Array.from(roleMembers.filter(m => m.roles.cache.has(targetRole.id)).values());
                    
                    if (members.length === 0) {
                        return selectInteraction.editReply({ content: 'No members found for that role.' });
                    }

                    let processed = 0;
                    let totalUpdated = 0;

                    for (const member of members) {
                        const resolved = await resolveUserRoblox(member.id);
                        if (resolved) {
                            const count = await fixUserHatches(member.id, resolved.username);
                            totalUpdated += count;
                        }
                        processed++;
                        if (processed % 5 === 0 || processed === members.length) {
                            await selectInteraction.editReply({ content: `Fixing role **${targetRole.name}**...\nProgress: ${processed}/${members.length} members checked. Total hatches fixed: ${totalUpdated}` });
                        }
                        await new Promise(r => setTimeout(r, 2000));
                    }

                    await selectInteraction.editReply({ content: `Finished fixing role **${targetRole.name}**! Checked ${members.length} members, linked ${totalUpdated} hatches.` });
                });
            }

            if (i.customId === 'fix_all_btn') {
                await i.deferUpdate();
                await i.editReply({ content: 'Starting database backfill... Querying secrets table...', embeds: [], components: [] });

                const [rows] = await pool.query("SELECT id, hatchedBy FROM secrets WHERE discordUserId IS NULL AND hatchedBy IS NOT NULL AND hatchedBy NOT LIKE '%Unknown%' ORDER BY timestamp ASC");
                await i.editReply({ content: `Found **${rows.length}** rows without Discord ID. Scanning users...` });

                let processed = 0;
                let fixed = 0;
                const processedUsers = new Set();

                for (let idx = 0; idx < rows.length; idx++) {
                    const row = rows[idx];
                    let robloxUsername = null;
                    const match = row.hatchedBy.match(/\(@(.*?)\)/);
                    if (match && match[1]) {
                        robloxUsername = match[1];
                    } else {
                        const firstWordMatch = row.hatchedBy.match(/^[^(\s@]+/);
                        if (firstWordMatch) robloxUsername = firstWordMatch[0].replace('@', '');
                    }

                    if (!robloxUsername) continue;

                    const usernameLower = robloxUsername.toLowerCase();
                    if (processedUsers.has(usernameLower)) {
                        continue;
                    }
                    processedUsers.add(usernameLower);

                    let robloxId = await getRobloxId(robloxUsername);
                    if (robloxId) {
                        let discordId = null;
                        try {
                            const url = `https://registry.rover.link/api/guilds/${GUILD_ID}/roblox-to-discord/${robloxId}`;
                            const response = await axios.get(url, { headers: { 'Authorization': `Bearer ${ROVER_API_KEY}` } });
                            if (response.data && response.data.discordUsers && response.data.discordUsers.length > 0) {
                                discordId = response.data.discordUsers[0].user.id;
                            }
                        } catch (e) {
                            if (e.response && e.response.status === 429) {
                                const retryAfter = (e.response.headers['retry-after'] ? parseInt(e.response.headers['retry-after']) : 60) * 1000;
                                await new Promise(r => setTimeout(r, retryAfter));
                                idx--;
                                processedUsers.delete(usernameLower);
                                continue;
                            }
                        }

                        if (discordId) {
                            const count = await fixUserHatches(discordId, robloxUsername);
                            fixed += count;
                        }
                    }

                    processed++;
                    if (processed % 10 === 0 || idx === rows.length - 1) {
                        await i.editReply({ content: `Database backfill in progress...\nChecked: ${processed} unique users. Total hatches linked: ${fixed}.` });
                    }

                    await new Promise(r => setTimeout(r, 2000));
                }

                await i.editReply({ content: `Database backfill completed! Checked ${processed} unique users, successfully linked ${fixed} hatches.` });
            }
        });
    }
};
