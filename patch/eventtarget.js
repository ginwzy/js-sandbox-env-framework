/**
 * patch/eventtarget —— 修伪 EventTarget 接口的方法调用 brand-check(behavior 轴,protochain 结构轴的配套)。
 *
 * 根因[实测]:protochain 把 Screen/NetworkInformation.prototype 接到 window.EventTarget.prototype 后,
 * screen / navigator.connection 结构上 instanceof EventTarget=true,但这些实例由 jsdom 创建时未走 EventTarget
 * 混入,**无内部 EventTarget slot** → 经原型链继承到的 add/removeEventListener/dispatchEvent 一调即抛 jsdom
 * brand-check。真机这些方法存在且可调 → instanceof=true 却方法抛错,是 false-confidence tell。
 *
 * 修法:对这类"插了 EventTarget 层但无 slot"的实例(brandless)在 EventTarget.prototype 三方法上 short-circuit
 * —— add/removeEventListener 返 undefined(检测窗口内 onchange 不 fire,no-op 观察上等同真机),dispatchEvent
 * 返 true(spec 默认:无 listener/未 cancel;返 undefined 会自埋 micro-tell)。真 EventTarget 不在集 → 走 orig。
 * 选 hook EventTarget.prototype 而非在 Screen.prototype 装 own 方法:后者会成 Screen.prototype 的 EXTRA own 键
 * tell(真机 Screen.prototype 无 own addEventListener);hook 保 native 且不动任何对象的 own 键集合。
 *
 * brandless 判定下放 mask(按 proto 登记,见 mask.eventTargetProto / isBrandlessEventTarget):凡 mask 把 proto
 * 接到 EventTarget.prototype(protochain 的 Screen/connection、screen 的 orientation、globals 的 Worker/
 * RTCPeerConnection/Notification/MediaQueryList/visualViewport)均自动入表,无需本 patch 手工逐个登记 ——
 * 故页面运行期才 new 的壳(Worker 等)也被覆盖,这是旧"预枚举实例 WeakSet"做不到的。
 */
export default {
  name: 'eventtarget',
  after: ['protochain'],
  apply({ window, mask }) {
    const ETP = window.EventTarget.prototype;

    // impl 用 concise method(`{m(){}}`.m):可用 this 又**无 own .prototype** —— 真机 native 方法无 .prototype,
    // 普通 function 表达式带 non-configurable .prototype 删不掉,会成 fn.hasPrototype/ownNames TELL(mask.hook 不剥它)。
    const shim = (orig, brandlessReturn) =>
      ({ m(...a) { return mask.isBrandlessEventTarget(this) ? brandlessReturn : orig.apply(this, a); } }).m;
    mask.hook(ETP, 'addEventListener', (orig) => shim(orig, undefined));
    mask.hook(ETP, 'removeEventListener', (orig) => shim(orig, undefined));
    mask.hook(ETP, 'dispatchEvent', (orig) => shim(orig, true));
  },
};
