/**
 * patch/chrome —— 注入 window.chrome 对象(完整 Chrome 特有,WebView 无)。
 * 门控:仅 host=chrome 生效;WebView(host=webview)自动跳过 → window.chrome 不存在。
 * 对照 sdenv: browser/chrome/chrome.js
 * 现状:仅建空壳 window.chrome(正确身份/原型)。loadTimes/csi/app 尚未补全(标准扩展键补全是另一项)。
 * 刻意不注入 runtime:真机无扩展页面时 window.chrome 无 runtime 键(L2 基线 window.chrome own keys=loadTimes,csi,app),
 * 注入 {runtime:{}} 即过度注入 —— 真 Chrome 没有的键,检测器 'runtime' in chrome 一测即破。
 */
export default {
  name: 'chrome',
  applies: (t) => t.host === 'chrome',
  apply({ window, mask }) {
    // adopt:顶端从 Node 异源 Object.prototype 重定向到 window.Object.prototype
    // (否则检测器 getPrototypeOf(chrome) === Object.prototype 为 false,一行即破)。
    window.chrome = mask.adopt({});
  },
};
