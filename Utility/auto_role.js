

module.exports = function startAutoRoleAssigner(client) {
    const TargetGuildId = '1426166275440382055';
    const TargetRoleId = '1426168230820712508';
    const ReconcileIntervalMs = 60 * 1000;

    let reconciling = false;
    const { IntentsBitField } = require('discord.js');
    const clientIntents = client?.options?.intents;
    const hasGuildMemberIntent = !!(clientIntents && (typeof clientIntents.has === 'function'
        ? clientIntents.has(IntentsBitField.Flags.GuildMembers)
        : (clientIntents & IntentsBitField.Flags.GuildMembers)));
    let listenerAvailable = hasGuildMemberIntent;


    async function tryAssignRoleToMember(member, reason = 'auto-role assign') {
        try {
            if (!member || !member.guild) return false;
            if (member.guild.id !== TargetGuildId) return false;
            if (member.user?.bot) return false;
            if (member.roles.cache.has(TargetRoleId)) return true;

            const role = member.guild.roles.cache.get(TargetRoleId);
            if (!role) {
                console.warn(`Auto-role: role ${TargetRoleId} not found in guild ${TargetGuildId}`);
                return false;
            }

            const me = member.guild.members.me || client.user && member.guild.members.cache.get(client.user.id);
            if (me && role.position >= (me.roles?.highest?.position || 0)) {
                console.warn(`Auto-role: cannot assign role ${TargetRoleId} because bot's role is not high enough.`);
                return false;
            }

            await member.roles.add(TargetRoleId, reason);
            console.log(`Auto-role: assigned role ${TargetRoleId} to ${member.user.tag} (${member.id})`);
            return true;
        } catch (err) {
            console.error(`Auto-role: failed to assign role to ${member?.id}:`, err?.message || err);
            return false;
        }
    }

    client.on('guildMemberAdd', async member => {
        try {
            if (member.guild.id !== TargetGuildId) return;
            const assigned = await tryAssignRoleToMember(member, 'assigned on guildMemberAdd');
            if (assigned) listenerAvailable = true;
        } catch (e) {
            listenerAvailable = false;
            console.error('Auto-role guildMemberAdd handler error:', e);
        }
    });

    setInterval(async () => {
        if (reconciling) return;
        if (listenerAvailable) return;

        reconciling = true;
        try {
            const guild = client.guilds.cache.get(TargetGuildId);
            if (!guild) return;

            for (const member of guild.members.cache.values()) {
                if (!member.user?.bot && !member.roles.cache.has(TargetRoleId)) {
                    await tryAssignRoleToMember(member, 'periodic reconciliation');
                }
            }
        } catch (err) {
            console.error('Auto-role reconciliation error:', err);
        } finally {
            reconciling = false;
        }
    }, ReconcileIntervalMs);
};
