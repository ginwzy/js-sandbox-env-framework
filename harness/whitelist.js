/**
 * harness/whitelist.js —— 已知可接受 divergence 规则(把已知未修项从 fatal 集合降级)。
 *
 * 每条规则 = 对一个 diff entry 的谓词 → 命中即标 whitelist,不计入 gate 失败。
 * 规则即数据:每条规则带一个 issue 锚点(见各规则 issue 字段),指向一项尚未完成的清理任务 ——
 * 该任务修复后删掉对应规则,即可让 gate 重新守住它。
 *
 * 验收口径:"T1 已修目标应零 divergence 或仅落白名单"。下列即"仅落白名单"的那部分 ——
 * 涵盖 jsdom 缺对象覆盖缺口 / webidl 内部 symbol 泄漏等已知未尽项。
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
  // 方法残留 .prototype 已修:patch/window sweep 据 L2 基线 NO_PROTOTYPE 名集,经 mask.deproto 用无-prototype
  // callable(window helper 绑 window 的 bound fn / Document.prototype 方法 this-转发 forwarder)替换原 jsdom
  // 普通函数声明;mask.mixin 改箭头函数造 getter 消除访问器侧 .prototype 残留。原两条白名单规则
  // (fn.hasPrototype / fn.ownNames 恰多出 prototype)已无匹配项,删除以让 gate 重新守住。
  // 访问器 native 化 + getter own-toString 已修:patch/window sweep 经 mask.wrapAccessor 把 jsdom 原生
  // accessor get/set 一并 native 化,mask.mixin 删自造 getter 的 own toString。原两条白名单规则
  // (accessor.get.toStringNative / accessor.(get|set).hasOwnToString)已无匹配项,删除以让 gate 重新守住。
  // 历史:曾有一条"bucket==='MISSING' 一刀切"兜底覆盖所有缺口;各面补齐后拆为按 target 精确归属的承接锚点。
  // 其中 DOM 原型锚点(Document/Element/HTMLElement/EventTarget.prototype 缺方法 / 访问器)已随 patch/domproto
  // 补齐(据真机基线补方法 + 访问器,keyorder per-host 重排键序)、MISSING 清零而删 —— 删除以让 gate 重新守住
  // 该覆盖面。Node/Event.prototype 无缺失方法(残留是 ownKeys.order 枚举序轴,受 non-configurable WebIDL 常量
  // 阻塞,归该轴单独清理);更高版本基线(v148/v149)较注入基线(v143)多出的版本漂移键仍 MISSING 但非阻断,
  // 待基线刷新另议。剩余按 target 锚点:
  {
    issue: 'yvq.21',
    reason: 'jsdom 实例对象缺真机标准扩展键:window.chrome(loadTimes/csi/app)、Screen(availLeft/availTop/orientation)—— 覆盖缺口,独立任务。',
    match: (e) => e.bucket === 'MISSING' && (e.targetId === 'window.chrome' || e.targetId === 'Screen.prototype'),
  },
  // 注:原 yvq.24 规则(Navigator.prototype secure-context 42 项 + window File System Access/Window
  // Management/Local Font Access 函数的 MISSING 兜底)已删 —— patch/navigator + patch/globals 据两基线
  // host 门控补齐(chrome 全集 ⊃ webview 子集,contacts 移动端专属),其 MISSING 清零。删除以让 gate
  // 重新守住覆盖(防漏补 / 防过度注入)。补齐后激活的 Navigator.prototype ownKeys.order 属枚举顺序轴,
  // 与 Node/Event/HTMLDivElement 同根,归该轴单独清理,刻意不在此白名单。
  {
    issue: 'yvq.2',
    reason: 'jsdom 在 window/对象上以内部 Symbol(ctorRegistrySymbol 等)挂运行时构件,真 Chrome 无 —— webidl2js symbol 泄漏,独立任务。',
    match: (e) => e.bucket === 'EXTRA' && e.field === 'symbolKey',
  },
  // 注:原 yvq.22 规则(userAgentData EXTRA 兜"非 secure context 基线缺陷")已删 —— 两基线均经
  // secure context 重采(linux=localhost、android=Via WebView + adb reverse),userAgentData 已在基线中,
  // 规则全失配。删除以让 gate 重新守住此键(防真过度注入)。
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
