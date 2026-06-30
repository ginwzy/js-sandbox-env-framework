/**
 * trace/monitor —— Proxy 访问监控(get/set/apply/construct 日志与断点)。
 *
 * 定位:分析/调试工具(非反检测),调试期显式对目标对象开启。
 * 对照 sdenv-extend/tools/monitor.js:get/set Proxy + debugger 触发 + 回调。
 *
 * 用法:
 *   const m = new Monitor();
 *   const watched = m.watch(target, 'window', { log: true, breakKeys: ['eval'] });
 *   // ... 脚本访问 watched.eval → 控制台日志 + 断言断点
 *   m.report();  // { get: N, set: N, ... }
 *   m.log;       // [{ op, name, key, value?, args?, ts }, ...]
 */
export class Monitor {
  constructor() {
    this.stats = { get: 0, set: 0, apply: 0, construct: 0 };
    this.log = [];
  }

  /**
   * 包裹对象返回受监控的 Proxy。
   * @param {object} target
   * @param {string} name       监控标识(日志前缀)
   * @param {object} [opts]
   * @param {boolean}       [opts.log]        开启控制台日志
   * @param {string[]}      [opts.breakKeys]  命中这些 key 时触发 debugger
   * @param {Function}      [opts.onGet]      get 回调 (key, value, name)
   * @param {Function}      [opts.onSet]      set 回调 (key, value, name)
   * @param {boolean}       [opts.deep]       递归包裹子对象(默认 false)
   */
  watch(target, name = '?', opts = {}) {
    if (target == null || (typeof target !== 'object' && typeof target !== 'function')) return target;

    const self = this;
    const { log: doLog, breakKeys = [], onGet, onSet, deep } = opts;
    const breakSet = new Set(breakKeys);
    const children = new WeakMap();

    return new Proxy(target, {
      get(t, key, receiver) {
        self.stats.get++;
        const value = Reflect.get(t, key, receiver);
        const entry = { op: 'get', name, key: String(key), ts: Date.now() };
        self.log.push(entry);
        if (doLog && typeof key === 'string') console.log(`[monitor:${name}] get .${key}`);
        if (breakSet.has(key)) { debugger; } // eslint-disable-line no-debugger
        onGet?.(key, value, name);
        if (deep && value != null && typeof value === 'object' && !children.has(value)) {
          const child = self.watch(value, `${name}.${String(key)}`, opts);
          children.set(value, child);
          return child;
        }
        return value;
      },
      set(t, key, value, receiver) {
        self.stats.set++;
        const entry = { op: 'set', name, key: String(key), ts: Date.now() };
        self.log.push(entry);
        if (doLog && typeof key === 'string') console.log(`[monitor:${name}] set .${key} =`, value);
        if (breakSet.has(key)) { debugger; } // eslint-disable-line no-debugger
        onSet?.(key, value, name);
        return Reflect.set(t, key, value, receiver);
      },
      apply(t, thisArg, args) {
        self.stats.apply++;
        self.log.push({ op: 'apply', name, args: args.length, ts: Date.now() });
        if (doLog) console.log(`[monitor:${name}] apply(${args.length} args)`);
        return Reflect.apply(t, thisArg, args);
      },
      construct(t, args, newTarget) {
        self.stats.construct++;
        self.log.push({ op: 'construct', name, args: args.length, ts: Date.now() });
        if (doLog) console.log(`[monitor:${name}] new(${args.length} args)`);
        return Reflect.construct(t, args, newTarget);
      },
    });
  }

  report() {
    const total = Object.values(this.stats).reduce((a, b) => a + b, 0);
    return { ...this.stats, total };
  }

  /** 按 op 或 key 过滤日志。 */
  filter(pred) {
    return this.log.filter(pred);
  }
}
