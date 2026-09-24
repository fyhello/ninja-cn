import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir, copyFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync, gunzipSync } from 'node:zlib';
import { root, hash } from '../tools/native-translations/dictionary.mjs';
import { createReview, acceptReview } from '../tools/native-translations/update.mjs';

test('候选接受必须通过完整审核，拒绝错误确认值、过期报告和价格污染', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ninja-tw-review-'));
  const paths = ['data/sources/native-translations/lock.json', 'data/poe2.json', 'data/reports/native-traditional.json',
    'data/overrides/terms.json', 'data/overrides/glossary.json',
    'tools/native-translations/dictionary.mjs', 'tools/native-translations/update.mjs',
    'tools/native-translations/collect.mjs', 'tools/native-translations/game-text.mjs',
    'tools/native-translations/schemas/game-text-tables.json', 'tools/native-translations/schemas/game-text-tools.json'];
  const lockBytes = await readFile(join(root, paths[0]));
  const lock = JSON.parse(lockBytes);
  for (const path of [...paths, lock.path]) {
    await mkdir(dirname(join(directory, path)), { recursive: true });
    await copyFile(join(root, path), join(directory, path));
  }
  const candidate = join(directory, 'candidate.gz');
  await copyFile(join(root, lock.path), candidate);
  const review = await createReview(candidate, directory);
  assert.equal(review.changes.length, 0);
  assert.equal(review.regressions.length, 0);
  const reportPath = join(directory, 'review.json');
  const reportBytes = Buffer.from(JSON.stringify(review));
  await writeFile(reportPath, reportBytes);
  await assert.rejects(acceptReview(candidate, reportPath, '0'.repeat(64), directory), /确认值不符/);
  assert.deepEqual(await readFile(join(directory, paths[0])), lockBytes);

  const overridePath = join(directory, 'data/overrides/terms.json');
  const overrides = await readFile(overridePath);
  await writeFile(overridePath, Buffer.concat([overrides, Buffer.from('\n')]));
  await assert.rejects(acceptReview(candidate, reportPath, hash(reportBytes), directory), /发生变化/);
  assert.deepEqual(await readFile(join(directory, paths[0])), lockBytes);
  await writeFile(overridePath, overrides);

  const result = await acceptReview(candidate, reportPath, hash(reportBytes), directory);
  assert.equal(result.snapshot, lock.sha256);
  const accepted = JSON.parse(await readFile(join(directory, paths[0])));
  assert.equal(hash(gunzipSync(await readFile(join(directory, accepted.origin.review_path)))), hash(reportBytes));

  const modified = JSON.parse(gunzipSync(await readFile(candidate)));
  modified.texts.find(row => row.locale === 'zh-TW' && row.table === 'BaseItemTypes' && row.en === 'Efficiency II').translated += '[1.02e]';
  await writeFile(candidate, gzipSync(JSON.stringify(modified)));
  const suspicious = await createReview(candidate, directory);
  assert.equal(suspicious.suspiciousNames.length, 1);
  const suspiciousBytes = Buffer.from(JSON.stringify(suspicious));
  await writeFile(reportPath, suspiciousBytes);
  const beforeRejection = await readFile(join(directory, paths[0]));
  await assert.rejects(acceptReview(candidate, reportPath, hash(suspiciousBytes), directory), /价格标注/);
  assert.deepEqual(await readFile(join(directory, paths[0])), beforeRejection);
});
