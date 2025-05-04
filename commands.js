const { PermissionsBitField } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse'); // Use a CSV parser library for handling CSV files
const axios = require('axios');
const { uploadFile, createFolder } = require('./driveUtils');

/**
 * Function to handle the !updateschedule command.
 * This function:
 * 1. Reads usernames from an attached .csv file.
 * 2. Purges the `schedule` table in the database.
 * 3. Inserts the new list of usernames with the current date.
 * 4. Provides:
 *    - The count of usernames added during the operation.
 *    - The total count of usernames in the database (should match the added count since the table is purged).
 * @param {Object} message - The Discord message object.
 * @param {Object} pool - The Postgres database connection pool.
 */
async function updateScheduleWithCSV(message, pool) {
  try {
    const { channel, attachments } = message;

    console.log("Processing !updateschedule command...");

    // Step 1: Check for an attached .csv file
    if (attachments.size === 0) {
      await channel.send("Please attach a .csv file containing the list of usernames.");
      return;
    }

    const csvAttachment = attachments.find(attachment => attachment.name.endsWith('.csv'));
    if (!csvAttachment) {
      await channel.send("No valid .csv file attached. Please attach a .csv file containing the list of usernames.");
      return;
    }

    // Step 2: Download the .csv file
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir); // Create temp directory if it doesn't exist
    }

    const csvFilePath = path.join(tempDir, csvAttachment.name);
    const response = await fetch(csvAttachment.url);
    const fileStream = fs.createWriteStream(csvFilePath);
    await new Promise((resolve, reject) => {
      response.body.pipe(fileStream);
      response.body.on("error", reject);
      fileStream.on("finish", resolve);
    });

    console.log(`Downloaded .csv file to ${csvFilePath}`);

    // Step 3: Parse the .csv file to extract usernames
    const usernamesToAdd = [];
    await new Promise((resolve, reject) => {
      fs.createReadStream(csvFilePath)
        .pipe(csvParser())
        .on('data', row => {
          if (row.username) {
            usernamesToAdd.push(row.username.trim());
          }
        })
        .on('end', resolve)
        .on('error', reject);
    });

    console.log(`Parsed usernames from .csv: ${usernamesToAdd.join(', ')}`);

    // Step 4: Purge the schedule table
    const purgeQuery = 'DELETE FROM schedule';
    await pool.query(purgeQuery);
    console.log("Schedule table purged.");

    // Step 5: Insert new usernames into the database
    const currentDate = new Date().toISOString().split('T')[0]; // Format: YYYY-MM-DD
    let addedCount = 0;

    for (const username of usernamesToAdd) {
      const query = 'INSERT INTO schedule (username, date) VALUES ($1, $2)';
      const result = await pool.query(query, [username, currentDate]);

      if (result.rowCount > 0) {
        addedCount++;
      }
    }

    // Step 6: Fetch the total count of usernames in the database
    const totalCountQuery = 'SELECT COUNT(*) AS total FROM schedule';
    const totalResult = await pool.query(totalCountQuery);
    const totalUsernames = totalResult.rows[0].total;

    console.log(`Schedule updated. ${addedCount} usernames added to the database. Total usernames: ${totalUsernames}.`);
    await channel.send(`Schedule updated. ${addedCount} usernames added to the database. Total usernames: ${totalUsernames}.`);

    // Clean up the temporary file
    fs.unlinkSync(csvFilePath);
    console.log(`Deleted temporary file: ${csvFilePath}`);
  } catch (error) {
    console.error("Error in updateScheduleWithCSV:", error);
    await message.channel.send("An error occurred while updating the schedule.");
  }
}

/**
 * Function to handle the !runschedule command.
 * This function:
 * 1. Queries all usernames from the Postgres table.
 * 2. Assigns the "Tomorrow" role to usernames in the table.
 * 3. Removes the "Tomorrow" role from users who have it but are not in the table.
 * @param {Object} channel - The Discord channel where the command was invoked.
 * @param {Object} pool - The Postgres database connection pool.
 */
async function runSchedule(channel, pool) {
  try {
    console.log("Running schedule...");

    // Step 1: Query the database for all usernames
    const query = 'SELECT username FROM schedule';
    console.log("Querying database for all usernames...");
    const result = await pool.query(query);

    if (result.rows.length === 0) {
      console.log("No users found in the database.");
      await channel.send("No users found in the database.");
      return;
    }

    const usernamesInTable = result.rows.map(row => row.username);
    console.log(`Usernames found in the table: ${usernamesInTable.join(', ')}`);

    // Step 2: Fetch the "Tomorrow" role
    const tomorrowRole = channel.guild.roles.cache.find(role => role.name === "Tomorrow");
    if (!tomorrowRole) {
      console.error("Role 'Tomorrow' does not exist.");
      await channel.send("Error: 'Tomorrow' role does not exist.");
      return;
    }

    // Step 3: Evaluate each member with the "Tomorrow" role
    const membersWithTomorrowRole = tomorrowRole.members;
    for (const [memberId, member] of membersWithTomorrowRole) {
      if (!usernamesInTable.includes(member.user.username)) {
        // Remove the "Tomorrow" role if the user is not in the table
        await member.roles.remove(tomorrowRole);
        console.log(`Removed 'Tomorrow' role from ${member.user.username}`);
      }
    }

    // Step 4: Assign the "Tomorrow" role to users in the table
    for (const username of usernamesInTable) {
      const member = channel.guild.members.cache.find(m => m.user.username === username);
      if (!member) {
        console.log(`User ${username} not found in the guild.`);
        continue; // Skip if the user is not found
      }

      if (!member.roles.cache.has(tomorrowRole.id)) {
        await member.roles.add(tomorrowRole);
        console.log(`Assigned 'Tomorrow' role to ${username}`);
      }
    }

    console.log("Schedule processing complete.");
    await channel.send("Schedule processing complete.");
  } catch (error) {
    console.error("Error in runSchedule:", error);
    await channel.send("An error occurred while running the schedule.");
  }
}

