const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const axios = require('axios');

const RequiredRoleId = '1369703955826999468';
const BotOwnerIds = (process.env.BOT_OWNER_ID || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);

function formatTime(seconds) {
    seconds = Math.round(seconds);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    let out = [];
    if (h > 0) out.push(`${h} hour${h !== 1 ? 's' : ''}`);
    if (m > 0) out.push(`${m} minute${m !== 1 ? 's' : ''}`);
    if (s > 0 || out.length === 0) out.push(`${s} second${s !== 1 ? 's' : ''}`);
    return out.join(' ');
}

const runningUpdates = new Map();
const DataDir = path.join(__dirname, '../Data');
const EarlierSecretsPath = path.join(DataDir, 'earlier_secrets.json');

function extractRobloxUsername(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const atMatch = raw.match(/\(@([a-zA-Z0-9_]+)\)/);
    if (atMatch && atMatch[1]) return atMatch[1].toLowerCase();
    const firstSegment = raw.split(/\s+/)[0];
    return firstSegment ? firstSegment.replace('@', '').toLowerCase() : null;
}

async function loadEarlierSecrets() {
    try {
        const raw = await fs.promises.readFile(EarlierSecretsPath, 'utf8');
        return JSON.parse(raw);
    } catch {
        return [];
    }
}

async function saveEarlierSecrets(data) {
    await fs.promises.writeFile(EarlierSecretsPath, JSON.stringify(data, null, 2), 'utf8');
}

async function streamUpdateSecrets(ndjsonPath, usernameMap, cancelToken) {
    const tempPath = `${ndjsonPath}.tmp`;
    const updatedCounts = new Map();
    const totalCounts = new Map();

    const reader = readline.createInterface({
        input: fs.createReadStream(ndjsonPath),
        crlfDelay: Infinity
    });
    const writer = fs.createWriteStream(tempPath, { flags: 'w' });

    let hadChanges = false;

    try {
        for await (const line of reader) {
            if (cancelToken?.cancelled) {
                throw new Error('Update cancelled');
            }

            if (!line.trim()) {
                writer.write('\n');
                continue;
            }

            let entry;
            try {
                entry = JSON.parse(line);
            } catch (error) {
                writer.write(line + '\n');
                continue;
            }

            const usernameLower = extractRobloxUsername(entry.hatchedBy);
            if (usernameLower && usernameMap.has(usernameLower)) {
                const target = usernameMap.get(usernameLower);
                const currentId = entry.discordUserId ? String(entry.discordUserId) : null;
                const targetId = target.discordId ? String(target.discordId) : null;
                totalCounts.set(usernameLower, (totalCounts.get(usernameLower) || 0) + 1);
                if (targetId && currentId !== targetId) {
                    entry.discordUserId = targetId;
                    hadChanges = true;
                    updatedCounts.set(usernameLower, (updatedCounts.get(usernameLower) || 0) + 1);
                }
            }

            writer.write(JSON.stringify(entry) + '\n');
        }
    } finally {
        reader.close();
    }

    await new Promise((resolve, reject) => {
        writer.once('finish', resolve);
        writer.once('error', reject);
        writer.end();
    });

    if (cancelToken?.cancelled) {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        throw new Error('Update cancelled');
    }

    if (hadChanges) {
        fs.renameSync(tempPath, ndjsonPath);
    } else if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
    }

    return { updatedCounts, totalCounts, hadChanges };
}

