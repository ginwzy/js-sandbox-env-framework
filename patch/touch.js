/**
 * patch/touch —— 触摸形态特有(移动端 / 触屏)。
 * 门控:仅 formFactor=mobile 生效。
 * 当前仅置 window.orientation;TouchEvent / Touch / TouchList 构造器族尚未实现。
 */
export default {
  name: 'touch',
  applies: (t) => t.formFactor === 'mobile',
  apply({ window }) {
    // window.orientation: 移动端特有(已废弃但仍存在),桌面无此属性 —— 比 ontouchstart 更可靠
    // (ontouchstart 在桌面 Chrome 也存在)。
    if (window.orientation === undefined) window.orientation = 0;
  },
};
