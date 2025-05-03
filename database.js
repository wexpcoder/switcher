const { Pool } = require('pg');

module.exports = {
  createPool: () => {
    return new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
  },
};