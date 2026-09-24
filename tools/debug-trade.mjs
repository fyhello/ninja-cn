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
const chromeProcess = spawn(chromePath, [
  '--remote-debugging-port=9222',
  `--load-extension=${extPath}`,
  `--disable-extensions-except=${extPath}`,
  `--user-data-dir=${userDataDir}`,
  '--no-first-run',
  '--no-default-browser-check',
  'https://www.pathofexile.com/trade2/search/poe2/Standard',
], {
  stdio: 'ignore',
  detached: true,
});

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('⏳ 等待 Chrome 调试端口 9222 响应...');
  let pages = [];
  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    try {
      pages = await getJson('http://127.0.0.1:9222/json');
      if (pages.length > 0) break;
    } catch (e) {}
  }

  console.log('📄 当前打开的标签页列表:');
  for (const page of pages) {
    console.log(`  - [${page.type}] ${page.title} (${page.url})`);
  }

  const tradePage = pages.find((p) => p.url.includes('pathofexile.com/trade2') || p.type === 'page');
  if (!tradePage || !tradePage.webSocketDebuggerUrl) {
    console.error('❌ 未找到市集页面 WebSocket 地址');
    return;
  }

  console.log('🔌 正在连接市集页面 CDP WebSocket:', tradePage.webSocketDebuggerUrl);
  // 使用 Node 自带的 WebSocket (Node 22+) 或原生 HTTP upgrade
  const ws = new globalThis.WebSocket(tradePage.webSocketDebuggerUrl);

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
    console.log('✔ WebSocket 已连接，正在启用 Runtime, Network, Console 监听...');
    await send('Runtime.enable');
    await send('Console.enable');
    await send('Network.enable');

    console.log('⏳ 正在等待 5 秒捕获页面请求与初始化状态...');
    await sleep(5000);

    // 检查主世界变量状态
    console.log('\n--- [诊断 1] 检查主世界全局变量 ---');
    const evalRes1 = await send('Runtime.evaluate', {
      expression: `JSON.stringify({
        hasStandalone: !!window.__POE_TRADE_STANDALONE_INSTALLED__,
        hasEngine: !!window.PoeNinjaTradeFetchEngine,
        datasetUrl: document.documentElement.dataset.poeNinjaDictUrl || null,
        datasetLang: document.documentElement.dataset.poeNinjaLanguage || null
      })`,
    });
    console.log('主世界状态:', evalRes1.result?.result?.value);

    // 检查 Vue 实例或搜索框状态
    console.log('\n--- [诊断 2] 检查页面搜索组件中的 options / 数据 ---');
    const evalRes2 = await send('Runtime.evaluate', {
      expression: `(() => {
        const multiselects = Array.from(document.querySelectorAll('.multiselect'));
        return JSON.stringify({
          multiselectCount: multiselects.length,
          inputs: Array.from(document.querySelectorAll('input')).map(i => i.placeholder || i.className)
        });
      })()`,
    });
    console.log('DOM 搜索框状态:', evalRes2.result?.result?.value);

    // 测试主动 fetch stats 并查看返回数据
    console.log('\n--- [诊断 3] 主动在页面中 fetch /api/trade2/data/stats 检查中文化 ---');
    const evalRes3 = await send('Runtime.evaluate', {
      awaitPromise: true,
      expression: `(async () => {
        try {
          const res = await window.fetch('/api/trade2/data/stats');
          const data = await res.json();
          const firstGroup = data.result?.[0];
          return JSON.stringify({
            status: res.status,
            groupLabel: firstGroup?.label,
            firstEntries: firstGroup?.entries?.slice(0, 3)
          });
        } catch (e) {
          return 'Fetch error: ' + e.message;
        }
      })()`,
    });
    console.log('fetch stats 诊断结果:', evalRes3.result?.result?.value);

    console.log('\n================ 诊断完成 ================');
    process.exit(0);
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.id && callbacks.has(msg.id)) {
        callbacks.get(msg.id)(msg);
        callbacks.delete(msg.id);
      } else if (msg.method === 'Console.messageAdded') {
        console.log('[Console Log]:', msg.params.message.text);
      } else if (msg.method === 'Runtime.consoleAPICalled') {
        const args = msg.params.args.map((a) => a.value || a.description).join(' ');
        console.log(`[Page Console ${msg.params.type}]:`, args);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        console.log('[Page Exception]:', msg.params.exceptionDetails.text, msg.params.exceptionDetails.exception?.description);
      } else if (msg.method === 'Network.responseReceived') {
        const url = msg.params.response.url;
        if (url.includes('trade2/data') || url.includes('trade2/fetch') || url.includes('trade2/search')) {
          console.log(`[Network Response] status=${msg.params.response.status} url=${url}`);
        }
      }
    } catch (e) {}
  };
}

main().catch((err) => {
  console.error('❌ 诊断工具运行出错:', err);
  process.exit(1);
});
