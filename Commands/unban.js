const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const fs = require('fs');
const path = require('path');

const LogFile = path.join(__dirname, '../Data/logs.json');

function logAction(action) {
    let logs = [];
    try {
        if (fs.existsSync(LogFile)) {
            logs = JSON.parse(fs.readFileSync(LogFile, 'utf8')) || [];
        }
    } catch (e) { logs = []; }
    logs.push(action);
    fs.writeFileSync(LogFile, JSON.stringify(logs, null, 2));
}

async function resolveBannedUser(input, interaction) {
    input = input.trim();
    let userId = null;
    if (/^\d+$/.test(input)) {
        userId = input;
    } else if (input.startsWith('<@') && input.endsWith('>')) {
        userId = input.replace(/[<@!>]/g, '');
    }

    if (userId) {
        try {
            const ban = await interaction.guild.bans.fetch(userId);
            if (ban) return ban.user;
        } catch {}
    }

    try {
        const bans = await interaction.guild.bans.fetch();
        const banEntry = bans.find(b => 
            b.user.username.toLowerCase() === input.toLowerCase() || 
            b.user.tag.toLowerCase() === input.toLowerCase()
        );
        if (banEntry) return banEntry.user;
    } catch (e) {
        console.error('Error fetching bans in resolveBannedUser:', e);
    }

    return null;
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
        .setName('unban')
        .setDescription('Unban someone')
        .setIntegrationTypes([0])
        .addStringOption(option =>
            option.setName('user')
                .setDescription('Banned user\'s username, tag, or ID')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for unban')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

    async execute(interaction) {
        if (interaction.guild && !isMod(interaction)) {
            return interaction.reply({ content: "You need to be an admin or have a moderator role to run this command", flags: MessageFlags.Ephemeral });
        }

        const userInput = interaction.options.getString('user');
        const reason = interaction.options.getString('reason') || 'No reason provided';
        if (!userInput) return interaction.reply({ content: 'You must specify a user to unban.', flags: MessageFlags.Ephemeral });

        const targetUser = await resolveBannedUser(userInput, interaction);
        if (!targetUser) return interaction.reply({ content: 'Could not find a banned user matching the input.', flags: MessageFlags.Ephemeral });
        const userId = targetUser.id;

        try {
            await interaction.guild.members.unban(userId, reason);
            await interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle("Unbanned")
                        .setDescription(`User <@${userId}> has been unbanned!\nReason: **${reason}**`)
                        .setColor(0xFBE7BD)
                ]
            });

            logAction({
                commandName: 'unban',
                status: 'success',
                user: { id: userId, tag: targetUser.tag },
                moderator: { tag: interaction.user.tag, id: interaction.user.id },
                reason,
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
                        logChannel.send({
                            embeds: [
                                new EmbedBuilder()
                                    .setTitle("Unban")
                                    .addFields([
                                        { name: '**User:**', value: `<@${userId}> (${userId})`, inline: false },
                                        { name: '**Moderator:**', value: `<@${interaction.user.id}> (${interaction.user.id})`, inline: false },
                                        { name: '**Reason:**', value: reason, inline: false }
                                    ])
                                    .setColor(0xFBE7BD)
                            ]
                        });
                    }
                }
            } catch (e) {}
        } catch (e) {
            logAction({
                commandName: "unban",
                status: "error",
                error: String(e),
                moderator: { id: interaction.user.id, tag: interaction.user.tag },
                user: { id: userId || 'unknown', tag: targetUser ? targetUser.tag : userInput },
                guild: interaction.guildId,
                time: new Date().toISOString()
            });
            await interaction.reply({ content: "Bot doesn't have required perms or unknown error :c", flags: MessageFlags.Ephemeral });
        }
    }
};

