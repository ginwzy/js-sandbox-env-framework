/**
 * patch/symbol —— 隐藏 webidl2js / jsdom 内部 Symbol 泄漏。
 *
 * 现状[实测]:jsdom 用 webidl2js 生成 Web IDL 包装,内部用模块级 Symbol 挂实现/注册表,直接暴露在反射面:
 *   Object.getOwnPropertySymbols(window)    -> Symbol([webidl2js] constructor registry) | Symbol(named property tracker) | Symbol(impl)
 *   Object.getOwnPropertySymbols(document)  -> Symbol(impl)
 *   Object.getOwnPropertySymbols(navigator) -> Symbol(impl)
 *   广采集另见 Symbol(SameObject caches) 及第二个 Symbol(impl)。
 * "[webidl2js]" 直接点名 jsdom 代码生成器,真实浏览器的 window/document/navigator 等 getOwnPropertySymbols 均为 []。
 * vmp 遍历反射面一测即破。
 *
 * 采集策略(关键):本 patch 在 pipeline 装配期运行,**先于任何页面脚本**,故此刻 jsdom 对象上的任何 own symbol
 * 必然是内部 symbol。因此从一批代表性包装对象上**全量按身份采集 own symbol**,即得完整内部集合 —— 无需按描述串
 * (如 '[webidl2js]')匹配,从根上杜绝误伤页面合法 Symbol;且自动覆盖未采样的包装类型,并区分同描述不同身份的多个 impl。
 *
 * 过滤策略:对三条会暴露 symbol 键的反射 API 按身份过滤(对照 sdenv Object.js 的 getOwnPropertySymbols 壳,但 sdenv
 * 仅处理 window 且粗暴返回 []):getOwnPropertySymbols(滤除,覆盖所有包装对象)、Reflect.ownKeys(仅滤 symbol 部分)、
 * getOwnPropertyDescriptors(从结果删内部 symbol 键)。internal symbol 不能删(jsdom 挂实现所需),只能在反射层隐藏;
 * 即便经 spread 物理拷到副本,副本的 getOwnPropertySymbols 同样被本壳过滤 → 反射面始终拿不到引用,三条 API 足以闭合泄漏面。
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
