import pg from 'pg';
import {appConfig} from './config.js';

const {Pool} = pg;
let pool;

export function getPool() {
    if (!pool) {
        pool = new Pool({
            connectionString: appConfig.databaseUrl,
        });
    }
    return pool;
}

export async function query(text, params = []) {
    return getPool().query(text, params);
}

export async function transaction(callback) {
    const client = await getPool().connect();
    try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
}

export async function closePool() {
    if (pool) {
        await pool.end();
        pool = undefined;
    }
}

export function rowData(row) {
    return row?.data || null;
}
