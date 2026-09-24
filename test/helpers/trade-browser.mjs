import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const scripts = new Map();
export function runScript(context, file) {
  if (!scripts.has(file)) scripts.set(file, readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8'));
  vm.runInContext(scripts.get(file), context, { filename: file, timeout: 15_000 });
}

export function makeBrowser({ mode = 'zh', item, status = 200, fetchError, withUI = false, clipboardError = false, copyResult = true } = {}) {
  const messages = [], warnings = [], copied = [], listeners = new Map(), intervals = [], timers = new Map(), rows = [];
  let timerId = 0;
  const storage = new Map([['poe-market-tool-trade-localization-mode', mode]]);
  const payload = { result: item ? [{ id: 'listing-A', item }] : [] };

  class XHR {
    constructor() { this.listeners = new Map(); this.responseType = ''; this.readyState = 0; this.status = 0; }
    get responseText() {
      if (this.responseType && this.responseType !== 'text') throw new Error('InvalidStateError');
      return this.body;
    }
    get response() { return this.responseType === 'json' ? this.jsonBody : this.body; }
    open(method, url) { this.url = url; this.readyState = 1; }
    addEventListener(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(listener);
    }
    removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
    emit(type) { for (const listener of [...this.listeners.get(type) || []]) listener.call(this); }
    send() { this.complete(payload, status); }
    complete(json, responseStatus = 200) {
      this.body = JSON.stringify(json); this.jsonBody = JSON.parse(this.body); this.status = responseStatus;
      for (const readyState of [2, 3, 4]) { this.readyState = readyState; this.emit('readystatechange'); }
      this.emit('load'); this.emit('loadend');
    }
  }

  function element(tag) {
    const classes = new Set();
    return {
      tag, children: [], style: {}, dataset: {}, attrs: {}, events: {}, isConnected: true,
      classList: { add: (...names) => names.forEach((name) => classes.add(name)), remove: (...names) => names.forEach((name) => classes.delete(name)), contains: (name) => classes.has(name) },
      appendChild(child) { child.parent = this; this.children.push(child); },
      remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); this.isConnected = false; },
      select() {},
      getAttribute(name) { return this.attrs[name] ?? null; },
      addEventListener(type, listener) { this.events[type] = listener; },
      querySelector(selector) { return selector === '.poe-ninja-copy-pob-btn' ? this.children.find((child) => child.className === 'poe-ninja-copy-pob-btn') || null : null; },
    };
  }

  const context = vm.createContext({
    URL, Request, Response,
    console: { warn: (...args) => warnings.push(args.join(' ')), error: (...args) => warnings.push(args.join(' ')), log() {} },
    location: { hostname: 'www.pathofexile.com', origin: 'https://www.pathofexile.com', pathname: '/trade2/search/poe2/Standard/test' },
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    document: {
      readyState: 'loading', body: null, documentElement: null, head: element('head'),
      addEventListener() {}, removeEventListener() {}, querySelector() { return null; },
      querySelectorAll: () => rows, createElement: element, getElementById() { return null; },
      execCommand() { if (copyResult instanceof Error) throw copyResult; return copyResult; },
    },
    fetch: async () => { if (fetchError) throw fetchError; return new Response(JSON.stringify(payload), { status }); },
    XMLHttpRequest: XHR,
    addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(listener); },
    postMessage(data) { messages.push(data); queueMicrotask(() => dispatch(data)); },
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; }, clearTimeout(id) { timers.delete(id); },
    setInterval(callback) { intervals.push(callback); },
    requestAnimationFrame(callback) { timers.set(++timerId, callback); return timerId; },
    MutationObserver: class { constructor(callback) { this.callback = callback; } observe() {} disconnect() {} },
    navigator: { clipboard: { async writeText(text) { if (clipboardError) throw new Error('剪贴板被拒绝'); copied.push(text); } } },
  });
  vm.runInContext('window = globalThis; self = globalThis;', context);
  function dispatch(data, origin = context.location.origin) {
    for (const listener of listeners.get('message') || []) listener({ source: vm.runInContext('window', context), origin, data });
  }
  function addRow(id, attribute = 'data-id') { const row = element('div'); row.attrs[attribute] = id; rows.push(row); return row; }
  function startUI() {
    context.document.body = element('body'); context.document.documentElement = element('html'); context.document.readyState = 'complete';
    runScript(context, 'trade/trade-pob-converter.js'); runScript(context, 'trade/trade-pob-ui.js');
  }
  if (withUI) startUI();
  return { context, payload, messages, warnings, copied, timers, intervals, rows, addRow, startUI, dispatch,
    scan: () => intervals.forEach((callback) => callback()),
    click: (row) => row.querySelector('.poe-ninja-copy-pob-btn').events.click({ preventDefault() {}, stopPropagation() {} }),
  };
}

export const settle = () => new Promise((resolve) => setImmediate(resolve));
export const rawMessage = (items) => ({ source: 'poe-ninja-trade-pob-raw', type: 'POE_NINJA_TRADE_FETCH_RAW', body: { result: items.map((item) => ({ id: item.id, item })) } });
