/**
 * patch/webgl —— WebGL 指纹查表回放(GPU 厂商/型号 + getParameter 参数 + 扩展列表)。
 *
 * 根因:jsdom 无 WebGL,getContext('webgl'/'webgl2') 返回 null —— 真机最强硬件指纹之一整段缺失(检测器读
 * UNMASKED_RENDERER_WEBGL / VENDOR / MAX_* 做设备哈希)。本 patch 不做真实渲染,只把 profile.webgl(capture
 * 采的 getParameter 全表 + extensions + UNMASKED_*)按 enum 查表回放 —— 纯数据,无 canvas/audio 的渲染回放难题。
 *
 * 形态对照真机[实测,Chrome 148/M4]:
 *  - WebGLRenderingContext 与 WebGL2RenderingContext 是**两个独立接口**(WebGL2 不继承 WebGL1)→ 建两个独立
 *    iface(真机 window 有这两个全局构造器)。常量在 prototype 上,enumerable + 非 writable + 非 configurable。
 *  - getParameter 数组类参数返回 **window-realm typed array**(MAX_VIEWPORT_DIMS→Int32Array、ALIASED_*→Float32Array;
 *    检测器 `result instanceof gl.Int32Array`)—— 用 window.Int32Array 构造,mask.adopt 管不了 typed array。
 *  - WEBGL_debug_renderer_info 扩展对象:constructor.name==='Object'、own keys 空、toStringTag='WebGLDebugRendererInfo'、
 *    两 UNMASKED_* 常量在其**原型**上 → Object.create(extProto),**不能**用 mask.iface(否则凭空造 window 全局 EXTRA 泄漏)。
 *
 * 门控:profile.webgl 缺(未采 GPU)则整段不装,不伪造无中生有的 GPU(getContext 维持 null,同 jsdom 原样)。
 *
 * 已知未尽项(陈述现状):
 *  - 常量为精简集(对齐 collect.js 采集的 KEYS),非真机全量 → proto own 键数与真机有差。
 *  - getContext('webgl') 复用 webgl2 同一张表(profile 仅采 webgl2),故 webgl1 的 VERSION 串会是 "WebGL 2.0…"。
 *  - getExtension 仅实现 WEBGL_debug_renderer_info;其余带方法的扩展返回 null —— 空方法壳调用即穿帮,宁可不给
 *    (代价:与 getSupportedExtensions 列表不一致,留作后续按需补真实扩展对象)。
 */

// 常量名→标准 enum 值(WebGL 规范定义,跨设备/版本恒定,host 无关;[实测]对齐 capture/collect.js 采集的 KEYS)。
const GL_CONSTANTS = {
  VERSION: 7938, SHADING_LANGUAGE_VERSION: 35724, VENDOR: 7936, RENDERER: 7937,
  MAX_TEXTURE_SIZE: 3379, MAX_VIEWPORT_DIMS: 3386, MAX_RENDERBUFFER_SIZE: 34024,
  MAX_VERTEX_ATTRIBS: 34921, MAX_VERTEX_UNIFORM_VECTORS: 36347, MAX_FRAGMENT_UNIFORM_VECTORS: 36349,
  MAX_VARYING_VECTORS: 36348, MAX_COMBINED_TEXTURE_IMAGE_UNITS: 35661, MAX_TEXTURE_IMAGE_UNITS: 34930,
  MAX_CUBE_MAP_TEXTURE_SIZE: 34076, ALIASED_LINE_WIDTH_RANGE: 33902, ALIASED_POINT_SIZE_RANGE: 33901,
};

// debug_renderer_info 扩展常量(住扩展对象原型,非 context 原型)。
const DEBUG_EXT_CONSTANTS = { UNMASKED_VENDOR_WEBGL: 37445, UNMASKED_RENDERER_WEBGL: 37446 };

// getParameter 返回 typed array 的 enum → 构造器名([实测];未列的返回标量/字符串原样)。
const TYPED_PARAM = { 3386: 'Int32Array', 33901: 'Float32Array', 33902: 'Float32Array' };