/**
 * Function to handle the !uploadphoto command.
 * This function:
 * 1. Fetches recent messages in the channel.
 * 2. Uploads photo attachments to Google Drive, organizing them into folders by date and username.
 * @param {Object} channel - The Discord channel where the command was invoked.
 */
async function uploadPhotos(channel) {
  console.log('Starting !uploadphoto command...');
  try {
    // Fetch the last 50 messages in the channel
    const fetchedMessages = await channel.messages.fetch({ limit: 50 });

    // Filter messages with photo attachments
    const photoMessages = fetchedMessages.filter((msg) =>
      msg.attachments.some((attachment) =>
        ['image/jpeg', 'image/png'].includes(attachment.contentType)
      )
    );

    if (photoMessages.size === 0) {
      console.log('No photos found in the last 50 messages.');
      await channel.send('No photos found in the last 50 messages.');
      return;
    }

    // Use the current date logic
    const now = new Date();
    const currentDate = new Date(
      now.toLocaleString('en-US', { timeZone: 'America/New_York' })
    )
      .toISOString()
      .split('T')[0]; // Format: YYYY-MM-DD

    // Create a folder for the current date
    const dailyFolderId = await createFolder(currentDate, process.env.GOOGLE_DRIVE_FOLDER_ID);

    // Process each photo and upload it to the appropriate user's subfolder
    for (const msg of photoMessages.values()) {
      const userId = msg.author.id;
      const userName = msg.author.username;
      const userFolderName = `${userName}_${userId}`;

      // Create a subfolder for the user if it doesn't exist
      const userFolderId = await createFolder(userFolderName, dailyFolderId);

      for (const attachment of msg.attachments.values()) {
        const fileUrl = attachment.url; // URL of the photo
        const fileName = attachment.name || 'photo.jpg'; // Default name if none provided
        const tempDir = path.join(__dirname, 'temp');
        const filePath = path.join(tempDir, fileName);

        // Ensure temp directory exists
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir);
        }

        // Download the photo using axios
        const response = await axios({
          url: fileUrl,
          method: 'GET',
          responseType: 'stream', // Get the response as a stream
        });

        // Save the file temporarily
        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);

        // Wait for the file to finish writing
        await new Promise((resolve, reject) => {
          writer.on('finish', resolve);
          writer.on('error', reject);
        });

        // Upload the file to the user's subfolder in Google Drive
        await uploadFile(filePath, fileName, attachment.contentType, userFolderId);

        // Clean up the temporary file
        fs.unlinkSync(filePath);

        console.log(`Uploaded photo "${fileName}" for user "${userName}" to Google Drive.`);
      }
    }

    console.log('Photo upload process completed.');
    await channel.send('Photo upload process completed.');
  } catch (error) {
    console.error('Error in !uploadphoto command:', error);
    await channel.send('An error occurred while uploading photos.');
  }
}

module.exports = {
  /**
   * Function to handle all commands.
   * @param {Object} message - The Discord message object.
   * @param {Object} client - The Discord client object.
   * @param {Object} pool - The Postgres database connection pool.
   * @param {Object} channelMap - A map of channels.
   * @param {string} RTS_BOT_ID - The bot's ID.
   */
  handleCommand: async (message, client, pool, channelMap, RTS_BOT_ID) => {
    if (message.author.bot) return;

    const { content, member, channel } = message;

    // Command: Update schedule
    if (content.startsWith('!updateschedule')) {
      if (!member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
        await channel.send("You do not have permission to use this command.");
        return;
      }
      await updateScheduleWithCSV(message, pool);
    }

    // Command: Run schedule
    if (content.startsWith('!runschedule')) {
      console.log("Running schedule command...");
      if (!member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
        await channel.send("You do not have permission to use this command.");
        return;
      }
      await runSchedule(channel, pool);
    }

    // Command: Upload photos
    if (content.startsWith('!uploadphoto')) {
      if (!member.permissions.has(PermissionsBitField.Flags.AttachFiles)) {
        await channel.send("You do not have permission to use this command.");
        return;
      }
      await uploadPhotos(channel);
    }

    // Other commands can be added here...
  },
};