/**
 * harness/diff-gate.test.js —— per-profile 结构 gate(伪装 profile × 其真机基线)。
 *   node harness/diff-gate.test.js
 *
 * 为什么独立于 harness/test.js:后者测 diff 引擎本身(手搓 fixture 验 diff/summarize 逻辑),
 * 从不跑 runDiff 对真实基线 —— 即此前没有任何自动门把某个伪装 profile 对其真机基线做结构比对,
 * 桌面 profile 完全无结构回归守护。本 gate 补这层:逐对跑 runDiff,守 EXTRA===0(mimic 独有键 =
 * 过度注入 / 沙箱构件泄漏,真 Chrome 无 —— 这是最该自动化的结构回归网)。
 *
 * 配对必须显式钉死,不能靠 runDiff 省略 baseline 时的默认:默认基线取 baselines/ 字母序第一,且配对
 * 只做 baseline→profile 单向,会把 desktop profile 套到 mobile 默认基线,产 host 错配的无意义 diff
 * (desktop-only 的 WebHID/Serial/USB/FLEDGE 等被当成 EXTRA)。chrome-mac 是 demo profile,无同名
 * 基线,其真机基线是 macos-chrome-v148(同 host=chrome / formFactor=desktop;版本 131 vs 148 仅差值
 * 不差结构面,故 EXTRA 仍为 0)。
 *
 * EXTRA===0 是当前维护中的硬不变量。结构 TELL(window.print 的 WebView shim 形态 / Document.constructor
 * 的 parseHTML* / Node·Event.prototype own 键序)属已知未尽项,以数量上限守护:新增结构 tell 即破门,
 * 已知项逐步修复后下调上限(修复落地时一并收紧)。
 */
import { runDiff } from './index.js';

let pass = 0; let failed = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

// [伪装 profile, 其真机基线, 已知结构 TELL 数上限]。同名对为采集服务一次落盘的 profile+baseline;
// chrome-mac→macos-chrome-v148、linux-chrome→linux-chrome-v143 是 demo/真采分离的人工配对。
const PAIRS = [
  ['chrome-mac', 'macos-chrome-v148', 5],
  ['macos-chrome-v148', 'macos-chrome-v148', 5],
  ['android-webview-v138', 'android-webview-v138', 5],
  ['linux-chrome', 'linux-chrome-v143', 5],
];

console.log('[per-profile 结构 gate — 伪装 profile × 真机基线]');

for (const [profile, baseline, tellMax] of PAIRS) {
  const { summary } = await runDiff({ profile, baseline });
  const EXTRA = summary.counts.EXTRA || 0;
  const TELL = summary.counts.TELL || 0;
  ok(`${profile} × ${baseline}:EXTRA===0(无过度注入 / mimic 独有键泄漏)`, EXTRA === 0);
  ok(`${profile} × ${baseline}:结构 TELL ${TELL} ≤ ${tellMax}(无新增结构 tell)`, TELL <= tellMax);
}

console.log(`\nper-profile 结构 gate:${pass} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
