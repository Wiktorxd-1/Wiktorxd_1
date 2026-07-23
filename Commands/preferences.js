const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const preference = require('../Utility/Hatches/preference');

const ClientId = process.env.DISCORD_CLIENT_ID || process.env.CLIENT_ID || '';


async function trySendDmTest(user, channel, interaction) {
    const embed = new EmbedBuilder()
        .setTitle('Test message')
        .setDescription('Hey this is a test mesage to make sure the bot can dm you when you hatch a secret!')
        .setColor(0xFBE7BD);

    try {
        await user.send({ embeds: [embed] });
        return { ok: true };
    } catch (err) {
        const cantDm = err && err.code === 50007;
        try {
            if (channel && typeof channel.send === 'function') {
                await channel.send(`<@${user.id}> The bot can't DM you, use [this link](https://discord.com/oauth2/authorize?client_id=1235222783592497232) to add the bot to your apps, it will allow the bot to DM you! (Select add to my apps, and authorize) Try again after doing this!`);
            } else {
                await interaction.followUp({ content: `The bot can't DM you. Please ensure your DMs are open or/and add the bot: https://discord.com/oauth2/authorize?client_id=1235222783592497232`});
            }
        } catch (e) {
        }

        if (cantDm) {
            console.log(`${user.tag || user.id} can't be dmd`);
        } else {
            console.error(err);
        }

        return { ok: false, error: err };
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('preferences')
        .setDescription('Configure how you receive hatch notifications'),

    async execute(interaction) {
        await interaction.deferReply();

        const embed = new EmbedBuilder()
            .setTitle('Preferences')
            .setDescription('Here you can choose how you\'ll get pinged, There are 2 options right now, Use the dropdown menu to select one option & get more info')
            .setColor(0xFBE7BD);

        const select = new StringSelectMenuBuilder()
            .setCustomId('pref_select')
            .setPlaceholder('Choose a preference...')
            .addOptions([
                {
                    label: 'DMs',
                    description: 'Get a DM from the bot when you hatch something!',
                    value: 'dm',
                    emoji: '📩'
                },
                {
                    label: 'Hatches channel',
                    description: 'Get pinged in Bubbler News when you hatch something!',
                    value: 'hatches',
                    emoji: '📣'
                },
                {
                    label: 'Choose a channel',
                    description: 'Coming Soon!!! (or at some point)',
                    value: 'choose',
                    emoji: '❓'
                }
            ]);

        const row = new ActionRowBuilder().addComponents(select);

        const reply = await interaction.editReply({ embeds: [embed], components: [row] });

        try {
            const filter = i => i.user.id === interaction.user.id && i.customId === 'pref_select';
            const selection = await reply.awaitMessageComponent({ filter, time: 60000 });
            const choice = selection.values[0];

            if (choice === 'hatches') {
                await preference.setPreference({ discordId: interaction.user.id, type: 0, messageType: 2 });
                await selection.update({ content: 'Saved preference: Hatches channel', embeds: [], components: [] });
                return;
            }

            const formatEmbed = new EmbedBuilder().setTitle('What format would you like?').setDescription('Choose one of the options below:').setColor(0xFBE7BD);
            const formatRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('fmt_bgs').setLabel('BGS Bot').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('fmt_this').setLabel('This bot').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('fmt_preview').setLabel('Show preview').setStyle(ButtonStyle.Primary)
            );

            await selection.update({ embeds: [formatEmbed], components: [formatRow] });

            try {
                const fmtFilter = i => i.user.id === interaction.user.id && ['fmt_bgs', 'fmt_this', 'fmt_preview'].includes(i.customId);
                const fmt = await selection.message.awaitMessageComponent({ filter: fmtFilter, time: 60000 });

                if (fmt.customId === 'fmt_preview') {
                    const bgsEmbed = new EmbedBuilder()
                        .setTitle('The Overlord')
                        .setDescription("**Total Hatched:** `1`\nThe rarity of hatching this pet is **1/50,000,000**\n\n(dm the bot /verify to display your name)")
                        .setAuthor({ name: 'New Secret Pet hatched!' })
                        .setThumbnail('https://cdn.discordapp.com/attachments/791552625866833960/1360399805364310056/pet.png')
                        .setTimestamp(new Date('2025-04-11T23:43:08.492000+00:00'));

                    const previewTime = Math.floor(new Date('2025-04-11T23:43:08.588000+00:00').getTime() / 1000);
                    const thisEmbed = new EmbedBuilder()
                        .setTitle('The Overlord')
                        .setDescription(
                            `<:user:1383493798138478732> **Hatched by:** Wiktor (@schiedamwikto)\n` +
                            `<:luck:1383493796876259379> **Exists:** 1\n` +
                            `<:paw:1383493795152265297> **Rarity:** 1/50,000,000\n` +
                            `<:clock:1383493793772208221> **Time:** <t:${previewTime}:R>`
                        )
                        .setThumbnail('https://cdn.discordapp.com/attachments/791552625866833960/1360399805364310056/pet.png')
                        .setColor(0xFBE7BD)
                        .setTimestamp(new Date('2025-04-11T23:43:08.588000+00:00'));

                    const previews = [
                        { embed: bgsEmbed },
                        { embed: thisEmbed }
                    ];

                    let idx = 0;
                    const makePreviewRow = (i) => {
                        const components = [];
                        if (i > 0) components.push(new ButtonBuilder().setCustomId('prev').setLabel('Previous').setStyle(ButtonStyle.Secondary));
                        if (i < previews.length - 1) components.push(new ButtonBuilder().setCustomId('next').setLabel('Next').setStyle(ButtonStyle.Secondary));
                        components.push(new ButtonBuilder().setCustomId('choose').setLabel('Choose').setStyle(ButtonStyle.Primary));
                        components.push(new ButtonBuilder().setCustomId('cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary));
                        return new ActionRowBuilder().addComponents(...components);
                    };

                    await fmt.update({ embeds: [previews[idx].embed], components: [makePreviewRow(idx)] });
                    const previewMsg = await fmt.fetchReply();

                    while (true) {
                        try {
                            const pFilter = i => i.user.id === interaction.user.id && ['prev', 'next', 'choose', 'cancel'].includes(i.customId);
                            const p = await previewMsg.awaitMessageComponent({ filter: pFilter, time: 60000 });
                            if (p.customId === 'prev') {
                                idx = Math.max(0, idx - 1);
                                await p.update({ embeds: [previews[idx].embed], components: [makePreviewRow(idx)] });
                                continue;
                            }
                            if (p.customId === 'next') {
                                idx = Math.min(previews.length - 1, idx + 1);
                                await p.update({ embeds: [previews[idx].embed], components: [makePreviewRow(idx)] });
                                continue;
                            }
                            if (p.customId === 'cancel') {
                                await p.update({ content: 'Cancelled preview.', embeds: [], components: [] });
                                break;
                            }
                                if (p.customId === 'choose') {
                                const chosenMessageType = idx === 0 ? 1 : 2;
                                if (choice === 'dm') {
                                    await preference.setPreference({ discordId: interaction.user.id, type: 1, messageType: chosenMessageType });
                                    try {
                                        await trySendDmTest(interaction.user, interaction.channel, interaction);
                                        await p.update({ content: `Saved preference: DMs (message type ${chosenMessageType}) — sending test DM...`, embeds: [], components: [] });
                                    } catch (e) {
                                        await p.update({ content: `Saved preference: DMs (message type ${chosenMessageType}) — couldn't DM you`, embeds: [], components: [] });
                                    }
                                } else if (choice === 'hatches') {
                                    await preference.setPreference({ discordId: interaction.user.id, type: 0, messageType: chosenMessageType });
                                    await p.update({ content: 'Saved preference: Hatches channel', embeds: [], components: [] });
                                } else {
                                    await p.update({ content: 'Saved preference.', embeds: [], components: [] });
                                }
                                break;
                            }
                        } catch (err) {
                            try { await previewMsg.edit({ content: 'Timed out during preview.', embeds: [], components: [] }); } catch {};
                            break;
                        }
                    }
                    return;
                }


                const chosenType = fmt.customId === 'fmt_bgs' ? 1 : 2;
                if (choice === 'dm') {
                    await preference.setPreference({ discordId: interaction.user.id, type: 1, messageType: chosenType });
                    try {
                        await trySendDmTest(interaction.user, interaction.channel, interaction);
                        await fmt.update({ content: `Saved preference: DMs (message type ${chosenType}) — test DM sent.`, embeds: [], components: [] });
                    } catch (e) {
                        await fmt.update({ content: `The bot can't DM you, make sure your DMs are open or/and add the bot: https://discord.com/oauth2/authorize?client_id=1235222783592497232 `, embeds: [], components: [] });
                    }
                } else {
                    await fmt.update({ content: 'Saved preference.', embeds: [], components: [] });
                }
                return;
            } catch (e) {
                try { await interaction.editReply({ content: 'Timed out waiting for format selection.', embeds: [], components: []}); } catch {};
                return;
            }
        } catch (e) {
            try { await interaction.editReply({ content: 'No selection made, cancelled.', components: [], embeds: [] }); } catch {};
            return;
        }
    }
};
