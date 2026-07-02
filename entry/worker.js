/**
 * worker_threads 入口 —— 每收一个任务在本 worker 内建 realm、执行、序列化回传、dispose。
 *
 * 为何 realm 必须整体活在 worker 内:jsdom window 不能跨线程传递(非可克隆);结果经 serializeResult 归一成
 * clone 安全数据再 postMessage(直接回传活 DOM / 循环引用会抛 DataCloneError)。默认每任务 fresh realm,
 * 跨任务零状态泄漏 —— 并行来自"N 个 worker"而非"复用 realm",故无隔离风险。
 *
 * 由 entry/pool.js 经 `new Worker(new URL('./worker.js', ...))` 加载,不直接运行。
 */
import { parentPort } from 'node:worker_threads';
import { Realm } from '../core/realm.js';
import { serializeResult } from '../core/serialize.js';

if (!parentPort) throw new Error('entry/worker.js 只能作为 worker_threads 加载(见 entry/pool.js)');

// job:{ id, code, profile, url?, scriptUrl?, trace? }
//   url       —— 文档域(cookie/origin 落地);scriptUrl —— 脚本在 stack 帧中的来源 URL(见 Realm.run)。
parentPort.on('message', async ({ id, code, profile, url, scriptUrl, trace }) => {
  let realm = null;
  try {
    realm = await Realm.create({ profile, url, trace: !!trace });
    parentPort.postMessage({ id, result: serializeResult(realm.run(code, { url: scriptUrl })) });
  } catch (e) {
    // 装配级失败(Realm.create 抛):也序列化回传,不让 worker 静默无响应(pool 靠回传解 pending)。
    parentPort.postMessage({ id, result: { ok: false, error: e?.message ?? String(e), missing: [] } });
  } finally {
    realm?.dispose();
  }
});
