const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const Iso6391 = require('iso-639-1');
const translate = require('google-translate-api-x');

function titleCaseEachWord(str) {
  if (!str) return str;
  return String(str)
    .split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function normalizeLang(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (Iso6391.validate(lower)) return lower;
  const title = titleCaseEachWord(raw);
  const codeFromName = Iso6391.getCode(title);
  if (codeFromName) return codeFromName;
  return null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('translate')
    .setIntegrationTypes([0, 1])
    .setContexts([0, 1, 2])
    .setDescription('Translate text with google translate')
    .addStringOption(opt =>
      opt.setName('text')
        .setDescription('Text to translate')
        .setRequired(true))
    .addStringOption(opt =>
      opt.setName('to')
        .setDescription('Target language (example: en, pl, nl, polish)')
        .setRequired(false))
    .addStringOption(opt =>
      opt.setName('from')
        .setDescription('Override automatic language detection')
        .setRequired(false)),

  async execute(interaction) {
    const toRaw = interaction.options.getString('to');
    const fromRaw = interaction.options.getString('from');
    const text = interaction.options.getString('text').trim();

    const toLang = normalizeLang(toRaw) || 'en';
    const fromLang = normalizeLang(fromRaw);

    if (toRaw && !normalizeLang(toRaw)) {
      return interaction.reply({
        content: 'Invalid language ',
        flags: MessageFlags.Ephemeral
      });
    }

    if (fromRaw && !normalizeLang(fromRaw)) {
      return interaction.reply({
        content: 'Invalid language',
        flags: MessageFlags.Ephemeral
      });
    }

    await interaction.deferReply();

    try {
      const translateOptions = { to: toLang };
      if (fromLang) translateOptions.from = fromLang;
      const res = await translate(text, translateOptions);
      const translated = res.text || '';
      const detectedFromCode = res.from?.language?.iso || '';
      const fromCode = fromLang || detectedFromCode || 'und';

      const fromNameRaw = Iso6391.getName(fromCode) || (fromCode || 'Unknown');
      const toNameRaw = Iso6391.getName(toLang) || toLang;

      const fromName = titleCaseEachWord(String(fromNameRaw));
      const toName = titleCaseEachWord(String(toNameRaw));

      const originalPretty = text.charAt(0).toUpperCase() + text.slice(1);
      const translatedPretty = translated.charAt(0).toUpperCase() + translated.slice(1);
      if (originalPretty.length > 1024 || translatedPretty.length > 1024) {
        return interaction.editReply(`**${fromName} → ${toName}**\n\nOriginal:\n${originalPretty}\n\nTranslated:\n${translatedPretty}`);
      }

      const embed = new EmbedBuilder()
        .setAuthor({ name: 'Google Translate', iconURL: 'https://www.gstatic.com/translate/favicon.ico' })
        .setColor('#FBE7BD')
        .addFields(
          { name: `${fromName}`, value: originalPretty },
          { name: `${toName}`, value: translatedPretty }
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await interaction.editReply(`Failed to translate, make sure the target language code is valid\nError: ${err.message || err}`);
    }
  }
};