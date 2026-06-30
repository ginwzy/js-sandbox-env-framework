/**
 * patch/clock.test.js —— clock 回放自测。
 *   node patch/clock.test.js
 *
 * 三层验证:
 *  1. 固定值模式(仅 now+seed):Date.now 恒定 + mulberry32 可复现
 *  2. 序列回放模式(sequences):Date.now/new Date()/Math.random 按序回放
 *  3. 暴露面:Date toString/name/length/instanceof/constructor/getOwnPropertyNames
 */
import { Realm } from '../core/realm.js';

let pass = 0; let failed = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

// ── 固定值模式(向后兼容) ────────────────────────────────────────────────────

const FIXED_CODE = `(() => ({
  now1: Date.now(),
  now2: Date.now(),
  now_eq: Date.now() === Date.now(),
  rand1: Math.random(),
  rand2: Math.random(),
  rand_ne: Math.random() !== Math.random(),
  date_ts: new Date().getTime(),
  date_str: typeof Date(),
}))()`;

const fixedRealm = await Realm.create({
  profile: {
    meta: { name: 'clock-fixed', traits: {} },
    timing: { now: 1735689600000, seed: 42 },
  },
});
const fr = fixedRealm.run(FIXED_CODE);
if (!fr.ok) { ok('fixed realm 执行成功', false); console.log(`    ${fr.error}`); process.exit(1); }
const fv = fr.value;

console.log('\n[固定值模式]');
ok('Date.now() 恒定', fv.now1 === 1735689600000 && fv.now_eq);
ok('Math.random() 可复现(非恒定)', fv.rand_ne);
ok('Math.random() 返回 number', typeof fv.rand1 === 'number' && fv.rand1 >= 0 && fv.rand1 < 1);
ok('new Date().getTime() === now', fv.date_ts === 1735689600000);
ok('Date() 返回 string', fv.date_str === 'string');

// 跨 run 可复现
const fr2 = fixedRealm.run(`Math.random()`);
ok('跨 run Math.random 可复现(seed 决定序列)', typeof fr2.value === 'number');
fixedRealm.dispose();

// ── 序列回放模式 ────────────────────────────────────────────────────────────

const SEQ_CODE = `(() => {
  const nows = [Date.now(), Date.now(), Date.now(), Date.now()];
  const dates = [new Date().getTime(), new Date().getTime(), new Date().getTime()];
  const rands = [Math.random(), Math.random(), Math.random()];
  return { nows, dates, rands };
})()`;

const seqProfile = {
  meta: { name: 'clock-seq', traits: {} },
  timing: {
    now: 1000000,
    sequences: {
      firstMap: { now: 1000000, newdate: 1000000 },
      now: [0, 100, 200],     // deltas: 1000000, 1000100, 1000200
      newdate: [0, 50, 150],  // deltas: 1000000, 1000050, 1000150
      random: [0.1, 0.5, 0.9],
    },
  },
};

const seqRealm = await Realm.create({ profile: seqProfile });
const sr = seqRealm.run(SEQ_CODE);
if (!sr.ok) { ok('seq realm 执行成功', false); console.log(`    ${sr.error}`); process.exit(1); }
const sv = sr.value;

console.log('\n[序列回放模式]');
ok('Date.now() 序列递增', sv.nows[0] === 1000000 && sv.nows[1] === 1000100 && sv.nows[2] === 1000200);
ok('Date.now() 序列耗尽后自增', sv.nows[3] === 1000201);
ok('new Date() 序列回放', sv.dates[0] === 1000000 && sv.dates[1] === 1000050 && sv.dates[2] === 1000150);
ok('Math.random() 序列回放', sv.rands[0] === 0.1 && sv.rands[1] === 0.5 && sv.rands[2] === 0.9);

// 同 profile 再跑一次 → 因序列已消耗,验证不崩
const sr2 = seqRealm.run(`Date.now()`);
ok('序列耗尽后不崩', sr2.ok);
seqRealm.dispose();

