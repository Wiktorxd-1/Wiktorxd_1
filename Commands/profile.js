const { EmbedBuilder, SlashCommandBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ComponentType, MessageFlags } = require('discord.js');
const axios = require('axios');
const ms = require('ms');
const preference = require('../Utility/Hatches/preference');

function getUserBadges(user, member) {
    const badges = [];
    const flags = user.flags ? user.flags.toArray() : [];

    const flagMap = {
        Staff: '👨‍💼 Discord Staff',
        Partner: '🤝 Partnered Server Owner',
        Hypesquad: '🎊 HypeSquad Events',
        BugHunterLevel1: '🐛 Bug Hunter Level 1',
        BugHunterLevel2: '🪲 Bug Hunter Level 2',
        HypeSquadOnlineHouse1: '🟣 House of Bravery',
        HypeSquadOnlineHouse2: '🔴 House of Brilliance',
        HypeSquadOnlineHouse3: '🟢 House of Balance',
        PremiumEarlySupporter: '💎 Early Supporter',
        TeamPseudoUser: '👥 Team User',
        VerifiedBot: '🤖 Verified Bot',
        VerifiedDeveloper: '👨‍💻 Early Verified Bot Developer',
        CertifiedModerator: '🛡️ Certified Moderator',
        BotHTTPInteractions: '⚡ HTTP Interactions',
        ActiveDeveloper: '🛠️ Active Developer'
    };

    for (const flag of flags) {
        if (flagMap[flag]) badges.push(flagMap[flag]);
    }

    if (member && member.premiumSince) {
        badges.push('🚀 Server Booster');
    }

    if (user.banner || (user.avatar && user.avatar.startsWith('a_'))) {
        badges.push('✨ Discord Nitro');
    }

    if (user.bot && !flags.includes('VerifiedBot')) {
        badges.push('🤖 Bot');
    }

    return badges.length > 0 ? badges.join('\n') : 'None';
}

function getKeyPermissions(member) {
    if (!member || !member.permissions) return [];
    if (member.permissions.has('Administrator')) return ['👑 Administrator (All Permissions)'];

    const keyPerms = [
        ['ManageGuild', 'Manage Server'],
        ['ManageRoles', 'Manage Roles'],
        ['ManageChannels', 'Manage Channels'],
        ['KickMembers', 'Kick Members'],
        ['BanMembers', 'Ban Members'],
        ['ManageMessages', 'Manage Messages'],
        ['MentionEveryone', 'Mention Everyone'],
        ['ModerateMembers', 'Timeout Members'],
        ['ViewAuditLog', 'View Audit Log']
    ];

    const found = [];
    for (const [perm, label] of keyPerms) {
        if (member.permissions.has(perm)) found.push(label);
    }
    return found;
}

function formatPresence(presence) {
    if (!presence) return null;

    const statusMap = {
        online: '🟢 Online',
        idle: '🌙 Idle',
        dnd: '⛔ Do Not Disturb',
        offline: '⚪ Offline'
    };

    const statusText = statusMap[presence.status] || '⚪ Offline';

    const clientStatus = presence.clientStatus;
    const devices = [];
    if (clientStatus) {
        if (clientStatus.desktop) devices.push('Desktop');
        if (clientStatus.mobile) devices.push('Mobile');
        if (clientStatus.web) devices.push('Web');
    }
    const deviceStr = devices.length ? ` (${devices.join(', ')})` : '';

    const activities = [];
    for (const act of presence.activities || []) {
        if (act.type === 4) {
            const state = act.state ? `"${act.state}"` : '';
            const emoji = act.emoji ? `${act.emoji.name} ` : '';
            if (state || emoji) activities.push(`💬 ${emoji}${state}`.trim());
        } else if (act.name === 'Spotify') {
            activities.push(`🎧 Listening to **${act.details || 'Music'}** by **${act.state || 'Artist'}**`);
        } else if (act.type === 0) {
            activities.push(`🎮 Playing **${act.name}**${act.details ? ` - ${act.details}` : ''}`);
        } else if (act.type === 1) {
            activities.push(`📹 Streaming **${act.name}**`);
        } else if (act.type === 2) {
            activities.push(`🎵 Listening to **${act.name}**`);
        } else if (act.type === 3) {
            activities.push(`📺 Watching **${act.name}**`);
        } else if (act.type === 5) {
            activities.push(`🏆 Competing in **${act.name}**`);
        }
    }

    return {
        statusText: `${statusText}${deviceStr}`,
        activities
    };
}

async function fetchLinkedRoblox(userId, guildId) {
    try {
        const pref = await preference.getPreferenceByDiscordId(userId);
        if (pref && pref.username) {
            return { username: pref.username, id: pref.robloxId || null };
        }
    } catch { }

    if (guildId && process.env.ROVER_API_KEY) {
        try {
            const res = await axios.get(`https://registry.rover.link/api/guilds/${guildId}/discord-to-roblox/${userId}`, {
                headers: {
                    'Authorization': `Bearer ${process.env.ROVER_API_KEY}`,
                    'Accept': 'application/json'
                },
                timeout: 3000
            });
            const d = res.data;
            if (d?.robloxId) {
                return { id: d.robloxId, username: d.cachedUsername || `User ${d.robloxId}` };
            }
            if (d?.robloxUsers?.[0]) {
                return { id: d.robloxUsers[0].id, username: d.robloxUsers[0].username || `User ${d.robloxUsers[0].id}` };
            }
        } catch { }
    }

    return null;
}

