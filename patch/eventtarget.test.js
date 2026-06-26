/**
 * patch/eventtarget.test.js —— 伪 EventTarget brand-check short-circuit 自测。
 *   node patch/eventtarget.test.js
 *
 * 守住 brandless 判定从"预枚举实例 WeakSet"改为"按 proto 登记(mask.eventTargetProto/isBrandlessEventTarget)"
 * 后的两面契约:
 *   ① 凡 mask 把 proto 接到 EventTarget.prototype 的伪 EventTarget(无 jsdom slot)—— 含**页面运行期才 new**
 *      的壳(Worker/RTCPeerConnection/MediaQueryList/visualViewport)—— add/removeEventListener 不抛、
 *      dispatchEvent 返 true、instanceof EventTarget 成立。旧实例集做不到懒构造壳,正是本次修复点。
 *   ② 真 EventTarget(document/element)走 orig 不受影响:listener 照常注册并 fire。
 */
import { Realm } from '../core/realm.js';

let pass = 0; let failed = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

const r = await Realm.create({ profile: 'chrome-mac' });
const R = r.run(`(function(){
  const noThrow = (fn) => { try { fn(); return true; } catch (e) { return false; } };
  return {
    // 懒构造壳(本次修复:proto-based 覆盖运行期 new 的实例)
    worker: noThrow(function(){ new Worker('x').addEventListener('message', function(){}); }),
    rtc: noThrow(function(){ new RTCPeerConnection().addEventListener('track', function(){}); }),
    mql: noThrow(function(){ matchMedia('(pointer: coarse)').addEventListener('change', function(){}); }),
    vv: noThrow(function(){ visualViewport.addEventListener('resize', function(){}); }),
    // 单例伪 EventTarget(回归)
    screen: noThrow(function(){ screen.addEventListener('change', function(){}); }),
    conn: navigator.connection ? noThrow(function(){ navigator.connection.addEventListener('change', function(){}); }) : true,
    orient: noThrow(function(){ screen.orientation.addEventListener('change', function(){}); }),
    // remove / dispatch
    remove: noThrow(function(){ matchMedia('(pointer: coarse)').removeEventListener('change', function(){}); }),
    dispatch: (function(){ try { return new Worker('x').dispatchEvent(new Event('x')) === true; } catch (e) { return false; } })(),
    // instanceof 对齐
    mqlIsET: matchMedia('(pointer: coarse)') instanceof EventTarget,
    workerIsET: (new Worker('x')) instanceof EventTarget,
    // 真 EventTarget 路径完好(orig 未被破坏:listener 真的 fire)
    realDoc: (function(){ let f = false; document.addEventListener('ping', function(){ f = true; }); document.dispatchEvent(new Event('ping')); return f; })(),
    realEl: (function(){ const d = document.createElement('div'); let n = 0; d.addEventListener('tap', function(){ n++; }); d.dispatchEvent(new Event('tap')); return n === 1; })(),
  };
})()`).value;

console.log('[懒构造伪 EventTarget:addEventListener 不抛 brand-check]');
ok('new Worker().addEventListener 不抛', R.worker === true);
ok('new RTCPeerConnection().addEventListener 不抛', R.rtc === true);
ok('matchMedia().addEventListener 不抛(MediaQueryList)', R.mql === true);
ok('visualViewport.addEventListener 不抛', R.vv === true);

console.log('\n[单例伪 EventTarget(回归)]');
ok('screen.addEventListener 不抛', R.screen === true);
ok('navigator.connection.addEventListener 不抛', R.conn === true);
ok('screen.orientation.addEventListener 不抛', R.orient === true);

console.log('\n[remove / dispatch / instanceof]');
ok('removeEventListener 不抛', R.remove === true);
ok('brandless dispatchEvent 返 true', R.dispatch === true);
ok('MediaQueryList instanceof EventTarget', R.mqlIsET === true);
ok('Worker 实例 instanceof EventTarget', R.workerIsET === true);

console.log('\n[真 EventTarget 路径完好(orig 未破坏)]');
ok('document listener 注册并 fire', R.realDoc === true);
ok('element listener 注册并 fire', R.realEl === true);

r.dispose();

console.log(`\n伪 EventTarget brand-check 自测:${pass} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
