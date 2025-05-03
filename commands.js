const { PermissionsBitField } = require('discord.js');
const { assignRoles, runSchedule } = require('./roles');
const { fetchSchedule, updateSchedule } = require('./schedule');
const { checkPermissions } = require('./helpers');

module.exports = {
  handleCommand: async (message, client, pool, channelMap, RTS_BOT_ID) => {
    if (message.author.bot) return;

    const { content, member, channel } = message;

    if (content.startsWith('!assignroles')) {
      if (!checkPermissions(member, PermissionsBitField.Flags.ManageRoles, channel)) return;
      await assignRoles(channel);
    }

    if (content.startsWith('!checkroles')) {
      // Add logic for checking roles
    }

    if (content.startsWith('!runschedule')) {
      if (!checkPermissions(member, PermissionsBitField.Flags.ManageRoles, channel)) return;
      await runSchedule(channel, pool);
    }

    if (content.startsWith('!updateschedule')) {
      if (!checkPermissions(member, PermissionsBitField.Flags.ManageRoles, channel)) return;
      await updateSchedule(message, pool);
    }

    if (content.startsWith('!help')) {
      const helpMessage = `
Available Commands:
!assignroles - Assigns Road Warriors role to users with Tomorrow role and removes Tomorrow role (requires Manage Roles).
!checkroles - Displays the number of users with the Tomorrow role and confirms RoadWarriors role exists.
!runschedule - Manually triggers the schedule assignment for tomorrow (requires Manage Roles).
!updateschedule - Uploads a CSV file to schedule users for tomorrow (requires Manage Roles).
!help - Displays this help message.
      `;
      await channel.send(helpMessage.trim());
    }
  },
};