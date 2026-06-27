/**
 * patch/domproto —— 补 jsdom 缺失的 DOM 原型**方法**(Document/Element/HTMLElement/EventTarget.prototype)。
 * 边界:globals 管 window 全局函数 + 全局构造器,navigator 管 Navigator.prototype;此处只管 DOM 元素 /
 * 文档 / 事件原型上的成员方法。native 化与形态契约见 mask 头注 + globals(只写一次):mask.method 装
 * native data 方法(writable+enumerable+configurable、name/length 校正、无 own toString、无 .prototype)。
 * 实现一律箭头函数(无 .prototype,真机 native 方法亦无)。返回值保真非本切片目标 —— L1 diff 只验形态,
 * 行为取安全默认(getAnimations→[]、checkVisibility→true、Promise 类取永久 pending);this 依赖的真实
 * 语义(getHTML 序列化 / scroll 实际滚动)留后续切片。
 *
 * 为何只补方法、暂留 on* 与 aria* 与 legacy 访问器(下一切片):L1 diff 的 ownKeys.order tell 仅在两侧键集
 * **相等**时触发(见 diff.js sameSet)。只补方法 → 各原型仍缺访问器 → 键集不等 → order 检测休眠,本切片
 * append 顺序无害。唯一例外是 EventTarget.prototype —— 它仅缺 when 一项,补它即令键集补全、激活 order
 * 检测,故配套在 keyorder 注册其真机序(见该文件 EVENT_TARGET_ORDER)。
 *
 * arity = 真机基线 fn.length(authoring 时从 harness/baselines 提取),勿据签名臆测:caretRangeFromPoint=0
 * 而非 2、多数 scroll/fullscreen 族=0。host 门控(chromeHost):browsingTopics/hasPrivateToken/
 * hasRedemptionRecord/ariaNotify 是 Chrome 隐私沙箱面,WebView 基线无 —— 无门控即在 webview 侧成 EXTRA。
 */
import { chromeHost } from './gates.js';

const hasOwn = Object.prototype.hasOwnProperty;

export default {
  name: 'domproto',
  after: ['window'],
  apply({ window, mask, traits }) {
    const W = window;
    const { method, adopt, pending } = mask;
    // 每个 impl 必须是**独立**函数对象:mask.fn 原地改写 name/length,共享一个引用会令后注册的方法
    // 覆盖前者的 name/length(全指向同一被改写对象)。故下方一律内联新箭头,勿抽公共 const 复用。

    // [名, arity, 实现, gate?]。
    const documentMethods = [
      ['caretPositionFromPoint', 2, () => null],
      ['caretRangeFromPoint', 0, () => null],
      ['elementFromPoint', 2, () => null],
      ['elementsFromPoint', 2, () => adopt([])],
      ['execCommand', 1, () => false],
      ['exitFullscreen', 0, () => pending()],
      ['exitPictureInPicture', 0, () => pending()],
      ['exitPointerLock', 0, () => undefined],
      ['getAnimations', 0, () => adopt([])],
      ['hasStorageAccess', 0, () => W.Promise.resolve(false)],
      ['hasUnpartitionedCookieAccess', 0, () => W.Promise.resolve(false)],
      ['moveBefore', 2, () => undefined],
      ['queryCommandEnabled', 1, () => false],
      ['queryCommandIndeterm', 1, () => false],
      ['queryCommandState', 1, () => false],
      ['queryCommandSupported', 1, () => false],
      ['queryCommandValue', 1, () => ''],
      ['requestStorageAccess', 0, () => pending()],
      ['requestStorageAccessFor', 1, () => pending()],
      ['startViewTransition', 0, () => adopt({})],
      ['webkitCancelFullScreen', 0, () => undefined],
      ['webkitExitFullscreen', 0, () => undefined],
      // Chrome 隐私沙箱面(WebView 缺 → chromeHost):
      ['ariaNotify', 1, () => undefined, chromeHost],
      ['browsingTopics', 0, () => pending(), chromeHost],
      ['hasPrivateToken', 1, () => W.Promise.resolve(false), chromeHost],
      ['hasRedemptionRecord', 1, () => W.Promise.resolve(false), chromeHost],
    ];

    const elementMethods = [
      ['animate', 1, () => adopt({})],
      ['checkVisibility', 0, () => true],
      ['computedStyleMap', 0, () => adopt({})],
      ['getAnimations', 0, () => adopt([])],
      ['getHTML', 0, () => ''],
      ['hasPointerCapture', 1, () => false],
      ['moveBefore', 2, () => undefined],
      ['releasePointerCapture', 1, () => undefined],
      ['requestFullscreen', 0, () => pending()],
      ['requestPointerLock', 0, () => pending()],
      ['scroll', 0, () => undefined],
      ['scrollBy', 0, () => undefined],
      ['scrollIntoView', 0, () => undefined],
      ['scrollIntoViewIfNeeded', 0, () => undefined],
      ['scrollTo', 0, () => undefined],
      ['setHTMLUnsafe', 1, () => undefined],
      ['setPointerCapture', 1, () => undefined],
      ['webkitRequestFullScreen', 0, () => undefined],
      ['webkitRequestFullscreen', 0, () => undefined],
      ['ariaNotify', 1, () => undefined, chromeHost],
    ];

    const htmlElementMethods = [
      ['hidePopover', 0, () => undefined],
      ['showPopover', 0, () => undefined],
      ['togglePopover', 0, () => false], // 返回切换后是否可见
    ];

    // EventTarget.prototype.when:Observable(新标准)。补它令 ET 键集补全 → keyorder 重排其真机序(配套)。
    const eventTargetMethods = [
      ['when', 1, () => adopt({})],
    ];

    const install = (proto, table) => {
      for (const [name, len, impl, gate] of table) {
        if (gate && !gate(traits)) continue;       // 平台/host 差异方法门控(据真机基线)
        if (hasOwn.call(proto, name)) continue;    // jsdom 已具(形态错则属 TELL,另判),不覆盖
        method(proto, name, len, impl);
      }
    };

    install(W.Document.prototype, documentMethods);
    install(W.Element.prototype, elementMethods);
    install(W.HTMLElement.prototype, htmlElementMethods);
    install(W.EventTarget.prototype, eventTargetMethods);
  },
};
