import {rm, readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';

const portArg = process.argv.find((arg) => arg.startsWith('--port='));
const port = Number(portArg?.split('=')[1] || process.env.PORT || 5173);
const skipWorker = process.argv.includes('--skip-worker');
const pidFile = resolve('.runtime', `server-${port}.pid`);

if (existsSync(pidFile)) {
    const pid = Number(await readFile(pidFile, 'utf8'));
    try {
        process.kill(pid, 'SIGTERM');
        console.log(`Stopped service on port ${port}, pid ${pid}`);
    }
    catch (error) {
        console.log(`Service pid ${pid} was not running: ${error.message}`);
    }
    await rm(pidFile, {force: true});
}
else {
    console.log(`No pid file found for port ${port}.`);
}

if (!skipWorker) {
    const workerPidFile = resolve('.runtime', 'worker.pid');
    if (!existsSync(workerPidFile)) {
        console.log('No worker pid file found.');
    }
    else {
        const workerPid = Number(await readFile(workerPidFile, 'utf8'));
        try {
            process.kill(workerPid, 'SIGTERM');
            console.log(`Stopped worker, pid ${workerPid}`);
        }
        catch (error) {
            console.log(`Worker pid ${workerPid} was not running: ${error.message}`);
        }
        await rm(workerPidFile, {force: true});
    }
}
