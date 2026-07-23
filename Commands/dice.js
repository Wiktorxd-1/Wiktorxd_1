const { SlashCommandBuilder } = require('discord.js');

function safeEval(expr) {
    if (!/^[\d+\-*/().\s]+$/.test(expr)) throw new Error('Invalid characters in input.');
    return eval(expr);
}

function clampBigInt(n, min, max) {
    if (n < min) return min;
    if (n > max) return max;
    return n;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('dice')
        .setDescription('Roll a dice!')
        .setIntegrationTypes([0, 1])
        .setContexts([0, 1, 2])
        .addStringOption(option =>
            option.setName('min')
                .setDescription('Lowest')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('max')
                .setDescription('Highest')
                .setRequired(false)),
    async execute(interaction) {
        await interaction.reply({ content: '<a:roll:1389311247333458042> Rolling..' });

        let min = 1, max = 6;
        const MinLimit = BigInt('-1000000000');
        const MaxLimit = BigInt('1000000000');

        try {
            if (interaction.options.getString('min') !== null) {
                min = safeEval(interaction.options.getString('min'));
            }
            if (interaction.options.getString('max') !== null) {
                max = safeEval(interaction.options.getString('max'));
            }
            min = BigInt(Math.floor(Number(min)));
            max = BigInt(Math.floor(Number(max)));
            min = clampBigInt(min, MinLimit, MaxLimit);
            max = clampBigInt(max, MinLimit, MaxLimit);
            if (min > max) [min, max] = [max, min];
        } catch (e) {
            return interaction.editReply({ content: 'Wrong input' });
        }

        const range = max - min + 1n;
        if (range <= 0n) {
            return interaction.editReply({ content: 'Invalid range.' });
        }

        function randomBigInt(min, max) {
            const range = max - min + 1n;
            const rand = BigInt(Math.floor(Math.random() * Number(range)));
            return min + rand;
        }

        const result = randomBigInt(min, max);

        setTimeout(() => {
            interaction.editReply({
                content: `<:Dice:1389312575702831205> The number rolled is: **${result.toString()}**! <:Dice:1389312575702831205>`
            });
        }, 50);
    }
};