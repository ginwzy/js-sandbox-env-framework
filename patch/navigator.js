/**
 * patch/navigator —— 把 jsdom 的 navigator 改造成 profile 指定的 Chrome navigator。
 * 在 jsdom 原生 Navigator 原型上以 getter 覆盖,保留原型链与 instanceof。
 */
export default {
  name: 'navigator',
  after: [],
  apply({ window, profile, mask, traits }) {
    const p = profile.section('navigator');
    const nav = window.navigator;
    const mobile = traits.formFactor === 'mobile';

    // 标量属性:以原型 getter 覆盖(mask.mixin 已处理描述符 + native 化)。
    mask.mixin(nav, {
      userAgent: () => p.userAgent ?? nav.userAgent,
      appVersion: () => p.appVersion ?? nav.appVersion,
      platform: () => p.platform ?? 'Win32',
      vendor: () => p.vendor ?? 'Google Inc.',
      language: () => p.language ?? 'en-US',
      languages: () => [...(p.languages ?? ['en-US', 'en'])],
      hardwareConcurrency: () => p.hardwareConcurrency ?? 8,
      deviceMemory: () => p.deviceMemory ?? 8,
      // 形态差异:移动端默认有触点,桌面为 0。
      maxTouchPoints: () => p.maxTouchPoints ?? (mobile ? 5 : 0),
      webdriver: () => false,
    });

    // connection: 伪造 NetworkInformation 内部接口(满足 instanceof + window 身份)。
    if (p.connection) {
      const { create } = mask.iface('NetworkInformation');
      const conn = create({ onchange: null, ...p.connection });
      mask.mixin(nav, { connection: () => conn });
    }

    // ── Navigator.prototype 标准接口(jsdom 全缺)────────────────────────────
    // 真机:多为 accessor getter 返回内部接口实例,少数为 data 方法。形态对齐基线
    // (data 方法 w+e+c;accessor get native/length0/set null)。行为为可信壳。
    const proto = window.Navigator.prototype;
    const native = (impl, fname, len) => mask.dropOwnToString(mask.fn(impl, fname, len));
    const promise = (v) => window.Promise.resolve(v);

    // data 方法:真机为 Navigator.prototype 上 enumerable 的 data 方法。
    const dataMethod = (mname, len, impl) => {
      if (mname in proto) return;
      Object.defineProperty(proto, mname, {
        value: native(impl, mname, len), writable: true, enumerable: true, configurable: true,
      });
    };
    dataMethod('getGamepads', 0, () => mask.adopt([]));
    dataMethod('sendBeacon', 1, () => true);
    dataMethod('vibrate', 1, () => true);

    // 内部接口实例:iface 注册 window 全局类(真机这些类确为全局)+ proto 装 native 方法,create 出实例。
    const ifaceInstance = (iname, methods = {}, props = {}) => {
      const { proto: ip, create } = mask.iface(iname);
      for (const [m, [len, impl]] of Object.entries(methods)) {
        Object.defineProperty(ip, m, {
          value: native(impl, m, len), writable: true, enumerable: true, configurable: true,
        });
      }
      return create(props);
    };

    const storage = mask.iface('DeprecatedStorageQuota');
    for (const [m, len] of [['queryUsageAndQuota', 2], ['requestQuota', 2]]) {
      Object.defineProperty(storage.proto, m, {
        value: native(() => undefined, m, len), writable: true, enumerable: true, configurable: true,
      });
    }

    // 接口实例 eager 化:真机这些全局类(window.Permissions 等)无条件存在、且 navigator.X 是单例
    // (多次访问返回同一对象)。故先建实例 + 注册全局类,getter 仅返回单例 —— 不在 getter 内重建
    // (否则 === 不成立、且每次访问重复注册 window 类)。
    const permissions = ifaceInstance('Permissions', {
      query: [1, (desc) => promise(mask.adopt({ name: desc && desc.name, state: 'prompt', onchange: null }))],
    });
    const geolocation = ifaceInstance('Geolocation', {
      getCurrentPosition: [1, () => undefined],
      watchPosition: [1, () => 0],
      clearWatch: [1, () => undefined],
    });
    const userActivation = ifaceInstance('UserActivation', {}, { hasBeenActive: false, isActive: false });
    const scheduling = ifaceInstance('Scheduling', { isInputPending: [0, () => false] });
    const mediaCapabilities = ifaceInstance('MediaCapabilities', {
      decodingInfo: [1, () => promise(mask.adopt({ supported: false, smooth: false, powerEfficient: false }))],
      encodingInfo: [1, () => promise(mask.adopt({ supported: false, smooth: false, powerEfficient: false }))],
    });
    const ink = ifaceInstance('Ink', { requestPresenter: [1, () => promise(undefined)] });
    const webkitTemporaryStorage = storage.create();
    const webkitPersistentStorage = storage.create();

    const accessors = {
      permissions: () => permissions,
      geolocation: () => geolocation,
      userActivation: () => userActivation,
      scheduling: () => scheduling,
      mediaCapabilities: () => mediaCapabilities,
      ink: () => ink,
      webkitTemporaryStorage: () => webkitTemporaryStorage,
      webkitPersistentStorage: () => webkitPersistentStorage,
      // 标量:真机 Chrome 桌面 pdfViewerEnabled=true、doNotTrack=null。WebView 无 PDF 插件 → false。
      pdfViewerEnabled: () => traits.host === 'chrome',
      doNotTrack: () => null,
    };

    // 平台差异键(据真机基线门控,避免对 WebView/移动端过度注入):
    // mediaSession 桌面+移动 Chrome 有、WebView 无 → host 门控;
    // windowControlsOverlay 桌面 PWA 专属、移动端无 → formFactor 门控。
    if (traits.host === 'chrome') {
      const mediaSession = ifaceInstance('MediaSession', {
        setActionHandler: [2, () => undefined],
        setPositionState: [1, () => undefined],
      }, { metadata: null, playbackState: 'none' });
      accessors.mediaSession = () => mediaSession;
    }
    if (traits.formFactor === 'desktop') {
      const windowControlsOverlay = ifaceInstance('WindowControlsOverlay', {
        getTitlebarAreaRect: [0, () => mask.adopt({ x: 0, y: 0, width: 0, height: 0 })],
      }, { visible: false });
      accessors.windowControlsOverlay = () => windowControlsOverlay;
    }

    mask.mixin(nav, accessors);
  },
};
