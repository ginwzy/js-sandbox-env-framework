/**
 * patch/clock —— 确定性时间与随机数(过 Akamai 这类强检测、复现签名的关键)。
 * 对照 sdenv-extend: handle/dateAndRandomHandle.js(录制 / 回放)。
 *
 * 两种模式(profile.timing 驱动):
 *  - 序列回放:timing.sequences 存录制序列(差值压缩),按调用序回放 → 跨 run 完全一致。
 *  - 固定值兜底:仅 timing.now / timing.seed,Date.now 返固定值 + mulberry32 PRNG。
 * 序列优先;无序列时走固定值;两者皆无则不接管。
 *
 * Date 构造拦截:Proxy(Date, {construct}) —— V8 下 toString 仍为 [native code]、
 * name/length/prototype/ownNames 不变;mask.fn 注册 masked WeakSet 保 nativeToString 输出。
 */
export default {
  name: 'clock',
  after: [],
  apply({ window, profile, mask }) {
    const t = profile.section('timing');
    const seq = t.sequences || {};
    const hasSeq = seq.now || seq.random || seq.newdate;
    if (!hasSeq && t.now == null && t.seed == null) return;

    // ── 序列展开(差值压缩 → 绝对值) ──────────────────────────────────────────

    function expand(arr, base) {
      if (!arr || !arr.length) return null;
      if (typeof arr[0] === 'number') return arr.map((d) => base + d);
      // RLE: [[delta, count], ...] → 展开
      const out = [];
      for (const [delta, count] of arr) for (let i = 0; i < count; i++) out.push(base + delta);
      return out;
    }

    // ── Date.now 回放 ─────────────────────────────────────────────────────────

    const nowSeq = expand(seq.now, seq.firstMap?.now ?? t.now ?? Date.now());
    let nowIdx = 0;
    const baseNow = t.now ?? Date.now();

    if (nowSeq) {
      window.Date.now = mask.native(() => {
        if (nowIdx < nowSeq.length) return nowSeq[nowIdx++];
        return nowSeq[nowSeq.length - 1] + (++nowIdx - nowSeq.length);
      }, 'now');
    } else if (t.now != null) {
      const fixedNow = t.now;
      window.Date.now = mask.native(() => fixedNow, 'now');
    }

    // ── new Date() 回放(零参数构造) ───────────────────────────────────────────

    const dateSeq = expand(seq.newdate, seq.firstMap?.newdate ?? baseNow);
    let dateIdx = 0;

    if (dateSeq || nowSeq || t.now != null) {
      const OrigDate = window.Date;
      const ProxyDate = new Proxy(OrigDate, {
        construct(target, args) {
          if (args.length === 0) {
            let ts;
            if (dateSeq) { ts = dateIdx < dateSeq.length ? dateSeq[dateIdx++] : dateSeq[dateSeq.length - 1] + (++dateIdx - dateSeq.length); }
            else ts = window.Date.now();
            return new target(ts);
          }
          return Reflect.construct(target, args);
        },
        apply(target, thisArg, args) {
          if (args.length === 0) {
            let ts;
            if (dateSeq) { ts = dateIdx < dateSeq.length ? dateSeq[dateIdx++] : dateSeq[dateSeq.length - 1] + (++dateIdx - dateSeq.length); }
            else ts = window.Date.now();
            return new target(ts).toString();
          }
          return Reflect.apply(target, thisArg, args);
        },
      });
      mask.fn(ProxyDate, 'Date');
      // Proxy 的 [[Prototype]] 是宿主 Function.prototype 而非 window.Function.prototype,
      // reparent 后 dropOwnToString 才能删除 fn() 装的 own toString(真 native 无 own toString)。
      mask.dropOwnToString(Object.setPrototypeOf(ProxyDate, window.Function.prototype));
      Object.defineProperty(OrigDate.prototype, 'constructor', { value: ProxyDate, writable: true, configurable: true });
      window.Date = ProxyDate;
    }

    // ── Math.random 回放 ──────────────────────────────────────────────────────

    const randSeq = seq.random;
    let randIdx = 0;

    if (randSeq && randSeq.length) {
      let s = (t.seed ?? 0) >>> 0;
      const mulberry = () => {
        s |= 0; s = (s + 0x6d2b79f5) | 0;
        let x = Math.imul(s ^ (s >>> 15), 1 | s);
        x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
      };
      window.Math.random = mask.native(() => (randIdx < randSeq.length ? randSeq[randIdx++] : mulberry()), 'random');
    } else if (t.seed != null) {
      let s = t.seed >>> 0;
      window.Math.random = mask.native(() => {
        s |= 0; s = (s + 0x6d2b79f5) | 0;
        let x = Math.imul(s ^ (s >>> 15), 1 | s);
        x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
      }, 'random');
    }
  },
};