function buildDiscordProfileEmbed(targetUser, targetMember, linkedRoblox, interaction) {
    const isMember = !!targetMember;
    const embedColor = targetUser.accentColor || (targetMember?.displayColor && targetMember.displayColor !== 0 ? targetMember.displayColor : 0xFBE7BD);

    const displayName = targetMember?.displayName || targetUser.globalName || targetUser.username;
    const tag = targetUser.tag || targetUser.username;

    const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setAuthor({
            name: `${tag}${targetMember?.nickname ? ` (${targetMember.nickname})` : ''}`,
            iconURL: targetUser.displayAvatarURL({ dynamic: true, size: 128 })
        })
        .setTitle(displayName)
        .setURL(`https://discord.com/users/${targetUser.id}`)
        .setThumbnail(targetMember?.displayAvatarURL({ dynamic: true, size: 512 }) || targetUser.displayAvatarURL({ dynamic: true, size: 512 }))
        .setFooter({
            text: `Requested by ${interaction.user.tag} • User ID: ${targetUser.id}`,
            iconURL: interaction.user.displayAvatarURL({ dynamic: true, size: 128 })
        })
        .setTimestamp();

    if (targetUser.banner) {
        embed.setImage(targetUser.bannerURL({ dynamic: true, size: 1024 }));
    }

    const createdTs = Math.floor(targetUser.createdTimestamp / 1000);
    const joinedTs = targetMember?.joinedTimestamp ? Math.floor(targetMember.joinedTimestamp / 1000) : null;

    const userInfoLines = [
        `• **Mention:** <@${targetUser.id}>`,
        `• **User ID:** \`${targetUser.id}\``,
        `• **Account Type:** ${targetUser.bot ? '🤖 Bot' : '👤 User'}${targetUser.system ? ' (System)' : ''}`,
        `• **Registered:** <t:${createdTs}:D> (<t:${createdTs}:R>)`
    ];

    if (isMember && joinedTs) {
        userInfoLines.push(`• **Joined Server:** <t:${joinedTs}:D> (<t:${joinedTs}:R>)`);
    }

    const badges = getUserBadges(targetUser, targetMember);
    if (badges !== 'None') {
        userInfoLines.push(`• **Badges:**\n${badges}`);
    }

    embed.addFields({
        name: '👤 User Information',
        value: userInfoLines.join('\n'),
        inline: false
    });

    if (isMember) {
        const serverLines = [];
        if (targetMember.nickname) {
            serverLines.push(`• **Server Nickname:** ${targetMember.nickname}`);
        }
        if (targetMember.roles.highest && targetMember.roles.highest.id !== interaction.guild?.id) {
            serverLines.push(`• **Highest Role:** ${targetMember.roles.highest}`);
        }
        if (targetMember.premiumSince) {
            serverLines.push(`• **Boosting Since:** <t:${Math.floor(targetMember.premiumSinceTimestamp / 1000)}:R>`);
        }

        const memberRoles = targetMember.roles.cache
            .filter(r => r.id !== interaction.guild?.id)
            .sort((a, b) => b.position - a.position);

        if (memberRoles.size > 0) {
            const maxRoles = 12;
            const shownRoles = memberRoles.first(maxRoles).map(r => `${r}`);
            const extra = memberRoles.size - maxRoles;
            serverLines.push(`• **Roles [${memberRoles.size}]:** ${shownRoles.join(', ')}${extra > 0 ? ` +${extra} more` : ''}`);
        } else {
            serverLines.push(`• **Roles:** None`);
        }

        const keyPerms = getKeyPermissions(targetMember);
        if (keyPerms.length > 0) {
            serverLines.push(`• **Key Permissions:** ${keyPerms.slice(0, 4).join(', ')}${keyPerms.length > 4 ? ` +${keyPerms.length - 4} more` : ''}`);
        }

        if (serverLines.length > 0) {
            embed.addFields({
                name: '🛡️ Server Details',
                value: serverLines.join('\n'),
                inline: false
            });
        }

        const pres = formatPresence(targetMember.presence);
        if (pres) {
            const presLines = [`• **Status:** ${pres.statusText}`];
            if (pres.activities.length > 0) {
                presLines.push(...pres.activities.map(a => `• ${a}`));
            }
            embed.addFields({
                name: '🎮 Presence & Activity',
                value: presLines.join('\n'),
                inline: false
            });
        }
    }

    if (linkedRoblox) {
        const robloxUrl = linkedRoblox.id ? `https://www.roblox.com/users/${linkedRoblox.id}/profile` : null;
        const robloxDisplay = robloxUrl
            ? `[${linkedRoblox.username}](${robloxUrl}) (\`${linkedRoblox.id}\`)`
            : `\`${linkedRoblox.username}\``;

        embed.addFields({
            name: '🔗 Linked Roblox Account',
            value: `• **Roblox User:** ${robloxDisplay}`,
            inline: false
        });
    }

    return embed;
}

