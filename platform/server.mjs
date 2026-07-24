import {appConfig} from './packages/storage/config.js';
import {listen} from './apps/api/server.js';

await listen({port: appConfig.port});
