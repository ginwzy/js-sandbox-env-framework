/**
 * patch/domproto —— 补 jsdom 缺失的 DOM 原型**成员**(方法 + 访问器)于 Document/Element/HTMLElement/
 * EventTarget.prototype。边界:globals 管 window 全局函数 + 全局构造器,navigator 管 Navigator.prototype;
 * 此处只管 DOM 元素 / 文档 / 事件原型上的成员。native 化与形态契约见 mask 头注 + globals(只写一次):
 * mask.method 装 native data 方法、mask.eventHandler 装 get+set 访问器、mask.accessor 装 get-only 访问器,
 * 三者形态(name/length/native/无 own toString/无 .prototype、flags)均逐字段对齐真机基线。
 * 实现一律箭头(无 .prototype,真机 native 亦无)。返回值/默认值保真非本切片目标 —— L1 diff 只验形态,
 * 行为取安全默认(getAnimations→[]、checkVisibility→true、Promise 类取永久 pending、on* 默认 null、只读态
 * 取保守值);this 依赖的真实语义(getHTML 序列化 / scroll 实际滚动 / 反射属性回写 attribute)留后续。
 *
 * ownKeys.order 与切片边界:L1 diff 的 order tell 仅在两侧键集**相等**时触发(见 diff.js sameSet)。补成员
 * 令对应原型键集补全 → 激活 order 检测 → 须在 keyorder 注册真机序。本 patch 补全 EventTarget.prototype
 * (仅缺 when)及 Document/Element/HTMLElement.prototype(方法 + 访问器全补)→ keyorder 据真机基线为这些
 * 原型注册序。order 随 host 而异者(事件处理器密集原型 chrome-vs-webview 序不同)由 keyorder per-host 表承接。
 *
 * arity / 门控:arity = 真机基线 fn.length(authoring 时提取,勿据签名臆测:caretRangeFromPoint=0、scroll/
 * fullscreen 族=0)。host 门控(chromeHost):browsingTopics/hasPrivateToken/hasRedemptionRecord/ariaNotify
 * (方法)+ activeViewTransition(访问器)是 Chrome 隐私 / 实验面,WebView 基线无 —— 无门控即 webview 侧 EXTRA。
 */
import { chromeHost } from './gates.js';

const hasOwn = Object.prototype.hasOwnProperty;

export default {
  name: 'domproto',
  after: ['window'],
  apply({ window, mask, traits }) {
    const W = window;
    const { method, accessor, eventHandler, adopt, pending } = mask;
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

    // ── 访问器 ──────────────────────────────────────────────────────────────
    // GETSET:get+set 形态(get 'get X'/len0、set 'set X'/len1)。涵盖 on* 事件处理器**与**可写反射 IDL
    // 属性(designMode/contentEditable/aria*Element 等,真机同此形态)。经 mask.eventHandler:每键独立闭包
    // 存值,默认 null(on* 正确;反射属性语义默认留后续)。名单据真机基线 accessor.get+set 判定(authoring 提取)。
    const documentGetSet = [
      'adoptedStyleSheets', 'alinkColor', 'bgColor', 'designMode', 'domain', 'fgColor', 'fullscreen',
      'fullscreenElement', 'fullscreenEnabled', 'linkColor', 'onanimationend', 'onanimationiteration',
      'onanimationstart', 'onbeforecopy', 'onbeforecut', 'onbeforepaste', 'onbeforexrselect', 'oncommand',
      'oncontentvisibilityautostatechange', 'onfreeze', 'onfullscreenchange', 'onfullscreenerror', 'onmousewheel',
      'onpointerlockchange', 'onpointerlockerror', 'onprerenderingchange', 'onresume', 'onscrollsnapchange',
      'onscrollsnapchanging', 'onsearch', 'onselectionchange', 'onselectstart', 'ontransitioncancel',
      'ontransitionend', 'ontransitionrun', 'ontransitionstart', 'onwebkitfullscreenchange',
      'onwebkitfullscreenerror', 'vlinkColor', 'xmlStandalone', 'xmlVersion',
    ];
    const elementGetSet = [
      'ariaActiveDescendantElement', 'ariaBrailleLabel', 'ariaBrailleRoleDescription', 'ariaControlsElements',
      'ariaDescribedByElements', 'ariaDetailsElements', 'ariaErrorMessageElements', 'ariaFlowToElements',
      'ariaLabelledByElements', 'elementTiming', 'onbeforecopy', 'onbeforecut', 'onbeforepaste',
      'onfullscreenchange', 'onfullscreenerror', 'onsearch', 'onwebkitfullscreenchange', 'onwebkitfullscreenerror',
      'part',
    ];
    const htmlElementGetSet = [
      'autocapitalize', 'autofocus', 'contentEditable', 'editContext', 'enterKeyHint', 'inert', 'innerText',
      'inputMode', 'onanimationend', 'onanimationiteration', 'onanimationstart', 'onbeforexrselect', 'oncommand',
      'oncontentvisibilityautostatechange', 'onmousewheel', 'onscrollsnapchange', 'onscrollsnapchanging',
      'onselectionchange', 'onselectstart', 'ontransitioncancel', 'ontransitionend', 'ontransitionrun',
      'ontransitionstart', 'outerText', 'popover', 'spellcheck', 'virtualKeyboardPolicy', 'writingSuggestions',
    ];

    // GETONLY:[名, 默认值 getter, gate?]。只读态(元素引用/能力位/可见态),默认取保守值(经 mask.accessor,
    // get-only、'get X'/len0)。getValue 由 mask.accessor 在取值时调 + adopt 对齐 window 身份。
    const documentGetOnly = [
      ['activeViewTransition', () => null, chromeHost], // 实验面,WebView 无
      ['all', () => undefined],
      ['featurePolicy', () => null],
      ['fonts', () => null],
      ['fragmentDirective', () => null],
      ['pictureInPictureElement', () => null],
      ['pictureInPictureEnabled', () => false],
      ['pointerLockElement', () => null],
      ['prerendering', () => false],
      ['rootElement', () => null],
      ['scrollingElement', () => null],
      ['timeline', () => null],
      ['wasDiscarded', () => false],
      ['webkitCurrentFullScreenElement', () => null],
      ['webkitFullscreenElement', () => null],
      ['webkitFullscreenEnabled', () => false],
      ['webkitHidden', () => false],
      ['webkitIsFullScreen', () => false],
      ['webkitVisibilityState', () => 'visible'],
      ['xmlEncoding', () => null],
    ];
    const elementGetOnly = [
      ['currentCSSZoom', () => 1],
    ];
    const htmlElementGetOnly = [
      ['attributeStyleMap', () => null],
      ['isContentEditable', () => false],
    ];

    const installGetSet = (proto, names) => {
      for (const name of names) {
        if (hasOwn.call(proto, name)) continue;
        eventHandler(proto, name);
      }
    };
    const installGetOnly = (proto, table) => {
      for (const [name, getValue, gate] of table) {
        if (gate && !gate(traits)) continue;
        if (hasOwn.call(proto, name)) continue;
        accessor(proto, name, getValue);
      }
    };

    installGetSet(W.Document.prototype, documentGetSet);
    installGetSet(W.Element.prototype, elementGetSet);
    installGetSet(W.HTMLElement.prototype, htmlElementGetSet);
    installGetOnly(W.Document.prototype, documentGetOnly);
    installGetOnly(W.Element.prototype, elementGetOnly);
    installGetOnly(W.HTMLElement.prototype, htmlElementGetOnly);
  },
};
