/**
 * patch/trace —— eval/Function 动态代码捕获(仅 --trace 模式装配)。
 *
 * 定位:调试/分析工具。拦截 eval() 和 new Function() / Function(),捕获动态生成代码到
 * realm.trace.dynamicCode[];可选剥离 debugger 语句(反反调试)。
 * 对照 sdenv-extend: handle/evalHandle.js + handle/funcHandle.js。
 *
 * 暴露面:Proxy + mask.fn + reparent + dropOwnToString,保 toString/name/length/prototype 不变。
 */
export default {
  name: 'trace',
  after: ['window'],
  apply({ window, mask, trace }) {
    if (!trace) return;
    if (!trace.dynamicCode) trace.dynamicCode = [];

    const stripDebugger = (src) => {
      if (typeof src !== 'string') return src;
      return src.replace(/\bdebugger\b/g, '');
    };

    // ── eval 拦截 ─────────────────────────────────────────────────────────────

    const OrigEval = window.eval;
    const ProxyEval = new Proxy(OrigEval, {
      apply(target, thisArg, args) {
        const raw = args[0];
        const cleaned = stripDebugger(raw);
        trace.dynamicCode.push({ type: 'eval', code: raw });
        return Reflect.apply(target, thisArg, [cleaned]);
      },
    });
    mask.fn(ProxyEval, 'eval', 1);
    mask.dropOwnToString(Object.setPrototypeOf(ProxyEval, window.Function.prototype));
    window.eval = ProxyEval;

    // ── Function 拦截 ─────────────────────────────────────────────────────────

    const OrigFunction = window.Function;
    const ProxyFunction = new Proxy(OrigFunction, {
      construct(target, args) {
        const cleaned = args.map(stripDebugger);
        trace.dynamicCode.push({ type: 'Function', args: [...args] });
        return Reflect.construct(target, cleaned);
      },
      apply(target, thisArg, args) {
        const cleaned = args.map(stripDebugger);
        trace.dynamicCode.push({ type: 'Function', args: [...args] });
        return Reflect.apply(target, thisArg, cleaned);
      },
    });
    mask.fn(ProxyFunction, 'Function', 1);
    mask.dropOwnToString(Object.setPrototypeOf(ProxyFunction, window.Function.prototype));
    // prototype.constructor 指回 Proxy 版(检测器查 Function.prototype.constructor === Function)
    Object.defineProperty(OrigFunction.prototype, 'constructor', { value: ProxyFunction, writable: true, configurable: true });
    window.Function = ProxyFunction;
  },
};
