/**
 * patch/chrome —— 注入 window.chrome 对象(完整 Chrome 特有,WebView 无)。
 * 门控:仅 host=chrome 生效;WebView(host=webview)自动跳过 → window.chrome 不存在。
 * 对照 sdenv: browser/chrome/chrome.js
 * TODO: 补全 chrome.runtime / chrome.loadTimes / chrome.csi。
 */
export default {
  name: 'chrome',
  applies: (t) => t.host === 'chrome',
  apply({ window, mask }) {
    // adopt:顶端从 Node 异源 Object.prototype 重定向到 window.Object.prototype
    // (否则检测器 getPrototypeOf(chrome) === Object.prototype 为 false,一行即破,yvq.14)。
    const chrome = mask.adopt({ runtime: {} });
    mask.tag(chrome.runtime, 'Object');
    window.chrome = chrome;
  },
};
