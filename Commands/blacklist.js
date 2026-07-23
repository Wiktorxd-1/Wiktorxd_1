const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const serverSettings = require('../Data/server_settings.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('blacklist')
        .setDescription('Add a string to automod')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(option =>
            option.setName('string')
                .setDescription('String to blacklist')
                .setRequired(true)
        ),

    async execute(interaction) {
        const string = interaction.options.getString('string');
        const guild = interaction.guild;

        if (!guild) {
            await interaction.reply({ content: 'This command can only be used in a server breh' });
            return;
        }

        const ownerId = process.env.BOT_OWNER_ID;
        const settings = serverSettings[guild.id];
        const allowedRoles = settings?.modRoles || [];
        const member = await guild.members.fetch(interaction.user.id);

        const isOwner = interaction.user.id === ownerId;
        const hasAllowedRole = allowedRoles.length > 0 && member.roles.cache.some(r => allowedRoles.includes(r.id));

        if (!isOwner && !hasAllowedRole) {
            await interaction.reply({ content: 'You do not have permission to use this command', flags: MessageFlags.Ephemeral });
            return;
        }

        const rules = await guild.autoModerationRules.fetch();
        let rule = rules.find(r => r.name === 'Blacklist');

        const patterns = [
            string,
            `*${string}`,
            `*${string}*`
        ];

        if (!rule) {
            rule = await guild.autoModerationRules.create({
                name: 'Blacklist',
                eventType: 1,
                triggerType: 1,
                triggerMetadata: { keywordFilter: [] },
                actions: [{ type: 1 }],
                enabled: true,
                reason: 'Created by blacklist command'
            });
        }

        for (const pattern of patterns) {
            if (pattern.length > 58) continue;
            const existing = rule.triggerMetadata.keywordFilter || [];
            if (existing.includes(pattern)) continue;
            try {
                await rule.edit({
                    triggerMetadata: { keywordFilter: [...existing, pattern] }
                });
                rule = await guild.autoModerationRules.fetch(rule.id);
            } catch {}
        }

        await interaction.reply({ content: `Added to automod: \`${string}\`` });
    },
};