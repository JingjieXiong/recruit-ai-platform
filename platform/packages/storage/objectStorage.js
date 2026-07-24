import {Client} from 'minio';
import {createReadStream} from 'node:fs';
import {mkdir, writeFile} from 'node:fs/promises';
import {dirname, relative, resolve} from 'node:path';
import {appConfig} from './config.js';

let client;

export function isFilesystemStorage() {
    return appConfig.storage.provider === 'filesystem';
}

function filesystemObjectPath(storageKey = '') {
    const root = resolve(appConfig.storage.dataRoot, 'object-storage');
    const path = resolve(root, storageKey);
    const fromRoot = relative(root, path);
    if (fromRoot.startsWith('..') || fromRoot === '' || fromRoot.startsWith('/')) {
        throw new Error('Invalid storage key');
    }
    return path;
}

export function getObjectStorageClient() {
    if (isFilesystemStorage()) {
        throw new Error('Object storage client is unavailable in filesystem storage mode');
    }
    if (!client) {
        client = new Client({
            endPoint: appConfig.objectStorage.endPoint,
            port: appConfig.objectStorage.port,
            useSSL: appConfig.objectStorage.useSSL,
            accessKey: appConfig.objectStorage.accessKey,
            secretKey: appConfig.objectStorage.secretKey,
        });
    }
    return client;
}

export async function ensureBucket() {
    if (isFilesystemStorage()) {
        await mkdir(resolve(appConfig.storage.dataRoot, 'object-storage'), {recursive: true});
        return;
    }
    const storage = getObjectStorageClient();
    const exists = await storage.bucketExists(appConfig.objectStorage.bucket).catch(() => false);
    if (!exists) {
        await storage.makeBucket(appConfig.objectStorage.bucket);
    }
}

export async function presignPutObject(storageKey) {
    await ensureBucket();
    if (isFilesystemStorage()) {
        const path = filesystemObjectPath(storageKey);
        await mkdir(dirname(path), {recursive: true});
        return `local-file://${path}`;
    }
    return getObjectStorageClient().presignedPutObject(appConfig.objectStorage.bucket, storageKey, 60 * 10);
}

export async function writeObjectBuffer(storageKey, buffer) {
    await ensureBucket();
    if (isFilesystemStorage()) {
        const path = filesystemObjectPath(storageKey);
        await mkdir(dirname(path), {recursive: true});
        await writeFile(path, buffer);
        return {storageKey, storageRef: publicStorageRef(storageKey)};
    }
    await getObjectStorageClient().putObject(appConfig.objectStorage.bucket, storageKey, buffer);
    return {storageKey, storageRef: publicStorageRef(storageKey)};
}

export async function getObjectReadStream(storageKey) {
    if (isFilesystemStorage()) {
        return createReadStream(filesystemObjectPath(storageKey));
    }
    return getObjectStorageClient().getObject(appConfig.objectStorage.bucket, storageKey);
}

export function publicStorageRef(storageKey) {
    if (isFilesystemStorage()) {
        return `file://${filesystemObjectPath(storageKey)}`;
    }
    return `s3://${appConfig.objectStorage.bucket}/${storageKey}`;
}

export async function checkObjectStorageHealth() {
    if (isFilesystemStorage()) {
        await ensureBucket();
        return {
            provider: 'filesystem',
            path: resolve(appConfig.storage.dataRoot, 'object-storage'),
            bucketReady: true,
        };
    }
    const exists = await getObjectStorageClient().bucketExists(appConfig.objectStorage.bucket);
    return {
        provider: 's3',
        endpoint: `${appConfig.objectStorage.endPoint}:${appConfig.objectStorage.port}`,
        bucket: appConfig.objectStorage.bucket,
        bucketReady: exists,
    };
}
