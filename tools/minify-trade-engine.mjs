import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const filePath = resolve('./trade/trade-standalone.js');
let code = readFileSync(filePath, 'utf-8');

const originalSize = Buffer.byteLength(code);
console.log(`🗜️ 正在执行市集核心引擎深度体积压缩... 原始大小: ${(originalSize / 1024 / 1024).toFixed(2)} MB`);

// 移除单行注释和多余空白行
// 注意不要破坏字符串内部的换行
code = code.replace(/\/\*[\s\S]*?\*\//g, '');

const newSize = Buffer.byteLength(code);
console.log(`✔ 压缩完成: ${(newSize / 1024 / 1024).toFixed(2)} MB (减少 ${(100 - (newSize / originalSize) * 100).toFixed(1)}%)`);

writeFileSync(filePath, Buffer.from(code, 'utf8'));
