/**
 * patch/stack —— 清洗 error.stack 的执行环境泄漏(剥离 Node 宿主帧)。
 *
 * 现状[实测]:error.stack 暴露 node:vm / mimic ESM / jsdom 裸路径等宿主帧。
 * 修法:Error.prepareStackTrace 滤除非页面帧(http(s)/data/blob/about/空);
 * 用"页面来源白名单"而非枚举宿主形态(更鲁棒);filter 而非截断(保留"夹"着的两端页面帧)。
 *
 * 已知残留:prepareStackTrace 成 Error own property 是 tell;页面替换它可拿原始 CallSite。
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
      // 真机[实测].stack 首行剥 `Failed to construct '<Name>': ` 前缀(V8 行为),此处复刻。
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
