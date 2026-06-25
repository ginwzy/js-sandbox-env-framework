/**
 * patch/canvas.test.js —— Canvas 2D 壳 realm 自测(harness 不探 canvas,故此为其唯一回归门)。
 *   node patch/canvas.test.js
 * 跑一条真实 canvas 指纹链(getContext 2d → fillStyle/font/fillRect/fillText → measureText → getImageData →
 * toDataURL),验收**结构**(非指纹值,见 canvas.js"已知未尽项"):typeof/instanceof/toStringTag/方法 native/
 * 返回类型/单例/canvas 身份/new 抛 Illegal,并锁住 advisor 指出的盲点 —— 跨 patch getContext 组合:
 * canvas 与 webgl 两 hook 拓扑序未定,组合后 '2d'/'webgl'/'webgl2' 须皆可 resolve(各用独立 canvas,真机一
 * canvas 仅绑一种 context type)。
 */
import { Realm } from '../core/realm.js';

let pass = 0; let failed = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

const CODE = `(() => {
  const cv = document.createElement('canvas');
  cv.width = 220; cv.height = 30;
  const ctx = cv.getContext('2d');
  // 真实指纹链(属性赋值 + no-op 绘制,均不得抛)
  ctx.textBaseline = 'top'; ctx.font = "14px 'Arial'";
  ctx.fillStyle = '#f60'; ctx.fillRect(125, 1, 62, 20);
  ctx.fillStyle = '#069'; ctx.fillText('mimic', 2, 15);
  ctx.beginPath(); ctx.arc(50, 15, 10, 0, 7); ctx.fill();
  const m = ctx.measureText('mimic');
  const img = ctx.getImageData(0, 0, 5, 5);
  const grad = ctx.createLinearGradient(0, 0, 10, 0); grad.addColorStop(0, '#fff');
  // Path2D 路径(真机可构造;ctx.fill(path) 须不崩)
  const p = new Path2D(); p.moveTo(0, 0); p.lineTo(10, 10); p.arc(5, 5, 3, 0, 7); p.closePath();
  ctx.fill(p); ctx.stroke(p);
  const url = cv.toDataURL();
  // 跨 patch getContext 组合(独立 canvas,各绑一种 type)
  const cv2 = document.createElement('canvas');
  const cv3 = document.createElement('canvas');
  return {
    typeof_CRC2D: typeof CanvasRenderingContext2D,
    ctx_notNull: !!ctx,
    instanceof_ctx: ctx instanceof CanvasRenderingContext2D,
    tag_ctx: Object.prototype.toString.call(ctx),
    fillRect_native: ctx.fillRect.toString(),
    getContext_native: cv.getContext.toString(),
    m_isTextMetrics: m instanceof TextMetrics,
    m_width_isNumber: typeof m.width === 'number',
    img_isImageData: img instanceof ImageData,
    img_data_isU8C: img.data instanceof Uint8ClampedArray,
    img_data_len: img.data.length,
    img_w: img.width, img_h: img.height,
    grad_isGradient: grad instanceof CanvasGradient,
    typeof_Path2D: typeof Path2D,
    p_isPath2D: p instanceof Path2D,
    url_isString: typeof url === 'string',
    url_isPng: url.slice(0, 14),
    url_webp: cv.toDataURL('image/webp').slice(0, 15),       // 真机据 type 返对应前缀
    url_jpeg: cv.toDataURL('image/jpeg').slice(0, 15),
    url_gif_fallback: cv.toDataURL('image/gif').slice(0, 14), // 不支持 type 真机回退 png
    ctx_canvas_identity: ctx.canvas === cv,
    singleton: ctx === cv.getContext('2d'),
    has_global_CRC2D: typeof CanvasRenderingContext2D === 'function',
    new_throws: (() => { try { new CanvasRenderingContext2D(); return false; } catch (e) { return e instanceof TypeError; } })(),
    // 构造器错误文本:真机 .message 带 "Failed to construct '<Name>': " 前缀,.stack 首行剥该前缀(message≠stack-head)
    crc2d_msg: (() => { try { new CanvasRenderingContext2D(); return ''; } catch (e) { return e.message; } })(),
    crc2d_stack_hasPrefix: (() => { try { new CanvasRenderingContext2D(); return null; } catch (e) { return e.stack.indexOf('Failed to construct') !== -1; } })(),
    path2d_msg: (() => { try { Path2D(); return ''; } catch (e) { return e.message; } })(),
    // 方法 arity(fn.length)—— 检测器可逐项扫 prototype 比对真机;native-toString 不暴露形参数,故须独立验。
    // 真机 Chrome [实测]值,重点锁曾手填错的 setTransform/roundRect/fillText/strokeText/createImageData。
    ar_setTransform: ctx.setTransform.length, ar_roundRect: ctx.roundRect.length,
    ar_fillText: ctx.fillText.length, ar_strokeText: ctx.strokeText.length,
    ar_createImageData: ctx.createImageData.length, ar_getImageData: ctx.getImageData.length,
    ar_arc: ctx.arc.length, ar_measureText: ctx.measureText.length,
    ar_path_roundRect: Path2D.prototype.roundRect.length, ar_path_arc: p.arc.length,
    // 标准 CRC2D 方法(缺则调用即崩):须存在且不抛
    gca_keys: (() => { try { return Object.keys(ctx.getContextAttributes()).join(','); } catch (e) { return 'THREW:' + e; } })(),
    gca_alpha: (() => { try { return ctx.getContextAttributes().alpha; } catch { return 'THREW'; } })(),
    gt_a: (() => { try { return ctx.getTransform().a; } catch { return 'THREW'; } })(),
    gt_tag: (() => { try { return Object.prototype.toString.call(ctx.getTransform()); } catch { return 'THREW'; } })(),
    isLost: (() => { try { return ctx.isContextLost(); } catch { return 'THREW'; } })(),
    reset_ok: (() => { try { ctx.reset(); return true; } catch { return false; } })(),
    // 接口原型 own 键序:真机 WebIDL constructor 恒末位(getOwnPropertyNames[0]==='constructor' 即穿)
    ctorlast_crc2d: (() => { const k = Object.getOwnPropertyNames(CanvasRenderingContext2D.prototype); return k[k.length - 1] === 'constructor' && k[0] !== 'constructor'; })(),
    ctorlast_path2d: (() => { const k = Object.getOwnPropertyNames(Path2D.prototype); return k[k.length - 1] === 'constructor' && k[0] !== 'constructor'; })(),
    combo_2d: !!cv2.getContext('2d'),
    combo_webgl2: !!cv3.getContext('webgl2'),
    combo_webgl1: !!document.createElement('canvas').getContext('webgl'),
  };
})()`;

