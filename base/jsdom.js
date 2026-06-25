/**
 * 基座层 —— 唯一允许直接接触 jsdom 的文件。
 * 未来若要更换 DOM 引擎(如换成 sdenv-jsdom),只改这一处。
 */
import { JSDOM, VirtualConsole } from 'jsdom';

/**
 * 创建一个干净的浏览器 window(尚未做任何 Chrome 化 / 反检测改造)。
 * @param {object} [opts]
 * @param {string} [opts.url]   document 的初始地址
 * @param {string} [opts.html]  初始 HTML
 * @param {boolean} [opts.debug] 调试期把 jsdom 异步错误转发到宿主 stderr(默认静音)
 * @param {(e:any)=>void} [opts.onError] jsdom 异步错误回调(供上层喂 trace/detector 反推缺失 API)
 * @returns {{ window: Window, context: object, errors: any[] }} jsdom 的 window、内部 vm context、异步错误收集数组
 *   context 供执行层用 vm.runInContext(code, context, { filename }) 运行目标脚本 ——
 *   相比 window.eval,可经 filename 把 error.stack 的帧来源对齐为页面 URL,消除 "eval at run (file://...)" 泄漏(见 patch/stack)。
 */
export function createWindow({ url = 'https://example.com/', html = '<!DOCTYPE html><html><head></head><body></body></html>', debug = false, onError } = {}) {
  // jsdom 把**定时器回调 / 事件回调里的未捕获异常**路由到 virtualConsole 的 jsdomError 事件;裸 VirtualConsole
  // 无监听 → 静默吞掉。对专门跑异步采集+POST 的敌对脚本(Akamai BMS 等),其错误几乎全在 load/setTimeout 里,
  // 一旦撞缺失 API 抛错,现象是"无 payload 也无报错"——最难定位的盲态。故装监听:
  //   · errors 数组:始终收集(供 Realm/harness 内省,静音不污染输出);
  //   · debug:转发宿主 stderr(调试期可见);
  //   · onError:回调上层(如喂 trace/detector 把异步错误也计入 missing)。
  // 三者皆宿主侧,与页面隔离 —— 不触碰页面可见的 error/onerror 行为(避免引入新 tell)。
  const virtualConsole = new VirtualConsole();
  const errors = [];
  virtualConsole.on('jsdomError', (e) => {
    errors.push(e);
    if (debug) console.error('[jsdomError]', (e && (e.detail?.message || e.message)) || String(e));
    if (onError) { try { onError(e); } catch { /* 宿主回调异常不得反噬 realm */ } }
  });
  const dom = new JSDOM(html, {
    url,
    // outside-only: 不自动执行页面内 <script>(避免不可控副作用),但允许 getInternalVMContext()
    // 取得 window 的 vm context,供执行层 vm.runInContext 运行目标脚本。
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole,
  });
  // getInternalVMContext 返回 window 所在的 vm context(与 window 同一全局),要求 runScripts !== undefined。
  return { window: dom.window, context: dom.getInternalVMContext(), errors };
}
