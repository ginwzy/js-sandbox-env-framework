/**
 * patch/viewport —— 窗口几何回放:window.inner/outer 尺寸 + devicePixelRatio 取自 profile.window。
 *
 * 根因:jsdom 默认 innerWidth/Height=1024x768、devicePixelRatio=1,与 profile.screen(真机屏幕尺寸)
 * 不一致 —— 窗口宽 > 屏幕宽、移动端 dpr=1 都是显式 bot tell。这些值真机采集已有(collect.js window 段),
 * 此前仅 globals 用其派生 visualViewport,window 自身的几何属性无 patch 消费 → 漏 jsdom 默认。
 *
 * jsdom 这几个属性是 own、configurable accessor(get-only),redefine 即覆盖;真机亦 get-only readonly,形态一致。
 */
export default {
  name: 'viewport',
  after: ['window'],
  apply({ window, profile, mask }) {
    const win = profile.section('window');
    // 缺某项则保留 jsdom 原值(不投机造)—— 仅回放采到的几何。
    const set = (name, val) => { if (val != null) mask.accessor(window, name, () => val); };
    set('innerWidth', win.innerWidth);
    set('innerHeight', win.innerHeight);
    set('outerWidth', win.outerWidth);
    set('outerHeight', win.outerHeight);
    set('devicePixelRatio', win.devicePixelRatio);
  },
};
