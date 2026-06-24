/**
 * patch/window —— 批量 native 化 window/DOM 标准方法,消除 jsdom 内置函数 toString 暴露实现源码的泄漏。
 *
 * 现状[实测]:window/DOM 方法 toString() 返回 jsdom 实现源码(且 name 为空、带 own toString),
 *   window.atob.toString()            -> function (str) { try { return atob(str); } ... Node.js DOMException ...
 *   new Event('x').stopPropagation.toString() -> stopPropagation() { const esValue = ... }
 * vmp 遍历 window/DOM 方法一测即破。根因与修法见 mask.wrap。
 *
 * 覆盖策略:jsdom 把每个 Web API 原型都以全局构造器暴露在 window 上(Event/DOMTokenList/
 * CSSStyleDeclaration/Storage/NodeList/HTMLCollection/History/Location/URL/URLSearchParams/
 * Node/EventTarget/Element/HTML*Element/Document/Text/...)。故枚举 window 上每个构造器, sweep
 * 其 prototype 链(停在 Object.prototype) —— 自动覆盖全部暴露原型, 免维护手列清单(对照 sdenv
 * browser/chrome/ 下几十个手列文件)。另从代表性实例链兜底未作为全局暴露的原型。
 *
 * 安全性:mask.wrap 只 native 化"当前在泄漏"的函数 —— 真实 ECMAScript intrinsic(Object/Array/
 * Function 等)其 prototype 方法本就 native, 自动跳过, 核心 intrinsic 不被触碰;方法与构造器一视同仁
 * (wrap 不动 .prototype, 构造器仍可 new)。
 * 不在范围:访问器(getter/setter)源码泄漏、方法残留 .prototype, 属另一类泄漏(见独立 issue)。
 */
