const { Client, GatewayIntentBits } = require('discord.js');
const { handleCommand } = require('./commands');
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

client.on('messageCreate', (message) => {
  handleCommand(message, client, pool, channelMap, RTS_BOT_ID);
});

client.login(process.env.DISCORD_TOKEN);