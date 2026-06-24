/**
 * patch/protochain —— 校正 jsdom webidl 对象的原型链结构泄漏。
 *
 * 根因[实测]:jsdom 核心 DOM 链(Element→Node→EventTarget→Object.prototype)正确挂 window realm 的
 * intrinsic,但 Navigator/Screen/Event 等 webidl 对象的 prototype 顶端挂在 *Node realm 的* 异源
 * Object.prototype(label 同为 'Object.prototype' 但 !== window.Object.prototype)——
 * 检测器 getPrototypeOf(Navigator.prototype) === Object.prototype 为 false,一行即破。
 * Screen / NetworkInformation 还另缺 EventTarget 层(真机 Screen→EventTarget→Object.prototype)。
 *
 * 修法:Object.setPrototypeOf 把顶端重定向到 window 的 intrinsic ——
 *  - 顶端异源 Object.prototype(Navigator / Event)→ window.Object.prototype。
 *  - 缺 EventTarget 层(Screen / NetworkInformation)→ window.EventTarget.prototype
 *    (其顶端已是 window.Object.prototype,一举解决"缺层"+"异源顶端")。
 *
 * 定位:仅结构层(probe 检测 getPrototypeOf 链 / instanceof)。插 EventTarget 层后 screen/connection
 * 结构上 instanceof EventTarget=true,但其 addEventListener/removeEventListener/dispatchEvent 调用会抛
 * jsdom brand-check(实例无 EventTarget 内部 slot)—— 属 behavior 轴,另立 issue(no-op hook 修)。
 * 修复前这些方法根本不存在(调用抛 'not a function'),故非本修引入的 regression。
 *
 * after navigator:NetworkInformation(navigator.connection 的原型)在 patch/navigator 经 mask.iface 创建。
 * chrome 的异源顶端不在此处理 —— 它是 patch/chrome 自造的普通对象,在源头用 mask.adopt 重定向更自然。
 * 边界:只校正 probe 探到的这几个;同源怪癖可能波及其他未探的 webidl 接口(jsdom 构造特性),待基线扩面发现。
 */
export default {
  name: 'protochain',
  after: ['navigator'],
  apply({ window }) {
    const OP = window.Object.prototype;
    const ETP = window.EventTarget.prototype;

    // ① 顶端异源 Object.prototype → window.Object.prototype(检测器 getPrototypeOf===Object.prototype 才成立)
    Object.setPrototypeOf(window.Navigator.prototype, OP);
    Object.setPrototypeOf(window.Event.prototype, OP);

    // ② 缺 EventTarget 层 → 插入(真机 Screen / NetworkInformation 继承 EventTarget;ETP 顶端已是 window.Object.prototype)
    Object.setPrototypeOf(window.Screen.prototype, ETP);
    const conn = window.navigator.connection;
    if (conn) Object.setPrototypeOf(Object.getPrototypeOf(conn), ETP); // NetworkInformation.prototype
  },
};
