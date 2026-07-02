/**
 * entry/pool.test.js —— RealmPool worker 池自测。
 *   node entry/pool.test.js
 *
 * 覆盖:结果正确性 / 错误回传 / 序列化边界(不可克隆值替占位符)/ 并发超池容量 / destroy 后拒绝。
 */
import { RealmPool } from './pool.js';

let pass = 0; let fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}`); } };

console.log('[RealmPool worker 池自测]');
const pool = new RealmPool({ size: 2 });
ok('size 生效', pool.size === 2);

const jobs = [
  { code: '1 + 1', expect: (r) => r.ok && r.value === 2 },
  { code: 'navigator.userAgent', expect: (r) => r.ok && typeof r.value === 'string' && r.value.length > 0 },
  { code: 'document.body.tagName', expect: (r) => r.ok && r.value === 'BODY' },
  { code: '({ a: 1, b: [2, 3] })', expect: (r) => r.ok && r.value && r.value.a === 1 && Array.isArray(r.value.b) },
  { code: 'throw new Error("boom")', expect: (r) => !r.ok && /boom/.test(r.error) },
  { code: 'window', expect: (r) => r.ok && typeof r.value === 'string' && r.value.includes('unserializable') },
];
const results = await Promise.all(jobs.map((j) => pool.run({ profile: 'android-webview-v138', code: j.code })));
jobs.forEach((j, i) => ok(`job[${i}] ${j.code.slice(0, 24)}`, j.expect(results[i])));
ok('每个结果带 missing 数组', results.every((r) => Array.isArray(r.missing)));

// 并发 8 > 池容量 2:全部 resolve、结果各对(验证队列 + round-robin)。
const many = await Promise.all(Array.from({ length: 8 }, (_, i) => pool.run({ profile: 'android-webview-v138', code: `${i} * 2` })));
ok('并发 8 > 池 2 全 resolve 且各对', many.every((r, i) => r.ok && r.value === i * 2));

await pool.destroy();
let rejected = false;
try { await pool.run({ profile: 'android-webview-v138', code: '1' }); } catch { rejected = true; }
ok('destroy 后 run 拒绝', rejected);

console.log(`\nRealmPool 自测:${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
