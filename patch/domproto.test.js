/**
 * patch/domproto.test.js —— crasher 反射访问器默认值自测。
 *   node patch/domproto.test.js
 *
 * 守住 reflectAccessor 分流后的两面契约:
 *   ① crasher 子集(adoptedStyleSheets/innerText/outerText/part)默认值为正确类型,页面 init 阶段的正常使用
 *      (for...of / 展开 / .trim() / .length / .add() / .contains())**不抛** —— null 默认下这些操作会抛、
 *      中断 sensor 前的执行。本测打的就是这些字面崩溃操作,而非仅 typeof。
 *   ② 回归:on* 处理器仍走 eventHandler(默认 null、可写);crasher 属性形态未变(get 'get X'/0、set 'set X'/1、
 *      get native),故 L1 形态零变化(diff-gate 不受影响,由 diff-gate.test.js 另守)。
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
  const el = document.createElement('div');
  const itGet = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText').get;
  const itSet = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText').set;
  return {
    // adoptedStyleSheets (Document) —— null 上 for...of/展开抛
    ass_type: typeof document.adoptedStyleSheets,
    ass_isArray: Array.isArray(document.adoptedStyleSheets),
    ass_iter: noThrow(function(){ for (const s of document.adoptedStyleSheets) {} }),
    ass_spread: noThrow(function(){ return [...document.adoptedStyleSheets]; }),
    ass_assign: noThrow(function(){ document.adoptedStyleSheets = []; }),

    // part (Element) —— null 上 .add()/.contains()/for...of 抛
    part_type: typeof el.part,
    part_add: noThrow(function(){ el.part.add('x'); }),
    part_contains: noThrow(function(){ return el.part.contains('x'); }),
    part_iter: noThrow(function(){ for (const p of el.part) {} }),
    part_spread: noThrow(function(){ return [...el.part]; }),
    part_value_str: typeof el.part.value === 'string',
    part_assign: noThrow(function(){ el.part = ''; }),

    // innerText / outerText (HTMLElement) —— null 上 .trim()/.length 抛
    it_type: typeof el.innerText,
    it_trim: noThrow(function(){ return el.innerText.trim(); }),
    it_len: noThrow(function(){ return el.innerText.length; }),
    it_assign: noThrow(function(){ el.innerText = 'x'; }),
    ot_type: typeof el.outerText,
    ot_trim: noThrow(function(){ return el.outerText.trim(); }),
    // 默认取 this.textContent(getDefault 以 this=实例 调用;getter 经 get-syntax 既绑 this 又无 .prototype)
    it_reflectsTextContent: (function(){ const d = document.createElement('div'); d.textContent = 'hello'; return d.innerText; })(),

    // 回归:on* 仍默认 null 且可写(eventHandler 路径未变)
    onsearch_null: document.onsearch === null,
    onsearch_writable: (function(){ document.onsearch = function f(){}; return typeof document.onsearch === 'function'; })(),

    // 形态:crasher 属性 get/set name+length 仍 'get X'/0、'set X'/1;get 为 native(无源码泄漏)
    it_getName: itGet.name, it_getLen: itGet.length,
    it_setName: itSet.name, it_setLen: itSet.length,
    it_getNative: itGet.toString().includes('[native code]'),
  };
})()`).value;

console.log('[adoptedStyleSheets:数组默认,for...of/展开/赋值不抛]');
ok('typeof 为 object', R.ass_type === 'object');
ok('Array.isArray 成立', R.ass_isArray === true);
ok('for...of 不抛', R.ass_iter === true);
ok('展开不抛', R.ass_spread === true);
ok('赋值不抛', R.ass_assign === true);

console.log('\n[part:DOMTokenList 壳,.add()/.contains()/for...of 不抛]');
ok('typeof 为 object', R.part_type === 'object');
ok('.add() 不抛', R.part_add === true);
ok('.contains() 不抛', R.part_contains === true);
ok('for...of 不抛', R.part_iter === true);
ok('展开不抛', R.part_spread === true);
ok('.value 为 string', R.part_value_str === true);
ok('赋值不抛', R.part_assign === true);

console.log('\n[innerText/outerText:string 默认,.trim()/.length 不抛]');
ok('innerText typeof string', R.it_type === 'string');
ok('innerText.trim() 不抛', R.it_trim === true);
ok('innerText.length 不抛', R.it_len === true);
ok('innerText 赋值不抛', R.it_assign === true);
ok('outerText typeof string', R.ot_type === 'string');
ok('outerText.trim() 不抛', R.ot_trim === true);
ok('innerText 默认反映 this.textContent', R.it_reflectsTextContent === 'hello');

console.log('\n[回归:on* 仍默认 null 且可写]');
ok('document.onsearch === null', R.onsearch_null === true);
ok('document.onsearch 可写', R.onsearch_writable === true);

console.log('\n[形态:get/set name+length 不变 + get native]');
ok("get name 为 'get innerText'", R.it_getName === 'get innerText');
ok('get length 为 0', R.it_getLen === 0);
ok("set name 为 'set innerText'", R.it_setName === 'set innerText');
ok('set length 为 1', R.it_setLen === 1);
ok('get 为 native', R.it_getNative === true);

r.dispose();

console.log(`\ndomproto crasher 反射访问器自测:${pass} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
