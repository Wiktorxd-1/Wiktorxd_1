const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const path = require('path');

const LogFile = path.join(__dirname, '../Data/logs.json');

function logBanAction(action) {
    let logs = [];
    try {
        const logDir = path.dirname(LogFile);
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }

        if (fs.existsSync(LogFile)) {
            const fileContent = fs.readFileSync(LogFile, 'utf8');
            logs = JSON.parse(fileContent) || [];
        }
    } catch (e) {
        console.error(`Error reading log file ${LogFile} in ban.js:`, e);
        logs = [];
    }

    logs.push(action);

    try {
        fs.writeFileSync(LogFile, JSON.stringify(logs, null, 2));
    } catch (e) {
        console.error(`Error writing to log file ${LogFile} in ban.js:`, e);
    }
}

async function resolveUser(input, interaction) {
    input = input.trim();
    let userId = null;
    if (/^\d+$/.test(input)) {
        userId = input;
    } else if (input.startsWith('<@') && input.endsWith('>')) {
        userId = input.replace(/[<@!>]/g, '');
    }
    if (userId) {
        try {
            return await interaction.guild.members.fetch(userId);
        } catch {}
    }
    const member = interaction.guild.members.cache.find(
        m => m.user.username === input || m.displayName === input
    );
    return member || null;
}


function isMod(interaction) {
    if (!interaction.guild) return false;
    if (interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return true;
    try {
        const settingsPath = path.join(__dirname, '../Data/server_settings.json');
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        let modRoles = settings[interaction.guildId]?.modRoles || [];
        if (typeof modRoles === "string") modRoles = [modRoles];
        if (!Array.isArray(modRoles)) return false;
        return interaction.member.roles.cache.some(role => modRoles.includes(role.id));
    } catch {
        return false;
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Ban someone')
        .setIntegrationTypes([0])
        .addUserOption(option =>
            option.setName('member')
                .setDescription('Who?')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for ban')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

    async execute(interaction) {
        if (interaction.guild && !isMod(interaction)) {
            return interaction.reply({ content: "You need to be an admin or have a moderator role to run this command", flags: 64 });
        }

        const targetUser = interaction.options.getUser('member');
        const reason = interaction.options.getString('reason') || 'No reason provided';

        if (!targetUser) {
            return interaction.reply({ content: "You must specify a user to ban.", flags: 64 });
        }

        let member = null;
        try { member = await interaction.guild.members.fetch(targetUser.id); } catch { member = null; }

        
        const bannedUsers = await interaction.guild.bans.fetch().catch(() => new Map());
        const alreadyBanned = Array.from(bannedUsers.values()).find(ban => ban.user.id === targetUser.id);
        if (alreadyBanned) {
            return interaction.reply({ content: `User ${alreadyBanned.user.tag} is already banned.`, flags: 64 });
        }

        const targetId = targetUser.id;
        if (targetId === interaction.user.id) {
            return interaction.reply({
                content: "You cannot ban yourself.",
                flags: 64
            });
        }
        if (targetId === interaction.client.user.id) {
            return interaction.reply({
                content: "I cannot ban myself.",
                flags: 64
            });
        }
        if (member && member.roles.highest.position >= interaction.member.roles.highest.position && interaction.user.id !== interaction.guild.ownerId) {
            return interaction.reply({
                content: "You cannot ban a member with an equal or higher role than yourself.",
                flags: 64
            });
        }
        try {
            
            if (member) {
                if (!member.bannable) {
                    return interaction.reply({ content: "I do not have sufficient permissions to ban this member.", flags: 64 });
                }
                await member.ban({ reason });
            } else {
                await interaction.guild.members.ban(targetId, { reason });
            }

            await interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle("User Banned")
                        .setDescription(`User **${member.user.tag}** has been banned permanently!`)
                        .setColor(0xFBE7BD)
                        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                        .addFields(
                            { name: 'Reason', value: reason, inline: true },
                            { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true }
                        )
                        .setTimestamp()
                ]
            });

            logBanAction({
                commandName: 'ban',
                status: 'success',
                user: { tag: member.user.tag, id: member.user.id },
                moderator: { tag: interaction.user.tag, id: interaction.user.id },
                reason,
                duration: "permanent",
                guild: interaction.guildId,
                time: new Date().toISOString()
            });

            try {
                const settingsPath = path.join(__dirname, '../Data/server_settings.json');
                const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
                const logChannelId = settings[interaction.guildId]?.logChannel;
                if (logChannelId) {
                    const logChannel = interaction.guild.channels.cache.get(logChannelId);
                    if (logChannel) {
                        const fields = [
                            { name: '**User:**', value: `<@${member.user.id}> (${member.user.id})`, inline: false },
                            { name: '**Moderator:**', value: `<@${interaction.user.id}> (${interaction.user.id})`, inline: false },
                            { name: '**Reason:**', value: reason, inline: false }
                        ];
                        fields.push({ name: '**Duration:**', value: `Permanent`, inline: false });

                        logChannel.send({
                            embeds: [
                                new EmbedBuilder()
                                    .setTitle("User Banned")
                                    .addFields(fields)
                                    .setColor(0xFBE7BD)
                                    .setTimestamp()
                            ]
                        });
                    }
                }
            } catch (e) {
                console.error("Error sending ban log to server log channel:", e);
            }

        } catch (e) {
            logBanAction({
                commandName: "ban",
                status: "error",
                error: String(e),
                moderator: { id: interaction.user.id, tag: interaction.user.tag },
                user: { id: member ? member.user.id : targetUser.id, tag: member ? member.user.tag : targetUser.tag },
                guild: interaction.guildId,
                time: new Date().toISOString()
            });
            console.error(`Error banning user ${member ? member.user.tag : targetUser.tag}:`, e);
            await interaction.reply({
                content: "An error occurred while trying to ban the user. This could be due to insufficient bot permissions or a Discord API issue.",
                flags: 64
            });
        }
    }
};
