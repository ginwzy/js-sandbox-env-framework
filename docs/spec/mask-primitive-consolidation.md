# mask 原语补全与 patch 层去冗余:分析与实现方案

## 核心论点

`patch/` 的分层(数据层 / 形状层 / 机制层)和声明式表驱动(navigator/globals)是清晰的。
当前的冗余与混乱**几乎全部来自一个根因:`mask` 缺了几个本该提供的原语**,于是多个 patch 各自
重造同一形状的代码。重造时出现了**漂移**——同一件事在不同文件里实现不一致,甚至漏了关键步骤,
由此引入两处真实缺陷。

修法不是在 patch 里"少写点",而是**把这些复现形状收敛成 mask 原语**(与现有 `iface`/`singleton`/
`accessor`/`method` 同级),patch 改为调用。这同时:① 消重复;② 把"易漂移的微妙判定"集中到一处
(与当初导出 `dropOwnToString`、收敛 `native` 同理);③ 顺带修掉下面坐实的两个 bug。

## 现状[实测] — 重复普查

| 复现形状 | 出现位置 | mask 是否已有原语 |
|---|---|---|
| 可构造接口壳(真机可 new) | `audio.js:31`、`canvas.js:64`、`globals.js:75`、`performance.js:135` | ❌ 仅有 illegal 版 `iface` |
| 读 `this` 的 per-instance native getter | `audio.js:46`(用 ~20 次)、`canvas.js:150`、`webgl.js:82` | ❌ `accessor` 是箭头闭包版 |
| 可写 `on*` 事件处理器访问器 | `navigator.js:195`、`screen.js:27`(逐字相同) | ❌ |
| 接口继承 EventTarget | 3 套并存做法(见 B4) | 半个(`singleton({parent})`) |
| `getContext` hook | `canvas.js:162` + `webgl.js:100`(双 hook 隐式协调) | ❌ |

---

## A. mask 原语补全(纯提炼,行为不变,且修两个 bug)

### A1. `mask.ctorIface` —— 可构造接口壳(与 `iface` 对称)

**现状[实测]**:真机**可 new** 的接口(`OfflineAudioContext`/`AudioContext`/`AudioBuffer`/`Path2D`/
`Worker`/`RTCPeerConnection`/`Notification`/`PerformanceObserver` 等)无原语支撑——`mask.iface` 只覆盖
"new 即抛 Illegal constructor"那一类。于是 4 处各写一遍"native ctor(无 new 抛错)+ proto + constructor
+ 注册 window + markCtorProto",且实现分叉:

| 位置 | `markCtorProto` | 无-new TypeError 文案 |
|---|---|---|
| `audio.js:31` `ctorIface` | ✅ | 完整句 `…Please use the 'new' operator, this DOM object constructor cannot be called as a function.` |
| `canvas.js:64` `Path2D`(内联) | ✅ | 完整句 |
| `globals.js:75` `makeCtor` | ❌ **缺** | 完整句 |
| `performance.js:135` `PerformanceObserver`(内联) | ❌ **缺** | **短句** `…Please use the 'new' operator.` |

一个坐实的缺陷 + 一处潜在脆弱性:

- **缺陷(message 文案不一致)[实测]**:`performance` 的无-new 文案是短句
  `…Please use the 'new' operator.`,其余三处是完整句 `…Please use the 'new' operator, this DOM
  object constructor cannot be called as a function.`。真机对"可构造接口被无 new 调用"返回的是完整句;
  短句逐字比对即偏离。实测确证(同 realm 内 `OfflineAudioContext()` vs `PerformanceObserver()` 抛出的
  message 不同)。统一原语后所有壳共用完整句。
- **潜在脆弱性(键序,当前被插入序掩盖)**:`globals.makeCtor` 与 `performance.PerformanceObserver`
  漏调 `markCtorProto`。项目不变量([实测],`mask/index.js` 头注 + `finalizeIfaces` @ `core/pipeline.js:50`)
  是真机 WebIDL 接口原型 `constructor` 在 own 字符串键**末位**,`getOwnPropertyNames(proto)[0] ===
  'constructor'` 即穿。**实测当前这两处 `constructor` 仍在末位**——因为它们在装完 methods **之后**才
  `defineProperty('constructor')`,插入序恰好让它落尾。即当前并非活 tell,但它**靠书写顺序的巧合维持、
  未走 `markCtorProto`/`finalizeIfaces` 保障**:一旦有人把 constructor 挪到方法前(如对齐 `iface`/audio
  的写法),会静默回到首位成 tell。统一原语后所有壳都经 `markCtorProto`,键序不再依赖书写顺序。

