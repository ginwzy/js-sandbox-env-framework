/**
 * RealmPool —— worker_threads 并行执行池。
 *
 * 单线程 realm 构建 ~30ms(patch 流水线占 ~79%,keyorder+window 两热点,微优化无效——是每个新 window 必付的
 * V8 属性功),吞吐 ~37/s。多 worker 并行提吞吐,但**次线性**:jsdom 分配密集 → 内存带宽/GC 跨 isolate 竞争,
 * 实测峰值约 3.6×(~140/s)落在 size≈物理核数,超过反而回退。零隔离风险(每 worker 内每任务 fresh realm)。
 * 冷启动:每 worker 各自加载整套 jsdom/mimic 图,只长驻池摊薄后才划算(短爆发更慢);生产按机器 benchmark 定 size。
 * 库承担 worker 边界的两处易错部分 —— realm 不能跨线程(整体活在 worker 内)+ 结果须序列化(见 entry/worker /
 * core/serialize);调用方只定池大小与喂任务。
 *
 *   import { RealmPool } from 'mimic';
 *   const pool = new RealmPool({ size: 8 });          // 省略 size 默认 max(1, 核数-1)
 *   const out = await pool.run({ code, profile: 'chrome-mac' });  // out 已 clone/JSON 安全
 *   await pool.destroy();
 *
 * 适用无状态单发任务。Session(跨多次 run 持有同一活 realm)需 worker 亲和,不走此池(另行支持)。
 */
import { Worker } from 'node:worker_threads';
import os from 'node:os';

const WORKER_URL = new URL('./worker.js', import.meta.url);

export class RealmPool {
  constructor({ size = Math.max(1, os.cpus().length - 1) } = {}) {
    this._size = Math.max(1, size | 0);
    this._workers = [];
    this._idle = [];           // 空闲 worker 栈
    this._queue = [];          // 待分派任务 { id, job }
    this._pending = new Map(); // id → { resolve, reject }
    this._seq = 0;
    this._destroyed = false;
    for (let i = 0; i < this._size; i++) this._spawn();
  }

  get size() { return this._size; }
  /** 排队中(未分派)任务数,供调用方做背压判断。 */
  get pending() { return this._queue.length; }

  /** @param {{code:string, profile?:string, url?:string, scriptUrl?:string, trace?:boolean}} job */
  run(job) {
    if (this._destroyed) return Promise.reject(new Error('RealmPool 已 destroy'));
    if (!job || typeof job.code !== 'string') return Promise.reject(new TypeError('run(job):job.code 必须是字符串'));
    const id = ++this._seq;
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      this._queue.push({ id, job });
      this._drain();
    });
  }

  /** 优雅关闭:拒绝所有在途/排队任务并终止全部 worker。幂等。 */
  async destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    const err = new Error('RealmPool 已 destroy');
    for (const [, p] of this._pending) p.reject(err);
    this._pending.clear();
    this._queue.length = 0;
    this._idle.length = 0;
    await Promise.all(this._workers.map((w) => w.terminate()));
    this._workers.length = 0;
  }

  _spawn() {
    const w = new Worker(WORKER_URL);
    w._currentId = null;
    w._down = false;
    w.on('message', ({ id, result }) => {
      const p = this._pending.get(id);
      if (p) { this._pending.delete(id); p.resolve(result); }
      w._currentId = null;
      this._idle.push(w);
      this._drain();
    });
    w.on('error', (e) => this._onWorkerDown(w, e));
    w.on('exit', (code) => { if (code !== 0) this._onWorkerDown(w, new Error(`worker 异常退出 code=${code}`)); });
    this._workers.push(w);
    this._idle.push(w);
  }

  // worker 崩溃:在途任务随之失败(不静默丢),替补一个维持池容量。_down 守卫防 error+exit 双触发的重复替补。
  _onWorkerDown(w, err) {
    if (this._destroyed || w._down) return;
    w._down = true;
    if (w._currentId != null) {
      const p = this._pending.get(w._currentId);
      if (p) { this._pending.delete(w._currentId); p.reject(err); }
      w._currentId = null;
    }
    const iw = this._workers.indexOf(w); if (iw >= 0) this._workers.splice(iw, 1);
    const ii = this._idle.indexOf(w); if (ii >= 0) this._idle.splice(ii, 1);
    try { w.terminate(); } catch { /* noop */ }
    this._spawn();
    this._drain();
  }

  _drain() {
    while (this._idle.length && this._queue.length) {
      const w = this._idle.pop();
      const { id, job } = this._queue.shift();
      w._currentId = id;
      try {
        w.postMessage({ id, ...job });
      } catch (e) {
        this._queue.unshift({ id, job }); // 放回队首交替补处理
        this._onWorkerDown(w, e);         // 其末尾会再 _drain
        return;
      }
    }
  }
}
