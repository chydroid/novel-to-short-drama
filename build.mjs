#!/usr/bin/env node
/* build.mjs — 把模块化的 novel-to-drama-studio.html 内联回单个文件，用于发布/部署。
 * 用法：node build.mjs
 * 读取 novel-to-drama-studio.html 中所有 <script src="src/X.js"></script>，
 * 将每个外部脚本内容内联为 <script>...</script>，输出 dist/novel-to-drama-studio.html。
 * 开发/测试仍走多文件（src/），本脚本只在需要单文件发布时运行。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML = resolve(__dirname, 'novel-to-drama-studio.html');
let html = readFileSync(HTML, 'utf8');

const re = /<script src="(src\/[^"]+)"><\/script>/g;
let m, n = 0;
const out = [];
let last = 0;
while ((m = re.exec(html))) {
  const srcPath = resolve(__dirname, m[1]);
  if (!existsSync(srcPath)) { console.error('缺失模块：' + m[1]); continue; }
  const code = readFileSync(srcPath, 'utf8').replace(/\r\n/g, '\n');
  out.push(html.slice(last, m.index));
  out.push('<script>\n' + code + '\n</script>');
  last = m.index + m[0].length;
  n++;
}
out.push(html.slice(last));
const result = out.join('');

const distDir = resolve(__dirname, 'dist');
if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true });
const distFile = resolve(distDir, 'novel-to-drama-studio.html');
writeFileSync(distFile, result, 'utf8');

const remaining = (result.match(/<script src="src\//g) || []).length;
console.log('已内联 ' + n + ' 个模块 → ' + distFile);
console.log('剩余外部 src 引用：' + remaining + (remaining ? '（警告：未全部内联）' : '（已完全内联）'));
