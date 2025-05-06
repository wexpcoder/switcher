const cron = require('node-cron');
const { assignRoles, runSchedule } = require('./commands'); //Import runSchedule command from commands.js

module.exports = {
  setupTasks: (client, TASK_CHANNEL_ID, GUILD_ID, pool) => {
    // 7:00 PM EDT task (11:00 PM UTC)
    cron.schedule('00 1 * * *', async () => {
      console.log('Running 7:00 PM EDT runSchedule task');
      const channel = client.channels.cache.get(TASK_CHANNEL_ID);
      if (!channel) return console.error('Task channel not found');
      await runSchedule(channel, pool);
    });

    // 7:00 AM EDT task (11:00 AM UTC)
    cron.schedule('00 11 * * *', async () => {
      console.log('Running 7:00 AM EDT assignRoles task');
      const channel = client.channels.cache.get(TASK_CHANNEL_ID);
      if (!channel) return console.error('Task channel not found');
      await assignRoles(channel);
    });
  },
};