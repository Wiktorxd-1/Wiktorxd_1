const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const path = require('path');
const ms = require('ms');

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

function humanizeMs(input) {
    const val = ms(input);
    if (!val) return input;
    let remaining = val;
    const units = [
        { label: 'day', ms: 86400000 },
        { label: 'hour', ms: 3600000 },
        { label: 'minute', ms: 60000 },
        { label: 'second', ms: 1000 }
    ];
    const parts = [];
    for (const { label, ms } of units) {
        if (remaining >= ms) {
            const count = Math.floor(remaining / ms);
            remaining -= count * ms;
            parts.push(`${count} ${label}${count !== 1 ? 's' : ''}`);
        }
    }
    if (parts.length === 0) return `${val} ms`;
    return parts.join(' and ');
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
        .setName('mute')
        .setDescription('Mute someone')
        .setIntegrationTypes([0])
        .addUserOption(option =>
            option.setName('member')
                .setDescription('Who?')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('time')
                .setDescription('Mute duration')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for mute')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async execute(interaction) {
        if (interaction.guild && !isMod(interaction)) {
            return interaction.reply({ content: "You need to be an admin or have a moderator role to run this command", flags: 64 });
        }

        const targetUser = interaction.options.getUser('member');
        const timeInput = interaction.options.getString('time');
        const reason = interaction.options.getString('reason') || 'No reason provided';

        const duration = ms(timeInput);
        if (!duration || duration < 1000) {
            return interaction.reply({ content: "Invalid time format. Use formats like `1h`, `30sec`, `3day`.", flags: 64 });
        }

        if (!targetUser) {
            return interaction.reply({ content: "Could not find the specified user.", flags: 64 });
        }
        let member = null;
        try { member = await interaction.guild.members.fetch(targetUser.id); } catch { member = null; }
        if (!member) return interaction.reply({ content: "Could not find the specified user.", flags: 64 });

        try {
            await member.timeout(duration, reason);
            await interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle("Muted")
                        .setDescription(`User ${member.user.tag} has been muted for **${humanizeMs(timeInput)}**!`)
                        .setColor(0xFBE7BD)
                ]
            });


            logAction({
                commandName: 'mute',
                status: 'success',
                user: { tag: member.user.tag, id: member.user.id },
                moderator: { tag: interaction.user.tag, id: interaction.user.id },
                reason,
                duration: humanizeMs(timeInput),
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
                                    .setTitle("Mute")
                                    .addFields([
                                        { name: '**User:**', value: `<@${member.user.id}> (${member.user.id})`, inline: false },
                                        { name: '**Moderator:**', value: `<@${interaction.user.id}> (${interaction.user.id})`, inline: false },
                                        { name: '**Reason:**', value: reason, inline: false },
                                        { name: '**Duration:**', value: `**${humanizeMs(timeInput)}**`, inline: false }
                                    ])
                                    .setColor(0xFBE7BD)
                            ]
                        });
                    }
                }
            } catch (e) {}
        } catch (e) {
            logAction({
                commandName: "mute",
                status: "error",
                error: String(e),
                moderator: { id: interaction.user.id, tag: interaction.user.tag },
                user: member ? { tag: member.user.tag, id: member.user.id } : (targetUser ? { tag: targetUser.tag, id: targetUser.id } : null),
                guild: interaction.guildId,
                time: new Date().toISOString()
            });
            await interaction.reply({ content: "Bot doesn't have required perms or unknown error :c", flags: 64 });
        }
    }
};