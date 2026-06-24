/**
 * patch/uadata —— navigator.userAgentData(UA-CH,现代检测重点)。
 *
 * 现状[实测]:jsdom 全缺;真实 Chrome(secure context)必有 NavigatorUAData。
 * 数据来源优先级:profile.navigator.userAgentData(真机采集的高熵值)> 从 UA/traits 确定性派生。
 *
 * 高熵字段(platformVersion/model/architecture/...)严格说需真机采集 —— capture/collect.js 已采,
 * 但经局域网 http 采集时 navigator.userAgentData 非 secure context 故为 undefined,落盘为空(采集链路缺陷)。
 * 缺采集时此处给**不矛盾的保守值**:低熵字段(brands/mobile/platform)从 UA 确定性派生;
 * platformVersion 仅 linux('')/android(UA 版本号)可安全派生,windows/macos 留空(空是合法低信息回答,
 * 优于凭空造与 UA 冲突的假版本号)。真机采集到 userAgentData 后整体覆盖。
 */

const PLATFORM_LABEL = { windows: 'Windows', macos: 'macOS', linux: 'Linux', android: 'Android', ios: 'iOS' };

/** 从 UA / traits 派生低熵基础 + 可安全派生的高熵字段。 */
function derive(profile, traits) {
  const ua = profile.get('navigator.userAgent', '');
  const m = ua.match(/Chrome\/(\d+)(?:\.[\d.]+)?/);
  const major = String(traits.version ?? (m ? m[1] : ''));
  const full = (ua.match(/Chrome\/([\d.]+)/) || [])[1] || `${major}.0.0.0`;
  const mobile = traits.formFactor === 'mobile';
  const platform = PLATFORM_LABEL[traits.platform] || 'Unknown';

  // GREASE brand:各版本固定一个非品牌占位项(顺序真机随机化,此处取确定序)。
  const brands = [
    { brand: 'Chromium', version: major },
    { brand: 'Google Chrome', version: major },
    { brand: 'Not_A Brand', version: '24' },
  ];
  const fullVersionList = [
    { brand: 'Chromium', version: full },
    { brand: 'Google Chrome', version: full },
    { brand: 'Not_A Brand', version: '24.0.0.0' },
  ];

  // platformVersion:仅这两类可从 UA 安全派生,其余留空待采集。
  let platformVersion = '';
  if (traits.platform === 'android') platformVersion = `${(ua.match(/Android (\d+)/) || [])[1] || '0'}.0.0`;

  return {
    brands, mobile, platform,
    high: {
      architecture: mobile ? '' : 'x86',
      bitness: mobile ? '' : '64',
      brands, fullVersionList, mobile, model: '', platform, platformVersion,
      uaFullVersion: full, wow64: false,
    },
  };
}

export default {
  name: 'uadata',
  after: ['navigator'],
  applies: (t) => t.engine === 'chromium',
  apply({ window, profile, mask, traits }) {
    if (window.navigator.userAgentData) return; // 已存在则不覆盖

    const native = (impl, name, len) => mask.dropOwnToString(mask.fn(impl, name, len));
    const captured = profile.get('navigator.userAgentData', null);
    const d = derive(profile, traits);

    // 低熵三件套:采集优先,否则派生。
    const brands = captured?.brands ?? d.brands;
    const mobile = captured?.mobile ?? d.mobile;
    const platform = captured?.platform ?? d.platform;

    // 高熵全集:采集字段覆盖派生默认。getHighEntropyValues 按 hints 投影此集。
    const highAll = { ...d.high, ...(captured || {}), brands, mobile, platform };
    delete highAll.brands; // brands/mobile/platform 是低熵基属性,下面单独装;high 投影时再并回

    const { proto, create } = mask.iface('NavigatorUAData');
    Object.defineProperty(proto, 'getHighEntropyValues', {
      value: native((hints) => {
        const base = { brands: mask.adopt(brands.map((b) => mask.adopt({ ...b }))), mobile, platform };
        const list = Array.isArray(hints) ? hints : [];
        for (const h of list) if (h in highAll) base[h] = mask.adopt(highAll[h]);
        return window.Promise.resolve(mask.adopt(base));
      }, 'getHighEntropyValues', 1),
      writable: true, enumerable: true, configurable: true,
    });
    Object.defineProperty(proto, 'toJSON', {
      value: native(() => mask.adopt({ brands: brands.map((b) => ({ ...b })), mobile, platform }), 'toJSON', 0),
      writable: true, enumerable: true, configurable: true,
    });

    const uaData = create({
      brands: mask.adopt(brands.map((b) => mask.adopt({ ...b }))),
      mobile,
      platform,
    });

    mask.mixin(window.navigator, { userAgentData: () => uaData });
  },
};