**API**:
```js
// 与 iface 返回同形:{ ctor, proto, create }
mask.ctorIface(name, len, init?, opts?)
//   init(self, args)  —— new 时初始化实例私有状态(可读 args 做参数校验并抛错,覆盖 PerformanceObserver)
//   opts = { parent?, methods?, accessors?, statics? }  —— 覆盖 globals.makeCtor 的 EventTarget 父原型/静态成员需求
```
**实现要点**(收敛 `iface` 已有逻辑,仅把"new 即抛"换成"无 new 才抛"):
```js
function ctorIface(name, len, init, opts = {}) {
  const ctor = native(function (...args) {
    if (!new.target) {
      throw new window.TypeError(`Failed to construct '${name}': `
        + `Please use the 'new' operator, this DOM object constructor cannot be called as a function.`);
    }
    if (init) init(this, args);
  }, name, len);
  const proto = adopt(tag({ ...(opts.props || {}) }, name));
  if (opts.parent) Object.setPrototypeOf(proto, opts.parent);
  ctor.prototype = proto;
  Object.defineProperty(proto, 'constructor', { value: ctor, configurable: true, enumerable: false });
  if (opts.methods) methods(proto, opts.methods);
  if (opts.accessors) accessors(proto, opts.accessors);
  if (opts.statics) methods(ctor, opts.statics);
  Object.defineProperty(window, name, { value: ctor, writable: true, configurable: true, enumerable: false });
  markCtorProto(proto);                       // ← 统一补上,缺陷 1 一次清掉
  const create = (extra = {}) => Object.assign(Object.create(proto), extra);
  return { ctor, proto, create };
}
```
**影响**:删 `audio.ctorIface`/`canvas` 内联壳/`globals.makeCtor`/`performance` 内联壳(约 40 行样板);
四处统一完整文案(修上述缺陷)+ 统一经 `markCtorProto`(把键序从"靠书写顺序"变为"原语保障")。`mask`
至此对称地拥有两种构造语义:`iface`(illegal)/ `ctorIface`(constructible)。

### A2. `mask.instAccessor` / `instAccessors` —— 读 `this` 的 per-instance native getter

**现状[实测]**:实例态 getter(经 WeakMap 取实例私有状态)需读 `this`,但 `mask.accessor` 用箭头
`() => adopt(getValue())`(为闭包标量设计,读不了 `this`)。于是三处各造:`audio.js:46` 的 `instGetter`
(本文件用约 20 次)、`canvas.js:150` 内联、`webgl.js:82` 的 `define`。三者本体一致:
```js
Object.defineProperty(proto, name, { get: mask.native(getterFn, `get ${name}`), enumerable: true, configurable: true });
```
与 `accessor` 的差异有二:① getter 是普通函数(读 `this`),② **不自动 adopt**(返回值多为 primitive
或已是 window 身份的对象;现三处实现均不 adopt)。

**API**:
```js
mask.instAccessor(target, name, getter)      // getter 为普通函数,以 this=实例 调用;不自动 adopt
mask.instAccessors(target, { name: getter })  // 批量(audio 的 ~20 个 getter 一表搞定)
```
**影响**:删三个本地 helper,audio 的约 20 处定义收成一两张表。命名与既有 `accessor`/`accessors`
家族对齐(`inst` 前缀标"读 this 的实例态")。

### A3. `mask.eventHandler` —— 可写 `on*` 事件处理器访问器

