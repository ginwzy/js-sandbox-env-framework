/**
 * patch/touch —— 触摸轴:每个设备都有取舍,故无 applies(始终生效),内部按 formFactor 分支。
 *   移动端(触屏):置 window.orientation(移动端特有,已废弃但仍存在);ontouch* 事件处理器真机存在,
 *     保留 jsdom 原状(L2 基线 android-webview Document/HTMLElement.prototype 确含 ontouch*)。
 *   桌面(无触屏):删 jsdom 在 Document/HTMLElement.prototype 误带的 ontouch*(GlobalEventHandlers 触摸
 *     IDL 属性)—— 桌面真机无触屏即无这些键(L2 基线确证),不删即 8 条 EXTRA tell。
 * TouchEvent / Touch / TouchList 构造器族尚未实现。
 */
const TOUCH_HANDLERS = ['ontouchstart', 'ontouchend', 'ontouchmove', 'ontouchcancel'];

export default {
  name: 'touch',
  apply({ window, traits }) {
    if (traits.formFactor === 'mobile') {
      if (window.orientation === undefined) window.orientation = 0;
      return;
    }
    // 桌面:剥 jsdom 误带的触摸事件处理器(configurable accessor,可删)。
    for (const proto of [window.Document.prototype, window.HTMLElement.prototype]) {
      for (const k of TOUCH_HANDLERS) {
        try { delete proto[k]; } catch { /* non-configurable 则留残留, 由 diff 抓 */ }
      }
    }
  },
};
