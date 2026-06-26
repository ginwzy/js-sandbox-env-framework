/**
 * patch/ctoriface.test.js —— mask.ctorIface(可构造接口壳)跨 patch 不变量自测。
 *   node patch/ctoriface.test.js
 *
 * 守住把 audio/canvas/globals/performance 四处自造壳收敛进 mask.ctorIface 后的两条契约,二者此前靠各 patch
 * 自觉、易漂移(performance 曾用短文案、globals/performance 未走 markCtorProto):
 *   ① constructor 在接口原型 own 字符串键**末位**(对齐真机 WebIDL;首位即穿)——不再依赖"装方法 vs 装
 *      constructor 的书写顺序",由 ctorIface 经 markCtorProto/finalizeIfaces 保障。
 *   ② 无-new 调用抛 window-realm TypeError,message 统一为真机[实测]完整句(短句逐字比对即偏离)。
 */
import { Realm } from '../core/realm.js';

let pass = 0; let failed = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

const SHELLS = ['OfflineAudioContext', 'AudioContext', 'AudioBuffer', 'Path2D',
  'Worker', 'RTCPeerConnection', 'Notification', 'PerformanceObserver'];
const TAIL = "Please use the 'new' operator, this DOM object constructor cannot be called as a function.";

const r = await Realm.create({ profile: 'chrome-mac' });
const R = JSON.parse(r.run(`(function(){
  const names = ${JSON.stringify(SHELLS)};
  const out = {};
  for (const n of names) {
    const C = window[n];
    const own = (C && C.prototype) ? Object.getOwnPropertyNames(C.prototype) : [];
    let msg = null; let isTE = false;
    try { C(); } catch (e) { msg = e.message; isTE = e instanceof TypeError; }
    out[n] = { isFn: typeof C === 'function', ctorLast: own[own.length - 1] === 'constructor', isTE: isTE, msg: msg };
  }
  // new 可用性(带各自必需参数)+ PerformanceObserver 参数校验
  const path2dNew = (function(){ try { return (new Path2D()) instanceof Path2D; } catch (e) { return false; } })();
  const poNew = (function(){ try { return (new PerformanceObserver(function(){})) instanceof PerformanceObserver; } catch (e) { return false; } })();
  const poBadArg = (function(){ try { new PerformanceObserver(123); return false; } catch (e) { return e instanceof TypeError && /PerformanceObserverCallback/.test(e.message); } })();
  return JSON.stringify({ out: out, path2dNew: path2dNew, poNew: poNew, poBadArg: poBadArg });
})()`).value);

console.log('[mask.ctorIface 跨 patch 不变量]');
for (const n of SHELLS) {
  const s = R.out[n];
  ok(`${n}:window 全局已注册`, s.isFn === true);
  ok(`${n}:constructor 在 own 键末位`, s.ctorLast === true);
  ok(`${n}:无-new 抛 TypeError`, s.isTE === true);
  ok(`${n}:无-new 文案为真机完整句`, s.msg === `Failed to construct '${n}': ${TAIL}`);
}

console.log('\n[new 可用性 + 参数校验]');
ok('new Path2D() instanceof Path2D', R.path2dNew === true);
ok('new PerformanceObserver(fn) instanceof PerformanceObserver', R.poNew === true);
ok('new PerformanceObserver(非函数) 抛 PerformanceObserverCallback TypeError', R.poBadArg === true);

r.dispose();

console.log(`\nmask.ctorIface 跨 patch 不变量自测:${pass} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