async function updateEarlierSecrets(username, discordId, hatchCount) {
    if (!discordId || !/^\d+$/.test(discordId)) return; 
    const secrets = await loadEarlierSecrets();
    username = String(username).toLowerCase();
    let entry = secrets.find(e => String(e.username).toLowerCase() === username);
    if (entry) {
        entry.discordId = discordId;
        entry.amount = hatchCount;
    } else {
        secrets.push({ username, discordId, amount: hatchCount });
    }
    await saveEarlierSecrets(secrets);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('update')
        .setDescription('update secrets file')
        .setDefaultMemberPermissions(0)
        .setIntegrationTypes([0])
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to update')
                .setRequired(false)
        )
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('Role to update')
                .setRequired(false)
        ),

    async execute(interaction) {
        await interaction.deferReply();

        if (!interaction.guild || interaction.guild.id !== '1369439484659236954') {
            await interaction.editReply('Only allowed in [bubbler discord server](https://discord.gg/4zXsCpqF3m)');
            return;
        }

        const member = interaction.member;
        const hasRequiredRole = member?.roles?.cache?.has(RequiredRoleId);
        const isOwner = BotOwnerIds.includes(interaction.user.id);

        if (!hasRequiredRole && !isOwner) {
            await interaction.editReply('You do not have permission to use this command.');
            return;
        }

        const userOption = interaction.options.getUser('user');
        const roleOption = interaction.options.getRole('role');

        if (!userOption && !roleOption) {
            await interaction.editReply('you must choose lil bro');
            return;
        }

        const updateKey = userOption ? `user:${userOption.id}` : `role:${roleOption.id}`;
        if (runningUpdates.has(updateKey)) {
            runningUpdates.get(updateKey).cancelled = true;
            await interaction.editReply('Cancelled successfully');
            return;
        }


        if (userOption && !roleOption) {
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('update_normal')
                        .setLabel('Normal')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId('update_force')
                        .setLabel('Force')
                        .setStyle(ButtonStyle.Success)
                );
            await interaction.editReply({
                content: `What type of update do you want to run for ${userOption.username}`,
                components: [row]
            });

            const buttonInt = await interaction.channel.awaitMessageComponent({
                filter: i => i.user.id === interaction.user.id,
                time: 60000
            }).catch(() => null);

            if (!buttonInt) {
                await interaction.editReply({ content: 'No selection made.', components: [] });
                return;
            }

            if (buttonInt.customId === 'update_normal') {
                await buttonInt.update({ content: 'Running normal update...', components: [] });

                await runUpdateForUser(userOption, interaction, null, updateKey);
                return;
            }

            if (buttonInt.customId === 'update_force') {
                const modal = new ModalBuilder()
                    .setCustomId('update_force_modal')
                    .setTitle('Force update username')
                    .addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('usernames')
                                .setLabel('Enter username(s)')
                                .setStyle(TextInputStyle.Short)
                                .setRequired(true)
                        )
                    );
                await buttonInt.showModal(modal);

                const modalInt = await buttonInt.awaitModalSubmit({
                    filter: i => i.user.id === interaction.user.id,
                    time: 120000
                }).catch(() => null);

                if (!modalInt) {
                    await interaction.editReply({ content: 'No usernames given', components: [] });
                    return;
                }

                const usernamesRaw = modalInt.fields.getTextInputValue('usernames');
                const usernames = usernamesRaw.split(',').map(u => u.trim()).filter(u => u.length > 0);

                await modalInt.reply({ content: `Running force update for: ${usernames.join(', ')}` });
                await runUpdateForUser(userOption, interaction, usernames, updateKey);
                return;
            }
            return;
        }

        await runUpdateForRole(roleOption, interaction, updateKey);
    }
};

async function runUpdateForUser(userOption, interaction, forceUsernames, updateKey) {
    const cancelToken = { cancelled: false };
    runningUpdates.set(updateKey, cancelToken);

    try {
        const guild = interaction.guild;
        const ndjsonPath = path.join(__dirname, '../Data/secrets.ndjson');
        const member = await guild.members.fetch(userOption.id).catch(() => null);
        if (!member) {
            await interaction.editReply('User not found.');
            return;
        }
        let robloxUsernames = forceUsernames;
        if (!robloxUsernames) {

            try {
                const url = `https://registry.rover.link/api/guilds/${guild.id}/discord-to-roblox/${member.id}`;
                const response = await axios.get(url, {
                    headers: { 'Authorization': `Bearer ${process.env.ROVER_API_KEY}` }
                });
                robloxUsernames = response.data?.cachedUsername ? [response.data.cachedUsername] : [];
            } catch {
                robloxUsernames = [];
            }
        }

        if (robloxUsernames.length === 0) {
            await interaction.editReply('No username(s) found for this user');
            return;
        }

        const usernameMap = new Map();
        for (const name of robloxUsernames) {
            const lowered = name.toLowerCase();
            usernameMap.set(lowered, { discordId: member.id, original: name });
        }

        if (cancelToken.cancelled) {
            await interaction.editReply('Update cancelled.');
            return;
        }

        let streamResult;
        try {
            streamResult = await streamUpdateSecrets(ndjsonPath, usernameMap, cancelToken);
        } catch (err) {
            if (err.message === 'Update cancelled') {
                await interaction.editReply('Updating cancelled');
                return;
            }
            console.error('streamUpdateSecrets failed:', err);
            await interaction.editReply('Failed to update entries due to an internal error.');
            return;
        }

        for (const [usernameLower, meta] of usernameMap.entries()) {
            if (cancelToken.cancelled) {
                await interaction.editReply('Updating cancelled');
                return;
            }
            const total = streamResult.totalCounts.get(usernameLower) || 0;
            if (total > 0 && meta.discordId && /^\d+$/.test(meta.discordId)) {
                await updateEarlierSecrets(meta.original, meta.discordId, total);
            }
        }

        const updatedTotal = Array.from(streamResult.updatedCounts.values()).reduce((a, b) => a + b, 0);
        const totalMatched = Array.from(streamResult.totalCounts.values()).reduce((a, b) => a + b, 0);

        if (totalMatched === 0) {
            await interaction.editReply('No matching hatches were found for the provided username(s).');
            return;
        }

        await interaction.editReply(`Update complete for ${member.user.username}. Updated ${updatedTotal} entries out of ${totalMatched} matching hatches.`);
    } finally {
        runningUpdates.delete(updateKey);
    }
}

