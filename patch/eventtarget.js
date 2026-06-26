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
 * 边界:仅收录 screen / connection(本 issue 探到的)。其它 iface 造的伪 EventTarget(MediaQueryList /
 * visualViewport / 各 navigator 单例,parent=EventTarget.prototype 但无 slot)有同类潜在抛错,待其被
 * addEventListener 路径触达时纳入 brandless。
 */
export default {
  name: 'eventtarget',
  after: ['protochain'],
  apply({ window, mask }) {
    const ETP = window.EventTarget.prototype;

    // brandless:插了 EventTarget 层但无 jsdom EventTarget slot 的实例。WeakSet 按身份判定(robust,免脆弱的
    // 错误信息匹配);screen / connection 均为单例(身份稳定,见 patch/screen、patch/navigator 的 === 不变量)。
    const brandless = new WeakSet();
    const reg = (o) => { if (o && typeof o === 'object') brandless.add(o); };
    reg(window.screen);
    if (window.navigator.connection) reg(window.navigator.connection);
    // screen.orientation(ScreenOrientation 单例)同属插了 EventTarget 层但无 slot 的伪 EventTarget(见 patch/screen)。
    if (window.screen.orientation) reg(window.screen.orientation);

    // impl 用 concise method(`{m(){}}`.m):可用 this 又**无 own .prototype** —— 真机 native 方法无 .prototype,
    // 普通 function 表达式带 non-configurable .prototype 删不掉,会成 fn.hasPrototype/ownNames TELL(mask.hook 不剥它)。
    const shim = (orig, brandlessReturn) => ({ m(...a) { return brandless.has(this) ? brandlessReturn : orig.apply(this, a); } }).m;
    mask.hook(ETP, 'addEventListener', (orig) => shim(orig, undefined));
    mask.hook(ETP, 'removeEventListener', (orig) => shim(orig, undefined));
    mask.hook(ETP, 'dispatchEvent', (orig) => shim(orig, true));
  },
};
