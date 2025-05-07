const cron = require('node-cron');
const { assignRoles, runSchedule, updateChannelTomorrowRole } = require('./commands');

module.exports = {
  setupTasks: (client, TASK_CHANNEL_ID, GUILD_ID, pool) => {
    // 7:00 PM EDT task (11:00 PM UTC)
    cron.schedule('30 22 * * *', async () => {
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

    // Helper function for channel updates
    async function runDayChannelUpdate(dayName, addToChannelId, removeFromChannelId) {
      console.log(`Running ${dayName} channel role update`);
      const guild = client.guilds.cache.get(GUILD_ID);
      if (!guild) {
        console.error('Guild not found');
        return;
      }
      
      // Get the task channel for sending notifications
      const taskChannel = client.channels.cache.get(TASK_CHANNEL_ID);
      
      try {
        const result = await updateChannelTomorrowRole(
          guild, 
          addToChannelId, 
          removeFromChannelId
        );
        
        if (!result.success) {
          console.error(`${dayName} channel role update failed:`, result.error);
          
          // Send failure message to task channel
          if (taskChannel) {
            await taskChannel.send(`❌ ${dayName} channel role update failed: ${result.error}`);
          }
        } else {
          // Send success message to task channel
          if (taskChannel) {
            await taskChannel.send(`✅ Successfully updated channel permissions: Added Tomorrow role to ${dayName} channel`);
          }
        }
      } catch (error) {
        console.error(`Error in ${dayName} channel update:`, error);
        
        // Send error message to task channel
        if (taskChannel) {
          await taskChannel.send(`❌ Error in ${dayName} channel update: ${error.message}`);
        }
      }
    }

    // Sunday 7:00 PM EDT (23:00 UTC) - Add to Sunday, remove from Saturday
    cron.schedule('00 23 * * 6', () => runDayChannelUpdate('Sunday', process.env.SUNDAY_CHANNEL_ID, process.env.SATURDAY_CHANNEL_ID));

    // Monday 7:00 PM EDT (23:00 UTC) - Add to Monday, remove from Sunday
    cron.schedule('00 23 * * 0', () => runDayChannelUpdate('Monday', process.env.MONDAY_CHANNEL_ID, process.env.SUNDAY_CHANNEL_ID));

    // Tuesday 7:00 PM EDT (23:00 UTC) - Add to Tuesday, remove from Monday
    cron.schedule('00 23 * * 1', () => runDayChannelUpdate('Tuesday', process.env.TUESDAY_CHANNEL_ID, process.env.MONDAY_CHANNEL_ID));

    // Wednesday 7:00 PM EDT (23:00 UTC) - Add to Wednesday, remove from Tuesday
    cron.schedule('00 23 * * 2', () => runDayChannelUpdate('Wednesday', process.env.WEDNESDAY_CHANNEL_ID, process.env.TUESDAY_CHANNEL_ID));

    // Thursday 7:00 PM EDT (23:00 UTC) - Add to Thursday, remove from Wednesday
    cron.schedule('00 23 * * 3', () => runDayChannelUpdate('Thursday', process.env.THURSDAY_CHANNEL_ID, process.env.WEDNESDAY_CHANNEL_ID));

    // Friday 7:00 PM EDT (23:00 UTC) - Add to Friday, remove from Thursday
    cron.schedule('00 23 * * 4', () => runDayChannelUpdate('Friday', process.env.FRIDAY_CHANNEL_ID, process.env.THURSDAY_CHANNEL_ID));

    // Saturday 7:00 PM EDT (23:00 UTC) - Add to Saturday, remove from Friday
    cron.schedule('00 23 * * 5', () => runDayChannelUpdate('Saturday', process.env.SATURDAY_CHANNEL_ID, process.env.FRIDAY_CHANNEL_ID));
  },
};