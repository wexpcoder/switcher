const cron = require('node-cron');
const { assignRoles, runSchedule, updateChannelTomorrowRole } = require('./commands');

module.exports = {
  setupTasks: (client, TASK_CHANNEL_ID, GUILD_ID, pool) => {
    // 7:00 PM EDT task (11:00 PM UTC)
    cron.schedule('35 21 * * *', async () => {
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

    // Sunday 7:00 PM EDT (23:00 UTC) - Add to Sunday, remove from Saturday
    cron.schedule('00 23 * * 0', async () => {
      console.log('Running Sunday channel role update');
      const guild = client.guilds.cache.get(GUILD_ID);
      if (!guild) return console.error('Guild not found');
      
      const result = await updateChannelTomorrowRole(
        guild, 
        process.env.SUNDAY_CHANNEL_ID, 
        process.env.SATURDAY_CHANNEL_ID
      );
      
      if (!result.success) {
        console.error('Sunday channel role update failed:', result.error);
      }
    });

    // Monday 7:00 PM EDT (23:00 UTC) - Add to Monday, remove from Sunday
    cron.schedule('00 23 * * 1', async () => {
      console.log('Running Monday channel role update');
      const guild = client.guilds.cache.get(GUILD_ID);
      if (!guild) return console.error('Guild not found');
      
      const result = await updateChannelTomorrowRole(
        guild, 
        process.env.MONDAY_CHANNEL_ID, 
        process.env.SUNDAY_CHANNEL_ID
      );
      
      if (!result.success) {
        console.error('Monday channel role update failed:', result.error);
      }
    });

    // Tuesday 7:00 PM EDT (23:00 UTC) - Add to Tuesday, remove from Monday
    cron.schedule('00 23 * * 2', async () => {
      console.log('Running Tuesday channel role update');
      const guild = client.guilds.cache.get(GUILD_ID);
      if (!guild) return console.error('Guild not found');
      
      const result = await updateChannelTomorrowRole(
        guild, 
        process.env.TUESDAY_CHANNEL_ID, 
        process.env.MONDAY_CHANNEL_ID
      );
      
      if (!result.success) {
        console.error('Tuesday channel role update failed:', result.error);
      }
    });

    // Wednesday 7:00 PM EDT (23:00 UTC) - Add to Wednesday, remove from Tuesday
    cron.schedule('50 21 * * 2', async () => {
      console.log('Running Wednesday channel role update');
      const guild = client.guilds.cache.get(GUILD_ID);
      if (!guild) return console.error('Guild not found');
      
      const result = await updateChannelTomorrowRole(
        guild, 
        process.env.WEDNESDAY_CHANNEL_ID, 
        process.env.TUESDAY_CHANNEL_ID
      );
      
      if (!result.success) {
        console.error('Wednesday channel role update failed:', result.error);
      }
    });

    // Thursday 7:00 PM EDT (23:00 UTC) - Add to Thursday, remove from Wednesday
    cron.schedule('00 23 * * 4', async () => {
      console.log('Running Thursday channel role update');
      const guild = client.guilds.cache.get(GUILD_ID);
      if (!guild) return console.error('Guild not found');
      
      const result = await updateChannelTomorrowRole(
        guild, 
        process.env.THURSDAY_CHANNEL_ID, 
        process.env.WEDNESDAY_CHANNEL_ID
      );
      
      if (!result.success) {
        console.error('Thursday channel role update failed:', result.error);
      }
    });

    // Friday 7:00 PM EDT (23:00 UTC) - Add to Friday, remove from Thursday
    cron.schedule('00 23 * * 5', async () => {
      console.log('Running Friday channel role update');
      const guild = client.guilds.cache.get(GUILD_ID);
      if (!guild) return console.error('Guild not found');
      
      const result = await updateChannelTomorrowRole(
        guild, 
        process.env.FRIDAY_CHANNEL_ID, 
        process.env.THURSDAY_CHANNEL_ID
      );
      
      if (!result.success) {
        console.error('Friday channel role update failed:', result.error);
      }
    });

    // Saturday 7:00 PM EDT (23:00 UTC) - Add to Saturday, remove from Friday
    cron.schedule('00 23 * * 6', async () => {
      console.log('Running Saturday channel role update');
      const guild = client.guilds.cache.get(GUILD_ID);
      if (!guild) return console.error('Guild not found');
      
      const result = await updateChannelTomorrowRole(
        guild, 
        process.env.SATURDAY_CHANNEL_ID, 
        process.env.FRIDAY_CHANNEL_ID
      );
      
      if (!result.success) {
        console.error('Saturday channel role update failed:', result.error);
      }
    });
  },
};