/**
 * harness/collection-probe.test.js —— 验 probe 的集合值采集 + 新增盲区 target 在 mimic 侧落地,
 * 且对既有(未重采)基线惰性。
 *   node harness/collection-probe.test.js
 *
 * 为什么独立:这里要真跑 snapshotMimic(过 Realm),不是手搓 fixture 验 diff 逻辑(那在 harness/test.js)。
 * 守两件事:① probe 能采到 plugins/mimeTypes 的 length+项字段、可 new 类构造器壳、单例 tag;
 * ② 新 target-id 加进 probe 不破既有基线 gate(diff 只迭代 baseline.targets → 新 id 惰性,EXTRA/TELL 不变)。
 * 真机基线尚缺这些 target,故 ① 的"对照真相"留 Phase 2(重采后接 per-profile gate);此处只验采集形态自洽。
 */
import { snapshotMimic } from './mimic-snapshot.js';
import { runDiff } from './index.js';

let pass = 0; let failed = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

console.log('[collection 采集 + 盲区 target 落地(mimic 侧)]');

const snap = await snapshotMimic('chrome-mac');
const get = (id) => snap.targets.find((t) => t.id === id);

// —— plugins:host=chrome 固定 5×PDF,length 与项字段直采(值级,非结构)——
const plugins = get('navigator.plugins');
ok('navigator.plugins resolved + 采到 collection', !!plugins && plugins.resolved && !!plugins.collection);
ok('plugins.collection.length === 5(非 headless 空集)', plugins?.collection?.length === 5);
ok('plugins 项采到 name/filename/description', (() => {
  const it = plugins?.collection?.items?.[0];
  return it && it.name === 'PDF Viewer' && it.filename === 'internal-pdf-viewer' && it.description === 'Portable Document Format';
})());

const mimeTypes = get('navigator.mimeTypes');
ok('navigator.mimeTypes.length === 2 + 项 type 采到', mimeTypes?.collection?.length === 2 && mimeTypes?.collection?.items?.[0]?.type === 'application/pdf');

// —— 单例对象:tag 正确(原型链/own 键由结构面采,真机基线后对照)——
ok('navigator.userAgentData 单例 tag', get('navigator.userAgentData')?.tag === '[object NavigatorUAData]');
ok('window.visualViewport 单例 tag', get('window.visualViewport')?.tag === '[object VisualViewport]');
ok('window.indexedDB 单例 tag', get('window.indexedDB')?.tag === '[object IDBFactory]');

// —— 可 new 接口类:构造器壳 native + name/length(对照真机表)——
const ctor = (id, name, len) => {
  const t = get(id);
  ok(`${id} 构造器壳:native + name='${name}' + length=${len}`,
    !!t && t.resolved && t.category === 'function' && t.fn.toStringNative && t.fn.name === name && t.fn.length === len);
};
ctor('window.Worker', 'Worker', 1); // 真机 Worker(scriptURL, options?) 首参必选 → length=1(jsdom 误为 2)
ctor('window.RTCPeerConnection', 'RTCPeerConnection', 0);
ctor('window.Notification', 'Notification', 1);

// —— 惰性不变量:新 target-id 对既有(未含它们的)基线不产生 EXTRA/TELL ——
// diff 只迭代 baseline.targets,新 id 不在其中 → 既有 gate 数完全不变(对照加 target 前 EXTRA=0/TELL=3)。
const { summary } = await runDiff({ profile: 'chrome-mac', baseline: 'macos-chrome-v148' });
ok('新 target 对旧基线惰性:chrome-mac×macos EXTRA===0', (summary.counts.EXTRA || 0) === 0);
ok('新 target 对旧基线惰性:结构 TELL 仍 ≤ 3(无新增)', (summary.counts.TELL || 0) <= 3);

console.log(`\ncollection 采集 + 盲区 target:${pass} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
