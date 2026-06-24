/**
 * patch/canvas —— Canvas 2D 指纹。
 * 对照 sdenv: 依赖原生 canvas 包做真实渲染;profile.canvas 提供 toDataURL 基线。
 * 当前为 stub,尚未实现:接 node canvas 或回放 profile.canvas.toDataURL,mask.fn 包裹 toDataURL/getImageData。
 */
export default {
  name: 'canvas',
  after: ['document'],
  apply(/* { window, profile, mask } */) {
    // stub
  },
};
