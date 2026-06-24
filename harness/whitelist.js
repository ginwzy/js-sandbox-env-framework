/**
 * harness/whitelist.js —— 已知可接受 divergence 规则(把已知未修项从 fatal 集合降级)。
 *
 * 每条规则 = 对一个 diff entry 的谓词 → 命中即标 whitelist,不计入 gate 失败。
 * 规则即数据:每条规则带一个 issue 锚点(见各规则 issue 字段),指向一项尚未完成的清理任务 ——
 * 该任务修复后删掉对应规则,即可让 gate 重新守住它。
 *
 * 验收口径:"T1 已修目标应零 divergence 或仅落白名单"。下列即"仅落白名单"的那部分 ——
 * 涵盖方法残留 .prototype / jsdom 缺对象覆盖缺口 / webidl 内部 symbol 泄漏等已知未尽项。
 */

/**
 * @typedef {object} DiffEntry
 * @property {string} targetId
 * @property {string|null} key
 * @property {string} field   如 'fn.hasPrototype' / 'fn.length' / 'resolved'
 * @property {string} bucket  TELL | MISSING | EXTRA | INFO
 * @property {*} baseline
 * @property {*} mimic
 */

/** @type {Array<{issue:string, reason:string, match:(e:DiffEntry)=>boolean}>} */
export const RULES = [
  {
    issue: 'yvq.11',
    reason: 'jsdom 把这些实现为普通函数声明,.prototype 为 non-configurable 删不掉 —— wrap 不动 .prototype,残留属另一类泄漏。',
    match: (e) => e.bucket === 'TELL' && e.field === 'fn.hasPrototype' && e.mimic === true && e.baseline === false,
  },
  {
    issue: 'yvq.11',
    reason: '同上:native 化的 window 方法 own 键差异恰为多出 prototype 一项(["length","name"]→[...,"prototype"]),其余键集合一致。差异不止 prototype(如夹带其他泄漏键)则不放行。',
    match: (e) => {
      if (!(e.bucket === 'TELL' && e.field === 'fn.ownNames'
        && typeof e.mimic === 'string' && typeof e.baseline === 'string')) return false;
      const b = new Set(e.baseline.split(',').filter(Boolean));
      const m = new Set(e.mimic.split(',').filter(Boolean));
      if (b.has('prototype')) return false;            // 基线本就有 prototype → 非"残留",不归此规则
      for (const k of b) if (!m.has(k)) return false;  // 基线的键必须都还在(无缺失)
      const extra = [...m].filter((k) => !b.has(k));
      return extra.length === 1 && extra[0] === 'prototype'; // 多出的恰且仅为 prototype
    },
  },
  // 访问器 native 化 + getter own-toString 已修:patch/window sweep 经 mask.wrapAccessor 把 jsdom 原生
  // accessor get/set 一并 native 化,mask.mixin 删自造 getter 的 own toString。原两条白名单规则
  // (accessor.get.toStringNative / accessor.(get|set).hasOwnToString)已无匹配项,删除以让 gate 重新守住。
  {
    issue: 'yvq.6',
    reason: 'jsdom 天生不提供这些标准浏览器对象/方法 —— 属覆盖面工作(coverage gap),非 T1 结构回归。',
    match: (e) => e.bucket === 'MISSING',
  },
  {
    issue: 'yvq.2',
    reason: 'jsdom 在 window/对象上以内部 Symbol(ctorRegistrySymbol 等)挂运行时构件,真 Chrome 无 —— webidl2js symbol 泄漏,独立任务。',
    match: (e) => e.bucket === 'EXTRA' && e.field === 'symbolKey',
  },
];

/**
 * 对一个 diff entry 求白名单命中,返回命中的 issue 标签或 null。
 * @param {DiffEntry} entry
 * @returns {string|null}
 */
export function classify(entry) {
  for (const rule of RULES) {
    try {
      if (rule.match(entry)) return rule.issue;
    } catch {
      /* 规则谓词异常视为未命中 */
    }
  }
  return null;
}
