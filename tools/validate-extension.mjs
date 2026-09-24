import { access, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { manifestFiles } from './extension-files.mjs';

const root = resolve(process.argv[2] ?? '.');
const errors = [];
async function requireFile(relativePath) {
  try {
    await access(resolve(root, relativePath));
  } catch {
    errors.push(`Missing required file: ${relativePath}`);
  }
}

async function readJson(relativePath) {
  try {
    const fullPath = resolve(root, relativePath);
    if (existsSync(fullPath)) {
      return JSON.parse(await readFile(fullPath, 'utf8'));
    }
    const gzPath = resolve(root, `${relativePath}.gz`);
    if (existsSync(gzPath)) {
      const gzBuf = await readFile(gzPath);
      const decompressed = gunzipSync(gzBuf);
      return JSON.parse(decompressed.toString('utf8'));
    }
    return null;
  } catch (error) {
    errors.push(`Invalid JSON in ${relativePath}: ${error.message}`);
    return null;
  }
}

function validateEntry(entry, path) {
  if (typeof entry === 'string') {
    if (!entry) errors.push(`${path} is empty`);
    return;
  }
  if (Array.isArray(entry)) {
    if (typeof entry[0] !== 'string' || !entry[0]) errors.push(`${path} is missing zh-CN`);
    return;
  }
  if (typeof entry?.['zh-CN'] !== 'string' || !entry['zh-CN']) {
    errors.push(`${path} is missing zh-CN`);
  }
  if (entry?.['zh-TW'] !== undefined && typeof entry['zh-TW'] !== 'string') {
    errors.push(`${path} has invalid zh-TW`);
  }
}

function validateDictionary(dictionary, game) {
  if (!dictionary) return;
  if (Object.keys(dictionary).some((key) => !['types', 'items', 'stats', 'tooltip', 'ui', 'terms', 'nativeTraditional'].includes(key))) {
    errors.push(`data/${game}.json contains non-runtime metadata`);
  }
  if (dictionary.nativeTraditional !== undefined) {
    const marker = dictionary.nativeTraditional;
    if (!/^[a-f0-9]{64}$/.test(marker?.snapshot) || !Number.isSafeInteger(marker?.missing) || marker.missing < 0) {
      errors.push(`data/${game}.json 的原生繁中来源标记无效`);
    }
    for (const section of ['items', 'stats', 'tooltip', 'ui', 'terms']) {
      for (const [english, entry] of Object.entries(dictionary[section] || {})) {
        if (typeof entry?.['zh-TW'] !== 'string' || !entry['zh-TW']) errors.push(`data/${game}.json ${section}.${english} 缺少独立繁中值或显式英文回退`);
      }
    }
  }

  for (const section of ['items', 'stats', 'tooltip', 'ui']) {
    if (!dictionary[section] || typeof dictionary[section] !== 'object') {
      errors.push(`data/${game}.json is missing ${section}`);
      continue;
    }
    for (const [english, entry] of Object.entries(dictionary[section])) {
      validateEntry(entry, `data/${game}.json ${section}.${english}`);
      if (typeof entry === 'object' && !Array.isArray(entry)) {
        if (Object.hasOwn(entry, 'en') || Object.hasOwn(entry, 'source')
          || Object.hasOwn(entry, 'sourceUrl') || Object.hasOwn(entry, 'confidence')
          || Object.hasOwn(entry, 'sources')) {
          errors.push(`data/${game}.json ${section}.${english} contains removable metadata`);
        }
        if (section !== 'items' && Object.hasOwn(entry, 'slug')) {
          errors.push(`data/${game}.json ${section}.${english} contains an invalid slug`);
        }
      }
    }
  }
}

function validatePoe2Terms(terms, language) {
  const path = `data/poe2.json.terms.${language}`;
  if (!terms || typeof terms !== 'object' || Array.isArray(terms)) return;
  const entries = Object.entries(terms);
  if (entries.length < 20000) {
    errors.push(`${path} has only ${entries.length} entries; expected at least 20000`);
  }
  for (const [english, entry] of entries) {
    if (typeof entry === 'string') {
      if (!entry) errors.push(`${path} ${english} is missing translation`);
      continue;
    }
    if (Array.isArray(entry)) {
      if (typeof entry[0] !== 'string' || !entry[0]) {
        errors.push(`${path} ${english} is missing translation`);
      }
      continue;
    }
    if (typeof entry?.translation !== 'string' || !entry.translation) {
      errors.push(`${path} ${english} is missing translation`);
    }
    if (typeof entry?.type !== 'string' || !entry.type) {
      errors.push(`${path} ${english} is missing type`);
    }
    if (entry?.source !== undefined || entry?.sourceUrl !== undefined || entry?.confidence !== undefined) {
      errors.push(`${path} ${english} contains removable metadata`);
    }
  }
}

async function main() {
  for (const file of [
    'manifest.json',
    'background.js',
    'content.js',
    'lib/translation-core.js',
    'lib/favorite-manager.js',
    'popup.html',
    'popup.js',
    'popup.css',
  ]) {
    await requireFile(file);
  }

  const hasPoe2Json = existsSync(resolve(root, 'data/poe2.json'));
  const hasPoe2Gz = existsSync(resolve(root, 'data/poe2.json.gz'));
  if (!hasPoe2Json && !hasPoe2Gz) {
    errors.push('Missing required file: data/poe2.json or data/poe2.json.gz');
  }

  const manifest = await readJson('manifest.json');
  if (manifest) {
    if (manifest.manifest_version !== 3) errors.push('manifest.json must be Manifest V3');
    if (manifest.background?.service_worker !== 'background.js') {
      errors.push('manifest.json must reference background.js as its service worker');
    }
    if (!manifest.permissions?.includes('storage')) errors.push('manifest.json must request storage permission');
    const script = manifest.content_scripts?.find((entry) => entry.matches?.includes('https://poe.ninja/*'));
    if (!script) {
      errors.push('manifest.json must inject a content script on https://poe.ninja/*');
    }
    try {
      for (const path of await manifestFiles(root, manifest)) await requireFile(path);
    } catch (error) {
      errors.push(error.message);
    }
    const mainScript = manifest.content_scripts?.find((entry) => entry.world === 'MAIN' && entry.js?.includes('trade/trade-standalone.js'));
    if (mainScript && (mainScript.run_at !== 'document_start' || mainScript.js.indexOf('trade/trade-pob-hook.js') < 0 || mainScript.js.indexOf('trade/trade-pob-hook.js') > mainScript.js.indexOf('trade/trade-standalone.js'))) {
      errors.push('复制 PoB 原文 Hook 必须在 document_start 且早于市集翻译脚本加载');
    }
  }

  const poe2 = await readJson('data/poe2.json');
  validateDictionary(poe2, 'poe2');
  validatePoe2Terms(poe2?.terms, 'zh-CN');

  if (errors.length) {
    for (const error of errors) console.error(`Extension validation: ${error}`);
    process.exitCode = 1;
    return;
  }

  console.log('Extension validation: OK');
}

main();
