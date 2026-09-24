import { spawn, execSync } from 'node:child_process';
import http from 'node:http';
import { resolve } from 'node:path';

const extPath = resolve('./dist/POE-Ninja-three-language-v0.2.13');
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const userDataDir = resolve('./.tmp_chrome_profile');

try {
  execSync('powershell -Command "Get-NetTCPConnection -LocalPort 9222 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"', { stdio: 'ignore' });
} catch (e) {}

console.log('🚀 正在启动 Chrome 调试实例加载扩展:', extPath);
const cp = spawn(chromePath, [
  '--remote-debugging-port=9222',
  `--load-extension=${extPath}`,
  `--disable-extensions-except=${extPath}`,
  `--user-data-dir=${userDataDir}`,
  '--no-first-run',
  '--disable-fre',
  '--no-default-browser-check',
  'https://poe.ninja/poe2/builds',
], { stdio: 'ignore', detached: true });

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = '';
      res.on('data', (c) => d += c);
      res.on('end', () => resolve(JSON.parse(d)));
    }).on('error', reject);
  });
}

async function main() {
  await sleep(3000);
  const pages = await getJson('http://127.0.0.1:9222/json');
  console.log('📄 页面列表:');
  for (const p of pages) {
    console.log(`  - [${p.type}] ${p.title} (${p.url})`);
  }

  const ninjaPage = pages.find((p) => p.url.includes('poe.ninja') || p.type === 'page');
  if (!ninjaPage || !ninjaPage.webSocketDebuggerUrl) return;

  const ws = new globalThis.WebSocket(ninjaPage.webSocketDebuggerUrl);
  let id = 1;
  const callbacks = new Map();
  function send(method, params = {}) {
    return new Promise((resolve) => {
      const msgId = id++;
      callbacks.set(msgId, resolve);
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }

  ws.onopen = async () => {
    console.log('✔ WebSocket 已连接，正在捕获 poe.ninja 翻译状态...');
    await send('Runtime.enable');
    await sleep(3000);

    const evalRes = await send('Runtime.evaluate', {
      expression: `document.body.innerText.slice(0, 500)`,
    });
    console.log('页面前 500 字内容:');
    console.log(evalRes.result?.result?.value);
    process.exit(0);
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && callbacks.has(msg.id)) {
      callbacks.get(msg.id)(msg);
      callbacks.delete(msg.id);
    }
  };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
