import { execSync } from 'node:child_process';
import { statSync, existsSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = resolve(ROOT, 'dist', 'POE-Ninja-three-language-v0.2.13');
const zipPath = resolve(ROOT, 'dist', 'POE-Ninja-three-language-v0.2.14.zip');

if (existsSync(zipPath)) {
  unlinkSync(zipPath);
}

console.log('📦 正在生成最终可分发生产安装包 (ZIP)...');
console.log('源目录:', distDir);
console.log('目标包:', zipPath);

const psCommand = `powershell -NoProfile -Command "Compress-Archive -Path '${distDir}\\*' -DestinationPath '${zipPath}' -Force"`;
execSync(psCommand, { stdio: 'inherit' });

const stat = statSync(zipPath);
console.log('\n====================================================');
console.log('🎉 最终可分发压缩包已成功生成！');
console.log(`📍 文件绝对路径: ${zipPath}`);
console.log(`📦 安装包最终体积: ${(stat.size / 1024 / 1024).toFixed(2)} MB (${(stat.size / 1024).toFixed(1)} KB)`);
console.log('====================================================');