function buildProfileButtons(targetUser, targetMember, linkedRoblox) {
    const row = new ActionRowBuilder();

    row.addComponents(
        new ButtonBuilder()
            .setCustomId(`prof_avatar_${targetUser.id}`)
            .setLabel('Avatar')
            .setEmoji('🖼️')
            .setStyle(ButtonStyle.Secondary)
    );

    if (targetUser.banner) {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`prof_banner_${targetUser.id}`)
                .setLabel('Banner')
                .setEmoji('🎨')
                .setStyle(ButtonStyle.Secondary)
        );
    }

    if (targetMember && targetMember.roles.cache.filter(r => r.id !== targetMember.guild.id).size > 0) {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`prof_roles_${targetUser.id}`)
                .setLabel('Roles')
                .setEmoji('📜')
                .setStyle(ButtonStyle.Secondary)
        );
    }

    if (linkedRoblox && (linkedRoblox.username || linkedRoblox.id)) {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`prof_roblox_${targetUser.id}`)
                .setLabel('Roblox Profile')
                .setEmoji('🟥')
                .setStyle(ButtonStyle.Primary)
        );
    }

    row.addComponents(
        new ButtonBuilder()
            .setCustomId(`prof_delete_${targetUser.id}`)
            .setLabel('Delete')
            .setEmoji('🗑️')
            .setStyle(ButtonStyle.Danger)
    );

    return row;
}

const makeRobloxRequest = async (url, config = {}, retries = 3, delaySeconds = 5) => {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await axios({ url, ...config });
            return response;
        } catch (error) {
            if (error.response && error.response.status === 429) {
                const retryAfter = parseInt(error.response.headers['retry-after']) || delaySeconds;
                await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
            } else {
                throw error;
            }
        }
    }
    throw new Error(`Failed to fetch ${url} after ${retries} retries due to persistent issues.`);
};

const makeRoverRequest = async (url, retries = 3, delaySeconds = 5) => {
    const roverApiKey = process.env.ROVER_API_KEY;
    if (!roverApiKey) {
        throw new Error('ROVER_API_KEY is not set in environment variables.');
    }
    for (let i = 0; i < retries; i++) {
        try {
            const response = await axios.get(url, {
                headers: {
                    'Authorization': `Bearer ${roverApiKey}`,
                    'Accept': 'application/json'
                }
            });
            return response;
        } catch (error) {
            if (error.response && error.response.status === 429) {
                const retryAfter = (error.response.data?.retry_after || 60) * 1000;
                await new Promise(resolve => setTimeout(resolve, retryAfter));
            } else {
                throw error;
            }
        }
    }
    throw new Error(`Failed to fetch ${url} from Rover after ${retries} retries.`);
};

