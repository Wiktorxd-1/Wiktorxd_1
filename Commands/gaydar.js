const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const fs = require("fs").promises;
const path = require("path");

const DataFile = path.join(__dirname, "..", "Data", "gaidar.json");

const runningInvokers = new Set();
const runningTargets = new Set();

const utility_functions = {
  chance: function (probability) {
    return Math.random() <= probability;
  },
  number_format_commas: function (number) {
    return String(number).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  },
};

async function readData() {
  try {
    const raw = await fs.readFile(DataFile, "utf8");
    const parsed = JSON.parse(raw || "{}");
    parsed.date = parsed.date || null;
    parsed.entries = parsed.entries || {};
    parsed.next = parsed.next || {};
    parsed.persistent = parsed.persistent || {};
    return parsed;
  } catch {
    return { date: null, entries: {}, next: {}, persistent: {} };
  }
}

async function writeData(data) {
  await fs.mkdir(path.dirname(DataFile), { recursive: true });
  await fs.writeFile(DataFile, JSON.stringify(data, null, 2), "utf8");
}

function currentUTCDateString() {
  return new Date().toISOString().slice(0, 10);
}

function generateMeter() {
  let meter = Math.floor(Math.random() * 101);
  if (utility_functions.chance(0.0001)) {
    meter = Math.floor(Math.random() * 2354082) + 500;
    if (utility_functions.chance(0.5)) meter *= -1;
  }
  return meter;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("gaydar")
    .setDescription("How gay are you?")
    .setIntegrationTypes([0, 1])
    .setContexts([0, 1, 2])
    .addStringOption((option) =>
      option
        .setName("target")
        .setDescription("See how gay a user is")
        .setRequired(false)
    ),

  async execute(interaction, client) {

    const targetInput = interaction.options.getString("target");
    if (runningInvokers.has(interaction.user.id)) {
      try {
        await interaction.reply({ content: 'Nah bro, wait.'});
      } catch {}
      return;
    }
    runningInvokers.add(interaction.user.id);

    let acquiredTarget = null;


    const secretMatch = typeof targetInput === "string"
      ? targetInput.trim().match(/^\s*(?:(?:<@!?(\d+)>|(\d+))\s*)?(={2,3})\s*(.+?)\s*$/i)
      : null;

    try {
      const data = await readData();
      const today = currentUTCDateString();

      if (!data.date || data.date !== today) {
        data.date = today;
        data.entries = {};
      }


      if (secretMatch) {
        const id = secretMatch[1] || secretMatch[2];
        const eqs = secretMatch[3];
        const val = secretMatch[4];

        if (eqs === "==") {
          if (!id) {
            const meter = generateMeter();
            const textInput = val.trim();
            await interaction.deferReply();
            const embed = new EmbedBuilder()
              .setTitle(`How gay is ${textInput}?`)
              .setDescription(`**${textInput}** is **${utility_functions.number_format_commas(meter)}% gay!**`)
              .setColor(0xff00ae)
              .setFooter({
                text: "The bot has 99.99% accuracy rate on checking users gayness ~ stolen from pridebot(.xyz)",
              });
            await interaction.editReply({ embeds: [embed] }).catch(() => {});
            return;
          }
          if (val.toLowerCase() === "r") {
            await interaction.deferReply({ flags: 64 });
            await interaction.editReply("Cannot reset with `==`. Use `===r` to reset persistent.").catch(()=>{});
            return;
          }
          const num = Number(val);
          if (!Number.isFinite(num)) {
            await interaction.deferReply({ flags: 64 });
            await interaction.editReply("Invalid number for override.").catch(()=>{});
            return;
          }
          data.next = data.next || {};
          data.next[id] = num;
          await writeData(data);
          await interaction.deferReply({ flags: 64 });
          await interaction.editReply(`One-time override set for <@${id}> -> ${utility_functions.number_format_commas(num)}. `).catch(()=>{});
          return;
        }

        if (eqs === "===") {
          if (val.toLowerCase() === "r") {
            data.persistent = data.persistent || {};
            delete data.persistent[id];
            await writeData(data);
            await interaction.deferReply({ flags: 64 });
            await interaction.editReply(`Override for <@${id}> removed `).catch(()=>{});
            return;
          }
          const num = Number(val);
          if (!Number.isFinite(num)) {
            await interaction.deferReply({ flags: 64 });
            await interaction.editReply("Invalid number for persistent override.").catch(()=>{});
            return;
          }
          data.persistent = data.persistent || {};
          data.persistent[id] = num;
          await writeData(data);
          await interaction.deferReply({ flags: 64 });
          await interaction.editReply(`Persistent override set for <@${id}> -> ${utility_functions.number_format_commas(num)}.`).catch(()=>{});
          return;
        }
      }


      let targetUser = null;
      if (!targetInput) {
        targetUser = interaction.user;
      } else {
        const mentionMatch = targetInput.trim().match(/^\s*<@!?(\d+)>\s*$/);
        const idMatch = targetInput.trim().match(/^\s*(\d{17,20})\s*$/);
        const idToFetch = mentionMatch ? mentionMatch[1] : idMatch ? idMatch[1] : null;
        if (idToFetch) {
          try {
            targetUser = await client.users.fetch(idToFetch);
          } catch {
            targetUser = null;
          }
        }
        if (!targetUser) {
          targetUser = interaction.user;
        }
      }


      const lockKey = String(targetUser.id);
      if (runningTargets.has(lockKey)) {
        try {
          await interaction.reply({ content: 'That user is currently being gayed; please try again in a sec'});
        } catch {}
        return;
      }
      runningTargets.add(lockKey);
      acquiredTarget = lockKey;

      await interaction.deferReply();

      const userName = targetUser.username;
      const userid = targetUser.id;

      let meter;

      if (data.persistent && Object.prototype.hasOwnProperty.call(data.persistent, userid)) {
        meter = data.persistent[userid];
      } else if (data.next && Object.prototype.hasOwnProperty.call(data.next, userid)) {
        meter = data.next[userid];

        delete data.next[userid];
        await writeData(data);
      } else if (data.entries && Object.prototype.hasOwnProperty.call(data.entries, userid)) {
        meter = data.entries[userid];
      } else {
        meter = generateMeter();
        data.entries = data.entries || {};
        data.entries[userid] = meter;
        await writeData(data);
      }

      const embed = new EmbedBuilder()
        .setTitle(`How gay is ${userName}?`)
        .setDescription(`<@${userid}> is **${utility_functions.number_format_commas(meter)}% gay!**`)
        .setColor(0xff00ae)
        .setFooter({
          text: "The bot has 99.99% accuracy rate on checking users gayness ~ stolen from pridebot(.xyz)",
        });

      await interaction.editReply({ embeds: [embed] }).catch(() => {});

      try { await commandLogging(client, interaction); } catch {}
      try { await darlogging(client, "Gaydar", userName, meter, userid); } catch {}
    } catch (err) {
      console.error("Gaydar command error:", err);
      try { await interaction.editReply("An error occurred.").catch(()=>{}); } catch {}
    }
    finally {
      try { runningInvokers.delete(interaction.user.id); } catch {}
      try { if (acquiredTarget) runningTargets.delete(acquiredTarget); } catch {}
    }
  },
};