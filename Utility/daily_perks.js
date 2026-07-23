const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');

const ChannelId = '1396468399202369536';
const MessageIdPath = path.join(__dirname, '..', 'Data', 'IDs', 'daily_perkmsg.txt');

const perksData = [
    {
        day: "Sunday",
        name: "Bubble Day",
        emoji: "<:Bubble:1432763358784000203>",
        thumbnail: "https://static.wikia.nocookie.net/bgs-infinity/images/0/0c/Bubbles.png",
        free: "<:Bubble:1432763358784000203> Blow 25% more Bubbles!\n <:Coins:1432775641434030181> Bubble sell value increased by 30%!",
        premium: "<:Bubble:1432763358784000203> Blow 35% more Bubbles!\n <:Coins:1432775641434030181> Bubble sell value increased by 50%!"
    },
    {
        day: "Monday",
        name: "Minigame Day",
        emoji: "<:Dice_Icon:1432763362240102431>",
        thumbnail: "https://static.wikia.nocookie.net/bgs-infinity/images/a/ad/Dice_Icon.png",
        free: "<:Dice_Small:1432763362240102431> Minigames have +1 extra drops!\n <:Timer:1432775639852777543> Minigames reset 15% faster!",
        premium: "<:Dice_Small:1432763362240102431> Minigames have +2 extra drops!\n <:Timer:1432775639852777543> Minigames reset 30% faster!"
    },
    {
        day: "Tuesday",
        name: "Hatch Day",
        emoji: "<:Shiny:1432763360121983108>",
        thumbnail: "https://static.wikia.nocookie.net/bgs-infinity/images/d/df/Golden_Egg_Icon.png",
        free: "<:Egg:1432776050386927656> Hatch +1 Extra Egg!\n<:Timer:1432775639852777543> Eggs hatch +15% faster!\n <:Big_Rigby:1450884067192078406> Chance for Big Rigby",
        premium: "<:Egg:1432776050386927656> Hatch +1 Extra Egg!\n<:Timer:1432775639852777543> Eggs hatch +30% faster!"
    },
    {
        day: "Wednesday",
        name: "Treasure Day",
        emoji: "<:Golden_Box:1432763355239546947>",
        thumbnail: "https://static.wikia.nocookie.net/bgs-infinity/images/a/a2/Golden_Box.png",
        free: "<:Coins:1432775641434030181> Increases Currency value by +15%!\n<:Timer:1432775639852777543> Chests reset 15% faster!",
        premium: "<:Coins:1432775641434030181> Increases Currency value by +30%!\n<:Timer:1432775639852777543> Chests reset 25% faster!"
    },
    {
        day: "Thursday",
        name: "Shop Day",
        emoji: "<:Shop:1432763353746378822>",
        thumbnail: "https://static.wikia.nocookie.net/bgs-infinity/images/2/2f/Shops_Icon.png",
        free: "<:Coins:1432775641434030181> Shop items are 25% cheaper!\n<:Shop:1432763353746378822> Shops have 50% more stock!",
        premium: "<:Coins:1432775641434030181> Shop items are 50% cheaper!\n<:Shop:1432763353746378822> Shops have 100% more stock!"
    },
    {
        day: "Friday",
        name: "Enchant Day",
        emoji: "<:Enchant:1432763364526002336>",
        thumbnail: "https://static.wikia.nocookie.net/bgs-infinity/images/c/c4/Special_Enchants_Icon.png",
        free: "<:Gems:1432776824601051277> Enchant rolling is 25% cheaper!\n<:Enchant:1432763364526002336> Special Enchants are 20% easier to get!",
        premium: "<:Gems:1432776824601051277> Enchant rolling is 45% cheaper!\n<:Enchant:1432763364526002336> Special Enchants are 35% easier to get!"
    },
    {
        day: "Saturday",
        name: "Luck Day",
        emoji: "<:Luck:1432763356942434334>",
        thumbnail: "https://static.wikia.nocookie.net/bgs-infinity/images/3/39/Luck_Icon.png",
        free: "<:Luck:1432763356942434334> Luck is increased by 100%!\n<:Hermit_Crab:1432777522461806718> Legendary Fish luck 35%!\n<:Rainbow_Clownfish:1432777714753994812> Fish Mutation chance 10%!\n <:Santa_Nert_Plushie:1450884065866813550> Chance for Santa Nert Plushie",
        premium: "<:Luck:1432763356942434334> Luck is increased by 250%!\n<:Hermit_Crab:1432777522461806718> Legendary Fish luck 50%!\n<:Rainbow_Clownfish:1432777714753994812> Fish Mutation chance 35%!"
    }
];