export default {
  name: 'window',
  after: [],
  apply({ window, mask }) {
    const stop = window.Object.prototype; // 原型链上界:核心 intrinsic 不碰
    const swept = new Set();

    // 方法 arity 修正表(sweepOwn 调 mask.wrap 须传 len,否则 fn() 跳过 .length 校正 → jsdom 形参个数泄漏)。
    // ground truth = L2 真机结构基线 linux-chrome-v143 的 fn.length。只列 jsdom 与真机 Chrome 不一致、经 diff 实证的方法 ——
    // jsdom 余者 arity 已与真机一致(否则会有成片 fn.length TELL),故精确修正而非全量覆盖。
    // 纪律:scroll/scrollBy/scrollTo 真机即 0(实测 jsdom 亦 0,已对),刻意不入表 —— 避免被 move/resize 族(真机 2)一刀切污染。
    // key = sweep 时计算的 owner label(window 自有 / <Ctor>.prototype),取自插桩实测的 wrap 生效点。
    // sweep 时计算的 owner label(window 自有 / <Ctor>.prototype),ARITY / NO_PROTOTYPE 共用为键。
    const labelOf = (obj) => (obj === window ? 'window' : (((obj.constructor && obj.constructor.name) || '') + '.prototype'));

    const ARITY = {
      window: { moveBy: 2, moveTo: 2, resizeBy: 2, resizeTo: 2, postMessage: 1 },
      'Document.prototype': { evaluate: 2, createExpression: 1 },
    };
    const arityOf = (obj, key) => {
      const t = ARITY[labelOf(obj)];
      return t && typeof t[key] === 'number' ? t[key] : undefined;
    };

    // .prototype 残留清除目标:真机 native 方法无 own .prototype,但 jsdom 把这些实现为普通 function
    // declaration → 残留 .prototype(non-configurable 删不掉)。ground truth = L2 真机结构基线的
    // fn.hasPrototype===false 名集(详见 docs/spec/prototype-residue-elimination.md)。
    // 刻意用基线而非运行时启发式:writable/vestigial 启发式会误伤 Window/StyleSheet/CSSRule 等真机有
    // .prototype、jsdom 却把 prototype 留空的接口构造器 —— 运行时分不清"jsdom 没填"与"本就是 helper"。
    // mask.deproto 仅当"名在表 且 jsdom 确有残留 .prototype"才替换;漏列只残留 tell(被 diff/gate 抓),
    // 不会误伤构造器(对比"排除名单"漏列会破坏 new)。window helper 绑 window(singleton receiver);
    // Document.prototype 方法 receiver 随实例变,deproto 走 this-转发 forwarder(bindTo 省略)。
    // 刻意排除 print:平台分歧 —— desktop Chrome 是 native(hasPrototype=false),Android WebView 却把
    //   print 实现为 JS shim(hasPrototype=true、name="")。两基线唯一分歧项;留它带 jsdom 原状,避免按
    //   桌面口径剥 proto 反而偏离 webview 真机。其 name/toStringNative 另属 webview shim 仿真,单独处理。
    const NO_PROTOTYPE = {
      window: new Set([
        'alert', 'atob', 'blur', 'btoa', 'cancelAnimationFrame', 'cancelIdleCallback', 'captureEvents',
        'clearInterval', 'clearTimeout', 'close', 'confirm', 'createImageBitmap', 'fetch', 'find', 'focus',
        'getComputedStyle', 'getSelection', 'matchMedia', 'moveBy', 'moveTo', 'open', 'postMessage',
        'prompt', 'queueMicrotask', 'releaseEvents', 'reportError', 'requestAnimationFrame', 'requestIdleCallback',
        'resizeBy', 'resizeTo', 'scroll', 'scrollBy', 'scrollTo', 'setInterval', 'setTimeout', 'stop',
        'structuredClone', 'webkitCancelAnimationFrame', 'webkitRequestAnimationFrame',
        'webkitRequestFileSystem', 'webkitResolveLocalFileSystemURL',
      ]),
      'Document.prototype': new Set(['evaluate', 'createExpression', 'createNSResolver']),
    };
    const noProtoOf = (obj, key) => {
      const s = NO_PROTOTYPE[labelOf(obj)];
      return !!(s && s.has(key));
    };
    const hasOwnProto = (f) => Object.prototype.hasOwnProperty.call(f, 'prototype');

    // 扫一个对象的自有函数属性。跳过 constructor —— 它指向类, wrap 会把其 name 误改成 'constructor'。
    const sweepOwn = (obj) => {
      if (!obj || obj === stop || swept.has(obj)) return;
      swept.add(obj);
      for (const key of Object.getOwnPropertyNames(obj)) {
        if (key === 'constructor') continue;
        const d = Object.getOwnPropertyDescriptor(obj, key);
        if (d) {
          if (typeof d.value === 'function') {
            const len = arityOf(obj, key);                                           // len 仅校正实证 arity 偏差
            // 残留 .prototype 的具名普通函数:换无-prototype callable(window 绑 window,原型方法转发 this);
            // 余者仅外观 native 化。仅当 jsdom 确有残留时才走 deproto,避免无谓替换 webidl 方法。
            if (noProtoOf(obj, key) && hasOwnProto(d.value)) mask.deproto(obj, key, len, obj === window ? window : undefined);
            else mask.wrap(obj, key, len);
          } else if (d.get || d.set) {
            mask.wrapAccessor(obj, key);                                             // jsdom 原生访问器:get/set 一并 native 化
          }
        }
      }
    };

    // 沿原型链逐层扫, 停在 Object.prototype。
    const sweepChain = (start) => {
      for (let o = start; o && o !== stop; o = Object.getPrototypeOf(o)) sweepOwn(o);
    };

    // window 自有方法 + 构造器函数本身(atob/btoa/setTimeout/getComputedStyle/URL/Event/...)。
    sweepOwn(window);

    // 每个全局构造器的 prototype 链 —— 覆盖 jsdom 暴露的全部 Web API 原型。
    for (const key of Object.getOwnPropertyNames(window)) {
      let proto = null;
      try {
        const d = Object.getOwnPropertyDescriptor(window, key);
        const ctor = d && d.value;
        proto = typeof ctor === 'function' ? ctor.prototype : null;
      } catch {
        continue;
      }
      if (proto && typeof proto === 'object') sweepChain(proto);
    }

    // 兜底:从代表性实例补扫 —— 既扫实例自有方法, 又扫其原型链。
    // jsdom 有怪癖:window.location 经 window 访问器暴露, 且 assign/replace/reload 等是 location
    // 实例自有属性(不在 Location.prototype 上), 故构造器枚举与纯原型链 walk 均漏 —— 必须扫实例自有。
    const doc = window.document;
    const seeds = [
      doc, //                      Document/Node 链
      doc.documentElement, //      HTML*Element/HTMLElement/Element 链
      doc.createElement('div'), // HTMLDivElement/... 链
      doc.createTextNode(''), //   Text/CharacterData 链
      window.location, //          单例:assign/replace/reload/toString(实例自有)
      window.history, //           单例
      window.navigator, //         Navigator(方法在原型)
      window.screen,
      window.localStorage,
      window.performance,
      window.crypto,
    ];
    for (const seed of seeds) {
      if (!seed || typeof seed !== 'object') continue;
      sweepOwn(seed); // 实例自有方法(覆盖 location 怪癖)
      try {
        sweepChain(Object.getPrototypeOf(seed));
      } catch {
        /* 个别 seed 不可用则跳过 */
      }
    }
  },
};