async function executeRobloxProfile(interaction, username, updateTarget = null) {
    const userNotFoundEmbed = new EmbedBuilder()
        .setColor(0xFBE7BD)
        .setTitle(`User "${username}" not found.`)
        .setTimestamp();

    let targetUserId;
    let targetUsername;
    let targetAvatarUrl = null;
    let creationDateTimestamp = 'N/A';

    try {
        const userResponse = await axios.post(`https://users.roblox.com/v1/usernames/users`, {
            usernames: [username],
            excludeBannedUsers: true
        });

        if (userResponse.data && userResponse.data.data && userResponse.data.data.length > 0) {
            targetUserId = userResponse.data.data[0].id;
            targetUsername = userResponse.data.data[0].name;
        } else {
            if (updateTarget) return updateTarget.followUp({ embeds: [userNotFoundEmbed], flags: MessageFlags.Ephemeral });
            return interaction.editReply({ embeds: [userNotFoundEmbed] });
        }

        let followersCount = 'N/A';
        let followingCount = 'N/A';
        let profileDescription = '';
        let allFriends = [];
        let friendCount = 0;
        let userGroups = [];
        let groupCount = 0;
        const guildId = interaction.guild?.id;
        let discordUserInfo = 'Not linked';

        const [profileRes, avatarRes, followersRes, followingRes, friendsRes, groupsRes, roverRes] = await Promise.allSettled([
            makeRobloxRequest(`https://users.roblox.com/v1/users/${targetUserId}`),
            makeRobloxRequest(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${targetUserId}&size=420x420&format=Png&isCircular=false`),
            makeRobloxRequest(`https://friends.roblox.com/v1/users/${targetUserId}/followers/count`),
            makeRobloxRequest(`https://friends.roblox.com/v1/users/${targetUserId}/followings/count`),
            makeRobloxRequest(`https://friends.roblox.com/v1/users/${targetUserId}/friends`),
            makeRobloxRequest(`https://groups.roblox.com/v1/users/${targetUserId}/groups/roles`),
            guildId ? makeRoverRequest(`https://registry.rover.link/api/guilds/${guildId}/roblox-to-discord/${targetUserId}`) : Promise.resolve(null)
        ]);

        if (profileRes.status === 'fulfilled' && profileRes.value?.data) {
            const creationDate = new Date(profileRes.value.data.created);
            creationDateTimestamp = `<t:${Math.floor(creationDate.getTime() / 1000)}:R>`;
            profileDescription = profileRes.value.data.description || '';
        }

        if (avatarRes.status === 'fulfilled' && avatarRes.value?.data?.data?.[0]?.imageUrl) {
            targetAvatarUrl = avatarRes.value.data.data[0].imageUrl;
        }

        if (followersRes.status === 'fulfilled' && typeof followersRes.value?.data?.count === 'number') {
            followersCount = followersRes.value.data.count;
        }

        if (followingRes.status === 'fulfilled' && typeof followingRes.value?.data?.count === 'number') {
            followingCount = followingRes.value.data.count;
        }

        if (friendsRes.status === 'fulfilled' && friendsRes.value?.data?.data) {
            allFriends = friendsRes.value.data.data;
            friendCount = allFriends.length;
        }

        if (groupsRes.status === 'fulfilled' && groupsRes.value?.data?.data) {
            userGroups = groupsRes.value.data.data;
            groupCount = userGroups.length;
        }

        if (roverRes.status === 'fulfilled' && roverRes.value?.data?.discordUsers?.length > 0) {
            const linkedUsers = roverRes.value.data.discordUsers.map(du => `<@${du.user.id}> (${du.user.username}${du.user.discriminator === '0' ? '' : `#${du.user.discriminator}`})`).join('\n');
            discordUserInfo = linkedUsers.substring(0, 1024);
        } else if (roverRes.status === 'rejected') {
            const err = roverRes.reason;
            if (err.response?.data?.errorCode === 'user_not_found') {
                discordUserInfo = 'not found';
            } else if (err.response?.status === 429) {
                discordUserInfo = 'rate limited';
            } else {
                discordUserInfo = 'Error fetching from Rover';
            }
        }

        const mainEmbed = new EmbedBuilder()
            .setColor(0xFBE7BD)
            .setAuthor({
                name: `@${targetUsername}`,
                iconURL: targetAvatarUrl,
                url: `https://www.roblox.com/users/${targetUserId}/profile`
            })
            .setTitle(targetUsername)
            .setURL(`https://www.roblox.com/users/${targetUserId}/profile`)
            .setThumbnail(targetAvatarUrl)
            .setFooter({
                text: `Requested by ${interaction.user.tag} • ID: ${targetUserId}`,
                iconURL: interaction.user.displayAvatarURL({ dynamic: true, size: 128 })
            })
            .setTimestamp();

        if (profileDescription && profileDescription.trim().length > 0) {
            mainEmbed.setDescription(`> ${profileDescription.substring(0, 1000).replace(/\n/g, '\n> ')}`);
        }

        mainEmbed.addFields([
            {
                name: '🟥 Roblox Details',
                value: [
                    `• **Roblox ID:** \`${targetUserId}\``,
                    `• **Joined Date:** ${creationDateTimestamp}`,
                    `• **Friends:** \`${friendCount}\``,
                    `• **Followers:** \`${followersCount}\``,
                    `• **Following:** \`${followingCount}\``,
                    `• **Groups:** \`${groupCount}\``
                ].join('\n'),
                inline: false
            }
        ]);

        if (interaction.guild && discordUserInfo && discordUserInfo !== 'Not linked' && discordUserInfo !== 'not found') {
            mainEmbed.addFields({ name: '🔗 Linked Discord', value: `• ${discordUserInfo}`, inline: false });
        }

        const actionRowComponents = [];
        if (allFriends.length > 0) {
            actionRowComponents.push(
                new ButtonBuilder()
                    .setCustomId('show_friends')
                    .setLabel('Show Friends')
                    .setStyle(ButtonStyle.Primary)
            );
        }
        if (userGroups.length > 0) {
            actionRowComponents.push(
                new ButtonBuilder()
                    .setCustomId('show_groups')
                    .setLabel('Show Groups')
                    .setStyle(ButtonStyle.Primary)
            );
        }
        actionRowComponents.push(
            new ButtonBuilder()
                .setCustomId('show_avatar')
                .setLabel('Show Avatar')
                .setStyle(ButtonStyle.Primary)
        );

        const components = actionRowComponents.length > 0
            ? [new ActionRowBuilder().addComponents(actionRowComponents)]
            : [];

        const replyMessage = updateTarget
            ? await updateTarget.followUp({ embeds: [mainEmbed], components: components })
            : await interaction.editReply({ embeds: [mainEmbed], components: components });

        if (components.length > 0 && replyMessage) {
            const initialButtonFilter = i => (
                i.customId === 'show_friends' ||
                i.customId === 'show_groups' ||
                i.customId === 'show_avatar'
            ) && i.user.id === interaction.user.id;

            const initialButtonCollector = replyMessage.createMessageComponentCollector({
                filter: initialButtonFilter,
                componentType: ComponentType.Button,
                time: 180000
            });

            initialButtonCollector.on('collect', async i => {
                await i.deferUpdate();

                if (i.customId === 'show_friends') {
                    const friendMap = new Map();
                    const userIds = allFriends.map(f => f.id);
                    const chunkSize = 100;
                    const batchPromises = [];

                    for (let c = 0; c < userIds.length; c += chunkSize) {
                        const chunk = userIds.slice(c, c + chunkSize);
                        batchPromises.push(
                            makeRobloxRequest('https://users.roblox.com/v1/users', {
                                method: 'POST',
                                data: { userIds: chunk, excludeBannedUsers: false }
                            }).catch(() => null)
                        );
                    }

                    const batchResponses = await Promise.all(batchPromises);
                    for (const res of batchResponses) {
                        if (res?.data?.data && Array.isArray(res.data.data)) {
                            for (const user of res.data.data) {
                                friendMap.set(user.id, user);
                            }
                        }
                    }

                    const friendsPages = [];
                    const friendsPerPage = 25;
                    const totalPages = Math.ceil(allFriends.length / friendsPerPage) || 1;

                    for (let j = 0; j < allFriends.length; j += friendsPerPage) {
                        const pageFriends = allFriends.slice(j, j + friendsPerPage);
                        const pageNum = Math.floor(j / friendsPerPage) + 1;
                        const embed = new EmbedBuilder()
                            .setColor(0xFBE7BD)
                            .setTitle(`${targetUsername}'s Friends (Page ${pageNum}/${totalPages})`)
                            .setDescription(`Total Friends: ${allFriends.length}`)
                            .setTimestamp();

                        for (const friend of pageFriends) {
                            const friendInfo = friendMap.get(friend.id) || friend;
                            const displayName = friendInfo.displayName || friendInfo.name || `User ${friend.id}`;
                            const usernameTag = friendInfo.name ? `@${friendInfo.name}` : `User ${friend.id}`;

                            embed.addFields({
                                name: displayName.substring(0, 256),
                                value: `[${usernameTag}](https://www.roblox.com/users/${friend.id}/profile)`,
                                inline: true
                            });
                        }
                        friendsPages.push(embed);
                    }

                    let currentFriendPage = 0;

                    const getFriendsPaginationRow = (pageIndex) => {
                        return new ActionRowBuilder()
                            .addComponents(
                                new ButtonBuilder()
                                    .setCustomId('prev_friend_page')
                                    .setLabel('Previous')
                                    .setStyle(ButtonStyle.Primary)
                                    .setDisabled(pageIndex === 0),
                                new ButtonBuilder()
                                    .setCustomId('next_friend_page')
                                    .setLabel('Next')
                                    .setStyle(ButtonStyle.Primary)
                                    .setDisabled(pageIndex === friendsPages.length - 1 || friendsPages.length === 0),
                                new ButtonBuilder()
                                    .setCustomId('delete_friends_message')
                                    .setLabel('Delete')
                                    .setEmoji('🗑️')
                                    .setStyle(ButtonStyle.Danger)
                            );
                    };

                    try {
                        const followUpMessage = await i.followUp({
                            embeds: [friendsPages[currentFriendPage]],
                            components: [getFriendsPaginationRow(currentFriendPage)],
                            flags: 0
                        });

                        const paginationFilter = (btnInteraction) => btnInteraction.user.id === interaction.user.id;
                        const paginationCollector = followUpMessage.createMessageComponentCollector({
                            filter: paginationFilter,
                            componentType: ComponentType.Button,
                            time: 180000
                        });

                        paginationCollector.on('collect', async btnI => {
                            await btnI.deferUpdate();

                            if (btnI.customId === 'prev_friend_page') {
                                currentFriendPage--;
                            } else if (btnI.customId === 'next_friend_page') {
                                currentFriendPage++;
                            } else if (btnI.customId === 'delete_friends_message') {
                                await followUpMessage.delete().catch(() => null);
                                paginationCollector.stop('deleted');
                                return;
                            }

                            try {
                                await btnI.editReply({
                                    embeds: [friendsPages[currentFriendPage]],
                                    components: [getFriendsPaginationRow(currentFriendPage)]
                                });
                            } catch { }
                        });

                        paginationCollector.on('end', async (collected, reason) => {
                            if (reason === 'deleted') return;
                            const disabledRow = getFriendsPaginationRow(currentFriendPage);
                            disabledRow.components.forEach(button => button.setDisabled(true));
                            try {
                                if (followUpMessage) {
                                    await followUpMessage.edit({ components: [disabledRow] }).catch(() => null);
                                }
                            } catch { }
                        });
                    } catch { }

                } else if (i.customId === 'show_groups') {
                    const groupsPages = [];
                    const groupsPerPage = 25;
                    const totalGroupPages = Math.ceil(userGroups.length / groupsPerPage);

                    for (let j = 0; j < totalGroupPages; j++) {
                        const start = j * groupsPerPage;
                        const end = start + groupsPerPage;
                        const pageGroups = userGroups.slice(start, end);

                        const embed = new EmbedBuilder()
                            .setColor(0xFBE7BD)
                            .setTitle(`${targetUsername}'s Groups (Page ${j + 1}/${totalGroupPages})`)
                            .setDescription(`Total Groups: ${userGroups.length}`)
                            .setTimestamp();

                        for (const group of pageGroups) {
                            embed.addFields({ name: group.group.name, value: `ID: ${group.group.id}\nRank: ${group.role.name}`, inline: true });
                        }
                        groupsPages.push(embed);
                    }

                    let currentGroupPage = 0;

                    const getGroupsPaginationRow = (pageIndex) => {
                        return new ActionRowBuilder()
                            .addComponents(
                                new ButtonBuilder()
                                    .setCustomId('prev_group_page')
                                    .setLabel('Previous')
                                    .setStyle(ButtonStyle.Primary)
                                    .setDisabled(pageIndex === 0),
                                new ButtonBuilder()
                                    .setCustomId('next_group_page')
                                    .setLabel('Next')
                                    .setStyle(ButtonStyle.Primary)
                                    .setDisabled(pageIndex === groupsPages.length - 1 || groupsPages.length === 0),
                                new ButtonBuilder()
                                    .setCustomId('delete_groups_message')
                                    .setLabel('Delete')
                                    .setEmoji('🗑️')
                                    .setStyle(ButtonStyle.Danger)
                            );
                    };

                    try {
                        const followUpMessage = await i.followUp({
                            embeds: [groupsPages[currentGroupPage]],
                            components: [getGroupsPaginationRow(currentGroupPage)],
                            flags: 0
                        });

                        const paginationFilter = (btnInteraction) => btnInteraction.user.id === interaction.user.id;
                        const paginationCollector = followUpMessage.createMessageComponentCollector({
                            filter: paginationFilter,
                            componentType: ComponentType.Button,
                            time: 180000
                        });

                        paginationCollector.on('collect', async btnI => {
                            await btnI.deferUpdate();

                            if (btnI.customId === 'prev_group_page') {
                                currentGroupPage--;
                            } else if (btnI.customId === 'next_group_page') {
                                currentGroupPage++;
                            } else if (btnI.customId === 'delete_groups_message') {
                                await followUpMessage.delete().catch(() => null);
                                paginationCollector.stop('deleted');
                                return;
                            }

                            try {
                                await btnI.editReply({
                                    embeds: [groupsPages[currentGroupPage]],
                                    components: [getGroupsPaginationRow(currentGroupPage)]
                                });
                            } catch { }
                        });

                        paginationCollector.on('end', async (collected, reason) => {
                            if (reason === 'deleted') return;
                            const disabledRow = getGroupsPaginationRow(currentGroupPage);
                            disabledRow.components.forEach(button => button.setDisabled(true));
                            try {
                                if (followUpMessage) {
                                    await followUpMessage.edit({ components: [disabledRow] }).catch(() => null);
                                }
                            } catch { }
                        });
                    } catch { }
                } else if (i.customId === 'show_avatar') {
                    let fullAvatarUrl = null;
                    try {
                        const avatarResponse = await axios.get(
                            `https://thumbnails.roblox.com/v1/users/avatar?userIds=${targetUserId}&size=720x720&format=Png&isCircular=false`
                        );
                        if (
                            avatarResponse.data &&
                            avatarResponse.data.data &&
                            avatarResponse.data.data.length > 0
                        ) {
                            fullAvatarUrl = avatarResponse.data.data[0].imageUrl;
                        }
                    } catch { }

                    if (fullAvatarUrl) {
                        await i.followUp({
                            embeds: [
                                new EmbedBuilder()
                                    .setColor(0xFBE7BD)
                                    .setTitle(`${targetUsername}'s Full Avatar`)
                                    .setImage(fullAvatarUrl)
                                    .setURL(`https://www.roblox.com/users/${targetUserId}/profile`)
                                    .setTimestamp()
                            ]
                        });
                    } else {
                        await i.followUp({
                            content: 'Could not fetch full avatar image.'
                        });
                    }
                }
            });

            initialButtonCollector.on('end', async (collected, reason) => {
                if (reason === 'time' || reason === 'idle') {
                    const originalReply = replyMessage;
                    if (originalReply && !(originalReply.flags && originalReply.flags.has && originalReply.flags.has(MessageFlags.Ephemeral))) {
                        const disabledComponents = components.map(row => {
                            const newRow = ActionRowBuilder.from(row);
                            newRow.components.forEach(button => button.setDisabled(true));
                            return newRow;
                        });
                        await originalReply.edit({ components: disabledComponents }).catch(() => {});
                    }
                }
            });
        }

    } catch (error) {
        try {
            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xFBE7BD)
                        .setTitle('Rate limit/Api down')
                        .setDescription('Not bot\'s fault, alr?')
                        .setTimestamp()
                ],
                components: []
            });
        } catch { }
    }
}

