const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

// Quick connection test to provide a clearer error early
pool.query('SELECT 1').then(() => {
  console.log('Postgres connection test OK');
}).catch(err => {
  console.error('Postgres connection test FAILED. Check PGHOST, PGUSER, PGPASSWORD, PGDATABASE and that Postgres is running. Error:', err.message);
  // Do not exit the process in production (e.g. Render) to allow successful deployment and retries.
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};
