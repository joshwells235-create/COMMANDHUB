import postgres from 'postgres';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('Set DATABASE_URL env var. Find it in Supabase Dashboard > Settings > Database > Connection string (URI)');
  process.exit(1);
}

const sql = postgres(connectionString, { ssl: 'require', max: 1, connect_timeout: 15 });

async function run() {
  try {
    const res = await sql`SELECT current_database() as db`;
    console.log('Connected to:', res[0].db);

    const schemaSQL = readFileSync(join(__dirname, '..', 'supabase', 'schema.sql'), 'utf-8');
    const seedSQL = readFileSync(join(__dirname, '..', 'supabase', 'seed.sql'), 'utf-8');

    console.log('Running schema...');
    await sql.unsafe(schemaSQL);
    console.log('Schema created!');

    console.log('Running seed...');
    await sql.unsafe(seedSQL);
    console.log('Seed data inserted!');

    const orgs = await sql`SELECT name FROM organizations ORDER BY name`;
    console.log(`Verified: ${orgs.length} organizations:`, orgs.map(o => o.name).join(', '));
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await sql.end();
  }
}

run();
