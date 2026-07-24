import {closePool, query} from '../packages/storage/db.js';

const reset = process.argv.includes('--reset');
const tables = [
    'audit_logs',
    'model_call_logs',
    'job_runs',
    'uploads',
    'job_knowledge_chunks',
    'consultation_sessions',
    'applications',
    'portfolio_submissions',
    'candidate_material_files',
    'candidates',
    'jobs',
];

if (reset) {
    await query(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
    console.log('database reset complete; no fake business data inserted');
}

const counts = {};
for (const table of tables) {
    const result = await query(`SELECT COUNT(*)::int AS count FROM ${table}`);
    counts[table] = result.rows[0].count;
}

console.log('database schema reachable; seed is intentionally empty');
console.log(JSON.stringify({reset, counts}, null, 2));
await closePool();
