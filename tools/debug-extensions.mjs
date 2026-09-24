import { spawn, execSync } from 'node:child_process';
import http from 'node:http';
import { resolve } from 'node:path';

const extPath = resolve('./dist/POE-Ninja-three-language-v0.2.13');
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const userDataDir = resolve('./.tmp_chrome_profile');

try {
  execSync('powershell -Command "Get-NetTCPConnection -LocalPort 9222 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"', { stdio: 'ignore' });
} catch (e) {}

console.log('🚀 正在启动 Chrome 并打开扩展管理页...');
const cp = spawn(chromePath, [
  '--remote-debugging-port=9222',
  `--load-extension=${extPath}`,
  `--disable-extensions-except=${extPath}`,
  `--user-data-dir=${userDataDir}`,
  '--no-first-run',
  '--disable-fre',
  '--no-default-browser-check',
  'chrome://extensions/',
], { stdio: 'ignore', detached: true });

async function main() {
  await new Promise((r) => setTimeout(r, 3000));
  http.get('http://127.0.0.1:9222/json', (res) => {
    let d = '';
    res.on('data', (c) => d += c);
    res.on('end', () => {
      console.log('📄 页面列表:');
      const pages = JSON.parse(d);
      for (const p of pages) {
        console.log(`  - [${p.type}] ${p.title} (${p.url})`);
      }
      process.exit(0);
    });
  });
}

main();
