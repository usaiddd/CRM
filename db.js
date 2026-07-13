const { Pool } = require('pg');
require('dotenv').config();

// Validate environment variables early to give helpful errors
const requiredEnv = ['PGHOST','PGUSER','PGPASSWORD','PGDATABASE'];
for (const k of requiredEnv) {
  if (!process.env[k]) {
    console.error(`Missing required env var ${k}. Please copy .env.example to .env and set it.`);
    process.exit(1);
  }
}

// Ensure password is a string
if (typeof process.env.PGPASSWORD !== 'string') {
  console.error('PGPASSWORD must be a string. Check your .env formatting.');
  process.exit(1);
}

const pool = new Pool({
  host: process.env.PGHOST,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  port: process.env.PGPORT || 5432,
});

// Quick connection test to provide a clearer error early
pool.query('SELECT 1').then(() => {
  console.log('Postgres connection test OK');
}).catch(err => {
  console.error('Postgres connection test FAILED. Check PGHOST, PGUSER, PGPASSWORD, PGDATABASE and that Postgres is running. Error:', err.message);
  // Exit to avoid running an app with broken DB config
  process.exit(1);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};
