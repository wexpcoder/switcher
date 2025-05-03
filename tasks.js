const cron = require('node-cron');
const { assignRoles, runSchedule } = require('./roles');

module.exports = {
  setupTasks: (client, TASK_CHANNEL_ID, GUILD_ID, pool) => {
    // 3:00 AM EDT task
    cron.schedule('0 7 * * *', async () => {
      console.log('Running 3:00 AM EDT assignRoles task');
      const channel = client.channels.cache.get(TASK_CHANNEL_ID);
      if (!channel) return console.error('Task channel not found');
      await assignRoles(channel);
    });

    // 8:00 PM EDT task
    cron.schedule('0 0 * * *', async () => {
      console.log('Running 8:00 PM EDT Tomorrow role assignment task');
      const channel = client.channels.cache.get(TASK_CHANNEL_ID);
      if (!channel) return console.error('Task channel not found');
      await runSchedule(channel, pool);
    });
  },
};