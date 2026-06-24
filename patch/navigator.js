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
    // 永久 pending 的 window-realm Promise:壳取最不惊扰行为(不 resolve 给假数据、不 reject 触发
    // unhandledrejection)。用于返回复杂对象(MediaStream / BatteryManager / 竞价结果)的方法。
    const pending = () => new window.Promise(() => {});

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

    // ── secure-context data 方法(corrected 基线经 secure 重采暴露)─────────────────────────────
    // 旧基线走局域网 http(非 secure context)采不到这些 → 此前以 MISSING 掩盖,与 userAgentData 同根因;
    // jsdom 全缺。host 门控:both=chrome+webview 共有;chromeOnly=WebView 缺的 Chrome 专属(Protected
    // Audience/FLEDGE 广告竞价、Protocol Handler、AppBadge 部分)。length 取自真机基线。可信壳:void→
    // resolve、返回复杂对象→永久 pending、旧式 (constraints,success,error) 回调签名→无返回。
    const secureMethods = {
      both: {
        clearAppBadge: [0, () => promise(undefined)],
        getBattery: [0, () => pending()],
        getUserMedia: [3, () => undefined],
        requestMIDIAccess: [0, () => pending()],
        requestMediaKeySystemAccess: [2, () => pending()],
        setAppBadge: [0, () => promise(undefined)],
        webkitGetUserMedia: [3, () => undefined],
      },
      chromeOnly: {
        adAuctionComponents: [1, () => mask.adopt([])],
        runAdAuction: [1, () => pending()],
        canLoadAdAuctionFencedFrame: [0, () => false],
        clearOriginJoinedAdInterestGroups: [1, () => pending()],
        createAuctionNonce: [0, () => ''],
        joinAdInterestGroup: [1, () => pending()],
        leaveAdInterestGroup: [0, () => pending()],
        updateAdInterestGroups: [0, () => undefined],
        deprecatedReplaceInURN: [2, () => promise(undefined)],
        deprecatedURNToURL: [1, () => pending()],
        getInstalledRelatedApps: [0, () => promise(mask.adopt([]))],
        getInterestGroupAdAuctionData: [1, () => pending()],
        registerProtocolHandler: [2, () => undefined],
        unregisterProtocolHandler: [2, () => undefined],
      },
    };
    for (const [m, [len, impl]] of Object.entries(secureMethods.both)) dataMethod(m, len, impl);
    if (traits.host === 'chrome') {
      for (const [m, [len, impl]] of Object.entries(secureMethods.chromeOnly)) dataMethod(m, len, impl);
    }

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

    // ── secure-context 接口 getter(accessor → window 全局接口类单例;jsdom 全缺)─────────────────
    // 真机:Navigator.prototype 上 accessor getter 返回内部接口单例(多次访问 === 同一对象)。eager 建
    // 实例 + 注册全局类,getter 仅返回单例。补壳深度按检测频率:高频(media/clipboard/storage/credentials/
    // serviceWorker/gpu)补关键方法,低频接口留裸实例(正确 [object Tag]/typeof/instanceof 即够指纹面)。
    // 注:真机这些多继承 EventTarget;此处刻意不插 EventTarget 层 —— 插了会令 addEventListener 触发 jsdom
    // brand-check(同 screen/connection),原型链保真属另一轴单独处理。host 门控同 data 方法。
    const bothIface = {
      clipboard: ['Clipboard', { methods: {
        read: [0, () => pending()], readText: [0, () => pending()],
        write: [1, () => pending()], writeText: [1, () => pending()],
      } }],
      credentials: ['CredentialsContainer', { methods: {
        create: [0, () => pending()], get: [0, () => pending()],
        preventSilentAccess: [0, () => promise(undefined)], store: [1, () => pending()],
      } }],
      keyboard: ['Keyboard', { methods: {
        getLayoutMap: [0, () => pending()], lock: [0, () => promise(undefined)], unlock: [0, () => undefined],
      } }],
      managed: ['NavigatorManagedData'],
      mediaDevices: ['MediaDevices', { methods: {
        enumerateDevices: [0, () => promise(mask.adopt([]))], getDisplayMedia: [1, () => pending()],
        getSupportedConstraints: [0, () => mask.adopt({})], getUserMedia: [1, () => pending()],
      }, props: { ondevicechange: null } }],
      storage: ['StorageManager', { methods: {
        estimate: [0, () => promise(mask.adopt({ quota: 0, usage: 0 }))], getDirectory: [0, () => pending()],
        persist: [0, () => promise(false)], persisted: [0, () => promise(false)],
      } }],
      serviceWorker: ['ServiceWorkerContainer', { methods: {
        getRegistration: [0, () => pending()], getRegistrations: [0, () => promise(mask.adopt([]))],
        register: [1, () => pending()], startMessages: [0, () => undefined],
      }, props: { controller: null, oncontrollerchange: null, onmessage: null, onmessageerror: null } }],
      virtualKeyboard: ['VirtualKeyboard', { props: { overlaysContent: false } }],
      wakeLock: ['WakeLock', { methods: { request: [0, () => pending()] } }],
      locks: ['LockManager', { methods: { query: [0, () => pending()], request: [2, () => pending()] } }],
      gpu: ['GPU', { methods: {
        getPreferredCanvasFormat: [0, () => 'bgra8unorm'], requestAdapter: [0, () => promise(null)],
      } }],
      storageBuckets: ['StorageBucketManager', { methods: {
        delete: [1, () => pending()], keys: [0, () => promise(mask.adopt([]))], open: [1, () => pending()],
      } }],
    };
    const chromeOnlyIface = {
      login: ['NavigatorLogin', { methods: { setStatus: [1, () => pending()] } }],
      devicePosture: ['DevicePosture', { props: { type: 'continuous' } }],
      hid: ['HID', { methods: {
        getDevices: [0, () => promise(mask.adopt([]))], requestDevice: [1, () => promise(mask.adopt([]))],
      } }],
      presentation: ['Presentation', { props: { defaultRequest: null, receiver: null } }],
      serial: ['Serial', { methods: { getPorts: [0, () => promise(mask.adopt([]))], requestPort: [0, () => pending()] } }],
      usb: ['USB', { methods: { getDevices: [0, () => promise(mask.adopt([]))], requestDevice: [1, () => pending()] } }],
      xr: ['XRSystem', { methods: { isSessionSupported: [1, () => promise(false)], requestSession: [1, () => pending()] } }],
    };
    const addIfaces = (table) => {
      for (const [key, [className, opts = {}]] of Object.entries(table)) {
        const inst = ifaceInstance(className, opts.methods || {}, opts.props || {});
        accessors[key] = () => inst;
      }
    };
    addIfaces(bothIface);
    if (traits.host === 'chrome') {
      addIfaces(chromeOnlyIface);
      // 非接口 accessor:protectedAudience→ProtectedAudience 单例;另一为 boolean 标量(部署强制开关)。
      const protectedAudience = ifaceInstance('ProtectedAudience', { queryFeatureSupport: [1, () => mask.adopt({})] });
      accessors.protectedAudience = () => protectedAudience;
      accessors.deprecatedRunAdAuctionEnforcesKAnonymity = () => true;
    }
    if (traits.formFactor === 'mobile') {
      // Contacts Picker:Android 专属(移动端 chrome + webview 皆有、桌面无)→ formFactor 门控,异于上面的
      // host 门控(那批是 Chrome-vs-WebView 特性差,这个是平台差)。
      const contacts = ifaceInstance('ContactsManager', {
        getProperties: [0, () => promise(mask.adopt([]))], select: [2, () => pending()],
      });
      accessors.contacts = () => contacts;
    }

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
