import { TextDecoder } from 'node:util';

const utf16 = new TextDecoder('utf-16le', { fatal: true });
const marker = Buffer.alloc(8, 0xbb);

function fieldSize(column) {
  if (column.array) return 16;
  const sizes = { bool: 1, string: 8, row: 8, foreignrow: 16, enumrow: 4, u16: 2, i16: 2, u32: 4, i32: 4, f32: 4, u64: 8, i64: 8 };
  const size = sizes[column.type];
  if (!size) throw new Error(`不支持的数据表字段类型：${column.type}`);
  return size * (column.interval ? 2 : 1);
}

export function readDatStrings(bytes, schema) {
  if (bytes.length < 12) throw new Error('游戏数据表不完整');
  const count = bytes.readUInt32LE(0);
  const rowSize = schema.columns.reduce((sum, column) => sum + fieldSize(column), 0);
  const boundary = 4 + count * rowSize;
  if (!bytes.subarray(boundary, boundary + 8).equals(marker)) throw new Error(`数据表 schema 与客户端结构不匹配：${schema.name}`);
  const variable = bytes.subarray(boundary);
  const pointer = (buffer, offset) => {
    if (offset < 0 || offset + 8 > buffer.length) throw new Error('游戏文本指针越界');
    const value = buffer.readBigUInt64LE(offset);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('游戏文本指针超出安全范围');
    return Number(value);
  };
  const stringAt = offset => {
    if (offset < 0 || offset % 2 || offset + 2 > variable.length) throw new Error('游戏文本偏移无效');
    let end = offset;
    while (end + 2 <= variable.length && variable.readUInt16LE(end) !== 0) end += 2;
    if (end + 2 > variable.length) throw new Error('游戏文本缺少结束符');
    return utf16.decode(variable.subarray(offset, end));
  };
  const columns = {};
  let offset = 0;
  for (const [index, column] of schema.columns.entries()) {
    if ([schema.identityField, ...(schema.contextFields || [])].includes(column.name) && ['u32', 'enumrow'].includes(column.type) && !column.array) {
      columns[column.name] = Array.from({ length: count }, (_, row) => bytes.readUInt32LE(4 + row * rowSize + offset));
    }
    if (column.type === 'string') {
      const name = column.name || `__col${index}`;
      columns[name] = Array.from({ length: count }, (_, row) => {
        const cell = 4 + row * rowSize + offset;
        if (!column.array) return stringAt(pointer(bytes, cell));
        const length = pointer(bytes, cell), start = pointer(bytes, cell + 8);
        if (length > variable.length / 8 || start + length * 8 > variable.length) throw new Error('游戏文本数组越界');
        return Array.from({ length }, (_, entry) => stringAt(pointer(variable, start + entry * 8)));
      });
    }
    offset += fieldSize(column);
  }
  return { count, columns };
}

export function displayGameText(value) {
  return value.replace(/\[([^\[\]]+)\]/g, (_, text) => text.split('|').at(-1)).replace(/\\n/g, '\n');
}

