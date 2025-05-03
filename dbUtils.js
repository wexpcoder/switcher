// dbUtils.js
// Utility functions for database operations

module.exports = {
  // Get tomorrow's date in the database timezone
  getTomorrowDate: async (pool) => {
    const result = await pool.query(
      "SELECT (CURRENT_DATE AT TIME ZONE 'America/New_York' + INTERVAL '1 day')::date"
    );
    return result.rows[0].date;
  },

  // Insert a schedule into the database
  insertSchedule: async (pool, date, usernames) => {
    if (usernames.length > 0) {
      const values = usernames.map((username, index) => `($1, $${index + 2})`).join(',');
      await pool.query(
        `INSERT INTO schedule (date, username) VALUES ${values}`,
        [date, ...usernames]
      );
    }
  },

  // Delete all records from the schedule table
  deleteSchedule: async (pool) => {
    await pool.query("DELETE FROM schedule");
  },
};