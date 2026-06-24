#!/usr/bin/env node
/**
 * 命令入口:
 *   mimic run     <script> [--profile name] [--trace]
 *   mimic check   <script> [--profile name]
 *   mimic capture [--port 8970]        起统一采集服务,一次访问同源落 profile + 结构基线
 *   mimic diff    [profile] [--baseline name] [--t1] [--verbose] [--json]   结构面 mimic-vs-真机 diff
 *   mimic baseline [--port 8970]       [弃用别名] 等同 capture,统一服务已同时产结构基线
 *   mimic serve   [--port 3000]
 *   mimic profiles
 */
import fs from 'node:fs';
import { Realm } from '../core/realm.js';
import { Profile } from '../core/profile.js';

function parseFlags(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) flags[key] = next, i++;
      else flags[key] = true;
    } else rest.push(a);
  }
  return { flags, rest };
}

/** 安全序列化 —— eval 结果可能是活的 window/DOM 节点/循环引用,JSON.stringify 会抛。 */
function safeJSON(out) {
  try {
    return JSON.stringify(out, null, 2);
  } catch {
    const desc = Object.prototype.toString.call(out.value);
    return JSON.stringify({ ok: out.ok, value: `[unserializable: ${desc}]`, missing: out.missing }, null, 2);
  }
}

async function cmdRun([script], flags) {
  if (!script) return fail('用法: sdenv run <script> [--profile name] [--trace]');
  const code = fs.readFileSync(script, 'utf-8');
  const realm = await Realm.create({ profile: flags.profile, trace: !!flags.trace });
  const out = realm.run(code);
  realm.dispose();
  console.log(safeJSON(out));
  process.exit(out.ok ? 0 : 1);
}

async function cmdCheck([script], flags) {
  if (!script) return fail('用法: sdenv check <script> [--profile name]');
  const code = fs.readFileSync(script, 'utf-8');
  const realm = await Realm.create({ profile: flags.profile, trace: true });
  try {
    const out = realm.run(code);
    console.log('缺失 API:', out.missing);
    console.log('建议 patch:', realm.trace.suggest());
  } finally {
    realm.dispose();
  }
}

async function cmdProfiles() {
  const names = await Profile.list();
  console.log(names.length ? names.join('\n') : '(profiles/ 为空)');
}

async function cmdServe(_rest, flags) {
  const { startServer } = await import('./server.js');
  startServer({ port: Number(flags.port) || 3000 });
}

async function cmdCapture(_rest, flags) {
  const { startCapture } = await import('../capture/server.js');
  startCapture({ port: Number(flags.port) || 8970 });
}

async function cmdDiff([profile], flags) {
  const { runDiff, formatReport, listBaselines } = await import('../harness/index.js');
  try {
    const report = await runDiff({
      profile: profile || flags.profile,
      baseline: typeof flags.baseline === 'string' ? flags.baseline : undefined,
      t1Only: !!flags.t1,
    });
    if (flags.json) console.log(JSON.stringify({ summary: report.summary, entries: report.entries }, null, 2));
    else console.log(formatReport(report, { verbose: !!flags.verbose }));
    process.exit(report.summary.gatePass ? 0 : 1);
  } catch (e) {
    console.error(`diff 失败: ${e.message}`);
    const names = listBaselines();
    if (names.length) console.error(`可用基线: ${names.join(', ')}`);
    process.exit(2);
  }
}

// 弃用别名:结构基线采集已并入统一 capture 服务(一次访问同源产 profile + baseline)。保留命令名不破
// `npm run baseline` 与肌肉记忆,转调 startCapture。旧默认端口 8971 → 统一 8970。
async function cmdBaseline(_rest, flags) {
  console.error('[弃用] `mimic baseline` 已并入 `mimic capture`(统一服务一次访问同源产 profile + 结构基线)。转启 capture。');
  const { startCapture } = await import('../capture/server.js');
  startCapture({ port: Number(flags.port) || 8970 });
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const [, , cmd, ...argv] = process.argv;
const { flags, rest } = parseFlags(argv);
const table = { run: cmdRun, check: cmdCheck, profiles: cmdProfiles, serve: cmdServe, capture: cmdCapture, diff: cmdDiff, baseline: cmdBaseline };
// 统一兜底:同步抛(readFileSync ENOENT)与 async 抛(Realm.create)都落到 fail(),不再裸堆栈崩溃。
Promise.resolve()
  .then(() => (table[cmd] || (() => fail('命令: run | check | capture | diff | baseline | serve | profiles')))(rest, flags))
  .catch((e) => fail(`执行失败: ${e.message}`));