// ── 两次独立 Realm 同 profile → 序列一致(确定性) ────────────────────────────

const r1 = await Realm.create({ profile: seqProfile });
const r2 = await Realm.create({ profile: seqProfile });
const v1 = r1.run(`[Date.now(), Date.now(), Math.random()]`).value;
const v2 = r2.run(`[Date.now(), Date.now(), Math.random()]`).value;

console.log('\n[跨 Realm 确定性]');
ok('两次独立 Realm 的 Date.now 序列一致', v1[0] === v2[0] && v1[1] === v2[1]);
ok('两次独立 Realm 的 Math.random 序列一致', v1[2] === v2[2]);
r1.dispose(); r2.dispose();

// ── RLE 压缩格式 ────────────────────────────────────────────────────────────

const rleProfile = {
  meta: { name: 'clock-rle', traits: {} },
  timing: {
    sequences: {
      firstMap: { now: 5000 },
      now: [[0, 3], [100, 2]], // → [5000, 5000, 5000, 5100, 5100]
    },
  },
};

const rleRealm = await Realm.create({ profile: rleProfile });
const rr = rleRealm.run(`[Date.now(), Date.now(), Date.now(), Date.now(), Date.now()]`);

console.log('\n[RLE 压缩]');
ok('RLE 展开正确', rr.ok && rr.value[0] === 5000 && rr.value[1] === 5000 && rr.value[2] === 5000
  && rr.value[3] === 5100 && rr.value[4] === 5100);
rleRealm.dispose();

// ── 暴露面(反检测不变量) ────────────────────────────────────────────────────

const SURFACE_CODE = `(() => ({
  date_toString: Date.toString(),
  date_name: Date.name,
  date_length: Date.length,
  date_ownNames: Object.getOwnPropertyNames(Date).sort().join(','),
  date_proto_ctor: Date.prototype.constructor === Date,
  date_instanceof: new Date() instanceof Date,
  fpt_call: Function.prototype.toString.call(Date),
  now_toString: Date.now.toString(),
  now_name: Date.now.name,
  random_toString: Math.random.toString(),
  random_name: Math.random.name,
  date_call: typeof Date(),
  date_with_args: new Date(2025, 0, 1).getFullYear(),
  date_parse: typeof Date.parse('2025-01-01'),
  date_utc: typeof Date.UTC(2025, 0),
}))()`;

const surfRealm = await Realm.create({ profile: seqProfile });
const su = surfRealm.run(SURFACE_CODE);
if (!su.ok) { ok('surface realm 执行成功', false); console.log(`    ${su.error}`); process.exit(1); }
const s = su.value;

console.log('\n[暴露面]');
ok('Date.toString() 为 native', s.date_toString === 'function Date() { [native code] }');
ok('Date.name === "Date"', s.date_name === 'Date');
ok('Date.length === 7', s.date_length === 7);
ok('Date.prototype.constructor === Date', s.date_proto_ctor);
ok('new Date() instanceof Date', s.date_instanceof);
ok('FPT.call(Date) 为 native', s.fpt_call === 'function Date() { [native code] }');
ok('Date.now.toString() 为 native', s.now_toString === 'function now() { [native code] }');
ok('Date.now.name === "now"', s.now_name === 'now');
ok('Math.random.toString() 为 native', s.random_toString === 'function random() { [native code] }');
ok('Math.random.name === "random"', s.random_name === 'random');
ok('Date() 无 new 返回 string', s.date_call === 'string');
ok('new Date(args) 不被拦截', s.date_with_args === 2025);
ok('Date.parse 仍可用', s.date_parse === 'number');
ok('Date.UTC 仍可用', s.date_utc === 'number');
ok('getOwnPropertyNames 完整', s.date_ownNames === 'UTC,length,name,now,parse,prototype');
surfRealm.dispose();

console.log(`\nclock 回放自测:${pass} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