async function executeDiscordProfile(interaction) {
    let targetInput = interaction.options.getString('user');
    let targetUser = null;
    let targetMember = null;

    if (!targetInput) {
        targetUser = interaction.user;
        targetMember = interaction.member;
    } else {
        targetInput = targetInput.trim();
        const mentionMatch = targetInput.match(/^<@!?(\d+)>$/);
        const cleanId = mentionMatch ? mentionMatch[1] : (targetInput.match(/^\d{17,20}$/) ? targetInput : null);

        if (cleanId) {
            try {
                targetUser = await interaction.client.users.fetch(cleanId, { force: true });
            } catch { }
        }

        if (!targetUser && interaction.guild) {
            const query = targetInput.toLowerCase().replace(/^@/, '');
            try {
                const searchResults = await interaction.guild.members.fetch({ query, limit: 10 });
                const found = searchResults.find(m =>
                    m.user.username.toLowerCase() === query ||
                    m.displayName.toLowerCase() === query ||
                    (m.user.tag && m.user.tag.toLowerCase() === query)
                ) || searchResults.first();
                if (found) {
                    targetUser = found.user;
                    targetMember = found;
                }
            } catch { }
        }

        if (!targetUser) {
            const query = targetInput.toLowerCase().replace(/^@/, '');
            targetUser = interaction.client.users.cache.find(u =>
                u.username.toLowerCase() === query ||
                (u.tag && u.tag.toLowerCase() === query) ||
                (u.globalName && u.globalName.toLowerCase() === query)
            );
        }
    }

    if (!targetUser) {
        const notFoundEmbed = new EmbedBuilder()
            .setColor(0xFBE7BD)
            .setTitle('User Not Found')
            .setDescription(`Could not find any Discord user matching \`${targetInput}\`.\nPlease provide a valid ping (<@user>), username, or 17-20 digit User ID.`)
            .setTimestamp();
        return interaction.editReply({ embeds: [notFoundEmbed] });
    }

    try {
        targetUser = await interaction.client.users.fetch(targetUser.id, { force: true });
    } catch { }

    if (!targetMember && interaction.guild) {
        try {
            targetMember = interaction.guild.members.cache.get(targetUser.id) || await interaction.guild.members.fetch(targetUser.id);
        } catch { }
    }

    const linkedRoblox = await fetchLinkedRoblox(targetUser.id, interaction.guild?.id);
    const mainEmbed = buildDiscordProfileEmbed(targetUser, targetMember, linkedRoblox, interaction);
    const buttonsRow = buildProfileButtons(targetUser, targetMember, linkedRoblox);

    const replyMessage = await interaction.editReply({
        embeds: [mainEmbed],
        components: [buttonsRow]
    });

    const collector = replyMessage.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 180000
    });

    collector.on('collect', async i => {
        if (i.user.id !== interaction.user.id) {
            await i.reply({ content: 'You did not run this command', flags: MessageFlags.Ephemeral });
            return;
        }

        if (i.customId === `prof_delete_${targetUser.id}`) {
            await interaction.deleteReply().catch(() => null);
            collector.stop('deleted');
            return;
        }

        if (i.customId === `prof_avatar_${targetUser.id}`) {
            const hasServerAvatar = targetMember && targetMember.avatar;
            const globalAvatar = targetUser.displayAvatarURL({ dynamic: true, size: 4096 });
            const serverAvatar = hasServerAvatar ? targetMember.displayAvatarURL({ dynamic: true, size: 4096 }) : null;

            const avatarEmbed = new EmbedBuilder()
                .setColor(mainEmbed.data.color || 0xFBE7BD)
                .setTitle(`${targetMember?.displayName || targetUser.globalName || targetUser.username}'s Avatar`)
                .setImage(serverAvatar || globalAvatar)
                .setDescription(`[Direct Link](${serverAvatar || globalAvatar})`)
                .setTimestamp();

            const avatarRow = new ActionRowBuilder();
            if (hasServerAvatar) {
                avatarRow.addComponents(
                    new ButtonBuilder().setCustomId(`av_server_${targetUser.id}`).setLabel('Server Avatar').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId(`av_global_${targetUser.id}`).setLabel('Global Avatar').setStyle(ButtonStyle.Secondary)
                );
            }
            avatarRow.addComponents(
                new ButtonBuilder().setCustomId(`prof_back_${targetUser.id}`).setLabel('Back to Profile').setStyle(ButtonStyle.Secondary)
            );

            await i.update({ embeds: [avatarEmbed], components: [avatarRow] });
            return;
        }

        if (i.customId === `av_server_${targetUser.id}`) {
            const serverAvatar = targetMember?.displayAvatarURL({ dynamic: true, size: 4096 });
            const avatarEmbed = new EmbedBuilder()
                .setColor(mainEmbed.data.color || 0xFBE7BD)
                .setTitle(`${targetMember?.displayName || targetUser.username}'s Server Avatar`)
                .setImage(serverAvatar)
                .setDescription(`[Direct Link](${serverAvatar})`)
                .setTimestamp();

            const avatarRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`av_server_${targetUser.id}`).setLabel('Server Avatar').setStyle(ButtonStyle.Primary).setDisabled(true),
                new ButtonBuilder().setCustomId(`av_global_${targetUser.id}`).setLabel('Global Avatar').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(`prof_back_${targetUser.id}`).setLabel('Back to Profile').setStyle(ButtonStyle.Secondary)
            );
            await i.update({ embeds: [avatarEmbed], components: [avatarRow] });
            return;
        }

        if (i.customId === `av_global_${targetUser.id}`) {
            const globalAvatar = targetUser.displayAvatarURL({ dynamic: true, size: 4096 });
            const avatarEmbed = new EmbedBuilder()
                .setColor(mainEmbed.data.color || 0xFBE7BD)
                .setTitle(`${targetUser.globalName || targetUser.username}'s Global Avatar`)
                .setImage(globalAvatar)
                .setDescription(`[Direct Link](${globalAvatar})`)
                .setTimestamp();

            const avatarRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`av_server_${targetUser.id}`).setLabel('Server Avatar').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(`av_global_${targetUser.id}`).setLabel('Global Avatar').setStyle(ButtonStyle.Primary).setDisabled(true),
                new ButtonBuilder().setCustomId(`prof_back_${targetUser.id}`).setLabel('Back to Profile').setStyle(ButtonStyle.Secondary)
            );
            await i.update({ embeds: [avatarEmbed], components: [avatarRow] });
            return;
        }

        if (i.customId === `prof_banner_${targetUser.id}`) {
            const bannerUrl = targetUser.bannerURL({ dynamic: true, size: 4096 });
            const bannerEmbed = new EmbedBuilder()
                .setColor(mainEmbed.data.color || 0xFBE7BD)
                .setTitle(`${targetUser.globalName || targetUser.username}'s Banner`)
                .setImage(bannerUrl)
                .setDescription(`[Direct Link](${bannerUrl})`)
                .setTimestamp();

            const bannerRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`prof_back_${targetUser.id}`).setLabel('Back to Profile').setStyle(ButtonStyle.Secondary)
            );
            await i.update({ embeds: [bannerEmbed], components: [bannerRow] });
            return;
        }

        if (i.customId === `prof_roles_${targetUser.id}`) {
            const rolesList = targetMember?.roles.cache
                .filter(r => r.id !== interaction.guild?.id)
                .sort((a, b) => b.position - a.position);

            const rolesDescription = rolesList && rolesList.size > 0
                ? rolesList.map(r => `${r} (\`${r.id}\`)`).join('\n').slice(0, 4000)
                : 'No roles';

            const rolesEmbed = new EmbedBuilder()
                .setColor(mainEmbed.data.color || 0xFBE7BD)
                .setTitle(`${targetMember?.displayName || targetUser.username}'s Roles (${rolesList?.size || 0})`)
                .setDescription(rolesDescription)
                .setTimestamp();

            const rolesRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`prof_back_${targetUser.id}`).setLabel('Back to Profile').setStyle(ButtonStyle.Secondary)
            );
            await i.update({ embeds: [rolesEmbed], components: [rolesRow] });
            return;
        }

        if (i.customId === `prof_roblox_${targetUser.id}`) {
            if (linkedRoblox?.username) {
                await i.deferUpdate();
                await executeRobloxProfile(interaction, linkedRoblox.username, i);
            }
            return;
        }

        if (i.customId === `prof_back_${targetUser.id}`) {
            await i.update({ embeds: [mainEmbed], components: [buttonsRow] });
            return;
        }
    });

    collector.on('end', async (collected, reason) => {
        if (reason === 'deleted') return;
        const disabledRow = new ActionRowBuilder();
        buttonsRow.components.forEach(btn => {
            disabledRow.addComponents(ButtonBuilder.from(btn).setDisabled(true));
        });
        await replyMessage.edit({ components: [disabledRow] }).catch(() => null);
    });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('profile')
        .setDescription('Get profile informations')
        .setIntegrationTypes([0, 1])
        .setContexts([0, 1, 2])
        .addSubcommand(subcommand =>
            subcommand
                .setName('discord')
                .setDescription('Lookup a Discord user\'s profile')
                .addStringOption(option =>
                    option.setName('user')
                        .setDescription('User mention, username, or user ID (defaults to you)')
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('roblox')
                .setDescription('Lookup a Roblox user\'s profile!')
                .addStringOption(option =>
                    option.setName('username')
                        .setDescription('Username')
                        .setRequired(true)
                )
        ),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        if (sub === 'discord') {
            await interaction.deferReply({ flags: 0 });
            await executeDiscordProfile(interaction);
        } else if (sub === 'roblox') {
            const username = interaction.options.getString('username');
            await interaction.deferReply({ flags: 0 });
            await executeRobloxProfile(interaction, username);
        } else {
            await interaction.reply({ content: 'Invalid subcommand', flags: MessageFlags.Ephemeral });
        }
    }
};
