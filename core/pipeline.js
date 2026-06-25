/**
 * 装配流水线 —— 按 patch 的 `after` 拓扑排序,再按 `applies(traits)` 门控,依次 apply。
 * 记录每个 patch 的门控决策,供 realm.describe() 内省。
 */

/**
 * @param {Array<{name:string, after?:string[], applies?:Function, apply:Function}>} patches
 * @param {object} realm  含 window/profile/mask/traits/trace
 * @returns {Array<{name:string, applied:boolean, reason:string, error?:string}>} 决策记录
 */
export function runPipeline(patches, realm) {
  const byName = new Map(patches.map((p) => [p.name, p]));
  const done = new Set();
  const visiting = new Set();
  const order = [];

  function visit(p) {
    if (done.has(p.name)) return;
    if (visiting.has(p.name)) throw new Error(`patch 循环依赖: ${p.name}`);
    visiting.add(p.name);
    for (const dep of p.after || []) {
      const d = byName.get(dep);
      if (d) visit(d);
      // 未知依赖:经宿主 console 告警而非静默吞 —— 静默跳过会让 after 里的 typo / 已删 patch 名无声蒸发,
      // 拓扑约束悄悄失效却零诊断(曾有 after:['document'] 悬空依赖长期潜伏)。把它暴露成可见信号。
      else console.warn(`[pipeline] patch '${p.name}' 的 after 依赖 '${dep}' 无对应 patch —— 该拓扑约束被忽略(检查拼写/是否已删)`);
    }
    visiting.delete(p.name);
    done.add(p.name);
    order.push(p);
  }
  patches.forEach(visit);

  const decisions = [];
  for (const p of order) {
    const gated = typeof p.applies === 'function';
    const applied = !gated || p.applies(realm.traits);
    const record = { name: p.name, applied, reason: applied ? (gated ? 'match' : 'always') : 'skip' };
    decisions.push(record);
    if (!applied) continue;
    try {
      p.apply(realm);
    } catch (e) {
      record.error = e.message;
      realm.trace?.patchError?.(p.name, e);
    }
  }
  // 全 patch 应用后统一收尾:把所有接口原型的 constructor own 键挪到末位(对齐真机 WebIDL)。集中一处调,
  // 不依赖各 patch 自觉;须在所有 mask.methods 装完后跑,否则后装的方法又把 constructor 顶到非末位。
  realm.mask?.finalizeIfaces?.();
  return decisions;
}
