const { SlashCommandBuilder } = require('discord.js');

function safeEval(expr) {
    if (typeof expr !== 'string') throw new Error('Invalid input');
    const s = expr.trim();
    if (!s || s.length > 50) throw new Error('Invalid length');
    const tokens = s.match(/\d+(?:\.\d+)?|[+\-*/()]/g);
    if (!tokens) throw new Error('Invalid characters');
    if (tokens.join('').replace(/\s+/g, '') !== s.replace(/\s+/g, '')) throw new Error('Invalid characters');
    let pos = 0;

    function consume(expected) {
        if (tokens[pos] === expected) {
            pos++;
            return true;
        }
        return false;
    }

    function parseFactor() {
        if (consume('(')) {
            const val = parseExpr();
            if (!consume(')')) throw new Error();
            return val;
        }
        if (consume('-')) return -parseFactor();
        if (consume('+')) return parseFactor();
        const tok = tokens[pos++];
        const num = parseFloat(tok);
        if (isNaN(num)) throw new Error();
        return num;
    }

    function parseTerm() {
        let val = parseFactor();
        while (pos < tokens.length) {
            if (consume('*')) val *= parseFactor();
            else if (consume('/')) {
                const denom = parseFactor();
                if (denom === 0) throw new Error();
                val /= denom;
            } else break;
        }
        return val;
    }

    function parseExpr() {
        let val = parseTerm();
        while (pos < tokens.length) {
            if (consume('+')) val += parseTerm();
            else if (consume('-')) val -= parseTerm();
            else break;
        }
        return val;
    }

    const res = parseExpr();
    if (pos !== tokens.length || !isFinite(res)) throw new Error('Invalid expression');
    return res;
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
            return interaction.reply({ content: 'Wrong input', flags: 64 });
        }

        const range = max - min + 1n;
        if (range <= 0n) {
            return interaction.reply({ content: 'Invalid range.', flags: 64 });
        }

        function randomBigInt(min, max) {
            const range = max - min + 1n;
            const rand = BigInt(Math.floor(Math.random() * Number(range)));
            return min + rand;
        }

        const result = randomBigInt(min, max);
        await interaction.reply({
            content: `<:Dice:1389312575702831205> The number rolled is: **${result.toString()}**! <:Dice:1389312575702831205>`
        });
    }
};