async function runUpdateForRole(roleOption, interaction, updateKey) {
    const cancelToken = { cancelled: false };
    runningUpdates.set(updateKey, cancelToken);

    const guild = interaction.guild;
    const ndjsonPath = path.join(__dirname, '../Data/secrets.ndjson');
    const channel = interaction.channel && typeof interaction.channel.send === 'function' ? interaction.channel : null;

    let progressMessage = null;

    const sendProgress = async (content) => {
        if (!content) return;
        try {
            if (channel) {
                if (!progressMessage || progressMessage.deleted) {
                    progressMessage = await channel.send(content);
                } else {
                    await progressMessage.edit({ content });
                }
            } else {
                if (!progressMessage || progressMessage.deleted) {
                    progressMessage = await interaction.followUp({ content });
                } else {
                    await progressMessage.edit({ content });
                }
            }
        } catch (err) {
            console.error('Failed to send role update progress message:', err);
            progressMessage = null;
        }
    };

    const sendSupplemental = async (content) => {
        if (!content) return;
        try {
            if (channel) {
                await channel.send(content);
            } else {
                await interaction.followUp({ content }).catch(() => {});
            }
        } catch (err) {
            console.error('Failed to send role update supplemental message:', err);
        }
    };

    try {
        const roleMembers = await guild.members.fetch();
        const membersToCheck = roleMembers.filter(m => m.roles.cache.has(roleOption.id));
        const members = Array.from(membersToCheck.values());

        if (members.length === 0) {
            await interaction.editReply('No members found for the specified role.');
            return;
        }

        await interaction.editReply(`Starting update for ${roleOption.name}. Progress will be posted in this channel.`);
        await sendProgress(`Collecting usernames: 0/${members.length}`);

        const usernameMap = new Map();
        const memberStats = new Map();

        const batchSize = 4;
        const batches = [];
        for (let i = 0; i < members.length; i += batchSize) {
            batches.push(members.slice(i, i + batchSize));
        }

        let processed = 0;

        
        const aggTotalCounts = new Map();
        const aggUpdatedCounts = new Map();

        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
            const batch = batches[batchIndex];
            if (cancelToken.cancelled) {
                await sendProgress('Update cancelled.');
                return;
            }

            
            const addedUsernames = [];

            for (const member of batch) {
                let attempt = 0;
                let robloxUsername = null;

                while (attempt < 3 && !robloxUsername && !cancelToken.cancelled) {
                    attempt++;
                    try {
                        const url = `https://registry.rover.link/api/guilds/${guild.id}/discord-to-roblox/${member.id}`;
                        const response = await axios.get(url, {
                            headers: { Authorization: `Bearer ${process.env.ROVER_API_KEY}` }
                        });

                        if (response.headers['x-ratelimit-remaining'] === '0') {
                            const waitSec = parseFloat(response.headers['x-ratelimit-reset-after'] || response.headers['retry-after'] || '1');
                            if (!cancelToken.cancelled) {
                                await sendSupplemental(`Rover rate limit reached, waiting ${formatTime(waitSec)}...`);
                            }
                            await new Promise(res => setTimeout(res, waitSec * 1000));
                            continue;
                        }

                        robloxUsername = response.data?.cachedUsername || null;
                    } catch (error) {
                        if (error.response && error.response.status === 429) {
                            const waitSec = parseFloat(error.response.headers['retry-after'] || '1');
                            if (!cancelToken.cancelled) {
                                await sendSupplemental(`Rover rate limited the bot, retrying in ${formatTime(waitSec)}...`);
                            }
                            await new Promise(res => setTimeout(res, waitSec * 1000));
                            continue;
                        }
                        break;
                    }
                }

                processed++;
                if (processed % 10 === 0 || processed === members.length) {
                    await sendProgress(`Collecting usernames: ${processed}/${members.length}`);
                }

                if (!robloxUsername) {
                    continue;
                }

                const lowered = robloxUsername.toLowerCase();
                usernameMap.set(lowered, { discordId: member.id, original: robloxUsername });
                addedUsernames.push(lowered);

                if (!memberStats.has(member.id)) {
                    memberStats.set(member.id, { member, usernames: new Set(), total: 0, updated: 0 });
                }
                memberStats.get(member.id).usernames.add(robloxUsername);
            }

            
            if (addedUsernames.length > 0) {
                const batchMap = new Map();
                for (const uname of addedUsernames) {
                    if (usernameMap.has(uname)) batchMap.set(uname, usernameMap.get(uname));
                }

                await sendProgress(`Running update for ${batchMap.size} username(s) (batch ${batchIndex + 1}/${batches.length})...`);
                try {
                    const batchResult = await streamUpdateSecrets(ndjsonPath, batchMap, cancelToken);
                    
                    for (const [k, v] of batchResult.totalCounts.entries()) {
                        aggTotalCounts.set(k, (aggTotalCounts.get(k) || 0) + v);
                    }
                    for (const [k, v] of batchResult.updatedCounts.entries()) {
                        aggUpdatedCounts.set(k, (aggUpdatedCounts.get(k) || 0) + v);
                    }

                    
                    for (const [uname, meta] of batchMap.entries()) {
                        const totals = batchResult.totalCounts.get(uname) || 0;
                        const updated = batchResult.updatedCounts.get(uname) || 0;
                        if (memberStats.has(meta.discordId)) {
                            const stat = memberStats.get(meta.discordId);
                            stat.total += totals;
                            stat.updated += updated;
                        }
                        if (totals > 0 && meta.discordId && /^\d+$/.test(meta.discordId)) {
                            try { await updateEarlierSecrets(meta.original, meta.discordId, totals); } catch (e) { console.error('updateEarlierSecrets failed:', e); }
                        }
                    }
                } catch (err) {
                    if (err.message === 'Update cancelled') {
                        await sendProgress('Update cancelled.');
                        return;
                    }
                    console.error('streamUpdateSecrets (batch) failed:', err);
                    await sendSupplemental('Failed to update entries for a batch due to an internal error. Continuing with next batch...');
                }
            }

            
            if (batchIndex < batches.length - 1) {
                await sendProgress(`Processed ${processed} members, waiting 10 seconds before next batch...`);
                await new Promise(res => setTimeout(res, 10000));
            }
        }

        if (cancelToken.cancelled) {
            await sendProgress('Update cancelled.');
            return;
        }

        if (usernameMap.size === 0) {
            await sendProgress('No linked usernames were found for members with this role.');
            return;
        }

        
        const totalUpdatedEntries = Array.from(aggUpdatedCounts.values()).reduce((a, b) => a + b, 0);
        const totalMatchedEntries = Array.from(aggTotalCounts.values()).reduce((a, b) => a + b, 0);
        const membersTouched = Array.from(memberStats.values()).filter(stat => stat.total > 0).length;

        await sendProgress(
            `Role update complete for ${roleOption.name}.\n` +
            `Processed ${usernameMap.size} username(s) across ${members.length} member(s).\n` +
            `${totalUpdatedEntries} entries were updated out of ${totalMatchedEntries} matching hatch(es).\n` +
            `Members affected: ${membersTouched}.`
        );

        if (totalMatchedEntries === 0) {
            await sendSupplemental('No matching hatches were found for the collected usernames.');
            return;
        }

        const topEntries = Array.from(memberStats.values())
            .filter(stat => stat.total > 0)
            .sort((a, b) => b.total - a.total)
            .slice(0, 5)
            .map(stat => {
                const displayName = stat.member?.user?.tag || stat.member?.user?.username || stat.member?.id;
                const usernames = Array.from(stat.usernames).join(', ');
                return `• ${displayName}: updated ${stat.updated}/${stat.total} hatches (${usernames})`;
            });

        if (topEntries.length > 0) {
            await sendSupplemental(`Top updated members:\n${topEntries.join('\n')}`);
        }
    } finally {
        runningUpdates.delete(updateKey);
    }
}