const { parse } = require('csv-parse/sync'); // Use the supported path
const fetch = require('node-fetch');
const moment = require('moment-timezone');
const { getTomorrowDate, insertSchedule, deleteSchedule } = require('./dbUtils');

module.exports = {
  fetchSchedule: async (pool) => {
    const result = await pool.query(
      "SELECT username FROM schedule WHERE date = (CURRENT_DATE AT TIME ZONE 'America/New_York' + INTERVAL '1 day')"
    );
    return result.rows.map(row => row.username);
  },

  updateSchedule: async (message, pool) => {
    const attachment = message.attachments.first();
    if (!attachment || !attachment.name.toLowerCase().endsWith('.csv')) {
      await message.channel.send('Please attach a valid CSV file.');
      return;
    }

    try {
      const response = await fetch(attachment.url);
      const csvText = await response.text();

      // Parse the CSV content
      const usernames = parse(csvText, { columns: false, trim: true })
        .map(row => row[0]) // Extract the first column (username)
        .filter(Boolean); // Remove empty rows

      if (usernames.length === 0) {
        await message.channel.send('The CSV file is empty or invalid.');
        return;
      }

      const tomorrowDate = moment.tz('America/New_York').add(1, 'day').startOf('day').format('YYYY-MM-DD');
      await deleteSchedule(pool);
      await insertSchedule(pool, tomorrowDate, usernames);

      const formattedDate = moment(tomorrowDate).format('ddd MMM D YYYY');
      await message.channel.send(`Updated schedule for ${formattedDate}.`);

    } catch (error) {
      console.error('Error updating schedule:', error);
      await message.channel.send('An error occurred while updating the schedule. Please try again.');
    }
  },
};