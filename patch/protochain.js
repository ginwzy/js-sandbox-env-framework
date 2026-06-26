/**
 * patch/protochain —— 校正 jsdom webidl 对象的原型链结构泄漏(结构轴;配套的 behavior 轴见 patch/eventtarget)。
 *
 * 根因[实测]:jsdom 核心 DOM 链正确挂 window realm intrinsic,但 Navigator/Screen/Event 等 webidl 对象的
 * prototype 顶端挂在 *Node realm 的* 异源 Object.prototype(label 同名但 !== window.Object.prototype)——
 * 检测器 `getPrototypeOf(Navigator.prototype) === Object.prototype` 为 false,一行即破。Screen /
 * NetworkInformation 还另缺 EventTarget 层(真机 Screen→EventTarget→Object.prototype)。
 *
 * 修法:Object.setPrototypeOf 把顶端重定向到 window intrinsic —— 异源顶端(Navigator/Event)→
 * window.Object.prototype;缺 EventTarget 层(Screen/NetworkInformation)→ window.EventTarget.prototype
 * (其顶端已是 window.Object.prototype,一举解决"缺层"+"异源顶端")。插 EventTarget 层会引入方法调用
 * brand-check,由 patch/eventtarget 配套修(非本修引入的 regression:修前这些方法根本不存在)。
 *
 * after navigator:NetworkInformation(navigator.connection 的原型)在 patch/navigator 经 mask.iface 创建。
 * chrome 的异源顶端不在此处理 —— 它是 patch/chrome 自造的普通对象,在源头用 mask.adopt 重定向更自然。
 * 边界:只校正 probe 探到的这几个;同源怪癖可能波及其他未探的 webidl 接口,待基线扩面发现。
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
