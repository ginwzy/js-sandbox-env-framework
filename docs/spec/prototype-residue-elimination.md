# .prototype 残留清除:经验验证与实现方案

## 背景

jsdom 把若干 window helper(atob/btoa/setTimeout 等)和 DOM XPath 方法实现为普通 function
declaration,导致这些函数在 native 化(mask.wrap)后仍残留 `.prototype` own property。
真实 Chrome 的 native 方法无 own `.prototype`。另一类残留来自 mask.mixin 用 `fn(function
() {...})` 造的 getter —— 普通函数有 `.prototype`,箭头函数没有。

## 现状[实测] — 基于 android-webview-v138 基线

```
GATE: FAIL — 48 个阻断项
  mixin getter 侧   32 条 (accessor.get.hasPrototype + accessor.get.ownNames) — 未白名单
  方法侧(jsdom fn) ~50 条 (fn.hasPrototype + fn.ownNames)                  — 已白名单
  XPath 方法        6 条  (fn.ownNames 含 arguments,caller,prototype)        — 已白名单
  其他阻断          ~10条  (ownKeys.order / window.print / Document.constructor 等)
```

## 两类残留的根因与可修性

### 类型 A:mixin getter 侧(可真修)

`mask.mixin` 内部用 `fn(function () { return adopt(getValue()); }, ...)` 造 getter。
普通函数有 `.prototype` own 属性;箭头函数没有。

**关键约束[实测]**:所有 mixin getValue 闭包均不使用 `this`(仅读闭包变量 p/nav/conn),
替换为箭头函数不破坏任何调用语义。

修法:`mask.mixin` 中把 getter 造法改为箭头函数:
```js
const get = dropOwnToString(fn(() => adopt(getValue()), `get ${key}`));
```
`fn()` 对箭头函数调用 `Object.setPrototypeOf(func, WFunctionProto)` 无副作用;
`dropOwnToString` 保持不变。修后:
- `'prototype' in getter` → false ✓
- `Object.getOwnPropertyNames(getter)` → `["length","name"]` ✓
- 预期消除:16 × `accessor.get.hasPrototype` + 16 × `accessor.get.ownNames` = 32 条阻断

### 类型 B:方法侧 jsdom function declaration(当前无法静默删除)

`atob`/`setTimeout` 等在 window 上的描述符 configurable:true —— 可以**替换**整个函数对象。
替换方案:concise-method forwarder(无 `.prototype`、无 `arguments`/`caller`):

```js
function makeFwd(orig, name, len) {
  const m = { [name](...args) { return orig.apply(this, args); } }[name];
  if (typeof len === 'number')
    Object.defineProperty(m, 'length', { value: len, configurable: true });
  return m;
}
```

**经验验证[实测]**:
- `'prototype' in fwd` → false ✓
- `Object.getOwnPropertyNames(fwd)` → `["length","name"]` ✓
- `fwd('aGVsbG8=')` → `"hello"` (this=undefined 亦正常) ✓
- `setTimeout(() => {}, 0)` via forwarder → 返回 timer id ✓
- `getComputedStyle(body)` via forwarder (this=undefined) → object ✓
- 替换 window.atob 后 `'prototype' in window.atob` → false ✓
- 顺带消除 `arguments,caller` 残留(concise method 是严格模式)

**安全边界 — VESTIGIAL prototype 不能作通用识别启发式**:
sweep 扫到的 65 个 VESTIGIAL 函数(prototype 只有 constructor)中,既有 `atob`/`setTimeout`
这类 helper,也有 `HTMLSpanElement`/`Location`/`Window`/`Audio`/`XMLDocument` 等真构造器。
真构造器在真机本就有 `.prototype`(非 tell),且 forwarder 会破坏 `new`。
因此方法侧替换必须用**有界已知集**,不能在 sweepOwn 里做通用判定。

当前 probe 目标集里的方法侧候选(需确认哪些在白名单内):
- window 上的 helper 函数(atob/btoa/setTimeout/setInterval/clearTimeout/clearInterval/
  alert/blur/close/confirm/focus/open/postMessage/print/prompt/queueMicrotask/
  getComputedStyle/getSelection/moveBy/moveTo/resizeBy/resizeTo/scroll/scrollBy/scrollTo/
  captureEvents/stop/requestAnimationFrame/cancelAnimationFrame 等)
- Document.prototype 的 evaluate/createExpression/createNSResolver

这些目前已被白名单覆盖。真修它们收益(减少白名单条目,让 gate 在不依赖白名单前提下通过)与
成本(在 sweepOwn 外维护一份有界集)需评估后决定是否推进。

## 实现顺序建议

1. **优先**:`mask.mixin` 一行改箭头,消除 32 条未白名单阻断 —— 改动极小、零风险。
2. **可选**:方法侧有界集替换 —— 效果是把白名单条目变为 gate 真通过,提高防伪装质量;
   代价是维护一份 helper 函数名单(或扩展 sweepOwn 识别逻辑)。
3. 若做方法侧,白名单对应条目同步删除(yvq.11 的两条 fn.hasPrototype / fn.ownNames 规则)。

## 已排除方案

- **通过 `delete func.prototype` 删除**:`delete` 对 non-configurable descriptor 无效,
  jsdom function declaration 的 prototype 描述符为 non-configurable,delete 静默失败。
- **赋值 `func.prototype = undefined`**:只改值,`'prototype' in func` 和 getOwnPropertyNames
  仍暴露该 key。
- **VESTIGIAL 启发式通用替换**:误伤真构造器(见上)。