**现状[实测]**:`navigator.js:195`(`connection.onchange`)与 `screen.js:27`(`orientation.onchange`)
逐字相同的 6 行,连理由注释都一样("get-only 会令 strict 模式赋值抛;改 data 属性又会造实例 own 键
破坏空实例不变量"):
```js
let onchange = null;
Object.defineProperty(proto, 'onchange', {
  get: mask.native(() => onchange, 'get onchange', 0),
  set: mask.native((v) => { onchange = v; }, 'set onchange', 1),
  enumerable: true, configurable: true,
});
```
**API**:
```js
mask.eventHandler(target, name)   // 装可写 on* 访问器,闭包存 handler,实例不留 own 键
```
**附带澄清的不一致(非本原语强制,但建议跟进)**:其余 `on*` 处理器多以**实例 data 属性**实现
(`navigator.ifaceTable` 的 `props:{ oncontrollerchange:null, … }`、`globals.makeCtor` 的
`init: self => { self.onmessage = null; … }`),真机是**原型可写 accessor**。connection/orientation
用的是高保真做法,其余是已知缺口(实例 own `onX` 键本身也偏离真机的"空实例")。有了 `eventHandler`
后,这些可逐步迁移到原型 accessor;迁移与否单列,不阻塞本原语。

---

## B. 结构性混乱(中等优先,涉及语义需小心)

### B4. EventTarget 有 3 套并存做法 + brandless 集靠手工同步 ⚠️

**现状[实测]**:"接口应继承 EventTarget"目前有三种实现:
- **(a) 插 ETP 层 + brandless 短路**:`protochain.js` 把 `Screen`/`NetworkInformation`.prototype 接到
  `window.EventTarget.prototype`,`eventtarget.js` 在 ETP 三方法上对 brandless 实例做 short-circuit
  (screen/connection/orientation)。
- **(b) 自维护 listener map**:`audio.js:58` `installEventTarget`,刻意不接 jsdom ETP(context 有其
  特殊的事件派发需求)。
- **(c) `parent=ET` 建壳**:`globals.makeCtor`(Worker/RTCPeerConnection/Notification)、`globals` 的
  `matchMedia`/MediaQueryList、`screen.js:22` 的 ScreenOrientation;`navigator` 则**刻意不插**。

**隐患**:brandless 是 `eventtarget.js` 内**手工登记的实例 WeakSet**(仅 screen/connection/orientation)。
而 (c) 中 `parent=ET` 的壳(Worker/RTCPeerConnection/MediaQueryList/visualViewport)同样"挂了 ETP 但无
EventTarget slot",**不在 brandless 集** → 页面对其调 `addEventListener` 会触发 jsdom brand-check 抛错。
`eventtarget.js` 头注已承认此缺口。本质问题是**"挂 ETP"与"登记 brandless"两个动作分散在不同文件、
靠人记得同步**,且 (c) 的实例是页面运行期 `new` 出来的、无法预先逐个登记。

**修法**:把 brandless 概念收进 mask,**改为按 prototype 登记**(而非预枚举实例):
```js
// mask 内部维护 brandlessProtos:Set<proto>;eventtarget.js 的 shim 改为按 this 的原型链判定
mask.eventTargetProto(proto)   // 一步:setPrototypeOf(proto, window.EventTarget.prototype) + 登记 brandless
```
- shim 判据从 `brandlessInstances.has(this)` 改为"`this` 的原型链(至 ETP 之前)命中 brandlessProtos"。
  按 proto 登记天然覆盖**懒构造**的壳(Worker 等),实例集做不到。
- (a)(c) 统一走 `mask.eventTargetProto` / `ctorIface({ parent: ET })`(后者内部调它),消除手工同步。
- (b) audio 可暂留(其 listener map 有独立语义),注释指向统一概念即可。

**风险**:改动 `eventtarget.js` 的匹配口径(实例集 → 原型链),须用现有 screen/connection/orientation
测试逐项回归;确认对真 EventTarget(window/document/element,其 proto 不在 brandlessProtos)仍走 orig。

### B5. `getContext` 被 canvas + webgl 各 hook 一次(隐式跨文件协调,低优先)

**现状**:`canvas.js:162` 与 `webgl.js:100` 都 hook `HTMLCanvasElement.prototype.getContext`,各自处理
自己的 type、把未知 type `delegate` 给 orig。靠 `mask.hook` 幂等 + 两边都 delegate 才在任意拓扑序下正确
(注释已说明)。能用但属隐式契约——"两边都得记得 delegate 未知 type"。

**可选修法**(优先级低于 A/B4):一个轻量 type 分发注册点——某处独占 hook getContext,canvas/webgl
经 `registerContext('2d', factory)` / `('webgl', …)` 注册,分发器按 type 查表、未命中走 orig。把隐式
协调变显式。不做也可,至少在两处补"配对契约"交叉注释。

---

## C. 次要

- **局部 helper 别名不统一**:`defineMethods = mask.methods`(`globals`/`plugins`)、`defineAccessors`、
  `makeSingleton = mask.singleton`(`globals`)等纯改名。`globals` 注释称"为调用点可读"而保留,但跨文件
  不一致(`plugins` 只别名 methods)。建议:直接用 `mask.*`,或在所有 patch 统一同一组别名约定。低优先、
  纯噪音。

---

## 实现顺序与风险

| 步骤 | 内容 | 风险 | 收益 |
|---|---|---|---|
| 1 | **A1 `ctorIface`** | 低(纯提炼) | 高:消 4 处重复 + 修文案缺陷 + 键序改由原语保障 |
| 2 | **A2 `instAccessor(s)`** | 低 | 中:消 3 处 helper + ~25 处样板 |
| 3 | **A3 `eventHandler`** | 低 | 低-中:消 2 处逐字重复 |
| 4 | **B4 EventTarget 统一** | 中(改 shim 匹配口径) | 中-高:消手工同步隐患、覆盖懒构造壳 |
| 5 | B5 / C | 低 | 低 |

每步独立可交付,逐步跑 `npm test`(212 项)验证行为不变;A1 还应专门断言各可构造壳
`getOwnPropertyNames(proto)` 末位为 `constructor`(键序回归守卫)+ 无-new 文案统一为完整句。

## 已排除 / 不做

- **把 (b) audio 的 listener map 也强行并入 (a)**:audio context 的事件派发(oncomplete + dispatchEvent
  链)语义与 screen/connection 的 no-op 短路不同,强并会把两种语义糅在一个 shim 里,得不偿失。保留其
  独立实现,仅在概念上指向统一的 brandless 注释。
- **getContext 引入完整插件式注册框架**:当前只有 2 个消费者(canvas/webgl),重框架属过度工程;B5 的
  轻量注册点是上限,且为可选项。
