// 此函数会嵌入 MAIN 世界产物，必须保持自包含。
export function localizeModText(template, source, showEnglish, translateAllocation) {
  const clean = (text) => String(text ?? '')
    .replace(/\[([^|\]]+)(?:\|([^\]]+))?\]/g, (_, id, display) => display || id)
    .replace(/\r\n?/g, '\n').split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim()).join('\n').trim();
  const original = clean(source);
  let translated = clean(template);
  if (/^Allocates\s+/i.test(original) && /配置\s*#/.test(translated)) {
    translated = translated.replace('#', translateAllocation(original.replace(/^Allocates\s+/i, '')));
  } else {
    // 区间中的连字符不是负号；富文本标识符中的数字不能作为词缀数值。
    const numberPattern = /(?<![\d.])[+-]?\d+(?:\.\d+)?/g;
    const values = original.match(numberPattern) || [];
    // 模板中的固定数字不是占位符，例如持续时间、技能等级或数量限制。
    const fixedValues = translated.match(numberPattern) || [];
    for (const fixed of fixedValues) {
      const index = values.findIndex((value) => Number(value) === Number(fixed));
      if (index < 0) {
        console.warn('[市集翻译] 词缀模板固定数值不匹配，保留原文');
        return original;
      }
      values.splice(index, 1);
    }
    const count = (translated.match(/#/g) || []).length;
    if (count !== values.length) {
      if (count || values.length) console.warn('[市集翻译] 词缀模板数值数量不匹配，保留原文');
      return original;
    }
    let index = 0;
    translated = translated.replace(/([+-]?)#/g, (_, templateSign) => {
      const value = values[index++];
      return /^[+-]/.test(value) ? value : templateSign + value;
    });
    if (values.length === 1 && /^[+-]?\d+(?:\.\d+)?% reduced\b/i.test(original)) translated = translated.replace(/增加|提高/g, '降低');
  }
  if (translated.includes('#')) {
    console.warn('[市集翻译] 词缀模板仍有未填充占位符，保留原文');
    return original;
  }
  return showEnglish && translated !== original ? `${translated}【（【${original}】）】` : translated;
}

function replaceOnce(code, source, replacement) {
  const index = code.indexOf(source);
  if (index < 0 || code.indexOf(source, index + source.length) >= 0) {
    throw new Error(`市集引擎修补位置不唯一或已变化：${source.slice(0, 70)}`);
  }
  return code.slice(0, index) + replacement + code.slice(index + source.length);
}

export function patchTradeLocalization(code) {
  code = replaceOnce(code,
    '{itemKey:"desecratedMods",extendedKey:"desecrated"},',
    '{itemKey:"desecratedMods",extendedKey:"desecrated"},{itemKey:"mutatedMods",extendedKey:"mutated"},');
  code = replaceOnce(code, 'let t=N(e.id),i=N(e.text);', 'let t=N(e.id),i=String(e.text??"").replace(/\\r\\n?/g,"\\n").trim();');
  code = replaceOnce(code, 'c=M(l?e.description||e.text||"":e);', 'c=String(l?e.description||e.text||"":e).replace(/\\r\\n?/g,"\\n").trim();');
  const start = 'let x=function(e,t){let i=w(e),a=w(t),l=';
  const end = '}(u,c);return x&&x!==c?l?{...e,description:x}:x:e';
  const first = code.indexOf(start);
  const last = code.indexOf(end, first);
  if (first < 0 || last < 0) throw new Error('市集词缀转换函数已变化');
  code = replaceOnce(code, code.slice(first, last + end.length),
    `let x=(${localizeModText.toString()})(u,c,n,name=>A(name,s)||name);return x&&x!==c?l?{...e,...(typeof e.description==="string"?{description:x}:{}),...(typeof e.text==="string"?{text:x}:{})}:x:e`);

  const openStart = code.indexOf('function et(...e){');
  const openEnd = code.indexOf('a.fetch=ee,I&&S&&R&&', openStart);
  if (openStart < 0 || openEnd < 0) throw new Error('市集 XHR 转换函数已变化');
  code = replaceOnce(code, code.slice(openStart, openEnd), String.raw`
function et(...args) {
  this.__poeTradeLocalizationCleanup__?.();
  if (this.__poeTradeResponseOverridden__) {
    delete this.responseText;
    delete this.response;
    this.__poeTradeResponseOverridden__ = false;
  }
  this.__poeTradeRequestUrl__ = String(args[1] || "");
  return S?.apply(this, args);
}
function ei(body) {
  const url = this.__poeTradeRequestUrl__;
  const dataKind = B(url);
  if (F(url, y, true)) {
    X();
    body = $(body);
  }
  if (F(url, _) || dataKind) {
    const cleanup = () => {
      this.removeEventListener("readystatechange", translate);
      this.removeEventListener("loadend", cleanup);
      this.__poeTradeLocalizationCleanup__ = null;
    };
    const translate = () => {
      if (this.readyState !== 4) return;
      cleanup();
      if (this.status < 200 || this.status >= 300) return;
      try {
        if (this.responseType && this.responseType !== "text" && this.responseType !== "json") return;
        const original = this.responseType === "json" ? JSON.stringify(this.response) : this.responseText;
        let localized;
        if (dataKind) localized = q(original, dataKind);
        else { D(original); localized = Q(original); }
        if (localized !== original) {
          if (this.responseType !== "json") Object.defineProperty(this, "responseText", { configurable: true, get: () => localized });
          const response = this.responseType === "json" ? JSON.parse(localized) : localized;
          Object.defineProperty(this, "response", { configurable: true, get: () => response });
          this.__poeTradeResponseOverridden__ = true;
        }
      } catch {
        console.warn("[市集翻译] XHR 响应转换失败，保留原始响应");
      }
    };
    this.__poeTradeLocalizationCleanup__ = cleanup;
    this.addEventListener("readystatechange", translate);
    this.addEventListener("loadend", cleanup);
  }
  try { return R?.call(this, body); }
  catch (error) { this.__poeTradeLocalizationCleanup__?.(); throw error; }
}
`);
  return code;
}
