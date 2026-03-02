import pg from 'pg';

let pool = null;

function getCredentials() {
  // Cloud Foundry
  if (process.env.VCAP_SERVICES) {
    const vcap = JSON.parse(process.env.VCAP_SERVICES);
    const pgService = vcap.postgres?.[0] || vcap['on-demand-postgres']?.[0];
    if (pgService) return pgService.credentials;
  }
  // Local dev fallback
  return {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'braincheck',
    username: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASS || '',
  };
}

export async function initDB() {
  const creds = getCredentials();
  // CF provides hosts[] array, or uri string; local uses host
  const host = creds.host || (creds.hosts && creds.hosts[0]) || 'localhost';
  pool = new pg.Pool({
    host,
    port: creds.port || 5432,
    database: creds.database || creds.db || creds.db_name || creds.dbname,
    user: creds.user || creds.username,
    password: creds.password,
    ssl: false,
    max: 5,
  });

  // Verify connection
  const client = await pool.connect();
  console.log('Connected to Postgres');
  client.release();

  // Create tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS quiz_results (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      title TEXT,
      subject TEXT,
      total_questions INTEGER,
      correct_count INTEGER,
      score INTEGER,
      difficulty TEXT,
      questions_json JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS homework_results (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      subject TEXT,
      total_problems INTEGER,
      correct_count INTEGER,
      results_json JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // Add questions_json column if missing (migration for existing DBs)
  await pool.query(`
    ALTER TABLE quiz_results ADD COLUMN IF NOT EXISTS questions_json JSONB
  `).catch(() => {});
  console.log('Database tables ready');
}

export function query(text, params) {
  return pool.query(text, params);
}

export function getPool() {
  return pool;
}
