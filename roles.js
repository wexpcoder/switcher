const { PermissionsBitField } = require('discord.js');
const { fetchSchedule } = require('./schedule');
const { checkPermissions } = require('./helpers');

module.exports = {
  assignRoles: async (channel) => {
    // Logic for assigning roles
    console.log('Assigning roles...');
  },

  runSchedule: async (channel, pool) => {
    console.log('Running schedule...');
    const usernames = await fetchSchedule(pool);
    if (!usernames.length) {
      await channel.send('No users scheduled for tomorrow.');
      return;
    }
    // Assign roles based on the fetched schedule
  },
};