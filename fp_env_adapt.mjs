/**
 * fp_env(Akamai sensor 采集)→ mimic profile 适配器。
 *
 * fp_env 是扁平 Akamai 形;mimic capture 衍生 profile 是嵌套自包含形(整段来自单次
 * 采集,见 profiles/android-webview-v138.json)。本脚本做 schema 重映射 + 设备去重选代表机,
 * 落 host=chrome 的 android 移动版 Chrome profile。
 *
 * 数据底层完全对得上(已实测):
 *  - collect1.getParameter_info[0] 与 mimic webgl.parameters 同为 GL enum 数字键
 *    (37445/37446=UNMASKED vendor/renderer,patch/webgl.js 直接消费)。
 *  - userAgentData.HighEntropyValues 拍平即 collect.js 的 userAgentData 形。
 *  - Date.TimezoneOffset 为真机采集 offset;Intl.Timezone 为 IANA 名。
 *
 * 缺口(fp_env 未采,各有兜底):
 *  - window.chrome 存在性:不写该键 → host=chrome 走 UA 兜底校验;patch/chrome 自行合成。
 *  - navigator.vendor/cookieEnabled:移动 Chrome 固定值,补默认。
 *  - canvas/audio/fonts:渲染类,标 absent(同 mimic capture 约定);其真值留在 collect1 作校验用。
 *
 * 用法:
 *   node fp_env_adapt.mjs                 # 默认选 top-24 高频机型写入 profiles/
 *   FP_ENV_DIR=/path node fp_env_adapt.mjs --limit 40
 *   node fp_env_adapt.mjs --all           # 全部 393 个唯一 (model×版本) 组合
 *   node fp_env_adapt.mjs --dry           # 只跑映射+validate,不落盘
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Profile } from './core/profile.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const FP_ENV_DIR = process.env.FP_ENV_DIR || argv.find((a) => a.startsWith('/'))
  || '/Users/zion/projects/work/node_akamai/fp_env';
const OUT_DIR = path.join(__dirname, 'profiles');
const ALL = argv.includes('--all');
const DRY = argv.includes('--dry');
const LIMIT = (() => { const i = argv.indexOf('--limit'); return i >= 0 ? Number(argv[i + 1]) : 24; })();

const DEFAULT_VENDOR = 'Google Inc.';

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** 从 IANA 时区名算 getTimezoneOffset 风格分钟数(west 为正),作 Date.TimezoneOffset 缺时兜底。 */
function tzOffsetMinutes(timeZone, ms) {
  try {
    const p = new Intl.DateTimeFormat('en-US', {
      timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(ms));
    const o = {};
    for (const x of p) o[x.type] = x.value;
    const asUTC = Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour, +o.minute, +o.second);
    return -(asUTC - ms) / 60000;
  } catch { return undefined; }
}