// 用含 webgl 段的 profile,使组合测试中 webgl/webgl2 真正装配(webgl patch 门控:无 GPU 数据则不装)。
const realm = await Realm.create({ profile: 'macos-chrome-v148' });
const r = realm.run(CODE);
if (!r.ok) { ok('realm 执行成功', false); console.log(`    ${r.error}`); realm.dispose(); process.exit(1); }
const v = r.value;
console.log('\n[canvas 2d 壳]');
ok('typeof CanvasRenderingContext2D === function', v.typeof_CRC2D === 'function');
ok('getContext("2d") 非 null(真机绝不为 null)', v.ctx_notNull === true);
ok('ctx instanceof CanvasRenderingContext2D', v.instanceof_ctx === true);
ok('tag [object CanvasRenderingContext2D]', v.tag_ctx === '[object CanvasRenderingContext2D]');
ok('fillRect toString 为 native', v.fillRect_native === 'function fillRect() { [native code] }');
ok('getContext toString 为 native', v.getContext_native === 'function getContext() { [native code] }');
ok('measureText → TextMetrics 实例', v.m_isTextMetrics === true);
ok('TextMetrics.width 是 number', v.m_width_isNumber === true);
ok('getImageData → ImageData 实例', v.img_isImageData === true);
ok('ImageData.data instanceof window.Uint8ClampedArray', v.img_data_isU8C === true);
ok('ImageData.data.length = w*h*4 (5*5*4=100)', v.img_data_len === 100);
ok('ImageData width/height = 5/5', v.img_w === 5 && v.img_h === 5);
ok('createLinearGradient → CanvasGradient 实例', v.grad_isGradient === true);
ok('typeof Path2D === function(真机可构造)', v.typeof_Path2D === 'function');
ok('new Path2D() → instanceof Path2D + ctx.fill(path) 不崩', v.p_isPath2D === true);
ok('toDataURL 返回 string', v.url_isString === true);
ok('toDataURL 返回 data:image/png 串(真机绝不为 null)', v.url_isPng === 'data:image/png');
ok('toDataURL("image/webp") 前缀 data:image/webp(自洽契约,非恒 png)', v.url_webp === 'data:image/webp');
ok('toDataURL("image/jpeg") 前缀 data:image/jpeg', v.url_jpeg === 'data:image/jpeg');
ok('toDataURL("image/gif") 不支持 → 回退 data:image/png(真机行为)', v.url_gif_fallback === 'data:image/png');
ok('new CanvasRenderingContext2D() 抛 window-realm TypeError(跨 realm 契约)', v.new_throws === true);
ok('CRC2D 构造 .message 带前缀(真机形态)', v.crc2d_msg === "Failed to construct 'CanvasRenderingContext2D': Illegal constructor");
ok('CRC2D 构造 .stack 首行**不含**前缀(message≠stack-head 分叉)', v.crc2d_stack_hasPrefix === false);
ok('Path2D() 当函数调 .message 含完整尾句', v.path2d_msg === "Failed to construct 'Path2D': Please use the 'new' operator, this DOM object constructor cannot be called as a function.");
ok('ctx.canvas === 创建它的 canvas', v.ctx_canvas_identity === true);
ok('同 canvas getContext("2d") 单例', v.singleton === true);
ok('有 window.CanvasRenderingContext2D 全局', v.has_global_CRC2D === true);
console.log('\n[方法 arity — 真机实测值,锁 .length 回归门]');
ok('setTransform.length=0(重载空签名;曾误填 6)', v.ar_setTransform === 0);
ok('roundRect.length=4(radii 可选;曾误填 3)', v.ar_roundRect === 4);
ok('fillText.length=3(maxWidth 可选;曾误填 2)', v.ar_fillText === 3);
ok('strokeText.length=3(maxWidth 可选;曾误填 2)', v.ar_strokeText === 3);
ok('createImageData.length=1(最短重载 imagedata;曾误填 2)', v.ar_createImageData === 1);
ok('getImageData.length=4', v.ar_getImageData === 4);
ok('arc.length=5', v.ar_arc === 5);
ok('measureText.length=1', v.ar_measureText === 1);
ok('Path2D.prototype.roundRect.length=4(第二现场;曾误填 3)', v.ar_path_roundRect === 4);
ok('Path2D.prototype.arc.length=5', v.ar_path_arc === 5);
console.log('\n[标准 CRC2D 方法 — 缺则调用即崩]');
ok('getContextAttributes() 不抛 + 经典 4 键', v.gca_keys === 'alpha,colorSpace,desynchronized,willReadFrequently');
ok('getContextAttributes().alpha === true', v.gca_alpha === true);
ok('getTransform() 不抛 + .a === 1(identity)', v.gt_a === 1);
ok('getTransform() tag [object DOMMatrix]', v.gt_tag === '[object DOMMatrix]');
ok('isContextLost() === false(不抛)', v.isLost === false);
ok('reset() 不抛', v.reset_ok === true);
ok('CRC2D.prototype own 键 constructor 在末位(真机 WebIDL 序)', v.ctorlast_crc2d === true);
ok('Path2D.prototype own 键 constructor 在末位', v.ctorlast_path2d === true);
console.log('\n[跨 patch getContext 组合]');
ok('canvas+webgl 组合后 getContext("2d") 仍 resolve', v.combo_2d === true);
ok('canvas+webgl 组合后 getContext("webgl2") 仍 resolve', v.combo_webgl2 === true);
ok('canvas+webgl 组合后 getContext("webgl") 仍 resolve', v.combo_webgl1 === true);
realm.dispose();

console.log(`\ncanvas 2d 壳自测:${pass} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
