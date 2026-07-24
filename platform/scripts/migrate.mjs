import {readdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {appConfig} from '../packages/storage/config.js';
import {query, closePool} from '../packages/storage/db.js';

const migrationDir = join(process.cwd(), 'db', 'migrations');
const files = (await readdir(migrationDir)).filter((file) => file.endsWith('.sql')).sort();

await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
`);

for (const file of files) {
    const exists = await query('SELECT id FROM schema_migrations WHERE id = $1', [file]);
    if (exists.rows.length) {
        console.log(`skip ${file}`);
        continue;
    }
    let sql = await readFile(join(migrationDir, file), 'utf8');
    if (appConfig.vector.provider === 'text') {
        sql = sql
            .replace(/CREATE EXTENSION IF NOT EXISTS vector;\s*/g, '')
            .replace(/embedding VECTOR\(1536\)/g, 'embedding JSONB');
    }
    await query(sql);
    await query('INSERT INTO schema_migrations (id) VALUES ($1)', [file]);
    console.log(`applied ${file}`);
}

await closePool();