// getContextAttributes 默认值([实测,空 options]):真机返回普通 Object(constructor=Object)。
const CONTEXT_ATTRS = {
  alpha: true, antialias: true, depth: true, desynchronized: false, failIfMajorPerformanceCaveat: false,
  powerPreference: 'default', premultipliedAlpha: true, preserveDrawingBuffer: false, stencil: false, xrCompatible: false,
};

export default {
  name: 'webgl',
  after: [], // 同 canvas:hook 的 HTMLCanvasElement.prototype 来自 jsdom 底座,无真实依赖。原 ['document'] 悬空,已删。
  apply({ window, profile, mask }) {
    const wg = profile.section('webgl');
    if (!wg || !wg.parameters) return; // 未采 GPU → 不伪造,getContext 维持 null(同 jsdom 原样)
    const params = wg.parameters;       // { "<enum>": 标量|数组 },key 为字符串化 enum
    const extensions = wg.extensions || [];
    const TYPED_CTOR = { Int32Array: window.Int32Array, Float32Array: window.Float32Array, Uint32Array: window.Uint32Array };

    // 扩展对象 WEBGL_debug_renderer_info:Object.create(extProto),tag + 两常量住 extProto(→ window.Object.prototype)。
    const extProto = mask.tag(mask.adopt({}), 'WebGLDebugRendererInfo');
    for (const [name, val] of Object.entries(DEBUG_EXT_CONSTANTS)) {
      Object.defineProperty(extProto, name, { value: val, enumerable: true, writable: false, configurable: false });
    }
    const debugExt = Object.create(extProto);

    const ctxCanvas = new WeakMap(); // context 实例 → 关联 <canvas>(per-instance canvas/drawingBuffer* accessor)

    const setupProto = (proto) => {
      // 常量:真机形态 enumerable + 非 writable + 非 configurable。
      for (const [name, val] of Object.entries(GL_CONSTANTS)) {
        Object.defineProperty(proto, name, { value: val, enumerable: true, writable: false, configurable: false });
      }
      mask.methods(proto, {
        getParameter: [1, function getParameter(pname) {
          const v = params[pname];
          if (v === undefined) return null;
          if (Array.isArray(v)) return new (TYPED_CTOR[TYPED_PARAM[pname]] || window.Float32Array)(v); // window-realm typed array
          return v; // 字符串/数字 primitive,无 realm 之分
        }],
        getSupportedExtensions: [0, function getSupportedExtensions() { return mask.adopt(extensions.slice()); }],
        getExtension: [1, function getExtension(name) { return name === 'WEBGL_debug_renderer_info' ? debugExt : null; }],
        getContextAttributes: [0, function getContextAttributes() { return mask.adopt({ ...CONTEXT_ATTRS }); }],
      });
      // per-instance accessor:读 this 取关联 <canvas>(mask.instAccessor 的实例态 getter)。
      mask.instAccessors(proto, {
        canvas: function () { return ctxCanvas.get(this) || null; },
        drawingBufferWidth: function () { const c = ctxCanvas.get(this); return c ? c.width : 0; },
        drawingBufferHeight: function () { const c = ctxCanvas.get(this); return c ? c.height : 0; },
      });
    };

    const webgl1 = mask.iface('WebGLRenderingContext');
    const webgl2 = mask.iface('WebGL2RenderingContext');
    setupProto(webgl1.proto);
    setupProto(webgl2.proto);

    // getContext 接管:同一 canvas 同 type 返回同一 context(真机[实测]单例语义);webgl/webgl2 外 delegate(2d 等不动)。
    const cache1 = new WeakMap(); const cache2 = new WeakMap();
    const ctxFor = (canvas, reg, cache) => {
      let c = cache.get(canvas);
      if (!c) { c = reg.create({}); ctxCanvas.set(c, canvas); cache.set(canvas, c); }
      return c;
    };
    mask.hook(window.HTMLCanvasElement.prototype, 'getContext', (orig) => function getContext(type, attrs) {
      if (type === 'webgl2') return ctxFor(this, webgl2, cache2);
      if (type === 'webgl' || type === 'experimental-webgl') return ctxFor(this, webgl1, cache1);
      return orig.call(this, type, attrs);
    });
  },
};
