/**
 * patch/canvas —— Canvas 2D 指纹壳。
 *
 * 根因:jsdom 无 canvas 包 → getContext('2d') 返回 null(真机绝不发生,缺壳即 tell/崩)。
 * 范围:指纹脚本触及的不崩调用链:getContext('2d') → 绘制(no-op) → measureText/toDataURL/getImageData。
 * 四个接口经 mask.iface 注册(instanceof 成立);getContext 单例语义(真机[实测])。
 *
 * 已知未尽项:toDataURL/getImageData/measureText 返结构有效占位(非真机渲染值,跨实例相同);
 * context 属性/ImageData 字段落实例 own(真机为 prototype accessor);toBlob/OffscreenCanvas 留长期。
 */

// 1x1 空白占位 data URL,按请求 type 自洽(真机[实测]);未命中 type 回退 png。
const PLACEHOLDER = {
  'image/png':
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWJiYGBgAAAAAP//XRcpzQAAAAZJREFUAwAADwADJDd96QAAAABJRU5ErkJggg==',
  'image/jpeg':
    'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZ/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJVAA//Z',
  'image/webp':
    'data:image/webp;base64,UklGRhACAABXRUJQVlA4WAoAAAAwAAAAAAAAAAAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZBTFBIAgAAAAAAVlA4IBgAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v02aAA=',
};
const placeholderFor = (type) => PLACEHOLDER[String(type || '').toLowerCase()] || PLACEHOLDER['image/png'];

// CRC2D.prototype 高频方法 → arity(no-op)。arity 为真机[实测]值(WebIDL .length=最少必填,重载方法反直觉)。
const NOOP_METHODS = {
  save: 0, restore: 0, scale: 2, rotate: 1, translate: 2, transform: 6, setTransform: 0, resetTransform: 0,
  clearRect: 4, fillRect: 4, strokeRect: 4,
  beginPath: 0, closePath: 0, moveTo: 2, lineTo: 2, bezierCurveTo: 6, quadraticCurveTo: 4,
  arc: 5, arcTo: 5, ellipse: 7, rect: 4, roundRect: 4,
  fill: 0, stroke: 0, clip: 0,
  fillText: 3, strokeText: 3,
  setLineDash: 1, drawImage: 3, putImageData: 3,
};

