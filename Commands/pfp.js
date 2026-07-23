const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const axios = require('axios');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('pfp')
        .setDescription('Show someone\'s pfp')
        .setIntegrationTypes([0, 1])
        .setContexts([0, 1, 2])
        .addUserOption(option =>
            option.setName('target')
                .setDescription('Target')
                .setRequired(false)
        )
        .addBooleanOption(option =>
            option.setName('server')
                .setDescription('show server pfp')
                .setRequired(false)
        ),

    async execute(interaction) {
        const targetUserOption = interaction.options.getUser('target');
        const showServerPfp = interaction.options.getBoolean('server') || false;

        let user, member, pfpBaseURL, pfpURLToDisplay, username, displayName, userId;

        if (targetUserOption) {
            user = targetUserOption;
            userId = user.id;
            if (interaction.guild) {
                try { member = await interaction.guild.members.fetch(userId); } catch { member = null; }
            }
        }

        

        if (!user) {
            user = interaction.user;
            member = interaction.member;
        }

        if (!pfpURLToDisplay) {
            username = user.username;
            displayName = member?.displayName || user.globalName || user.username;
            if (showServerPfp && member && member.avatar) {
                pfpBaseURL = member.displayAvatarURL({ dynamic: true, size: 4096 }).split('?')[0];
                pfpURLToDisplay = `${pfpBaseURL}?size=256`;
            } else if (user.displayAvatarURL) {
                pfpBaseURL = user.displayAvatarURL({ dynamic: true, size: 4096 }).split('?')[0];
                pfpURLToDisplay = `${pfpBaseURL}?size=256`;
            } else {
                pfpBaseURL = null;
                pfpURLToDisplay = null;
            }
        }

        
        if (!pfpURLToDisplay) {
            userId = userId || (user && user.id);
            if (userId) {
                try {
                    const apiRes = await axios.get(`https://discordpfp.vercel.app/api/json?id=${encodeURIComponent(userId)}`);
                    const apiData = apiRes.data;
                    if (apiData && apiData.success === true && apiData.avatar_url) {
                        pfpBaseURL = apiData.avatar_url.split('?')[0];
                        pfpURLToDisplay = `${pfpBaseURL}?size=256`;
                    }
                } catch (e) {
                }
            }
        }

        if (!pfpURLToDisplay) {
            return interaction.reply({ content: 'Could not resolve pfp for the given input.', flags: 64 });
        }

        const initialPfpEmbed = new EmbedBuilder()
            .setColor(0xFBE7BD)
            .setTitle(`${displayName || username}'s profile pic`)
            .setImage(pfpURLToDisplay)
            .setTimestamp();

        const showSizesPfpButton = new ButtonBuilder()
            .setCustomId('pfp_show_sizes')
            .setLabel('Show Sizes')
            .setStyle(ButtonStyle.Primary);

        const initialPfpActionRow = new ActionRowBuilder()
            .addComponents(showSizesPfpButton);

        await interaction.reply({
            embeds: [initialPfpEmbed],
            components: [initialPfpActionRow]
        });
        let replyMessage;
        try {
            replyMessage = await interaction.fetchReply();
        } catch (error) {
            console.error('Failed to fetch reply:', error.message);
            return;
        }

        const showSizesPfpCollector = replyMessage.createMessageComponentCollector({
            filter: i => i.user.id === interaction.user.id && i.customId === 'pfp_show_sizes',
            time: 180000,
            max: 1
        });

        showSizesPfpCollector.on('collect', async pfpButtonInteraction => {
            const sizePfpButtonsRow1 = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setCustomId('pfp_size_64').setLabel('64x64').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('pfp_size_128').setLabel('128x128').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('pfp_size_256').setLabel('256x256').setStyle(ButtonStyle.Secondary)
                );

            const sizePfpButtonsRow2 = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setURL(`${pfpBaseURL}?size=512`).setLabel('512x512').setStyle(ButtonStyle.Link),
                    new ButtonBuilder().setURL(`${pfpBaseURL}?size=1024`).setLabel('1024x1024').setStyle(ButtonStyle.Link),
                    new ButtonBuilder().setURL(`${pfpBaseURL}?size=2048`).setLabel('2048x2048').setStyle(ButtonStyle.Link)
                );

            await pfpButtonInteraction.update({
                embeds: [initialPfpEmbed],
                components: [sizePfpButtonsRow1, sizePfpButtonsRow2]
            });

            const sizeChooserPfpCollector = replyMessage.createMessageComponentCollector({
                filter: i => i.user.id === interaction.user.id && i.customId.startsWith('pfp_size_'),
                time: 175000,
            });

            sizeChooserPfpCollector.on('collect', async sizePfpButtonInteraction => {
                const selectedPfpSize = sizePfpButtonInteraction.customId.split('_')[2];
                const newPfpURL = `${pfpBaseURL}?size=${selectedPfpSize}`;

                const updatedPfpEmbed = new EmbedBuilder()
                    .setColor(0xFBE7BD)
                    .setTitle(`${displayName || username}'s profile pic`)
                    .setImage(newPfpURL)
                    .setTimestamp();

                await sizePfpButtonInteraction.update({
                    embeds: [updatedPfpEmbed],
                    components: [sizePfpButtonsRow1, sizePfpButtonsRow2]
                });
            });

            sizeChooserPfpCollector.on('end', async (collected, reason) => {
                if (reason === 'time') {
                    const pfpMessageToEdit = await interaction.fetchReply();
                    const currentRows = pfpMessageToEdit.components;
                    if (currentRows && currentRows.length > 0) {
                        const disabledPfpRows = currentRows.map(row => {
                            return new ActionRowBuilder().addComponents(
                                row.components.map(button => {
                                    const btn = ButtonBuilder.from(button);
                                    btn.setDisabled(true);
                                    return btn;
                                })
                            );
                        });
                        await interaction.editReply({ components: disabledPfpRows });
                    }
                }
            });
        });

        showSizesPfpCollector.on('end', async (collected, reason) => {
            if (reason === 'time' && collected.size === 0) {
                const expiredButtonRow = new ActionRowBuilder().addComponents(
                    showSizesPfpButton.setDisabled(true)
                );
                const pfpMessageToEdit = await interaction.fetchReply();
                await interaction.editReply({ components: [expiredButtonRow] });
            }
        });
    },
};