function quotedLine(line) {
  const start = line.indexOf('"');
  if (start < 0) return null;
  let end = start + 1;
  for (; end < line.length; end++) {
    if (line[end] === '\\') { end++; continue; }
    if (line[end] === '"') break;
  }
  if (end >= line.length) throw new Error('词缀描述引号未闭合');
  const raw = line.slice(start + 1, end);
  const text = raw.replace(/\\(["\\nrt])/g, (_, escape) => ({ n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\' })[escape]);
  return { condition: line.slice(0, start).trim(), text, special: line.slice(end + 1).trim() };
}

// 与 PoB 导出器相同的描述结构，但不丢弃语言块、数值变换或不可显示声明。
export function parseCsd(text, path = '') {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const result = { includes: [], noDescription: [], directives: [], blocks: [] };
  let block, language = 'English', declared = null, currentForms;
  const finishSection = () => {
    if (block && declared !== null && currentForms.length !== declared) throw new Error(`${path}:${block.line} 语言段行数不匹配：${language}`);
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('//')) continue;
    if (line === 'no_identifiers') { result.directives.push(line); continue; }
    if (/^include\s/.test(line)) { result.includes.push(quotedLine(line).text); continue; }
    if (/^no_description\s/.test(line)) { result.noDescription.push(line.slice(15).trim()); continue; }
    if (/^(?:handed_)?description(?:\s|$)/.test(line)) {
      finishSection();
      block = { line: i + 1, declaration: line, stats: [], sections: { English: [] }, duplicates: [] };
      currentForms = block.sections.English;
      result.blocks.push(block); language = 'English'; declared = null;
      let header = '';
      while (++i < lines.length) {
        header += ` ${lines[i].trim()}`;
        const parts = header.trim().split(/\s+/), count = Number(parts[0]);
        if (Number.isInteger(count) && count > 0 && parts.length === count + 1) {
          if (parts.slice(1).some(id => !/^[A-Za-z_%+][A-Za-z0-9_+%.-]*$/.test(id))) throw new Error(`${path}:${i + 1} 属性 ID 组无效`);
          block.stats = parts.slice(1); break;
        }
        if (header.includes('"') || (Number.isInteger(count) && parts.length > count + 1)) throw new Error(`${path}:${i + 1} 属性 ID 组无效`);
      }
      if (!block.stats.length) throw new Error(`${path} 缺少属性 ID 组`);
      continue;
    }
    if (!block) throw new Error(`${path}:${i + 1} 未识别的词缀文件内容：${line}`);
    if (/^lang\s/.test(line)) {
      finishSection(); language = quotedLine(line).text; declared = null;
      currentForms = [];
      if (block.sections[language]) block.duplicates.push({ language, line: i + 1, forms: currentForms });
      else block.sections[language] = currentForms;
      continue;
    }
    if (/^\d+$/.test(line) && declared === null) { declared = Number(line); continue; }
    const form = quotedLine(line);
    if (!form || declared === null) throw new Error(`${path}:${i + 1} 无法解析词缀描述：${line}`);
    const tokens = form.condition.split(/\s+/);
    const limits = tokens.slice(0, block.stats.length);
    if (limits.length !== block.stats.length || limits.some(value => !/^(?:#|-?\d+|!-?\d+|(?:#|-?\d+)\|(?:#|-?\d+))$/.test(value))) throw new Error(`${path}:${i + 1} 无效的词缀条件`);
    currentForms.push({ ...form, limits, flags: tokens.slice(block.stats.length), line: i + 1 });
  }
  finishSection();
  return result;
}

export function pairTableTexts(english, localized, schema, locale) {
  if (english.count !== localized.count) throw new Error(`${schema.name} 同客户端语言表行数不同`);
  const idField = schema.identityField || (english.columns.Id ? 'Id' : null);
  if (idField && !english.columns[idField]) throw new Error(`${schema.name} 缺少身份字段 ${idField}`);
  if (idField && english.columns[idField].some((id, row) => id !== localized.columns[idField]?.[row])) throw new Error(`${schema.name} 同客户端语言表 ID 顺序不同`);
  if (schema.identityField && new Set(english.columns[idField]).size !== english.count) throw new Error(`${schema.name} 原生身份字段重复`);
  for (const field of schema.contextFields || []) {
    if (!english.columns[field] || english.columns[field].some((value, row) => value !== localized.columns[field]?.[row])) throw new Error(`${schema.name} 同客户端语境字段不同：${field}`);
  }
  const records = [];
  for (const [field, values] of Object.entries(english.columns)) {
    if (field === idField || schema.contextFields?.includes(field) || (schema.name === 'Words' && field !== 'Text2')) continue;
    for (let row = 0; row < values.length; row++) {
      const enValues = Array.isArray(values[row]) ? values[row] : [values[row]];
      const translatedValues = Array.isArray(localized.columns[field][row]) ? localized.columns[field][row] : [localized.columns[field][row]];
      if (enValues.length !== translatedValues.length) throw new Error(`${schema.name}:${row}:${field} 语言数组长度不同`);
      for (let element = 0; element < enValues.length; element++) {
        const en = enValues[element], translated = translatedValues[element];
        if (!en || !translated || en === translated) continue;
        const id = idField ? String(english.columns[idField][row]) : en;
        const context = schema.contextFields ? Object.fromEntries(schema.contextFields.map(field => [field, english.columns[field][row]])) : undefined;
        records.push({ table: schema.name, id, field, element, locale, en, translated, row, identity: idField || 'english-context',
          ...(context ? { context, nameRole: schema.nameRoles?.[context.Wordlist] } : {}) });
      }
    }
  }
  return records;
}
