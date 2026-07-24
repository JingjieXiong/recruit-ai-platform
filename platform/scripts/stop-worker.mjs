import {existsSync} from 'node:fs';
import {readFile, rm} from 'node:fs/promises';
import {resolve} from 'node:path';

const pidFile = resolve('.runtime', 'worker.pid');

if (!existsSync(pidFile)) {
    console.log('No worker pid file found.');
    process.exit(0);
}

const pid = Number(await readFile(pidFile, 'utf8'));
try {
    process.kill(pid, 'SIGTERM');
    console.log(`Stopped worker, pid ${pid}`);
}
catch (error) {
    console.log(`Worker pid ${pid} was not running: ${error.message}`);
}

await rm(pidFile, {force: true});
