const { parse } = require('csv-parse');
const fetch = require('node-fetch');

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

    const response = await fetch(attachment.url);
    const csvText = await response.text();

    const usernames = [];
    parse(csvText, { columns: false, trim: true })
      .on('data', (row) => usernames.push(row[0]))
      .on('end', async () => {
        const tomorrowDate = (await pool.query(
          "SELECT (CURRENT_DATE AT TIME ZONE 'America/New_York' + INTERVAL '1 day')::date"
        )).rows[0].date;

        await pool.query("DELETE FROM schedule");
        for (const username of usernames) {
          await pool.query(
            "INSERT INTO schedule (date, username) VALUES ($1, $2)",
            [tomorrowDate, username]
          );
        }

        await message.channel.send(`Updated schedule for ${tomorrowDate}.`);
      });
  },
};