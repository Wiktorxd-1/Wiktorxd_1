const { SlashCommandBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

const FlagsPath = path.join(__dirname, '../flags.txt');
const OwnerId = '697047593334603837';

function getFlags() {
    if (!fs.existsSync(FlagsPath)) return {};
    const lines = fs.readFileSync(FlagsPath, 'utf8').split('\n').filter(Boolean);
    const flags = {};
    for (const line of lines) {
        const [key, value] = line.split('=');
        if (key && value !== undefined) flags[key.trim()] = value.trim();
    }
    return flags;
}

function setFlag(flag, value) {
    const flags = getFlags();
    const oldValue = flags[flag];
    flags[flag] = value;
    const out = Object.entries(flags).map(([k, v]) => `${k}=${v}`).join('\n');
    fs.writeFileSync(FlagsPath, out);
    return oldValue;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('flags')
        .setDescription('View or edit flags')
        .setIntegrationTypes([0, 1])
        .addStringOption(option =>
            option.setName('flag')
                .setDescription('Flag to edit')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('value')
                .setDescription('Value to set')
                .setRequired(false)
        ),

    async execute(interaction) {
        if (interaction.user.id !== OwnerId) {
            await interaction.reply({ content: 'Nuh uh', flags: 64 });
            return;
        }

        const flag = interaction.options.getString('flag');
        const value = interaction.options.getString('value');
        const flags = getFlags();

        if (!flags.hasOwnProperty(flag)) {
            await interaction.reply({ content: `Flag **${flag}** does not exist`, flags: 64 });
            return;
        }

        if (value === null) {
            await interaction.reply({
                content: `Flag **${flag}** is currently set to **${flags[flag]}**`
            });
            return;
        }

        const oldValue = setFlag(flag, value);
        await interaction.reply({
            content: `flag: **${flag}** has been changed from: **${oldValue}** to **${value}**`
        });
    },
};