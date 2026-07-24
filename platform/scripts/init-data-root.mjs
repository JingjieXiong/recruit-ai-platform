import {mkdir, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {isAbsolute, relative, resolve} from 'node:path';
import {appConfig} from '../packages/storage/config.js';

const pathArg = process.argv.find((arg) => arg.startsWith('--path='));
const requestedPath = pathArg?.split('=')[1] || appConfig.storage.dataRoot;
const repoRoot = resolve('.');
const children = ['postgres', 'object-storage', 'redis', 'backups', 'logs', 'tmp'];

function expandPath(value) {
    if (value.startsWith('~/')) return value.replace('~', homedir());
    return value;
}

const dataRoot = resolve(expandPath(requestedPath));

function isInside(parent, child) {
    const rel = relative(parent, child);
    return rel === '' || Boolean(rel && !rel.startsWith('..') && !isAbsolute(rel));
}

if (isInside(repoRoot, dataRoot)) {
    console.error(`Refuse to initialize data root inside code repo: ${dataRoot}`);
    console.error('Use an external path, for example ~/.recruit-ai-platform/local');
    process.exit(1);
}

await mkdir(dataRoot, {recursive: true});
for (const child of children) {
    await mkdir(resolve(dataRoot, child), {recursive: true});
}

const markerPath = resolve(dataRoot, 'DATA_ROOT.md');
if (!existsSync(markerPath)) {
    await writeFile(
        markerPath,
        `# AI 招聘提效平台数据目录

这个目录是长期数据根目录，不属于代码仓库。

- 代码可以删除、重建、切换 tag 或重新部署。
- 这里保存真实业务数据依赖的本地落点，不应随代码版本回滚而删除。
- 本地默认路径：\`${dataRoot}\`
- 服务器建议路径：\`/data/ai-recruiting\` 或 \`/srv/ai-recruiting/data\`

## 子目录

- \`postgres/\`：数据库备份、迁移辅助文件或本地调试导出。
- \`object-storage/\`：对象存储清单、导出物或本地调试文件。
- \`redis/\`：队列状态导出、故障排查材料或本地调试文件。
- \`backups/\`：数据库 dump、对象存储清单和发版前备份。
- \`logs/\`：服务器运行日志或运维导出的日志。
- \`tmp/\`：临时处理文件，可以按需清理。

## 使用规则

1. 不要把本目录提交到 Git。
2. 不要在发版脚本里清空本目录。
3. 回滚代码时只切换代码版本，不删除这里的数据。
4. 如果换服务器，先迁移本目录对应的数据服务和对象文件，再切流量。
`,
        'utf8'
    );
}

console.log(`Data root ready: ${dataRoot}`);
for (const child of children) {
    console.log(`- ${resolve(dataRoot, child)}`);
}
