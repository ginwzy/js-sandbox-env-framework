/**
 * patch/stack —— 清洗 error.stack 的执行环境泄漏(剥离 Node 宿主帧)。
 *
 * 现状[实测]:脚本经 vm.runInContext(见 core/realm)执行后,error.stack 在栈底/栈中暴露三种形态的宿主帧 ——
 * `node:vm`(Node 内置)、`file:///.../core/realm.js`(mimic ESM)、jsdom 安装路径裸绝对路径(异步/事件回调,
 * 如 `at Timeout.task [as _onTimeout] (/.../jsdom/.../Window.js)`)。真机里页面脚本由事件循环独立 task 调度,
 * C++ 宿主帧不进 JS stack;vmp 常检测 stack 是否含路径/node: 或非页面帧。
 *
 * 执行路径(core/realm 的 filename=页面URL)已消除"页面帧"侧泄漏;本 patch 处理"宿主帧"侧:装
 * Error.prepareStackTrace —— V8 首次格式化 .stack 时传入结构化 CallSite[],滤除非页面帧、其余复用
 * CallSite.toString()(即 V8 原生 Chrome 帧格式,自动覆盖具名/匿名/构造器/eval/async,零格式偏差)。
 *
 * 判据用"页面来源白名单"而非枚举宿主形态:页面帧 fileName 必为 http(s)/data/blob/about 开头或为空(page 内
 * eval/匿名);其余(node:、file://、jsdom 裸路径、未来任何新形态)一律判宿主帧 —— 比"枚举前缀"鲁棒,异步回调
 * 的 jsdom 裸路径正是前缀法漏掉的。用 filter 而非遇宿主帧截断:page→jsdom 派发→回调 page 时栈中会"夹"宿主帧
 * (真机该位置是不显示的 C++ native 帧),删全部宿主帧、保留两端页面帧最贴真机。
 *
 * 已知残留(刻意推迟):① 'prepareStackTrace' 成 Error 可见 own property(真机为 undefined 且非 own)是 tell;
 * ② 页面若替换 Error.prepareStackTrace 可拿到含宿主帧的原始 CallSite。本 patch 先把字符串层 .stack 做干净,
 * 并把 prepareStackTrace 自身 native 化,避免其 toString() 直接泄漏 mimic 源码。
 */
export default {
  name: 'stack',
  after: [],
  apply({ window, mask }) {
    // 页面来源:http(s)/data/blob/about 协议,或空 fileName(page 内 eval/匿名帧)。其余皆宿主帧。
    const isPageFrame = (file) => !file || /^(?:https?|data|blob|about):/.test(file);

    const prepareStackTrace = mask.fn(function prepareStackTrace(error, frames) {
      const name = (error && error.name) || 'Error';
      const message = error && error.message;
      // 构造器 binding 错误:真机[实测].message 带 `Failed to construct '<Name>': ` 前缀,但 .stack 首行**剥**该前缀
      // (V8 在 throw 时用短串建栈、.message 另设为长串 → message≠stack-head)。JS 层 throw new TypeError(s) 无法
      // 天然制造该分叉(stack 首行恒 ==`name: ${s}`),故在重建 .stack 时剥前缀复刻 —— 只命中构造器错,不误伤普通错。
      const core = message ? message.replace(/^Failed to construct '[^']*': /, '') : message;
      const head = core ? `${name}: ${core}` : name;
      const lines = [];
      for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];
        let file;
        try {
          file = frame.getFileName();
        } catch {
          file = '';
        }
        if (!isPageFrame(file)) continue; // 宿主帧:对应真机的 native 帧,不显示
        lines.push(`    at ${frame.toString()}`); // V8 原生 Chrome 帧格式
      }
      return lines.length ? `${head}\n${lines.join('\n')}` : head;
    }, 'prepareStackTrace', 2);

    window.Error.prepareStackTrace = prepareStackTrace;
  },
};
