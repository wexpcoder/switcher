const { PermissionsBitField } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse');
const axios = require('axios');
const { drive, uploadFile, createFolder } = require('./driveUtils');

// In-memory cache to store folder IDs
const folderCache = {};

// Set up periodic cache expiration (every 6 hours)
setInterval(() => {
  const cacheSize = Object.keys(folderCache).length;
  if (cacheSize > 0) {
    console.log(`Clearing folder cache (${cacheSize} entries) as part of periodic maintenance`);
    Object.keys(folderCache).forEach(key => delete folderCache[key]);
    console.log('Folder cache cleared.');
  }
}, 6 * 60 * 60 * 1000);

/**
 * Helper function to find or create a folder in Google Drive.
 * Uses an in-memory cache and Google Drive API to avoid duplicate folders and verify folder existence.
 * @param {string} folderName - The name of the folder (e.g., '2025-05-04' or 'userA_123').
 * @param {string} parentFolderId - The ID of the parent folder.
 * @param {boolean} forceRefresh - Whether to force a refresh of the folder (ignore cache).
 * @returns {string} The ID of the existing or newly created folder.
 */
async function findOrCreateFolder(folderName, parentFolderId, forceRefresh = false) {
  try {
    const cacheKey = `${parentFolderId}:${folderName}`;

    // Skip cache if force refresh is requested
    if (forceRefresh && folderCache[cacheKey]) {
      console.log(`Force refresh requested for folder '${folderName}', clearing cache entry`);
      delete folderCache[cacheKey];
    }

    // Check if folder ID is cached
    if (folderCache[cacheKey]) {
      console.log(`Found cached folder '${folderName}' with ID ${folderCache[cacheKey]}`);
      try {
        // Simple verification that folder exists
        const folderResponse = await drive.files.get({
          fileId: folderCache[cacheKey],
          fields: 'id',
        });
        
        if (!folderResponse || !folderResponse.data) {
          throw new Error('Google Drive API returned an invalid response for cached folder.');
        }
        
        console.log(`Verified cached folder '${folderName}' exists with ID ${folderCache[cacheKey]}`);
        return folderCache[cacheKey];
      } catch (error) {
        console.warn(`Cached folder '${folderName}' with ID ${folderCache[cacheKey]} does not exist or is inaccessible: ${error.message}`);
        delete folderCache[cacheKey];
      }
    }

    // Query Google Drive for existing folder
    console.log(`Checking Google Drive for folder '${folderName}' under parent ID ${parentFolderId}`);
    const response = await drive.files.list({
      q: `name='${folderName}' and '${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id)',
    });
    if (!response || !response.data || !response.data.files) {
      throw new Error('Google Drive API returned an invalid response for folder search.');
    }
    const folders = response.data.files;
    if (folders.length > 0) {
      console.log(`Found existing folder '${folderName}' with ID ${folders[0].id}`);
      folderCache[cacheKey] = folders[0].id;
      return folders[0].id;
    }

    // Create a new folder
    console.log(`Creating new folder '${folderName}' under parent ID ${parentFolderId}`);
    const folderId = await createFolder(folderName, parentFolderId);
    folderCache[cacheKey] = folderId;
    return folderId;
  } catch (error) {
    console.error(`Error in findOrCreateFolder for '${folderName}':`, error);
    throw error;
  }
}

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

    // Use axios for downloading the file as a stream
    const response = await axios({
      url: csvAttachment.url,
      method: 'GET',
      responseType: 'stream', // Ensure the response is a stream
    });

    const fileStream = fs.createWriteStream(csvFilePath);
    await new Promise((resolve, reject) => {
      response.data.pipe(fileStream);
      response.data.on("error", reject);
      fileStream.on("finish", resolve);
    });

    console.log(`Downloaded .css file to ${csvFilePath}`);

    // Step 3: Parse the .csv file to extract usernames
    const usernamesToAdd = [];
    await new Promise((resolve, reject) => {
      fs.createReadStream(csvFilePath)
        .pipe(parse({ columns: true })) // Use csv-parse with columns enabled
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
    console.log("Running schedule now.");

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

    // Step 2: Fetch all guild members to ensure the cache is populated
    await channel.guild.members.fetch();

    // Step 3: Fetch the "Tomorrow" role
    const tomorrowRole = channel.guild.roles.cache.find(role => role.name === "Tomorrow");
    if (!tomorrowRole) {
      console.error("Role 'Tomorrow' does not exist.");
      await channel.send("Error: 'Tomorrow' role does not exist.");
      return;
    }

    // Step 4: Evaluate each member with the "Tomorrow" role
    const membersWithTomorrowRole = tomorrowRole.members;
    let removedCount = 0;
    for (const [memberId, member] of membersWithTomorrowRole) {
      if (!usernamesInTable.includes(member.user.username)) {
        // Remove the "Tomorrow" role if the user is not in the table
        await member.roles.remove(tomorrowRole);
        removedCount++;
        console.log(`Removed 'Tomorrow' role from ${member.user.username}`);
      }
    }

    // Step 5: Assign the "Tomorrow" role to users in the table
    let assignedCount = 0;
    let notFoundCount = 0;
    for (const username of usernamesInTable) {
      const member = channel.guild.members.cache.find(m => m.user.username.toLowerCase() === username.toLowerCase());
      if (!member) {
        notFoundCount++;
        console.log(`User ${username} not found in the guild.`);
        continue; // Skip if the user is not found
      }

      if (!member.roles.cache.has(tomorrowRole.id)) {
        await member.roles.add(tomorrowRole);
        assignedCount++;
        console.log(`Assigned 'Tomorrow' role to ${username}`);
      }
    }

    console.log(`Schedule processing complete. ${assignedCount} users assigned, ${removedCount} users removed, ${notFoundCount} users not found.`);
    await channel.send(`✅ Success! Added ${assignedCount} drivers for tomorrow. Drivers removed: ${removedCount}`);
  } catch (error) {
    console.error("Error in runSchedule:", error);
    await channel.send("An error occurred while running the schedule.");
  }
}

/**
 * Helper function to upload photos to Google Drive.
 * @param {Object} message - The Discord message object containing photo attachments.
 */
async function autoUploadPhotos(message) {
  try {
    // Clear entire folder cache at start of each upload session
    const cacheCount = Object.keys(folderCache).length;
    if (cacheCount > 0) {
      console.log(`Clearing folder cache (${cacheCount} entries) for fresh folder verification`);
      Object.keys(folderCache).forEach(key => delete folderCache[key]);
    }
    
    const channel = message.channel;
    const attachments = message.attachments.filter((attachment) =>
      ['image/jpeg', 'image/png'].includes(attachment.contentType)
    );

    if (attachments.size < 4) {
      console.log(`Not enough photo attachments (${attachments.size} photos, minimum 4 required).`);
      return;
    }

    // Verify parent folder accessibility
    try {
      await drive.files.get({
        fileId: process.env.GOOGLE_DRIVE_FOLDER_ID,
        fields: 'id, name, permissions',
      });
      console.log(`Parent folder ID ${process.env.GOOGLE_DRIVE_FOLDER_ID} is accessible`);
    } catch (error) {
      console.error(`Parent folder ID ${process.env.GOOGLE_DRIVE_FOLDER_ID} is not accessible:`, error);
      await channel.send(`Error: Cannot access Google Drive parent folder. Please check GOOGLE_DRIVE_FOLDER_ID.`);
      return;
    }

    // Use the current date logic
    const now = new Date();
    const currentDate = new Date(
      now.toLocaleString('en-US', { timeZone: 'America/New_York' })
    )
      .toISOString()
      .split('T')[0]; // Format: YYYY-MM-DD

    // Find or create a folder for the current date
    let dailyFolderId;
    try {
      dailyFolderId = await findOrCreateFolder(currentDate, process.env.GOOGLE_DRIVE_FOLDER_ID);
      
      // Additional verification of daily folder
      await drive.files.get({
        fileId: dailyFolderId,
        fields: 'id',
      });
      console.log(`Successfully verified daily folder with ID: ${dailyFolderId}`);
    } catch (error) {
      console.error(`Error ensuring daily folder exists:`, error);
      await channel.send(`Error: Could not create or access the daily folder. Please try again.`);
      return;
    }

    const userId = message.author.id;
    const userName = message.author.username;
    const userFolderName = `${userName}_${userId}`;

    // Create a subfolder for the user if it doesn't exist
    let userFolderId;
    try {
      // First try with normal caching
      userFolderId = await findOrCreateFolder(userFolderName, dailyFolderId);
      
      // Additional verification of user folder
      await drive.files.get({
        fileId: userFolderId,
        fields: 'id',
      });
      console.log(`Successfully verified user folder with ID: ${userFolderId}`);
    } catch (error) {
      console.error(`Error ensuring user folder exists:`, error);
      
      // Force refresh and try again
      try {
        console.log(`Forcing refresh for user folder '${userFolderName}'`);
        userFolderId = await findOrCreateFolder(userFolderName, dailyFolderId, true);
        console.log(`Re-created user folder with ID: ${userFolderId}`);
      } catch (retryError) {
        console.error(`Failed to recreate user folder:`, retryError);
        await channel.send(`Error: Could not create or access your user folder. Please try again.`);
        return;
      }
    }

    let successCount = 0;
    let failureCount = 0;

    for (const attachment of attachments.values()) {
      const fileUrl = attachment.url;
      const fileName = attachment.name || 'photo.jpg';
      const tempDir = path.join(__dirname, 'temp');
      const filePath = path.join(tempDir, fileName);

      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir);
      }

      const response = await axios({
        url: fileUrl,
        method: 'GET',
        responseType: 'stream',
      });

      const writer = fs.createWriteStream(filePath);
      response.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });

      let fileId;
      try {
        fileId = await uploadFile(filePath, fileName, attachment.contentType, userFolderId);
        
        // Verify the file was actually uploaded
        await drive.files.get({
          fileId: fileId,
          fields: 'id, name',
        });
        
        successCount++;
        console.log(`Auto-uploaded photo "${fileName}" for user "${userName}" to Google Drive with ID: ${fileId}`);
      } catch (uploadError) {
        failureCount++;
        console.error(`Failed to upload photo "${fileName}" to folder ID ${userFolderId}:`, uploadError);
      } finally {
        // Clean up the temporary file
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
    }

    if (failureCount > 0) {
      console.log(`Upload summary: ${successCount} photos uploaded successfully, ${failureCount} photos failed.`);
      if (failureCount === attachments.size) {
        await channel.send(`Error: Failed to upload all photos. Please try again.`);
      } else if (successCount > 0) {
        await channel.send(`Partial success: ${successCount} photos uploaded, ${failureCount} photos failed.`);
      }
    } else if (successCount > 0) {
      console.log(`All ${successCount} photos uploaded successfully.`);
    }
  } catch (error) {
    console.error('Error in autoUploadPhotos:', error);
    await channel.send(`Error uploading photos: ${error.message}`);
  }
}

/**
 * Function to handle the !uploadphoto command.
 * This function:
 * 1. Fetches recent messages in the channel.
 * 2. Ensures there are 4 or more photo attachments (JPEG or PNG).
 * 3. Uploads photo attachments to Google Drive, organizing them into folders by date and username.
 * @param {Object} channel - The Discord channel where the command was invoked.
 */
async function uploadPhotos(channel) {
  console.log('Starting !uploadphoto command...');
  try {
    // Verify parent folder accessibility
    try {
      await drive.files.get({
        fileId: process.env.GOOGLE_DRIVE_FOLDER_ID,
        fields: 'id, name, permissions',
      });
      console.log(`Parent folder ID ${process.env.GOOGLE_DRIVE_FOLDER_ID} is accessible`);
    } catch (error) {
      console.error(`Parent folder ID ${process.env.GOOGLE_DRIVE_FOLDER_ID} is not accessible:`, error);
      await channel.send(`Error: Cannot access Google Drive parent folder. Please check GOOGLE_DRIVE_FOLDER_ID.`);
      return;
    }

    // Fetch the last 50 messages in the channel
    const fetchedMessages = await channel.messages.fetch({ limit: 50 });

    // Filter messages with photo attachments
    const photoMessages = fetchedMessages.filter((msg) =>
      msg.attachments.some((attachment) =>
        ['image/jpeg', 'image/png'].includes(attachment.contentType)
      )
    );

    // Count total photo attachments
    let totalPhotos = 0;
    for (const msg of photoMessages.values()) {
      totalPhotos += msg.attachments.filter((attachment) =>
        ['image/jpeg', 'image/png'].includes(attachment.contentType)
      ).size;
    }

    if (totalPhotos < 4) {
      console.log(`Not enough photos found (${totalPhotos} photos, minimum 4 required).`);
      await channel.send(`Not enough photos found (${totalPhotos} photos, minimum 4 required).`);
      return;
    }

    // Use the current date logic
    const now = new Date();
    const currentDate = new Date(
      now.toLocaleString('en-US', { timeZone: 'America/New_York' })
    )
      .toISOString()
      .split('T')[0]; // Format: YYYY-MM-DD

    // Find or create a folder for the current date with verification
    let dailyFolderId;
    try {
      dailyFolderId = await findOrCreateFolder(currentDate, process.env.GOOGLE_DRIVE_FOLDER_ID);
      
      // Verify the daily folder exists
      await drive.files.get({
        fileId: dailyFolderId,
        fields: 'id',
      });
      console.log(`Successfully verified daily folder with ID: ${dailyFolderId}`);
    } catch (error) {
      console.error(`Error ensuring daily folder exists:`, error);
      await channel.send(`Error: Could not create or access the daily folder. Please try again.`);
      return;
    }

    // Track upload statistics
    let totalSuccessCount = 0;
    let totalFailureCount = 0;

    // Process each photo and upload it to the appropriate user's subfolder
    for (const msg of photoMessages.values()) {
      const userId = msg.author.id;
      const userName = msg.author.username;
      const userFolderName = `${userName}_${userId}`;

      // Create a subfolder for the user with verification
      let userFolderId;
      try {
        userFolderId = await findOrCreateFolder(userFolderName, dailyFolderId);
        
        // Verify the user folder exists
        await drive.files.get({
          fileId: userFolderId,
          fields: 'id',
        });
        console.log(`Successfully verified user folder with ID: ${userFolderId}`);
      } catch (error) {
        console.error(`Error ensuring user folder exists for ${userName}:`, error);
        
        // Force recreation of the user folder by clearing cache entry
        const cacheKey = `${dailyFolderId}:${userFolderName}`;
        if (folderCache[cacheKey]) {
          delete folderCache[cacheKey];
        }
        
        try {
          userFolderId = await findOrCreateFolder(userFolderName, dailyFolderId);
          console.log(`Re-created user folder with ID: ${userFolderId}`);
        } catch (retryError) {
          console.error(`Failed to recreate user folder for ${userName}:`, retryError);
          await channel.send(`Error: Could not create or access folder for user ${userName}. Skipping their photos.`);
          continue; // Skip this user's photos
        }
      }

      let userSuccessCount = 0;
      let userFailureCount = 0;

      for (const attachment of msg.attachments.values()) {
        // Skip non-image attachments
        if (!['image/jpeg', 'image/png'].includes(attachment.contentType)) {
          continue;
        }
        
        const fileUrl = attachment.url;
        const fileName = attachment.name || 'photo.jpg';
        const tempDir = path.join(__dirname, 'temp');
        const filePath = path.join(tempDir, fileName);

        // Ensure temp directory exists
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir);
        }

        try {
          // Download the photo using axios
          const response = await axios({
            url: fileUrl,
            method: 'GET',
            responseType: 'stream',
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
          const fileId = await uploadFile(filePath, fileName, attachment.contentType, userFolderId);
          
          // Verify the file was uploaded successfully
          await drive.files.get({
            fileId: fileId,
            fields: 'id, name',
          });
          
          userSuccessCount++;
          totalSuccessCount++;
          console.log(`Uploaded photo "${fileName}" for user "${userName}" to Google Drive with ID: ${fileId}`);
        } catch (error) {
          userFailureCount++;
          totalFailureCount++;
          console.error(`Failed to upload photo "${fileName}" for user "${userName}":`, error);
        } finally {
          // Clean up the temporary file
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        }
      }

      if (userFailureCount > 0) {
        console.log(`Upload results for ${userName}: ${userSuccessCount} successful, ${userFailureCount} failed`);
      }
    }

    // Report overall results
    if (totalFailureCount > 0) {
      if (totalSuccessCount > 0) {
        await channel.send(`Partial success: ${totalSuccessCount} photos uploaded, ${totalFailureCount} photos failed.`);
      } else {
        await channel.send(`Error: Failed to upload all photos. Please try again.`);
      }
    } else if (totalSuccessCount > 0) {
      await channel.send(`Success: All ${totalSuccessCount} photos uploaded successfully.`);
    } else {
      await channel.send(`No eligible photos were processed.`);
    }

    console.log(`Photo upload process completed. Total: ${totalSuccessCount} successful, ${totalFailureCount} failed.`);
  } catch (error) {
    console.error('Error in !uploadphoto command:', error);
    await channel.send(`Error uploading photos: ${error.message}`);
  }
}

/**
 * Function to handle the !assignroles command.
 * This function:
 * 1. Removes "RoadWarriors" roles from users without the "Tomorrow" role.
 * 2. Assigns "RoadWarriors" to users with the "Tomorrow" role and removes their "Tomorrow" roles.
 * 3. Sends a confirmation with the number of roles cleaned up and assigned.
 * @param {Object} channel - The Discord channel where the command was invoked.
 */
async function assignRoles(channel) {
  try {
    console.log('Starting assignRoles');
    const guild = channel.guild;
    if (!guild) {
      console.error('Guild not found');
      await channel.send('Error: Guild not found.');
      return;
    }
    await guild.members.fetch();
    const tomorrowRole = guild.roles.cache.find(role => role.name === 'Tomorrow');
    const roadWarriorsRole = guild.roles.cache.find(role => role.name === 'RoadWarriors');
    if (!tomorrowRole || !roadWarriorsRole) {
      await channel.send('Roles not found!');
      return;
    }

    console.log('Fetching RoadWarriors members');
    const roadWarriorsMembers = roadWarriorsRole.members;
    console.log(`Found ${roadWarriorsMembers.size} RoadWarriors members`);
    let cleanupCount = 0;
    for (const member of roadWarriorsMembers.values()) {
      try {
        console.log(`Checking ${member.user.tag} for Tomorrow role: ${member.roles.cache.has(tomorrowRole.id)}`);
        if (!member.roles.cache.has(tomorrowRole.id)) {
          await member.roles.remove(roadWarriorsRole);
          cleanupCount++;
          console.log(`Removed RoadWarriors from ${member.user.tag}`);
        } else {
          console.log(`Kept RoadWarriors for ${member.user.tag}: has Tomorrow`);
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (roleError) {
        console.error(`Failed to remove RoadWarriors from ${member.user.tag}:`, roleError);
      }
    }

    console.log('Fetching Tomorrow members');
    const tomorrowMembers = tomorrowRole.members;
    console.log(`Found ${tomorrowMembers.size} Tomorrow members`);
    if (tomorrowMembers.size === 0) {
      await channel.send('No users with Tomorrow role found.');
      return;
    }
    let successCount = 0;
    for (const member of tomorrowMembers.values()) {
      try {
        console.log(`Processing ${member.user.tag} with Tomorrow role`);
        if (!member.roles.cache.has(roadWarriorsRole.id)) {
          await member.roles.add(roadWarriorsRole);
          await member.roles.remove(tomorrowRole);
          successCount++;
          console.log(`Assigned RoadWarriors to ${member.user.tag}`);
        } else {
          await member.roles.remove(tomorrowRole);
          console.log(`Kept RoadWarriors for ${member.user.tag}`);
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (roleError) {
        console.error(`Failed to assign/remove roles for ${member.user.tag}:`, roleError);
      }
    }

    await channel.send(`✅Completed! Removed RoadWarriors role from ${cleanupCount} drivers & assigned to ${successCount} others.`);
  } catch (error) {
    console.error('Error in assignRoles:', error);
    await channel.send(`Error assigning roles: ${error.message}`);
  }
}

/**
 * Function to create a new root folder and print its ID.
 * This also shares the folder with the admin email to ensure human access.
 * @returns {Promise<string>} The ID of the new folder
 */
async function createRootDebugFolder(adminEmail) {
  try {
    console.log("Creating debug root folder to test Google Drive access");
    const rootFolderResponse = await drive.files.create({
      requestBody: {
        name: 'DiscordBot_Photos_Debug',
        mimeType: 'application/vnd.google-apps.folder',
      },
      fields: 'id',
    });
    
    const newRootFolderId = rootFolderResponse.data.id;
    console.log(`Successfully created debug root folder with ID: ${newRootFolderId}`);
    
    // Share the folder with the admin email
    try {
      await drive.permissions.create({
        fileId: newRootFolderId,
        requestBody: {
          role: 'writer',
          type: 'user',
          emailAddress: adminEmail
        }
      });
      console.log(`Shared folder with admin email: ${adminEmail}`);
    } catch (shareError) {
      console.error(`Failed to share folder with admin: ${shareError.message}`);
    }
    
    console.log(`To fix this issue, update your GOOGLE_DRIVE_FOLDER_ID environment variable to: ${newRootFolderId}`);
    
    return newRootFolderId;
  } catch (error) {
    console.error("Failed to create debug root folder:", error);
    throw error;
  }
}

/**
 * Updates channel permissions to add/remove the Tomorrow role
 * @param {Object} guild - The Discord guild object
 * @param {string} addToChannelId - Channel ID to add Tomorrow role permissions to
 * @param {string} removeFromChannelId - Channel ID to remove Tomorrow role permissions from
 */
async function updateChannelTomorrowRole(guild, addToChannelId, removeFromChannelId) {
  try {
    console.log(`Updating Tomorrow role permissions: adding to ${addToChannelId}, removing from ${removeFromChannelId}`);
    
    // Get the Tomorrow role
    const tomorrowRole = guild.roles.cache.find(role => role.name === "Tomorrow");
    if (!tomorrowRole) {
      console.error("Role 'Tomorrow' does not exist.");
      return {success: false, error: "Role 'Tomorrow' not found"};
    }
    
    let success = true;
    let error = null;
    
    // Add role to the target channel
    if (addToChannelId) {
      try {
        const addToChannel = guild.channels.cache.get(addToChannelId);
        if (addToChannel) {
          await addToChannel.permissionOverwrites.create(tomorrowRole, {
            ViewChannel: true,
            SendMessages: true
          });
          console.log(`Added Tomorrow role permissions to channel: ${addToChannel.name}`);
        } else {
          console.error(`Channel with ID ${addToChannelId} not found`);
          success = false;
          error = `Channel to add role to (${addToChannelId}) not found`;
        }
      } catch (err) {
        console.error(`Error adding permissions to channel ${addToChannelId}:`, err);
        success = false;
        error = `Error adding permissions: ${err.message}`;
      }
    }
    
    // Remove role from the previous channel
    if (removeFromChannelId) {
      try {
        const removeFromChannel = guild.channels.cache.get(removeFromChannelId);
        if (removeFromChannel) {
          const currentOverwrites = removeFromChannel.permissionOverwrites.cache.get(tomorrowRole.id);
          if (currentOverwrites) {
            await currentOverwrites.delete();
            console.log(`Removed Tomorrow role permissions from channel: ${removeFromChannel.name}`);
          } else {
            console.log(`Tomorrow role has no permission overwrites in channel: ${removeFromChannel.name}`);
          }
        } else {
          console.error(`Channel with ID ${removeFromChannelId} not found`);
          // Don't set success to false here as the add operation might have succeeded
        }
      } catch (err) {
        console.error(`Error removing permissions from channel ${removeFromChannelId}:`, err);
        // Don't set success to false here as the add operation might have succeeded
      }
    }
    
    return { success, error };
  } catch (error) {
    console.error(`Error in updateChannelTomorrowRole:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Updates channel permissions to add/remove the RoadWarriors role
 * @param {Object} guild - The Discord guild object
 * @param {string} addToChannelId - Channel ID to add RoadWarriors role permissions to
 * @param {string} removeFromChannelId - Channel ID to remove RoadWarriors role permissions from
 */
async function updateChannelRoadWarriorsRole(guild, addToChannelId, removeFromChannelId) {
  try {
    console.log(`Updating RoadWarriors role permissions: adding to ${addToChannelId}, removing from ${removeFromChannelId}`);
    
    // Get the RoadWarriors role
    const roadWarriorsRole = guild.roles.cache.find(role => role.name === "RoadWarriors");
    if (!roadWarriorsRole) {
      console.error("Role 'RoadWarriors' does not exist.");
      return {success: false, error: "Role 'RoadWarriors' not found"};
    }
    
    let success = true;
    let error = null;
    
    // Add role to the target channel
    if (addToChannelId) {
      try {
        const addToChannel = guild.channels.cache.get(addToChannelId);
        if (addToChannel) {
          await addToChannel.permissionOverwrites.create(roadWarriorsRole, {
            ViewChannel: true,
            SendMessages: true
          });
          console.log(`Added RoadWarriors role permissions to channel: ${addToChannel.name}`);
        } else {
          console.error(`Channel with ID ${addToChannelId} not found`);
          success = false;
          error = `Channel to add role to (${addToChannelId}) not found`;
        }
      } catch (err) {
        console.error(`Error adding permissions to channel ${addToChannelId}:`, err);
        success = false;
        error = `Error adding permissions: ${err.message}`;
      }
    }
    
    // Remove role from the previous channel
    if (removeFromChannelId) {
      try {
        const removeFromChannel = guild.channels.cache.get(removeFromChannelId);
        if (removeFromChannel) {
          const currentOverwrites = removeFromChannel.permissionOverwrites.cache.get(roadWarriorsRole.id);
          if (currentOverwrites) {
            await currentOverwrites.delete();
            console.log(`Removed RoadWarriors role permissions from channel: ${removeFromChannel.name}`);
          } else {
            console.log(`RoadWarriors role has no permission overwrites in channel: ${removeFromChannel.name}`);
          }
        } else {
          console.error(`Channel with ID ${removeFromChannelId} not found`);
        }
      } catch (err) {
        console.error(`Error removing permissions from channel ${removeFromChannelId}:`, err);
      }
    }
    
    return { success, error };
  } catch (error) {
    console.error(`Error in updateChannelRoadWarriorsRole:`, error);
    return { success: false, error: error.message };
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

    // Pin messages starting with "### RTS Reminders"
    if (content.startsWith("### RTS Reminders")) {
      console.log('Message starting with "### RTS Reminders" detected. Attempting to pin the message...');
      message.pin().catch((error) => {
        console.error('Failed to pin message:', error);
      });
    }

    // Automatic photo upload for messages with more than 4 photo attachments
    await autoUploadPhotos(message);

    // Command: Update schedule
    if (content.startsWith('!sendschedule')) {
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

    // Command: Assign roles
    if (content.startsWith('!assignroles')) {
      console.log("Processing !assignroles command...");
      if (!member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
        await channel.send("You do not have permission to use this command.");
        return;
      }
      await assignRoles(channel);
    }

    // Command: Debug Google Drive
    if (content.startsWith('!debugdrive')) {
      if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        await channel.send("You need administrator permissions to use this command.");
        return;
      }
      
      // Get email from command if provided, otherwise use environment variable
      let adminEmail = process.env.ADMIN_EMAIL;
      const args = content.split(' ');
      if (args.length > 1 && args[1].includes('@')) {
        adminEmail = args[1];
      }
      
      if (!adminEmail) {
        await channel.send("Please provide an email address to share the folder with: `!debugdrive your-email@example.com`");
        return;
      }
      
      try {
        const newFolderId = await createRootDebugFolder(adminEmail);
        await channel.send(`Created a new root folder in Google Drive with ID: ${newFolderId}\n\nThis folder has been shared with ${adminEmail}.\n\nUpdate your GOOGLE_DRIVE_FOLDER_ID in Heroku environment variables to fix Google Drive access issues.`);
      } catch (error) {
        console.error("Drive debug error:", error);
        await channel.send(`Error creating debug folder: ${error.message}`);
      }
    }

    // Command: Clear folder cache
    if (content.startsWith('!clearcache')) {
      if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        await channel.send("You need administrator permissions to use this command.");
        return;
      }
      
      // Clear the folder cache
      const cacheSize = Object.keys(folderCache).length;
      Object.keys(folderCache).forEach(key => delete folderCache[key]);
      console.log('Folder cache cleared.');
      
      await channel.send(`Cleared folder cache (${cacheSize} entries removed). Next uploads will refresh folder information.`);
      console.log(`Cleared folder cache (${cacheSize} entries).`);
    }

    // Command: Clear specific user folder from cache
    if (content.startsWith('!clearusercache')) {
      if (!member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
        await channel.send("You need manage messages permission to use this command.");
        return;
      }
      
      // Clear specific user's folder from cache
      const args = content.split(' ');
      const username = args.slice(1).join(' ');
      
      if (!username) {
        await channel.send("Please provide a username: `!clearusercache username`");
        return;
      }
      
      let cleared = 0;
      Object.keys(folderCache).forEach(key => {
        if (key.includes(username)) {
          delete folderCache[key];
          cleared++;
        }
      });
      
      await channel.send(`Cleared ${cleared} folder cache entries for user "${username}".`);
      console.log(`Cleared ${cleared} folder cache entries for user "${username}".`);
    }

    // Command: Force reset user folder
    if (content.startsWith('!forcereset')) {
      if (!member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
        await channel.send("You need manage messages permission to use this command.");
        return;
      }
      
      const args = content.split(' ');
      const username = args.slice(1).join(' ');
      
      if (!username) {
        await channel.send("Please provide a username: `!forcereset username`");
        return;
      }
      
      // Clear all cache entries for this user
      let cleared = 0;
      Object.keys(folderCache).forEach(key => {
        if (key.includes(username)) {
          delete folderCache[key];
          cleared++;
        }
      });
      
      await channel.send(`Cleared ${cleared} folder cache entries for user "${username}". Their next upload will create fresh folders.`);
    }

    // Command: Help
    if (content.startsWith('!help')) {
      const isAdmin = member.permissions.has(PermissionsBitField.Flags.Administrator);
      const canManageRoles = member.permissions.has(PermissionsBitField.Flags.ManageRoles);
      const canManageMessages = member.permissions.has(PermissionsBitField.Flags.ManageMessages);
      
      let helpMessage = "**Available Commands:**\n\n";
      
      // Commands for everyone
      helpMessage += "**General Commands:**\n";
      helpMessage += "• Upload 4+ photos in a message - Automatically uploads them to Google Drive\n";
      
      // Commands for users who can manage messages
      if (canManageMessages) {
        helpMessage += "\n**Moderator Commands:**\n";
        helpMessage += "• `!clearusercache [username]` - Clear a specific user's folder cache\n";
        helpMessage += "• `!forcereset [username]` - Reset a specific user's folder in the cache\n";
      }
      
      // Commands for users who can manage roles
      if (canManageRoles) {
        helpMessage += "\n**Role Management Commands:**\n";
        helpMessage += "• `!sendschedule` - Update schedule from an attached CSV file\n";
        helpMessage += "• `!runschedule` - Assign the 'Tomorrow' role based on the schedule\n";
        helpMessage += "• `!assignroles` - Assign 'RoadWarriors' role to users with 'Tomorrow' role\n";
        helpMessage += "• `!purgerole [roleName]` - Remove the specified role from all members who have it\n";
        helpMessage += "• `!confirmpurge [roleName]` - Confirm removal of a role from many members\n";
      }
      
      // Commands for administrators
      if (isAdmin) {
        helpMessage += "\n**Administrator Commands:**\n";
        helpMessage += "• `!clearcache` - Clear the entire folder cache\n";
        helpMessage += "• `!debugdrive [email]` - Create a debug folder in Google Drive and share it\n";
      }
      
      await channel.send(helpMessage);
      return;
    }

    // Command: Purge role
    if (content.startsWith('!purgerole')) {
      // Check permissions (requires Manage Roles permission)
      if (!member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
        await channel.send("You need manage roles permission to use this command.");
        return;
      }
      
      // Get role name from command
      const args = content.split(' ');
      const roleName = args.slice(1).join(' ');
      
      if (!roleName) {
        await channel.send("Please provide a role name: `!purgerole RoleName`");
        return;
      }
      
      try {
        // Find the role by name
        const role = channel.guild.roles.cache.find(r => 
          r.name.toLowerCase() === roleName.toLowerCase()
        );
        
        // Check if the role exists
        if (!role) {
          await channel.send(`Error: Role "${roleName}" not found.`);
          return;
        }
        
        // Get the number of members with this role
        await channel.guild.members.fetch();
        const membersWithRole = role.members.size;
        
        if (membersWithRole === 0) {
          await channel.send(`No members have the role "${role.name}".`);
          return;
        }
        
        // Confirmation message if there are many members
        if (membersWithRole > 10) {
          await channel.send(`This will remove the "${role.name}" role from ${membersWithRole} members. Type \`!confirmpurge ${role.name}\` to confirm.`);
          
          // Store this in memory for the confirmation command
          if (!client.pendingPurges) client.pendingPurges = {};
          
          client.pendingPurges[channel.id] = {
            roleId: role.id,
            roleName: role.name,
            requesterId: member.id,
            timestamp: Date.now()
          };
          
          // Set timeout to clear the pending purge after 60 seconds
          setTimeout(() => {
            if (client.pendingPurges && client.pendingPurges[channel.id]) {
              delete client.pendingPurges[channel.id];
            }
          }, 60000); // 60 seconds
          
          return;
        }
        
        // If fewer than 10 members, proceed directly
        const message = await channel.send(`Removing role "${role.name}" from ${membersWithRole} members...`);
        let successCount = 0;
        let failCount = 0;
        
        // Use Promise.all to perform all role removals - Discord.js will handle the rate limiting
        const removePromises = role.members.map(async (member) => {
          try {
            await member.roles.remove(role);
            successCount++;
            return true;
          } catch (error) {
            console.error(`Failed to remove role from ${member.user.tag}:`, error);
            failCount++;
            return false;
          }
        });
        
        await Promise.all(removePromises);
        await message.edit(`Completed! Removed role "${role.name}" from ${successCount} members.${failCount > 0 ? ` Failed for ${failCount} members.` : ''}`);
        
      } catch (error) {
        console.error('Error in purge role command:', error);
        await channel.send(`An error occurred while purging the role: ${error.message}`);
      }
    }
    
    // Command: Confirm purge
    if (content.startsWith('!confirmpurge')) {
      // Check permissions (requires Manage Roles permission)
      if (!member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
        await channel.send("You need manage roles permission to use this command.");
        return;
      }
      
      // Check if there's a pending purge for this channel
      if (!client.pendingPurges || !client.pendingPurges[channel.id]) {
        await channel.send("No role purge is pending confirmation in this channel.");
        return;
      }
      
      const pendingPurge = client.pendingPurges[channel.id];
      
      // Check if this is the same user who initiated the purge
      if (pendingPurge.requesterId !== member.id) {
        await channel.send("Only the user who initiated the purge can confirm it.");
        return;
      }
      
      // Check if the confirmation has expired (60 seconds)
      if (Date.now() - pendingPurge.timestamp > 60000) {
        await channel.send("The purge confirmation has expired. Please start again with `!purgerole`.");
        delete client.pendingPurges[channel.id];
        return;
      }
      
      // Get role name from command
      const args = content.split(' ');
      const roleName = args.slice(1).join(' ').toLowerCase();
      
      // Check if the confirmation is for the correct role
      if (pendingPurge.roleName.toLowerCase() !== roleName) {
        await channel.send(`Confirmation role name doesn't match the pending purge role "${pendingPurge.roleName}".`);
        return;
      }
      
      try {
        // Find the role
        const role = channel.guild.roles.cache.get(pendingPurge.roleId);
        if (!role) {
          await channel.send(`Error: Role no longer exists.`);
          delete client.pendingPurges[channel.id];
          return;
        }
        
        const membersWithRole = role.members.size;
        const message = await channel.send(`Removing role "${role.name}" from ${membersWithRole} members...`);
        
        let successCount = 0;
        let failCount = 0;
        
        // Use Promise.all to perform all role removals - Discord.js will handle the rate limiting
        const removePromises = role.members.map(async (member) => {
          try {
            await member.roles.remove(role);
            successCount++;
            return true;
          } catch (error) {
            console.error(`Failed to remove role from ${member.user.tag}:`, error);
            failCount++;
            return false;
          }
        });
        
        await Promise.all(removePromises);
        await message.edit(`Completed! Removed role "${role.name}" from ${successCount} members.${failCount > 0 ? ` Failed for ${failCount} members.` : ''}`);
        
        // Clear the pending purge
        delete client.pendingPurges[channel.id];
        
      } catch (error) {
        console.error('Error in confirm purge command:', error);
        await channel.send(`An error occurred while purging the role: ${error.message}`);
        delete client.pendingPurges[channel.id];
      }
    }
  },
  // Export these functions so they can be used by tasks.js
  runSchedule,
  assignRoles,
  updateChannelTomorrowRole, 
  updateChannelRoadWarriorsRole
};

async function verifyGoogleDriveFolder() {
  try {
    const response = await drive.files.get({
      fileId: process.env.GOOGLE_DRIVE_FOLDER_ID,
      fields: 'id, name, permissions',
    });
    console.log('Google Drive API response:', response.data);
  } catch (error) {
    console.error('Error accessing Google Drive folder:', error);
  }
}

// Call the function - but don't await it at the top level
verifyGoogleDriveFolder();