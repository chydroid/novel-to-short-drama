/**
 * Agnes / 文本模型 API 本地代理（Node 零依赖）
 * ------------------------------------------------------------
 * 作用：浏览器直接请求 apihub.agnes-ai.com 会被 CORS 拦截，
 *       这个脚本在本机起一个转发服务并补上 CORS 头，
 *       让工作台页面可以通过 http://127.0.0.1:8787 访问。
 *
 * 启动：
 *   node agnes-proxy.js
 *   node agnes-proxy.js --port 8787 --agnes https://apihub.agnes-ai.com --text https://api.openai.com --tts https://api.xiaomimimo.com
 *
 * 然后在工作台「设置」里填：
 *   Agnes 接口 Base URL      http://127.0.0.1:8787/v1
 *   Agnes 任务查询根地址      http://127.0.0.1:8787
 *   文本模型 Base URL        http://127.0.0.1:8787/text/v1
 *   小米 TTS Base URL        http://127.0.0.1:8787/tts/v1
 *
 * 路由规则：
 *   /agnesapi*            -> AGNES 目标（视频任务查询）
 *   /text/*               -> TEXT 目标（去掉 /text 前缀）
 *   /tts/*                -> TTS 目标（去掉 /tts 前缀）
 *   其它（如 /v1/...）     -> AGNES 目标
 *
 * 注意：仅监听 127.0.0.1，不对外暴露；请勿部署到公网。
 */
const http = require('http');
const https = require('https');
const { URL } = require('url');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const PORT = Number(arg('port', process.env.PORT || 8787));
const AGNES = (arg('agnes', process.env.AGNES_TARGET || 'https://apihub.agnes-ai.com')).replace(/\/+$/, '');
const TEXT = (arg('text', process.env.TEXT_TARGET || 'https://api.openai.com')).replace(/\/+$/, '');
const TTS = (arg('tts', process.env.TTS_TARGET || 'https://api.xiaomimimo.com')).replace(/\/+$/, '');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400'
};

function pipe(req, res, targetBase, pathWithQuery) {
  let target;
  try {
    target = new URL(pathWithQuery, targetBase);
  } catch (e) {
    res.writeHead(500, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, CORS));
    return res.end('目标地址解析失败：' + targetBase + pathWithQuery);
  }
  const isHttps = target.protocol === 'https:';
  const lib = isHttps ? https : http;

  const headers = Object.assign({}, req.headers);
  delete headers['host'];
  delete headers['origin'];
  delete headers['referer'];
  delete headers['accept-encoding']; // 不做压缩，避免解压处理

  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = chunks.length ? Buffer.concat(chunks) : null;
    if (body) headers['content-length'] = Buffer.byteLength(body);

    const t0 = Date.now();
    const up = lib.request(
      { protocol: target.protocol, hostname: target.hostname, port: target.port || (isHttps ? 443 : 80),
        path: target.pathname + target.search, method: req.method, headers },
      (ur) => {
        const out = Object.assign({}, ur.headers);
        delete out['transfer-encoding'];
        delete out['content-encoding'];
        delete out['content-length'];
        Object.assign(out, CORS);
        res.writeHead(ur.statusCode || 502, out);
        ur.on('data', (d) => res.write(d));
        ur.on('end', () => {
          res.end();
          console.log(`[${ur.statusCode}] ${req.method} ${target.pathname}${target.search} ${Date.now() - t0}ms`);
        });
      }
    );
    up.on('error', (e) => {
      console.error('代理转发失败:', e.message);
      res.writeHead(502, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, CORS));
      res.end(JSON.stringify({ error: 'proxy_error', message: e.message }));
    });
    up.setTimeout(600000, () => { up.destroy(new Error('上游超时')); });
    if (body) up.write(body);
    up.end();
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }
  const u = req.url || '/';
  if (u === '/' || u === '/health') {
    res.writeHead(200, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, CORS));
    return res.end('agnes-proxy OK\nAGNES=' + AGNES + '\nTEXT=' + TEXT + '\nTTS=' + TTS + '\n');
  }
  if (u.indexOf('/text/') === 0) {
    return pipe(req, res, TEXT, u.slice('/text'.length));
  }
  if (u.indexOf('/tts/') === 0) {
    return pipe(req, res, TTS, u.slice('/tts'.length));
  }
  return pipe(req, res, AGNES, u);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('==================================================');
  console.log(' Agnes 本地代理已启动: http://127.0.0.1:' + PORT);
  console.log('   /v1/* 与 /agnesapi*  -> ' + AGNES);
  console.log('   /text/*              -> ' + TEXT);
  console.log('   /tts/*               -> ' + TTS);
  console.log('');
  console.log(' 工作台设置里填：');
  console.log('   Agnes Base URL   http://127.0.0.1:' + PORT + '/v1');
  console.log('   任务查询根地址   http://127.0.0.1:' + PORT + '');
  console.log('   文本模型 Base    http://127.0.0.1:' + PORT + '/text/v1');
  console.log('   小米 TTS Base    http://127.0.0.1:' + PORT + '/tts/v1');
  console.log('==================================================');
});