function generatePerkEmbed(dayIndex, isToday = true) {
    const perk = perksData[dayIndex];
    const description = isToday 
        ? `Today is **${perk.day} - ${perk.name}**, and these perks are active:`
        : `Perks for **${perk.day} - ${perk.name}**:`;

    return new EmbedBuilder()
        .setTitle("Daily Perks")
        .setDescription(description)
        .setColor(0x38BEFF)
        .addFields(
            { name: "Free Tier", value: perk.free, inline: true },
            { name: "<:Bubble_Pass:1432778205085044857> Premium", value: perk.premium, inline: true }
        )
        .setThumbnail(perk.thumbnail)
        .setFooter({
            text: "Bubbler News | .gg/MS2xuxEKJ3",
            iconURL: "https://media.discordapp.net/attachments/1369439484659236955/1383514274110115971/3b5268975ace36ff416a836731632c35-removebg-preview-removebg-previeww_1.png"
        })
}

function generateUpcomingPerksDropdown(currentDayIndex) {
    const options = perksData
        .filter((_, index) => index !== currentDayIndex)
        .map((perk, index) => {
            const dayValue = perksData.findIndex(p => p.day === perk.day);
            return {
                label: `${perk.name}`,
                description: `Daily perk for ${perk.day}`,
                value: `daily_perk_${dayValue}`,
                emoji: perk.emoji,
            }
        });

    return new ActionRowBuilder()
        .addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('select_daily_perk')
                .setPlaceholder('View upcoming daily perks...')
                .addOptions(options),
        );
}

async function initializeDailyPerks(client) {
    try {
        const channel = await client.channels.fetch(ChannelId);
        if (!channel) {
            console.error(`[DailyPerks] Channel with ID ${ChannelId} not found.`);
            return;
        }

        let messageId;
        try {
            await fs.mkdir(path.dirname(MessageIdPath), { recursive: true });
            const raw = await fs.readFile(MessageIdPath, 'utf8');
            messageId = raw ? raw.trim() : null;
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            messageId = null;
        }

        const todayIndex = new Date().getUTCDay();
        const embed = generatePerkEmbed(todayIndex, true);
        const dropdown = generateUpcomingPerksDropdown(todayIndex);

        let message;
        if (messageId) {
            try {
                message = await channel.messages.fetch(messageId);
            } catch (error) {
                message = null;
            }
        }

        if (!message) {
            try {
                const messages = await channel.messages.fetch({ limit: 15 });
                message = messages.find(m => m.author.id === client.user.id && m.embeds?.[0]?.title === "Daily Perks");
                if (message) {
                    await fs.mkdir(path.dirname(MessageIdPath), { recursive: true });
                    await fs.writeFile(MessageIdPath, message.id);
                }
            } catch (e) {
                console.error("[DailyPerks] Failed to scan recent messages:", e);
            }
        }

        if (message) {
            try {
                await message.edit({ embeds: [embed], components: [dropdown] });
            } catch (error) {
                message = await channel.send({ embeds: [embed], components: [dropdown] });
                await fs.mkdir(path.dirname(MessageIdPath), { recursive: true });
                await fs.writeFile(MessageIdPath, message.id);
            }
        } else {
            message = await channel.send({ embeds: [embed], components: [dropdown] });
            await fs.mkdir(path.dirname(MessageIdPath), { recursive: true });
            await fs.writeFile(MessageIdPath, message.id);
        }
        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setUTCHours(24, 0, 0, 0);
        // Add 5 seconds offset to ensure we definitely cross midnight before the next run
        const msUntilMidnight = tomorrow.getTime() - now.getTime() + 5000;

        setTimeout(() => initializeDailyPerks(client), msUntilMidnight);

    } catch (error) {
        console.error("[DailyPerks] An error occurred during initialization:", error);
    }
}

async function handleDailyPerkInteraction(interaction) {
    if (!interaction.isStringSelectMenu() || interaction.customId !== 'select_daily_perk') return;

    try {
        const selectedValue = interaction.values[0];
        const dayIndex = parseInt(selectedValue.split('_')[2]);
        if (!isNaN(dayIndex) && dayIndex >= 0 && dayIndex < perksData.length) {
            const embed = generatePerkEmbed(dayIndex, false);
            await interaction.reply({ embeds: [embed], flags: 64 }); 
        }
    } catch (error) {
        console.error('Error handling daily perk selection:', error);
        await interaction.reply({ content: 'There was an error processing your selection.', flags: 64 }).catch(console.error);
    }
}

module.exports = { initializeDailyPerks, generatePerkEmbed, perksData, generateUpcomingPerksDropdown, handleDailyPerkInteraction };
