const { SlashCommandBuilder } = require('discord.js');

const Answers = {
    positive: [
        "Absolutely!",
        "For sure",
        "Yes.",
        "Signs point to yes",
        "ULTRA likely",
        "Yuh uh",
        "yep"
    ],
    neutral: [
        "Hmm...",
        "Honestly, who cares?",
        "Nope or yup?",
        "Maybe.",
        "50/50",
        "Ask later, i don't feel like answering rn",
        "I don't know, ask someone else bro ✌️",
        "Yesn't"
    ],
    negative: [
        "Nope.",
        "ULTRA unlikely",
        "Don't count on it",
        "Definitely not",
        "Nah.",
        "Nuh uh"
    ]
};

function pickCategory() {
    const keys = Object.keys(Answers);
    return keys[Math.floor(Math.random() * keys.length)];
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('8ball')
        .setDescription('Ask the (almost) all knowing magic 8ball')
        .setIntegrationTypes([0, 1])
        .setContexts([0, 1, 2])
        .addStringOption(option =>
            option.setName('question')
                .setDescription('Ask your question, peasant.')
                .setRequired(true)
        ),

    async execute(interaction) {
        const question = interaction.options.getString('question').trim();
        const thinking = '<a:roll:1389311247333458042> Thinking...';

        await interaction.reply({ content: thinking });


        await new Promise(r => setTimeout(r, 700));

        const category = pickCategory();
        const answers = Answers[category];
        const answer = answers[Math.floor(Math.random() * answers.length)];


        const final = `🎱 **Question:** ${question}\n**Answer:** ${answer}`;

        await interaction.editReply({ content: final });
    }
};