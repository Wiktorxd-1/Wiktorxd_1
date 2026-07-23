require('dotenv').config();
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const flags = require('./flags');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('clear')
        .setDescription('Delete messages!')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .setIntegrationTypes([0])
        .addSubcommand(subcommand =>
            subcommand
                .setName('any')
                .setDescription('Delete messages')
                .addIntegerOption(option =>
                    option.setName('amount')
                        .setDescription('Amount of messages to delete (NO LIMIT)')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('after')
                .setDescription('Delete messages after a specific message')
                .addStringOption(option =>
                    option.setName('message_id')
                        .setDescription('msg id')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option.setName('max_id')
                        .setDescription('Delete up to this message id (inclusive)')
                        .setRequired(false)
                )
                .addIntegerOption(option =>
                    option.setName('max')
                        .setDescription('Maximum messages to delete')
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('images')
                .setDescription('Delete messages containing images/vids')
                .addIntegerOption(option =>
                    option.setName('amount')
                        .setDescription('Amount of messages')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('links')
                .setDescription('Delete messages with links')
                .addIntegerOption(option =>
                    option.setName('amount')
                        .setDescription('Amount of messages')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('bots')
                .setDescription('Delete messages sent by bots')
                .addIntegerOption(option =>
                    option.setName('amount')
                        .setDescription('Amount of messages')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('user')
                .setDescription('Delete messages from a specific person')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('Target')
                        .setRequired(true)
                )
                .addIntegerOption(option =>
                    option.setName('amount')
                        .setDescription('Amount of messages')
                        .setRequired(true)
                )
        ),

    async execute(interactionOrMessage, optionsFromPrefix = null) {
        const isPrefixCommand = interactionOrMessage.content !== undefined;
        const ownerId = process.env.BOT_OWNER_ID;
        const channel = interactionOrMessage.channel;
        const user = interactionOrMessage.user || interactionOrMessage.author;
        const member = interactionOrMessage.member;

        const isOwner = user.id === ownerId;
        const isAdmin = member && member.permissions.has(PermissionFlagsBits.Administrator);
        const canManageMessages = member && member.permissions.has(PermissionFlagsBits.ManageMessages);

        if (!isOwner && !isAdmin && !canManageMessages) {
            if (isPrefixCommand) {
                return interactionOrMessage.reply({ content: 'No perms lmao' });
            } else {
                if (interactionOrMessage.deferred || interactionOrMessage.replied) {
                    return interactionOrMessage.followUp({ content: 'No perms lmao', flags: 64 });
                } else {
                    return interactionOrMessage.reply({ content: 'No perms lmao', flags: 64 });
                }
            }
        }

        let initialReply;
        if (isPrefixCommand) {
            initialReply = await interactionOrMessage.reply(`Trying to delete messages...`);
            try {
                await interactionOrMessage.delete();
            } catch (err) {
                console.error('Error deleting command message:', err);
            }
        } else {
            if (!interactionOrMessage.deferred && !interactionOrMessage.replied) {
                await interactionOrMessage.deferReply({ flags: 64 });
            }
        }

        let amountToClear;
        let messageIdToDeleteAfter;
        let maxMessageIdToDelete;
        let filterType = 'any';
        let targetUserId;

        if (isPrefixCommand) {
            filterType = optionsFromPrefix.type;
            if (optionsFromPrefix.type === 'after') {
                messageIdToDeleteAfter = optionsFromPrefix.messageId;
                maxMessageIdToDelete = optionsFromPrefix.maxId;
                amountToClear = 10000;
            } else if (optionsFromPrefix.type === 'user') {
                targetUserId = optionsFromPrefix.userId;
                amountToClear = optionsFromPrefix.amount;
            } else {
                amountToClear = optionsFromPrefix.amount;
            }
        } else if (interactionOrMessage.isChatInputCommand()) {
            filterType = interactionOrMessage.options.getSubcommand();
            if (filterType === 'any') {
                amountToClear = interactionOrMessage.options.getInteger('amount');
            } else if (filterType === 'after') {
                messageIdToDeleteAfter = interactionOrMessage.options.getString('message_id');
                maxIdToDeleteTo = interactionOrMessage.options.getString('max_id') || null;
                amountToClear = interactionOrMessage.options.getInteger('max') || 10000;
            } else if (filterType === 'user') {
                const userOption = interactionOrMessage.options.getUser('user');
                targetUserId = userOption ? userOption.id : null;
                amountToClear = interactionOrMessage.options.getInteger('amount');
            } else {
                amountToClear = interactionOrMessage.options.getInteger('amount');
            }
        } else {
            return;
        }

        if (amountToClear < 1 && filterType !== 'after') {
            return interactionOrMessage.reply({ content: 'Bro what are you trying with less then 1 xd', flags: isPrefixCommand ? 0 : 64 });
        }

        let messagesDeletedCount = 0;
        let lastMessageId = interactionOrMessage.id;
        const fourteenDaysInMs = 1209600000;
        let processedMsgIds = new Set();
        try {
            let done = false;
            while (!done && messagesDeletedCount < amountToClear) {
                const fetchedMessages = await channel.messages.fetch({
                    limit: 100,
                    before: lastMessageId
                });
                if (fetchedMessages.size === 0) break;
                lastMessageId = fetchedMessages.last().id;

                let batchToDelete = [];
                let batchToDeleteOld = [];
                let shouldStopFetching = false;

                for (const msg of fetchedMessages.values()) {
                    if (processedMsgIds.has(msg.id)) continue;
                    processedMsgIds.add(msg.id);
                    if (filterType === 'after') {
                        if (msg.id <= messageIdToDeleteAfter) {
                            shouldStopFetching = true;
                            break;
                        }
                        if (maxIdToDeleteTo && msg.id > maxIdToDeleteTo) {
                            continue;
                        }
                        if (Date.now() - msg.createdTimestamp < fourteenDaysInMs) {
                            batchToDelete.push(msg);
                        } else {
                            batchToDeleteOld.push(msg);
                        }
                        if (messagesDeletedCount + batchToDelete.length + batchToDeleteOld.length >= amountToClear) {
                            shouldStopFetching = true;
                            break;
                        }
                    } else if (filterType === 'user') {
                        if (msg.author.id === targetUserId) {
                            if (Date.now() - msg.createdTimestamp < fourteenDaysInMs) {
                                batchToDelete.push(msg);
                            } else {
                                batchToDeleteOld.push(msg);
                            }
                            if (messagesDeletedCount + batchToDelete.length + batchToDeleteOld.length >= amountToClear) {
                                shouldStopFetching = true;
                                break;
                            }
                        }
                    } else {
                        let shouldDelete = false;
                        switch (filterType) {
                            case 'any':
                                shouldDelete = true;
                                break;
                            case 'images':
                                shouldDelete = msg.attachments.some(attachment => attachment.width || attachment.height) || msg.embeds.some(embed => embed.type === 'image' || embed.type === 'video');
                                break;
                            case 'links':
                                shouldDelete = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|([a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s]*)?)/g.test(msg.content) || msg.embeds.some(embed => embed.url);
                                break;
                            case 'bots':
                                shouldDelete = msg.author.bot;
                                break;
                        }
                        if (shouldDelete) {
                            if (Date.now() - msg.createdTimestamp < fourteenDaysInMs) {
                                batchToDelete.push(msg);
                            } else {
                                batchToDeleteOld.push(msg);
                            }
                            if (messagesDeletedCount + batchToDelete.length + batchToDeleteOld.length >= amountToClear) {
                                shouldStopFetching = true;
                                break;
                            }
                        }
                    }
                }

                if (batchToDelete.length > 0) {
                    const ids = batchToDelete.slice(0, 100).map(m => m.id);
                    try {
                        const deleted = await channel.bulkDelete(ids, true);
                        messagesDeletedCount += deleted.size;
                    } catch (err) {

                        for (const m of batchToDelete.slice(0, 100)) {
                            try {
                                await m.delete();
                                messagesDeletedCount++;
                            } catch (err2) {
                                console.warn(`Failed to delete message ${m.id}: ${err2.message}`);
                            }
                        }
                    }
                }

                for (const m of batchToDeleteOld) {
                    try {
                        await m.delete();
                        messagesDeletedCount++;
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    } catch (err) {
                        console.warn(`Failed to delete old message ${m.id}: ${err.message}`);
                    }
                }

                if (shouldStopFetching) done = true;
            }

            const confirmationContent = `Successfully deleted ${messagesDeletedCount} messages!`;

            if (isPrefixCommand) {
                const confirmationMessage = await channel.send(confirmationContent);
                if (initialReply) {
                    try {
                        await initialReply.delete();
                    } catch (err) {
                        console.error('Error deleting initial bot reply:', err);
                    }
                }
                setTimeout(async () => {
                    try {
                        await confirmationMessage.delete();
                    } catch (error) {
                        console.error('Error deleting confirmation message:', error);
                    }
                }, 10000);
            } else {
                await interactionOrMessage.followUp({ content: confirmationContent, flags: 64 });
            }

        } catch (error) {
            console.error('Error deleting messages:', error);
            let errorMessageContent = `Error: ${error.message}`;
            if (error.code === 50013) {
                errorMessageContent = 'I dont have enough perms (sob)';
            }

            if (isPrefixCommand) {
                const errorMessage = await channel.send(errorMessageContent);
                setTimeout(async () => {
                    try {
                        await errorMessage.delete();
                    } catch (err) {
                        console.error('Error deleting error message:', err);
                    }
                }, 30000);
            } else {
                await interactionOrMessage.followUp({ content: errorMessageContent, flags: 64 });
            }
        }
    },
};