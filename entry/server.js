/**
 * HTTP 入口(stub)—— 复用 Realm,提供在线执行 / 检测。
 * 取代旧 server/;routes(sandbox/env/ai/snapshot/mock)尚未迁移。
 *
 *   POST /run    { code, profile }      → Realm.create().run(code)
 *   POST /check  { code, profile }      → { missing, suggest }
 *   GET  /profiles
 */
export function startServer({ port = 3000 } = {}) {
  // stub:实现时用 express 挂载路由,内部统一走 Realm。
  console.log(`[server] stub —— 计划监听 :${port}(待实现)`);
}
