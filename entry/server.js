/**
 * HTTP 入口 —— 经 RealmPool 并行执行,内部统一走 worker(realm 活在 worker 内、结果已序列化)。
 *
 *   POST /run       { code, profile?, url?, scriptUrl?, trace? }  → { ok, value, missing }(已 clone/JSON 安全)
 *   GET  /profiles                                                → string[]
 *
 * 返回句柄 { server, pool, close() } 供编程调用优雅关闭;CLI(mimic serve)走 SIGINT。
 * /check(missing + suggest)待 worker 侧透传 trace.suggest 后补。
 */
import http from 'node:http';
import { RealmPool } from './pool.js';
import { Profile } from '../core/profile.js';

const MAX_BODY = 4 << 20; // 4MB

export function startServer({ port = 3000, size } = {}) {
  const pool = new RealmPool(size ? { size } : {});

  const readJSON = (req) => new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (c) => { buf += c; if (buf.length > MAX_BODY) { req.destroy(); reject(new Error('body 过大')); } });
    req.on('end', () => { try { resolve(buf ? JSON.parse(buf) : {}); } catch { reject(new Error('body 非合法 JSON')); } });
    req.on('error', reject);
  });
  const send = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  };

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'POST' && req.url === '/run') {
        const { code, profile, url, scriptUrl, trace } = await readJSON(req);
        if (typeof code !== 'string') return send(res, 400, { ok: false, error: 'code 必须是字符串' });
        return send(res, 200, await pool.run({ code, profile, url, scriptUrl, trace }));
      }
      if (req.method === 'GET' && req.url === '/profiles') {
        return send(res, 200, await Profile.list());
      }
      send(res, 404, { ok: false, error: `未知路由 ${req.method} ${req.url}` });
    } catch (e) {
      send(res, 400, { ok: false, error: e?.message ?? String(e) });
    }
  });

  const close = async () => { await new Promise((r) => server.close(r)); await pool.destroy(); };
  server.on('error', (e) => { console.error(`serve 启动失败:${e.message}`); process.exitCode = 1; });
  process.once('SIGINT', () => { close().finally(() => process.exit(0)); });
  server.listen(port, () => console.log(`mimic serve —— :${port}(pool size=${pool.size})`));
  return { server, pool, close };
}
