const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const https = require('https');

const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 25 });

const CURRENCIES = [
    { code: 'USD', name: 'US Dollar', symbol: '$' },
    { code: 'EUR', name: 'Euro', symbol: '€' },
    { code: 'GBP', name: 'British Pound', symbol: '£' },
    { code: 'PLN', name: 'Polish Zloty', symbol: 'zł' },
    { code: 'JPY', name: 'Japanese Yen', symbol: '¥' },
    { code: 'CAD', name: 'Canadian Dollar', symbol: 'CA$' },
    { code: 'AUD', name: 'Australian Dollar', symbol: 'A$' },
    { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF' },
    { code: 'CNY', name: 'Chinese Yuan', symbol: '¥' },
    { code: 'INR', name: 'Indian Rupee', symbol: '₹' },
    { code: 'BTC', name: 'Bitcoin', symbol: '₿' },
    { code: 'ETH', name: 'Ethereum', symbol: 'Ξ' },
    { code: 'SOL', name: 'Solana', symbol: 'SOL' },
    { code: 'BRL', name: 'Brazilian Real', symbol: 'R$' },
    { code: 'MXN', name: 'Mexican Peso', symbol: '$' },
    { code: 'KRW', name: 'South Korean Won', symbol: '₩' },
    { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$' },
    { code: 'NZD', name: 'New Zealand Dollar', symbol: 'NZ$' },
    { code: 'HKD', name: 'Hong Kong Dollar', symbol: 'HK$' },
    { code: 'SEK', name: 'Swedish Krona', symbol: 'kr' },
    { code: 'NOK', name: 'Norwegian Krone', symbol: 'kr' },
    { code: 'DKK', name: 'Danish Krone', symbol: 'kr' },
    { code: 'TRY', name: 'Turkish Lira', symbol: '₺' },
    { code: 'ZAR', name: 'South African Rand', symbol: 'R' },
    { code: 'AED', name: 'UAE Dirham', symbol: 'AED' },
    { code: 'SAR', name: 'Saudi Riyal', symbol: 'SAR' },
    { code: 'THB', name: 'Thai Baht', symbol: '฿' },
    { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp' },
    { code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM' },
    { code: 'PHP', name: 'Philippine Peso', symbol: '₱' },
    { code: 'CZK', name: 'Czech Koruna', symbol: 'Kč' },
    { code: 'HUF', name: 'Hungarian Forint', symbol: 'Ft' },
    { code: 'ILS', name: 'Israeli New Shekel', symbol: '₪' },
    { code: 'CLP', name: 'Chilean Peso', symbol: '$' },
    { code: 'ARS', name: 'Argentine Peso', symbol: '$' },
    { code: 'COP', name: 'Colombian Peso', symbol: '$' },
    { code: 'UAH', name: 'Ukrainian Hryvnia', symbol: '₴' },
    { code: 'VND', name: 'Vietnamese Dong', symbol: '₫' },
    { code: 'EGP', name: 'Egyptian Pound', symbol: 'E£' },
    { code: 'NGN', name: 'Nigerian Naira', symbol: '₦' },
    { code: 'KWD', name: 'Kuwaiti Dinar', symbol: 'KD' },
    { code: 'QAR', name: 'Qatari Riyal', symbol: 'QR' },
    { code: 'RON', name: 'Romanian Leu', symbol: 'lei' },
    { code: 'BGN', name: 'Bulgarian Lev', symbol: 'лв' },
    { code: 'ISK', name: 'Icelandic Krona', symbol: 'kr' },
    { code: 'PKR', name: 'Pakistani Rupee', symbol: '₨' },
    { code: 'BDT', name: 'Bangladeshi Taka', symbol: '৳' },
    { code: 'TWD', name: 'New Taiwan Dollar', symbol: 'NT$' },
    { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh' },
    { code: 'PEN', name: 'Peruvian Sol', symbol: 'S/' },
    { code: 'MAD', name: 'Moroccan Dirham', symbol: 'MAD' },
    { code: 'OMR', name: 'Omani Rial', symbol: 'OMR' },
    { code: 'JOD', name: 'Jordanian Dinar', symbol: 'JD' },
    { code: 'BHD', name: 'Bahraini Dinar', symbol: 'BD' },
    { code: 'XRP', name: 'Ripple', symbol: 'XRP' },
    { code: 'DOGE', name: 'Dogecoin', symbol: 'Ð' },
    { code: 'ADA', name: 'Cardano', symbol: 'ADA' },
    { code: 'BNB', name: 'BNB', symbol: 'BNB' },
    { code: 'USDT', name: 'Tether USD', symbol: 'USDT' },
    { code: 'USDC', name: 'USD Coin', symbol: 'USDC' },
    { code: 'AVAX', name: 'Avalanche', symbol: 'AVAX' },
    { code: 'DOT', name: 'Polkadot', symbol: 'DOT' },
    { code: 'LTC', name: 'Litecoin', symbol: 'Ł' },
    { code: 'LINK', name: 'Chainlink', symbol: 'LINK' }
];

function formatNumber(num) {
    if (!Number.isFinite(num)) return '0';
    if (num >= 1) {
        return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    } else if (num >= 0.0001) {
        return num.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 });
    } else {
        return num.toLocaleString('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 8 });
    }
}

async function fetchDirectRate(from, to) {
    try {
        const url = `https://www.google.com/finance/quote/${encodeURIComponent(from)}-${encodeURIComponent(to)}`;
        const res = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9'
            },
            httpsAgent,
            timeout: 6000,
            validateStatus: status => status === 200
        });

        const escapedFrom = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const escapedTo = to.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        const regex1 = new RegExp(`"(?:[^"]*?\\()?${escapedFrom}\\s*\\/\\s*${escapedTo}\\)?",\\s*\\d+,\\s*null,\\s*\\[([0-9.]+)`, 'i');
        const match1 = res.data.match(regex1);
        if (match1 && !isNaN(Number(match1[1]))) return Number(match1[1]);

        const regex2 = new RegExp(`"${escapedFrom}-${escapedTo}","[^"]+",\\s*([0-9.]+)`, 'i');
        const match2 = res.data.match(regex2);
        if (match2 && !isNaN(Number(match2[1]))) return Number(match2[1]);

        const regex3 = new RegExp(`\\[\\s*([0-9.]+)\\s*,[^,\\]]*,[^,\\]]*,\\d+,\\d+,\\d+\\s*\\][^\\]]*?"${escapedFrom}-${escapedTo}"`, 'i');
        const match3 = res.data.match(regex3);
        if (match3 && !isNaN(Number(match3[1]))) return Number(match3[1]);

        const regex4 = new RegExp(`data-last-price="([0-9.]+)"`, 'i');
        const match4 = res.data.match(regex4);
        if (match4 && !isNaN(Number(match4[1]))) return Number(match4[1]);

        return null;
    } catch {
        return null;
    }
}

async function fetchExchangeRate(from, to) {
    if (from === to) return 1;
    const directRate = await fetchDirectRate(from, to);
    if (directRate !== null) return directRate;
    const inverseRate = await fetchDirectRate(to, from);
    if (inverseRate !== null && inverseRate > 0) return 1 / inverseRate;
    return null;
}

const data = new SlashCommandBuilder()
    .setName('exchange')
    .setDescription('Convert currency exchange rates using Google Finance')
    .addStringOption(option =>
        option.setName('from')
            .setDescription('Currency to convert from (e.g. USD, EUR, BTC)')
            .setRequired(true)
            .setAutocomplete(true)
    )
    .addStringOption(option =>
        option.setName('to')
            .setDescription('Currency to convert to (e.g. EUR, PLN, USD)')
            .setRequired(true)
            .setAutocomplete(true)
    )
    .addNumberOption(option =>
        option.setName('amount')
            .setDescription('Amount of currency to convert (default: 1)')
            .setRequired(false)
            .setMinValue(0.00000001)
    );

module.exports = {
    data,
    async autocomplete(interaction) {
        try {
            const rawFocused = interaction.options.getFocused();
            const query = (typeof rawFocused === 'string' ? rawFocused : (rawFocused && rawFocused.value) || '').trim().toLowerCase();

            if (!query) {
                return interaction.respond(
                    CURRENCIES.slice(0, 25).map(c => ({
                        name: `${c.code} - ${c.name}${c.symbol ? ` (${c.symbol})` : ''}`.slice(0, 100),
                        value: c.code
                    }))
                );
            }

            const filtered = CURRENCIES.filter(c =>
                c.code.toLowerCase().includes(query) ||
                c.name.toLowerCase().includes(query)
            );

            filtered.sort((a, b) => {
                const aStarts = a.code.toLowerCase().startsWith(query);
                const bStarts = b.code.toLowerCase().startsWith(query);
                if (aStarts && !bStarts) return -1;
                if (!aStarts && bStarts) return 1;
                return a.code.localeCompare(b.code);
            });

            await interaction.respond(
                filtered.slice(0, 25).map(c => ({
                    name: `${c.code} - ${c.name}${c.symbol ? ` (${c.symbol})` : ''}`.slice(0, 100),
                    value: c.code
                }))
            );
        } catch {}
    },
    async execute(interaction) {
        await interaction.deferReply();

        const from = (interaction.options.getString('from') || '').trim().toUpperCase();
        const to = (interaction.options.getString('to') || '').trim().toUpperCase();
        const amount = interaction.options.getNumber('amount') ?? 1;

        if (!from || !to) {
            return interaction.editReply({ content: '❌ Please specify both source and target currency codes.' });
        }

        if (amount <= 0) {
            return interaction.editReply({ content: '❌ Amount must be a positive number greater than 0.' });
        }

        const rate = await fetchExchangeRate(from, to);
        if (rate === null) {
            return interaction.editReply({
                content: `❌ Could not retrieve exchange rate for **${from}** to **${to}** from Google Finance. Please verify the currency symbols.`
            });
        }

        const total = amount * rate;
        const inverse = 1 / rate;

        const embed = new EmbedBuilder()
            .setColor(0x1A73E8)
            .setAuthor({
                name: 'Google Finance • Currency Exchange',
                iconURL: 'https://ssl.gstatic.com/finance/favicon/finance_496x496.png',
                url: `https://www.google.com/finance/quote/${encodeURIComponent(from)}-${encodeURIComponent(to)}`
            })
            .setTitle(`${from} to ${to} Exchange Rate`)
            .setURL(`https://www.google.com/finance/quote/${encodeURIComponent(from)}-${encodeURIComponent(to)}`)
            .setDescription(`## ${formatNumber(amount)} ${from} = ${formatNumber(total)} ${to}`)
            .addFields(
                { name: `1 ${from}`, value: `${formatNumber(rate)} ${to}`, inline: true },
                { name: `1 ${to}`, value: `${formatNumber(inverse)} ${from}`, inline: true }
            )
            .setFooter({
                text: 'Google Finance • Real-time Quotes',
                iconURL: 'https://ssl.gstatic.com/finance/favicon/finance_496x496.png'
            })
            .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
    },
    prefixData: {
        name: 'exchange',
        description: 'Convert currency exchange rates using Google Finance',
        async execute(message, args) {
            if (!args || args.length < 2) {
                return message.reply('❌ Usage: `?exchange <amount> <FROM> <TO>` or `?exchange <FROM> <TO> [amount]`');
            }

            let amount = 1;
            let from = '';
            let to = '';

            const firstAsNum = parseFloat(args[0]);
            const lastAsNum = parseFloat(args[args.length - 1]);

            if (!isNaN(firstAsNum) && args.length >= 3) {
                amount = firstAsNum;
                from = (args[1] || '').trim().toUpperCase();
                to = (args[2] || '').trim().toUpperCase();
            } else if (!isNaN(lastAsNum) && args.length >= 3) {
                from = (args[0] || '').trim().toUpperCase();
                to = (args[1] || '').trim().toUpperCase();
                amount = lastAsNum;
            } else {
                from = (args[0] || '').trim().toUpperCase();
                to = (args[1] || '').trim().toUpperCase();
                if (args[2] && !isNaN(parseFloat(args[2]))) {
                    amount = parseFloat(args[2]);
                }
            }

            if (!from || !to) {
                return message.reply('❌ Please specify both source and target currency codes.');
            }

            if (amount <= 0) {
                return message.reply('❌ Amount must be a positive number greater than 0.');
            }

            const rate = await fetchExchangeRate(from, to);
            if (rate === null) {
                return message.reply(`❌ Could not retrieve exchange rate for **${from}** to **${to}** from Google Finance. Please verify the currency symbols.`);
            }

            const total = amount * rate;
            const inverse = 1 / rate;

            const embed = new EmbedBuilder()
                .setColor(0x1A73E8)
                .setAuthor({
                    name: 'Google Finance • Currency Exchange',
                    iconURL: 'https://ssl.gstatic.com/finance/favicon/finance_496x496.png',
                    url: `https://www.google.com/finance/quote/${encodeURIComponent(from)}-${encodeURIComponent(to)}`
                })
                .setTitle(`${from} to ${to} Exchange Rate`)
                .setURL(`https://www.google.com/finance/quote/${encodeURIComponent(from)}-${encodeURIComponent(to)}`)
                .setDescription(`## ${formatNumber(amount)} ${from} = ${formatNumber(total)} ${to}`)
                .addFields(
                    { name: `1 ${from}`, value: `${formatNumber(rate)} ${to}`, inline: true },
                    { name: `1 ${to}`, value: `${formatNumber(inverse)} ${from}`, inline: true }
                )
                .setFooter({
                    text: 'Google Finance • Real-time Quotes',
                    iconURL: 'https://ssl.gstatic.com/finance/favicon/finance_496x496.png'
                })
                .setTimestamp();

            return message.reply({ embeds: [embed] });
        }
    }
};