/** fp_env 单文件 → mimic profile(扁平自包含,镜像 android-webview-v138.json)。 */
function fpToProfile(d, captureFile) {
  const n = d.navigator || {};
  const hev = (n.userAgentData && n.userAgentData.HighEntropyValues) || {};
  const ua = n.userAgent || '';
  const major = Number((ua.match(/Chrom(?:e|ium)\/(\d+)/) || [])[1]);
  const model = hev.model || '';

  // userAgentData:HighEntropyValues 拍平为 collect.js 形(brands/mobile/platform 在外,高熵并列)。
  const userAgentData = {
    brands: hev.brands,
    mobile: hev.mobile,
    platform: hev.platform,
    architecture: hev.architecture,
    bitness: hev.bitness,
    model: hev.model,
    platformVersion: hev.platformVersion,
    uaFullVersion: hev.uaFullVersion,
    fullVersionList: hev.fullVersionList,
    wow64: hev.wow64,
  };

  const navigator = {
    userAgent: ua,
    appVersion: n.appVersion,
    platform: n.platform,
    vendor: n.vendor || DEFAULT_VENDOR,
    language: n.language,
    languages: Array.isArray(n.languages) ? n.languages : (n.language ? [n.language] : []),
    hardwareConcurrency: n.hardwareConcurrency,
    deviceMemory: n.deviceMemory,
    maxTouchPoints: n.maxTouchPoints,
    cookieEnabled: n.cookieEnabled !== undefined ? n.cookieEnabled : true,
    userAgentData,
  };
  if (n.connection) {
    navigator.connection = {
      effectiveType: n.connection.effectiveType,
      downlink: n.connection.downlink,
      rtt: n.connection.rtt,
      saveData: n.connection.saveData,
    };
  }

  const s = d.screen || {};
  const screen = {
    width: s.width, height: s.height, availWidth: s.availWidth, availHeight: s.availHeight,
    colorDepth: s.colorDepth, pixelDepth: s.pixelDepth,
    orientation: s.orientation ? { type: s.orientation.type, angle: s.orientation.angle } : undefined,
  };

  // window.chrome 故意不写 —— fp_env 未采;host=chrome 由 validate 的 UA 兜底放行,patch/chrome 合成。
  const window = {
    innerWidth: d.innerWidth, innerHeight: d.innerHeight,
    outerWidth: d.outerWidth, outerHeight: d.outerHeight,
    devicePixelRatio: d.devicePixelRatio,
  };

  const timeZone = d['Intl.Timezone'];
  const offset = (d.Date && typeof d.Date.TimezoneOffset === 'number')
    ? d.Date.TimezoneOffset
    : tzOffsetMinutes(timeZone, Date.UTC(2025, 6, 1));
  const timezone = { timeZone, offset };

  // webgl:getParameter_info[0] 即 enum 数字键表(同 mimic webgl.parameters);[1] 是 shader 精度,不并入。
  let webgl;
  const gp = d.collect1 && Array.isArray(d.collect1.getParameter_info) ? d.collect1.getParameter_info[0] : null;
  if (gp) {
    webgl = {
      parameters: { ...gp },
      extensions: (d.collect1 && d.collect1.canvas_webgl2_SupportedExtensions) || [],
      unmaskedVendor: gp['37445'],
      unmaskedRenderer: gp['37446'],
    };
  }

  const name = ['android-chrome', model ? slug(model) : `gpu-${slug(webgl?.unmaskedRenderer || 'unknown')}`, `v${major}`].join('-');
  const meta = {
    source: 'fp_env-akamai',
    captureFile, // 配对的真机采集文件名 —— 供 fp_env_verify.mjs 取 collect1 ground truth
    hygiene: { devicePixelRatio: d.devicePixelRatio, issues: [] },
    fidelity: {
      navigator: 'real', screen: 'real', window: 'real', timezone: 'real',
      webgl: webgl ? 'params' : 'absent',
      canvas: 'absent', audio: 'absent', fonts: 'absent',
    },
    traits: { engine: 'chromium', platform: 'android', formFactor: 'mobile', host: 'chrome', version: major },
    name,
  };

  const profile = { meta, navigator, screen, window, timezone };
  if (webgl) profile.webgl = webgl;
  return profile;
}

async function main() {
  const files = fs.readdirSync(FP_ENV_DIR).filter((f) => /^z__env_.*\.json$/.test(f));
  if (!files.length) { console.error(`无 z__env_*.json:${FP_ENV_DIR}`); process.exit(1); }

  // 去重:按 (model, Chrome major),首见留存 + 计数。
  const byKey = new Map();
  for (const f of files) {
    let d;
    try { d = JSON.parse(fs.readFileSync(path.join(FP_ENV_DIR, f), 'utf-8')); } catch { continue; }
    const n = d.navigator || {};
    const hev = (n.userAgentData && n.userAgentData.HighEntropyValues) || {};
    const major = (n.userAgent || '').match(/Chrom(?:e|ium)\/(\d+)/);
    const key = `${hev.model || '(empty)'}|v${major ? major[1] : '?'}`;
    if (!byKey.has(key)) byKey.set(key, { file: f, data: d, model: hev.model || '', count: 0 });
    byKey.get(key).count++;
  }

  let reps = [...byKey.values()].sort((a, b) => b.count - a.count);
  if (!ALL) reps = reps.filter((r) => r.model).slice(0, LIMIT); // 具名机型,top-N

  console.log(`扫描 ${files.length} 文件 → ${byKey.size} 唯一 (model×版本);生成 ${reps.length} 个 profile${DRY ? ' [dry-run]' : ''}\n`);

  let ok = 0; const problems = [];
  for (const r of reps) {
    const prof = fpToProfile(r.data, r.file);
    const issues = (await Profile.load(prof)).validate();
    const tag = issues.length ? `✗ ${issues.join('; ')}` : '✓';
    const gpu = prof.webgl?.unmaskedRenderer || '(no webgl)';
    console.log(`  ${tag.padEnd(2)} ${prof.meta.name.padEnd(34)} ${String(r.count).padStart(3)}×  ${gpu}`);
    if (issues.length) { problems.push({ name: prof.meta.name, issues }); continue; }
    if (!DRY) fs.writeFileSync(path.join(OUT_DIR, `${prof.meta.name}.json`), JSON.stringify(prof, null, 2));
    ok++;
  }

  console.log(`\n${DRY ? '校验通过' : '已写入'} ${ok}/${reps.length}${problems.length ? `;${problems.length} 个 validate 失败` : ''}`);
  if (problems.length) process.exitCode = 2;
}

main().catch((e) => { console.error(e); process.exit(1); });
