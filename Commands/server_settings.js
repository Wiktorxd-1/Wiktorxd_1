const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, ActionRowBuilder, ChannelSelectMenuBuilder, EmbedBuilder, RoleSelectMenuBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

const ServerSettingsFile = path.join(__dirname, '../Data/server_settings.json');

function saveServerSettings(guildId, data) {
    let settings = {};
    try {
        if (fs.existsSync(ServerSettingsFile)) {
            settings = JSON.parse(fs.readFileSync(ServerSettingsFile, 'utf8')) || {};
        }
    } catch (e) {}
    settings[guildId] = { ...settings[guildId], ...data };
    fs.writeFileSync(ServerSettingsFile, JSON.stringify(settings, null, 2));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('server_settings')
        .setDescription('Set server settings')
        .setIntegrationTypes([0])
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub =>
            sub.setName('logchannel')
                .setDescription('Set the logging channel')
        )
        .addSubcommand(sub =>
            sub.setName('addmodrole')
                .setDescription('Add a moderator role')
        ),

    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: "You need **Administrator** permissions to run this command.", flags: 64 });
        }

        const sub = interaction.options.getSubcommand();

        if (sub === 'logchannel') {
            const selectMenu = new ChannelSelectMenuBuilder()
                .setCustomId('select_log_channel')
                .setPlaceholder('Choose a logging channel')
                .setChannelTypes(ChannelType.GuildText)
                .setMinValues(1)
                .setMaxValues(1);

            const row = new ActionRowBuilder().addComponents(selectMenu);

            await interaction.reply({
                content: 'Choose a logging channel:',
                components: [row],
                flags: 64
            });

            const collector = interaction.channel.createMessageComponentCollector({
                filter: i => i.user.id === interaction.user.id && i.customId === 'select_log_channel',
                time: 60_000,
                max: 1
            });

            collector.on('collect', async i => {
                const selectedChannelId = i.values[0];
                saveServerSettings(interaction.guildId, { logChannel: selectedChannelId });
                await i.update({
                    components: [],
                    embeds: [
                        new EmbedBuilder()
                            .setTitle("Server Settings Updated")
                            .setDescription(`Logging channel set to <#${selectedChannelId}>`)
                            .setColor(0xFBE7BD)
                    ]
                });
            });

            collector.on('end', collected => {
                if (collected.size === 0) {
                    interaction.editReply({ content: "No channel selected. Setup cancelled.", components: [] });
                }
            });
        } else if (sub === 'addmodrole') {
            const selectMenu = new RoleSelectMenuBuilder()
                .setCustomId('select_mod_role')
                .setPlaceholder('Choose a moderator role')
                .setMinValues(1)
                .setMaxValues(1);

            const row = new ActionRowBuilder().addComponents(selectMenu);

            await interaction.reply({
                content: 'Choose a moderator role to add:',
                components: [row],
                flags: 64
            });

            const collector = interaction.channel.createMessageComponentCollector({
                filter: i => i.user.id === interaction.user.id && i.customId === 'select_mod_role',
                time: 60_000,
                max: 1
            });

            collector.on('collect', async i => {
                const selectedRoleId = i.values[0];
                let settings = {};
                try {
                    if (fs.existsSync(ServerSettingsFile)) {
                        settings = JSON.parse(fs.readFileSync(ServerSettingsFile, 'utf8')) || {};
                    }
                } catch (e) {}
                const prevRoles = Array.isArray(settings[interaction.guildId]?.modRoles) ? settings[interaction.guildId].modRoles : [];
                const newRoles = Array.from(new Set([...prevRoles, selectedRoleId]));
                saveServerSettings(interaction.guildId, { modRoles: newRoles });
                await i.update({
                    components: [],
                    embeds: [
                        new EmbedBuilder()
                            .setTitle("Server Settings Updated")
                            .setDescription(`Added moderator role: <@&${selectedRoleId}>`)
                            .setColor(0xFBE7BD)
                    ]
                });
            });

            collector.on('end', collected => {
                if (collected.size === 0) {
                    interaction.editReply({ content: "No role selected. Setup cancelled.", components: [] });
                }
            });
        }
    }
};