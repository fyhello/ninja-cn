import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, access } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { manifestFiles } from '../tools/extension-files.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
test('打包清单包含市集复制脚本及 manifest 声明的资源', async () => {
  const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
  const files = await manifestFiles(root, manifest);
  for (const name of ['hook', 'converter', 'ui']) assert.ok(files.includes(`trade/trade-pob-${name}.js`));
  for (const file of files) await access(resolve(root, file));
});

test('市集翻译的普通脚本和压缩产物完全一致', async () => {
  const code = await readFile(resolve(root, 'trade/trade-standalone.js'));
  const compressed = await readFile(resolve(root, 'trade/trade-standalone.js.gz'));
  assert.deepEqual(gunzipSync(compressed), code);
});
