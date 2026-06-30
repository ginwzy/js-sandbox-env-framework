/**
 * patch/screen —— 覆盖 jsdom 的 screen 尺寸 / 色深为 profile 值,并补真机 Screen.prototype 标准扩展键。
 *
 * Screen.prototype 真机[实测]含 availLeft / availTop / orientation(jsdom 缺,旧为覆盖缺口)。三者皆为
 * 原型上的只读 accessor(同 width/height,经 mask.mixin 装在原型)。orientation 返回 ScreenOrientation
 * 单例:继承 EventTarget、type/angle 自 profile.screen.orientation、onchange 可写。
 *
 * onchange(事件处理器)/ isExtended(只读 bool,多屏扩展态)补全键集;own 键序由 patch/keyorder 统一重排
 * (真机 constructor 在 orientation 后、onchange/isExtended 前)。
 */
export default {
  name: 'screen',
  after: [],
  apply({ window, profile, mask }) {
    const p = profile.section('screen');
    const o = p.orientation || {};

    // ScreenOrientation 单例:继承 EventTarget,type/angle 只读,onchange 可写,lock/unlock 方法壳。
    const so = mask.iface('ScreenOrientation');
    mask.eventTargetProto(so.proto); // 真机:ScreenOrientation extends EventTarget(顺带登记 brandless)
    mask.accessors(so.proto, {
      type: () => o.type || 'landscape-primary',
      angle: () => o.angle ?? 0,
    });
    mask.eventHandler(so.proto, 'onchange');
    mask.methods(so.proto, { lock: [1, () => mask.adopt(window.Promise.resolve())], unlock: [0, () => undefined] });
    const orientation = so.create();

    mask.mixin(window.screen, {
      width: () => p.width ?? 1920,
      height: () => p.height ?? 1080,
      availWidth: () => p.availWidth ?? p.width ?? 1920,
      availHeight: () => p.availHeight ?? p.height ?? 1040,
      colorDepth: () => p.colorDepth ?? 24,
      pixelDepth: () => p.pixelDepth ?? 24,
      availLeft: () => p.availLeft ?? 0,
      availTop: () => p.availTop ?? 0,
      orientation: () => orientation,
    });

    // 真机[实测]Screen.prototype 另有 onchange(事件处理器)/ isExtended(只读 bool,单屏 false)两键,
    // 排在 constructor 之后;键序由 patch/keyorder 的 SCREEN_ORDER 统一重排。
    const sproto = window.Screen.prototype;
    mask.eventHandler(sproto, 'onchange');
    mask.accessor(sproto, 'isExtended', () => false);
  },
};
