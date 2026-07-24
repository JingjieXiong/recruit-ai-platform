import {setTimeout as sleep} from 'node:timers/promises';
import {loadRootEnv} from './env.mjs';
import {run, spawnService} from './process.mjs';

const interviewPort = 5192;
const env = {
    ...loadRootEnv({requireFile: false}),
    AI_MODE: 'fixture',
    INTERVIEW_RUNTIME: 'browser-demo',
    INTERVIEW_PORT: String(interviewPort),
    INTERVIEW_BASE_URL: `http://127.0.0.1:${interviewPort}`,
    INTERVIEW_PUBLIC_BASE_URL: `http://127.0.0.1:${interviewPort}`,
};
const interview = spawnService('fixture-interview', process.execPath, ['server.mjs'], {
    cwd: 'interview-room',
    env,
});

async function waitForInterview() {
    for (let attempt = 0; attempt < 40; attempt += 1) {
        try {
            const response = await fetch(`http://127.0.0.1:${interviewPort}/healthz`);
            if (response.ok) return;
        }
        catch {
            // Service is still starting.
        }
        await sleep(200);
    }
    throw new Error('Interview runtime did not become ready');
}

try {
    await waitForInterview();
    run(process.execPath, ['scripts/verify_backend_v1.mjs'], {
        cwd: 'platform',
        env,
    });
    process.stdout.write('Fixture end-to-end flow passed: job → application → prescreen → interview → callback → human review.\n');
}
finally {
    interview.kill('SIGTERM');
}
