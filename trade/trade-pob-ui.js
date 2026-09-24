/**
 * trade-pob-ui.js
 *
 * 在流放之路市集搜索结果的每个物品行注入「复制 PoB」按钮。
 * 1. 接收并缓存主世界 trade-pob-hook.js 广播的原始物品快照。
 * 2. 若缓存未命中，支持跨世界向主世界实时请求原始英文数据。
 * 3. 通过 PoeNinjaTradePobConverter 转换为标准的 Path of Building 纯英文文本格式并写入剪贴板。
 *
 * 运行环境：Content Script (Isolated World)
 */
(function attachTradePobUI() {
  'use strict';

  const pathname = window.location.pathname || '';
  if (!pathname.includes('/trade') && !pathname.includes('/trade2')) return;

  // ========== 2. 原始英文物品数据缓存与按需请求 ==========
  // key: itemId (data-id), value: item JSON (英文原文)
  const rawItemCache = new Map();
  const pendingRequests = new Map();
  const MESSAGE_SOURCE = 'poe-ninja-trade-pob-raw';

  function copyItem(item) {
    return item ? JSON.parse(JSON.stringify(item)) : null;
  }

  function handleRawFetchData(data) {
    if (!data) return;
    let json = data.body;
    if (typeof json === 'string') {
      try { json = JSON.parse(json); } catch { return; }
    }
    if (!json || !Array.isArray(json.result)) return;
    for (const entry of json.result) {
      if (!entry) continue;
      const item = entry.item;
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        if (entry.id) rawItemCache.set(String(entry.id), item);
        if (entry.itemId) rawItemCache.set(String(entry.itemId), item);
        if (item.id) rawItemCache.set(String(item.id), item);
      }
    }
  }

  // 监听来自 MAIN 世界发来的消息
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== window.location.origin || event.data?.source !== MESSAGE_SOURCE) return;

    // 1. 拦截广播消息
    if (event.data.type === 'POE_NINJA_TRADE_FETCH_RAW') {
      handleRawFetchData(event.data);
    }

    // 2. 响应按需查询
    if (event.data.type === 'POE_NINJA_RESPONSE_RAW_ITEM') {
      const { requestId, dataId, item } = event.data;
      const pending = pendingRequests.get(requestId);
      if (!pending || pending.dataId !== dataId) return;
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        if (dataId) rawItemCache.set(String(dataId), item);
        if (item.id) rawItemCache.set(String(item.id), item);
      }
      pendingRequests.delete(requestId);
      pending.resolve(copyItem(item));
    }
  });

  async function fetchRawItemFromMainWorld(dataId, timeoutMs = 1500) {
    if (!dataId) return null;
    const id = String(dataId).trim();
    if (rawItemCache.has(id)) return copyItem(rawItemCache.get(id));

    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRequests.delete(requestId);
        reject(new Error('原始物品数据读取超时，请重新搜索后重试'));
      }, timeoutMs);

      pendingRequests.set(requestId, {
        dataId: id,
        resolve(item) {
          clearTimeout(timer);
          resolve(item);
        },
      });

      window.postMessage({
        source: MESSAGE_SOURCE,
        type: 'POE_NINJA_REQUEST_RAW_ITEM',
        requestId,
        dataId: id,
      }, window.location.origin);
    });
  }

  // 暴露给全局其他模块（如 OmniPoB HUD 试穿）复用
  window.PoeNinjaRawDataManager = {
    getRawItem: (dataId) => copyItem(rawItemCache.get(String(dataId).trim())),
    fetchRawItem: fetchRawItemFromMainWorld,
  };

  // ========== 3. 按钮样式 ==========
  function injectStyles() {
    if (document.getElementById('poe-ninja-pob-styles')) return;
    const style = document.createElement('style');
    style.id = 'poe-ninja-pob-styles';
    style.textContent = `
      .poe-ninja-copy-pob-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 3px;
        padding: 3px 8px;
        margin: 2px 4px;
        border: 1px solid rgba(179, 139, 72, 0.7);
        border-radius: 3px;
        background: linear-gradient(180deg, #2b2319 0%, #17130e 100%);
        color: #d1b17b;
        font-size: 11px;
        font-family: inherit;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s ease-in-out;
        white-space: nowrap;
        line-height: 1.2;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
        user-select: none;
        vertical-align: middle;
      }
      .poe-ninja-copy-pob-btn:hover {
        background: linear-gradient(180deg, #443727 0%, #261f17 100%);
        border-color: rgba(220, 180, 100, 0.95);
        color: #fff0d0;
        box-shadow: 0 0 6px rgba(200, 160, 80, 0.4);
      }
      .poe-ninja-copy-pob-btn.success {
        border-color: rgba(80, 200, 120, 0.8) !important;
        background: linear-gradient(180deg, #1d3824 0%, #0e1e13 100%) !important;
        color: #72f09d !important;
      }
      .poe-ninja-copy-pob-btn.error {
        border-color: rgba(220, 80, 80, 0.8) !important;
        background: linear-gradient(180deg, #3d1c1c 0%, #1e0d0d 100%) !important;
        color: #f07272 !important;
      }
      .poe-ninja-copy-pob-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  // ========== 4. 获取当前语言 ==========
  function getLabelText() {
    try {
      const lang = window.localStorage.getItem('preferredLanguage') ||
                   window.localStorage.getItem('selectedLanguage') || 'zh-CN';
      if (lang === 'en') return 'Copy PoB';
      if (lang === 'zh-TW') return '複製 PoB';
      return '复制 PoB';
    } catch {
      return '复制 PoB';
    }
  }

  // ========== 5. 注入按钮逻辑 ==========
  const feedbackTimers = new WeakMap();

  function getRowItemId(row) {
    return String(row.getAttribute('data-id') || row.getAttribute('data-item-id') || '').trim();
  }

  function createCopyButton(row) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'poe-ninja-copy-pob-btn';
    btn.textContent = `📋 ${getLabelText()}`;
    btn.title = '复制为 Path of Building 纯英文导入文本';

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (btn.disabled) return;
      clearTimeout(feedbackTimers.get(btn));
      btn.classList.remove('success', 'error');

      btn.disabled = true;
      btn.textContent = '⏳ 提取中...';

      try {
        const dataId = getRowItemId(row);
        if (!dataId) throw new Error('当前结果行缺少物品 ID');
        // 1. 尝试从本地缓存或跨世界实时向主世界拉取英文原版数据
        const item = await fetchRawItemFromMainWorld(dataId);
        if (!row.isConnected || getRowItemId(row) !== dataId) throw new Error('当前物品已更新，请重新点击复制');

        if (!item) {
          throw new Error('未捕获到英文原始数据，请重新搜索后重试');
        }

        if (!window.PoeNinjaTradePobConverter) {
          throw new Error('PoB 转换模块尚未就绪');
        }

        // 2. 转换为标准的 PoB 英文文本
        const pobText = window.PoeNinjaTradePobConverter.itemToPobText(item);
        if (!pobText) {
          throw new Error('物品文本转换失败');
        }

        // 3. 写入系统剪贴板
        try {
          await navigator.clipboard.writeText(pobText);
          showFeedback(btn, 'success', '✅ 已复制');
        } catch (clipErr) {
          if (!row.isConnected || getRowItemId(row) !== dataId) throw new Error('当前物品已更新，请重新点击复制');
          // Fallback 剪贴板写入
          const textarea = document.createElement('textarea');
          textarea.value = pobText;
          textarea.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0';
          try {
            document.body.appendChild(textarea);
            textarea.select();
            if (!document.execCommand('copy')) throw new Error('浏览器拒绝剪贴板写入，请保持页面焦点后重试');
          } finally {
            textarea.remove();
          }
          showFeedback(btn, 'success', '✅ 已复制');
        }
      } catch (err) {
        showFeedback(btn, 'error', '复制失败', err.message || '未知错误');
      } finally {
        btn.disabled = false;
      }
    });

    return btn;
  }

  function showFeedback(btn, type, text, detail = '') {
    clearTimeout(feedbackTimers.get(btn));
    btn.textContent = text;
    btn.title = detail || '复制为 Path of Building 纯英文导入文本';
    btn.classList.remove('success', 'error');
    btn.classList.add(type);
    feedbackTimers.set(btn, setTimeout(() => {
      btn.textContent = `📋 ${getLabelText()}`;
      btn.classList.remove('success', 'error');
    }, 1500));
  }

  function injectCopyPobButton(row) {
    if (!row || row.querySelector('.poe-ninja-copy-pob-btn')) return;
    const dataId = getRowItemId(row);
    if (!dataId) return;

    const btn = createCopyButton(row);

    // 优先插入到官方市集按钮组容器 .btns 内
    const targets = [
      row.querySelector('.right .details .btns'),
      row.querySelector('.right .btns'),
      row.querySelector('.btns'),
      row.querySelector('.right .details'),
      row.querySelector('.right'),
      row.querySelector('.middle .bottom'),
      row.querySelector('.middle'),
    ];

    let inserted = false;
    for (const target of targets) {
      if (target) {
        target.appendChild(btn);
        inserted = true;
        break;
      }
    }

    if (!inserted) {
      row.appendChild(btn);
    }
  }

  // ========== 6. 扫描与监听机制 ==========
  function scanExistingRows() {
    const rows = document.querySelectorAll('.row[data-id], .row[data-item-id], [data-id].resultset-item');
    if (!rows || rows.length === 0) return;
    for (const row of rows) {
      injectCopyPobButton(row);
    }
  }

  let scanTimer = null;
  function debouncedScan() {
    if (scanTimer) return;
    scanTimer = requestAnimationFrame(() => {
      scanTimer = null;
      scanExistingRows();
    });
  }

  const observer = new MutationObserver((mutations) => {
    let shouldScan = false;
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' || mutation.addedNodes.length > 0) {
        shouldScan = true;
        break;
      }
    }
    if (shouldScan) {
      debouncedScan();
    }
  });

  function startObserving() {
    injectStyles();

    const rootTarget = document.documentElement || document.body;
    if (rootTarget) {
      observer.observe(rootTarget, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-id', 'data-item-id'] });
    }

    setInterval(scanExistingRows, 800);
    scanExistingRows();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserving);
  } else {
    startObserving();
  }
})();
