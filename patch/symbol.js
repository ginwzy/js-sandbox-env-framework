/**
 * patch/symbol —— 隐藏 webidl2js / jsdom 内部 Symbol 泄漏。
 *
 * 现状[实测]:jsdom 内部 Symbol(impl/registry/tracker)直接暴露在 getOwnPropertySymbols 反射面。
 * 采集策略:装配期(先于页面脚本)全量按身份采集 own symbol → 完整内部集合,无需描述串匹配。
 * 过滤:getOwnPropertySymbols / Reflect.ownKeys / getOwnPropertyDescriptors 三条 API 按身份滤除,闭合泄漏面。
 */
export default {
  name: 'symbol',
  after: [],
  apply({ window, mask }) {
    const Obj = window.Object;
    const Refl = window.Reflect;

    // 1) 全量采集内部 symbol(页面未执行 → 所见即内部)。按身份去重,覆盖同描述不同身份的多个 impl。
    const hidden = new Set();
    const collect = (o) => {
      if (o == null || (typeof o !== 'object' && typeof o !== 'function')) return;
      try {
        for (const s of Obj.getOwnPropertySymbols(o)) hidden.add(s);
      } catch {
        /* 个别 seed 不可反射则跳过 */
      }
    };
    const doc = window.document;
    const seeds = [
      window, doc, window.navigator, doc.documentElement, doc.head,
      doc.createElement('div'), doc.createElement('canvas'), doc.createTextNode(''),
      doc.documentElement.classList, doc.implementation,
      window.location, window.history, window.localStorage, window.sessionStorage,
      window.screen, window.performance, window.crypto,
      window.navigator.connection,
    ];
    for (const Ctor of ['Event', 'CustomEvent', 'URL', 'URLSearchParams']) {
      try {
        const C = window[Ctor];
        seeds.push(Ctor === 'Event' || Ctor === 'CustomEvent' ? new C('x') : new C(Ctor === 'URL' ? 'https://a.invalid/' : 'a=1'));
      } catch {
        /* 构造失败则跳过 */
      }
    }
    for (const s of seeds) collect(s);

    const isHidden = (k) => typeof k === 'symbol' && hidden.has(k);

    // 2) getOwnPropertySymbols:滤除内部 symbol。仅在确有命中时重建数组,避免无谓分配并保留 window.Array 身份。
    mask.hook(Obj, 'getOwnPropertySymbols', (orig) => function getOwnPropertySymbols(o) {
      const out = orig(o);
      for (let i = 0; i < out.length; i++) if (hidden.has(out[i])) return out.filter((s) => !hidden.has(s));
      return out;
    });

    // 3) Reflect.ownKeys:含字符串+symbol 键,仅滤 symbol 部分。
    mask.hook(Refl, 'ownKeys', (orig) => function ownKeys(o) {
      const out = orig(o);
      for (let i = 0; i < out.length; i++) if (isHidden(out[i])) return out.filter((k) => !isHidden(k));
      return out;
    });

    // 4) getOwnPropertyDescriptors:从结果对象删除内部 symbol 键(delete 不存在键为无害 no-op)。
    mask.hook(Obj, 'getOwnPropertyDescriptors', (orig) => function getOwnPropertyDescriptors(o) {
      const out = orig(o);
      for (const s of hidden) delete out[s];
      return out;
    });
  },
};
