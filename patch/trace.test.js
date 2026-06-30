/**
 * patch/trace.test.js —— eval/Function 动态代码捕获 + monitor 自测。
 *   node patch/trace.test.js
 *
 * 三层验证:
 *  1. 动态代码捕获:eval/Function 调用被记录到 trace.dynamicCode
 *  2. debugger 剥离:动态代码中 debugger 语句被移除(反反调试)
 *  3. 暴露面:eval/Function 的 toString/name/length/prototype/constructor 不变
 *  4. 门控:trace=false 时 patch 不装配(eval/Function 保持原样)
 *  5. monitor:watch() 记录 get/set 操作
 */
import { Realm } from '../core/realm.js';
import { Monitor } from '../trace/monitor.js';

let pass = 0; let failed = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

// ── 动态代码捕获(trace=true) ────────────────────────────────────────────────

const CAPTURE_CODE = `(() => {
  const r1 = eval('1 + 2');
  const r2 = eval('3 * 4');
  const fn1 = new Function('a', 'b', 'return a + b');
  const r3 = fn1(10, 20);
  const fn2 = Function('x', 'return x * 2');
  const r4 = fn2(5);
  return { r1, r2, r3, r4 };
})()`;

const realm = await Realm.create({
  profile: { meta: { name: 'trace-test', traits: {} } },
  trace: true,
});
const cr = realm.run(CAPTURE_CODE);
if (!cr.ok) { ok('realm 执行成功', false); console.log(`    ${cr.error}`); process.exit(1); }
const cv = cr.value;

console.log('\n[动态代码捕获]');
ok('eval 执行结果正确', cv.r1 === 3 && cv.r2 === 12);
ok('new Function 执行结果正确', cv.r3 === 30);
ok('Function() 执行结果正确', cv.r4 === 10);

const dc = realm.trace.dynamicCode;
ok('捕获了 4 条动态代码', dc.length === 4);
ok('eval 类型正确', dc[0]?.type === 'eval' && dc[1]?.type === 'eval');
ok('eval 代码内容正确', dc[0]?.code === '1 + 2' && dc[1]?.code === '3 * 4');
ok('Function 类型正确', dc[2]?.type === 'Function' && dc[3]?.type === 'Function');
ok('Function args 正确', dc[2]?.args?.[0] === 'a' && dc[2]?.args?.[1] === 'b' && dc[2]?.args?.[2] === 'return a + b');

// ── debugger 剥离 ──────────────────────────────────────────────────────────

const DEBUG_CODE = `(() => {
  const r = eval('debugger; 42');
  const fn = new Function('debugger; return 99');
  return { r, fnResult: fn() };
})()`;

const dr = realm.run(DEBUG_CODE);
ok('debugger 剥离后 eval 正常执行', dr.ok && dr.value.r === 42);
ok('debugger 剥离后 Function 正常执行', dr.ok && dr.value.fnResult === 99);

// ── 暴露面(反检测不变量) ────────────────────────────────────────────────────

const SURFACE_CODE = `(() => ({
  eval_toString: eval.toString(),
  eval_name: eval.name,
  eval_length: eval.length,
  eval_fpt: Function.prototype.toString.call(eval),
  fn_toString: Function.toString(),
  fn_name: Function.name,
  fn_length: Function.length,
  fn_fpt: Function.prototype.toString.call(Function),
  fn_proto_ctor: Function.prototype.constructor === Function,
  fn_ownNames: Object.getOwnPropertyNames(Function).sort().join(','),
  eval_hasOwnToString: Object.prototype.hasOwnProperty.call(eval, 'toString'),
  fn_hasOwnToString: Object.prototype.hasOwnProperty.call(Function, 'toString'),
}))()`;

const sr = realm.run(SURFACE_CODE);
if (!sr.ok) { ok('surface realm 执行成功', false); console.log(`    ${sr.error}`); process.exit(1); }
const s = sr.value;

console.log('\n[暴露面]');
ok('eval.toString() 为 native', s.eval_toString === 'function eval() { [native code] }');
ok('eval.name === "eval"', s.eval_name === 'eval');
ok('eval.length === 1', s.eval_length === 1);
ok('FPT.call(eval) 为 native', s.eval_fpt === 'function eval() { [native code] }');
ok('Function.toString() 为 native', s.fn_toString === 'function Function() { [native code] }');
ok('Function.name === "Function"', s.fn_name === 'Function');
ok('Function.length === 1', s.fn_length === 1);
ok('FPT.call(Function) 为 native', s.fn_fpt === 'function Function() { [native code] }');
ok('Function.prototype.constructor === Function', s.fn_proto_ctor);
ok('eval 无 own toString', !s.eval_hasOwnToString);
ok('Function 无 own toString', !s.fn_hasOwnToString);

realm.dispose();

// ── 门控:trace=false 时不装配 ───────────────────────────────────────────────

const noTraceRealm = await Realm.create({
  profile: { meta: { name: 'no-trace', traits: {} } },
  trace: false,
});
const ntCode = `(() => ({
  eval_str: eval.toString(),
  fn_str: Function.toString(),
  eval_result: eval('100'),
}))()`;
const nr = noTraceRealm.run(ntCode);

console.log('\n[门控]');
ok('trace=false 时 eval 仍可用', nr.ok && nr.value.eval_result === 100);
ok('trace=false 时无 dynamicCode', !noTraceRealm.trace);
noTraceRealm.dispose();

// ── Monitor ─────────────────────────────────────────────────────────────────

console.log('\n[Monitor]');
const m = new Monitor();

const target = { a: 1, b: 2, nested: { x: 10 } };
const watched = m.watch(target, 'testObj', { log: false });

// get
const v1 = watched.a;
const v2 = watched.b;
ok('Monitor get 计数', m.stats.get === 2);
ok('Monitor get 值透传', v1 === 1 && v2 === 2);

// set
watched.c = 3;
ok('Monitor set 计数', m.stats.set === 1);
ok('Monitor set 值落地', target.c === 3);

// log 记录
ok('Monitor 日志记录', m.log.length === 3);
ok('Monitor 日志 op 正确', m.log[0].op === 'get' && m.log[2].op === 'set');
ok('Monitor 日志 key 正确', m.log[0].key === 'a' && m.log[2].key === 'c');

// report
const report = m.report();
ok('Monitor report 统计', report.get === 2 && report.set === 1 && report.total === 3);

// function monitoring
const fn = (x) => x * 2;
const watchedFn = m.watch(fn, 'double');
const fnResult = watchedFn(21);
ok('Monitor apply 计数', m.stats.apply === 1);
ok('Monitor apply 结果透传', fnResult === 42);

// filter
const gets = m.filter((e) => e.op === 'get');
ok('Monitor filter 正确', gets.length === 2);

console.log(`\ntrace/monitor 自测:${pass} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
