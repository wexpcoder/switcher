const { Client, GatewayIntentBits } = require('discord.js');
const { handleCommand, handleRescueMessage } = require('./commands');
const { setupTasks } = require('./tasks');
const { createPool } = require('./database');


require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const pool = createPool();
const GUILD_ID = process.env.GUILD_ID;
const TASK_CHANNEL_ID = process.env.TASK_CHANNEL_ID;
const RTS_BOT_ID = process.env.RTS_BOT_ID;
const channelMap = {}; // Define your channel map here

client.on('ready', () => {
  console.log('Bot is ready!');
  setupTasks(client, TASK_CHANNEL_ID, GUILD_ID, pool);
});

// Combined message event listener
client.on('messageCreate', async (message) => {
  // Handle commands
  handleCommand(message, client, pool, channelMap, RTS_BOT_ID);
  
  // Handle rescue messages
  await handleRescueMessage(message);
  
  // Pin any message starting with "### RTS Reminders" (from any user or bot)
  if (message.content.startsWith("### RTS Reminders")) {
    try {
      console.log(`Attempting to pin message starting with "### RTS Reminders" from ${message.author.username}`);
      await message.pin();
      console.log('Successfully pinned the message');
    } catch (error) {
      console.error('Failed to pin message:', error);
      // Add detailed error logging
      if (error.code === 30003) {
        console.error('Max pins reached (50)');
      } else if (error.code === 50013) {
        console.error('Missing permissions to pin messages');
      } else {
        console.error(`Error code: ${error.code}, Message: ${error.message}`);
      }
    }
  }
});

client.login(process.env.DISCORD_TOKEN);