export default {
  name: 'canvas',
  after: [],
  apply({ window, mask }) {
    // 接口壳(真机全局构造器 → mask.iface)。
    const crc2d = mask.iface('CanvasRenderingContext2D');
    const textMetrics = mask.iface('TextMetrics');
    const imageData = mask.iface('ImageData');
    const gradient = mask.iface('CanvasGradient');

    // Path2D:真机可构造(缺失则 new Path2D() 即崩)。
    mask.ctorIface('Path2D', 0, null, {
      methods: {
        addPath: [1, function addPath() {}], moveTo: [2, function moveTo() {}], lineTo: [2, function lineTo() {}],
        bezierCurveTo: [6, function bezierCurveTo() {}], quadraticCurveTo: [4, function quadraticCurveTo() {}],
        arc: [5, function arc() {}], arcTo: [5, function arcTo() {}], ellipse: [7, function ellipse() {}],
        rect: [4, function rect() {}], roundRect: [4, function roundRect() {}], closePath: [0, function closePath() {}],
      },
    });

    const WUint8Clamped = window.Uint8ClampedArray;

    // CanvasGradient:createLinearGradient 等返回;addColorStop no-op。
    mask.methods(gradient.proto, { addColorStop: [2, function addColorStop() {}] });

    // TextMetrics 实例:measureText 返回,度量为占位值。
    const makeMetrics = (text) => {
      const m = textMetrics.create();
      const w = String(text == null ? '' : text).length * 7; // 占位度量:确定但非真机
      const metrics = {
        width: w, actualBoundingBoxLeft: 0, actualBoundingBoxRight: w,
        actualBoundingBoxAscent: 10, actualBoundingBoxDescent: 2,
        fontBoundingBoxAscent: 11, fontBoundingBoxDescent: 3,
        emHeightAscent: 11, emHeightDescent: 3,
        hangingBaseline: 9, alphabeticBaseline: 0, ideographicBaseline: -3,
      };
      for (const [k, v] of Object.entries(metrics)) {
        Object.defineProperty(m, k, { value: v, enumerable: true, configurable: true });
      }
      return m;
    };

    // ImageData 实例:getImageData/createImageData 返回;.data 为 window-realm Uint8ClampedArray(全 0)。
    const makeImageData = (w, h) => {
      const d = imageData.create();
      const px = Math.max(0, (w | 0) * (h | 0));
      Object.defineProperty(d, 'data', { value: new WUint8Clamped(px * 4), enumerable: true, configurable: false });
      Object.defineProperty(d, 'width', { value: w | 0, enumerable: true, configurable: false });
      Object.defineProperty(d, 'height', { value: h | 0, enumerable: true, configurable: false });
      Object.defineProperty(d, 'colorSpace', { value: 'srgb', enumerable: true, configurable: false });
      return d;
    };

    // getTransform:identity DOMMatrix 结构占位(realm 暂无 DOMMatrix 全局,值/原型链不保真,但不崩)。
    const makeIdentityMatrix = () => mask.adopt(mask.tag({
      a: 1, b: 0, c: 0, d: 1, e: 0, f: 0,
      m11: 1, m12: 0, m13: 0, m14: 0, m21: 0, m22: 1, m23: 0, m24: 0,
      m31: 0, m32: 0, m33: 1, m34: 0, m41: 0, m42: 0, m43: 0, m44: 1,
      is2D: true, isIdentity: true,
    }, 'DOMMatrix'));

    // CRC2D.prototype 方法集:no-op 几何/绘制 + 工厂方法。
    const methods = {};
    for (const [n, len] of Object.entries(NOOP_METHODS)) methods[n] = [len, function () {}];
    Object.assign(methods, {
      measureText: [1, function measureText(text) { return makeMetrics(text); }],
      getImageData: [4, function getImageData(sx, sy, sw, sh) { return makeImageData(sw, sh); }],
      createImageData: [1, function createImageData(w, h) { return makeImageData(w, h); }],
      createLinearGradient: [4, function createLinearGradient() { return gradient.create(); }],
      createRadialGradient: [6, function createRadialGradient() { return gradient.create(); }],
      createConicGradient: [3, function createConicGradient() { return gradient.create(); }],
      isPointInPath: [2, function isPointInPath() { return false; }],
      isPointInStroke: [2, function isPointInStroke() { return false; }],
      getLineDash: [0, function getLineDash() { return mask.adopt([]); }],
      // getContextAttributes 返回真机[实测]默认属性;getTransform→identity 占位;reset no-op;isContextLost 恒 false。
      getContextAttributes: [0, function getContextAttributes() {
        return mask.adopt({ alpha: true, colorSpace: 'srgb', desynchronized: false, willReadFrequently: false });
      }],
      getTransform: [0, function getTransform() { return makeIdentityMatrix(); }],
      reset: [0, function reset() {}],
      isContextLost: [0, function isContextLost() { return false; }],
    });
    mask.methods(crc2d.proto, methods);

    const ctxCanvas = new WeakMap(); // 2d context → 关联 <canvas>
    mask.instAccessor(crc2d.proto, 'canvas', function () { return ctxCanvas.get(this) || null; });

    // getContext 接管:'2d' 返回单例 context;非 '2d' delegate(多 patch 共 hook getContext,须互相 delegate)。
    const cache = new WeakMap();
    const ctxFor = (canvas) => {
      let c = cache.get(canvas);
      if (!c) { c = crc2d.create({}); ctxCanvas.set(c, canvas); cache.set(canvas, c); }
      return c;
    };
    mask.hook(window.HTMLCanvasElement.prototype, 'getContext', (orig) => function getContext(type, attrs) {
      if (type === '2d') return ctxFor(this);
      return orig.call(this, type, attrs);
    });

    // toDataURL:jsdom 返回 null(真机绝不为 null)→ 按请求 type 返自洽占位串(复刻 type→MIME 映射)。
    mask.hook(window.HTMLCanvasElement.prototype, 'toDataURL', () => function toDataURL(type) { return placeholderFor(type); });
  },
};
