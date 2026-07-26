const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const fsPromises = require('fs').promises;
const fs = require('fs');
const path = require('path');
const readline = require('readline');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('hatches')
        .setDescription('Find secret hatches for someone')
        .setIntegrationTypes([0, 1])
        .setContexts([0, 1, 2])
        .addUserOption(option =>
            option.setName('discord')
                .setDescription('discord user')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('username')
                .setDescription('roblox username')
                .setRequired(false)),

    async execute(interaction) {
        const discordUserOption = interaction.options.getUser('discord');
        const robloxUsernameOption = interaction.options.getString('username');
        const secretsPath = path.join(__dirname, '..', 'Data', 'secrets.ndjson');
        const earlierSecretsPath = path.join(__dirname, '..', 'Data', 'earlier_secrets.json');

        await interaction.deferReply();

        let searchDiscordId = null;
        let searchRobloxUsername = null;

        if (robloxUsernameOption) {
            searchRobloxUsername = robloxUsernameOption.toLowerCase();
        } else if (discordUserOption) {
            searchDiscordId = discordUserOption.id;
        } else {
            searchDiscordId = interaction.user.id;
        }

        const getEarlierSecretEntry = async () => {
            try {
                const data = await fsPromises.readFile(earlierSecretsPath, 'utf8');
                const entries = JSON.parse(data);
                if (searchRobloxUsername) {
                    return entries.find(e => e.username && e.username.toLowerCase() === searchRobloxUsername);
                }
                if (searchDiscordId) {
                    return entries.find(e => e.discordId === searchDiscordId);
                }
            } catch (error) {
                if (error.code !== 'ENOENT') console.error('Error reading earlier_secrets.json', error);
                return null;
            }
            return null;
        };

        const earlierSecretEntry = await getEarlierSecretEntry();
        const cachedTotal = earlierSecretEntry?.amount || null;

        if (!searchRobloxUsername && earlierSecretEntry?.username) {
            searchRobloxUsername = earlierSecretEntry.username.toLowerCase();
        }

        await interaction.editReply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('Loading')
                    .setDescription('Loading data...')
                    .setColor(0xFBE7BD)
            ]
        });

        const matchingHatchesRaw = await require('../Utility/Hatches/secrets').searchSecretsDB(searchDiscordId, searchRobloxUsername);
        let matchingHatches = matchingHatchesRaw.reverse();

        if (matchingHatches.length === 0) {
            if (cachedTotal && cachedTotal > 0) {
                return interaction.editReply({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('Not found')
                            .setDescription('Could not find any hatches for this user, even though they were in the cache. The cache might be outdated.')
                            .setColor(0xFBE7BD),
                    ],
                });
            }

            let notFoundMessage =
                'No one was found in the database. The person may not have been verified when they hatched it, or you typed the wrong username';
            if (searchDiscordId && !robloxUsernameOption) {
                notFoundMessage = 'No hatches found for the discord account';
            } else if (searchRobloxUsername && !discordUserOption && robloxUsernameOption) {
                notFoundMessage = `No hatches found for "${robloxUsernameOption}"`;
            }

            return interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('Not found')
                        .setDescription(notFoundMessage)
                        .setColor(0xFBE7BD),
                ],
            });
        }

        let currentIndex = 0;

        const generateEmbed = (idx) => {
            const hatchData = matchingHatches[idx];

            if (!hatchData || typeof hatchData !== 'object') {
                console.error('Invalid hatchData at index:', idx, hatchData);
                return new EmbedBuilder()
                    .setTitle('Error Displaying Data')
                    .setDescription('An unexpected error occurred while preparing this hatch record for display.')
                    .setColor(0xFF0000);
            }

            const unixTimestamp = Math.floor(new Date(hatchData.timestamp).getTime() / 1000);
            return new EmbedBuilder()
                .setTitle(hatchData.name || 'Unknown Pet')
                .setDescription(
                    `<:user:1385619588703846613> **Hatched by:** ${hatchData.hatchedBy || 'Unknown'}\n` +
                    `<:luck:1385619577496535162> **Exist (when hatched):** ${hatchData.totalHatched || 'Unknown'}\n` +
                    `<:paw:1385619568126464010> **Rarity:** ${hatchData.rarity || 'Unknown'}\n` +
                    `<:clock:1385619558991265863> **Time:** <t:${unixTimestamp}:R>\n\n` +
                    `**Secret ${idx + 1}/${matchingHatches.length}**`
                )
                .setThumbnail(hatchData.imageUrl)
                .setColor(0xFBE7BD)
                .setTimestamp();
        };

        const getActionRow = (currentIdx) => {
            if (matchingHatches.length <= 1) {
                return null;
            }

            return new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('previous_hatch')
                    .setLabel('Previous')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(currentIdx === 0),
                new ButtonBuilder()
                    .setCustomId('next_hatch')
                    .setLabel('Next')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(currentIdx === matchingHatches.length - 1)
            );
        };

        let currentEmbed = generateEmbed(currentIndex);
        let actionRow = getActionRow(currentIndex);

        const replyOptions = {
            embeds: [currentEmbed],
            components: actionRow ? [actionRow] : [],
        };

        const message = await interaction.editReply(replyOptions);

        if (matchingHatches.length > 1) {
            const collector = message.createMessageComponentCollector({ time: 300000 });

            collector.on('collect', async (i) => {
                if (i.user.id !== interaction.user.id) {
                    await i.reply({ content: 'You cannot control this menu.', flags: MessageFlags.Ephemeral }).catch(() => {});
                    return;
                }

                if (i.customId === 'previous_hatch') {
                    currentIndex--;
                } else if (i.customId === 'next_hatch') {
                    currentIndex++;
                }

                currentEmbed = generateEmbed(currentIndex);
                actionRow = getActionRow(currentIndex);

                await i.update({
                    embeds: [currentEmbed],
                    components: actionRow ? [actionRow] : [],
                }).catch(() => {});
            });

            collector.on('end', () => {
                message.edit({ components: [] }).catch(() => {});
            });
        }
    },
};