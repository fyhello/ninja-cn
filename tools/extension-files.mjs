import { glob, readFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';

export async function manifestFiles(root, manifest) {
  const files = new Set(['manifest.json']);
  if (manifest.background?.service_worker) files.add(manifest.background.service_worker);
  for (const entry of manifest.content_scripts || []) {
    for (const file of [...entry.js || [], ...entry.css || []]) files.add(file);
  }
  for (const entry of manifest.web_accessible_resources || []) {
    for (const resource of entry.resources || []) {
      if (!resource.includes('*')) { files.add(resource); continue; }
      const matches = [];
      for await (const file of glob(resource, { cwd: root, withFileTypes: true })) {
        if (file.isFile()) matches.push(resolve(file.parentPath, file.name));
      }
      if (!matches.length) throw new Error(`扩展资源匹配为空：${resource}`);
      for (const file of matches) files.add(file);
    }
  }
  return [...files];
}

export async function syncManifestFiles(root, destination) {
  const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
  for (const file of await manifestFiles(root, manifest)) {
    const source = resolve(root, file);
    const target = resolve(destination, relative(root, source));
    try {
      if ((await readFile(target)).equals(await readFile(source))) continue;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
  }
}
