# harness probe 盲区收口 + collection 值采集(实施方案)

> 跟踪 issue:js-sandbox-env-framework-yvq.23(probe 盲区:plugins/Worker/RTCPeerConnection/
> indexedDB/Notification/visualViewport/userAgentData 未列 target)。本文是落地契约;源码/测试里
> 不写 issue-id(注释规约 §2),"为什么"就地写成自解释散文。

## 1. 问题与根因

`harness/probe.js` 的 `TARGETS` 是 L1 diff 的"真相源":两侧同源跑,差异即泄漏。yvq.6 已为一批标准
对象补壳(`patch/globals.js`/`plugins.js`/`uadata.js`),但**这些壳不在 probe TARGETS 里 → L1 diff 测不到**,
形态/原型链/own 键只靠各 patch 的运行时自测,无真机基线对照。具体两类盲区:

- **结构盲区(加 target 即可)**:`window.Worker`/`RTCPeerConnection`/`Notification`(可 new 类)、
  `window.indexedDB`/`visualViewport`(单例)、`navigator.userAgentData`(NavigatorUAData 单例)。
  probe 现有 `fnTell`(函数)/`objectRecord`(对象)足以采其形态,只是没被列进清单。

- **值盲区(需扩 probe schema)**:`navigator.plugins`/`mimeTypes`。`plugins.length=0` 是经典 headless
  **值级** tell;probe 现在只采结构(描述符 flags / valueType),不采集合内容(length 数值、索引项的
  name/filename/...)。jsdom 本就有 `plugins` key + 空 `PluginArray` 壳,故 diff 既不报 MISSING 也不报
  TELL —— 盲。yvq.6 已补固定 5×PDF 插件集,但无对照验证。

## 2. 核心不变量:为什么能"先落码、后采基线"

`harness/diff.js:131` 的主循环**只迭代 `baseline.targets`** —— mimic 快照里出现的、基线没有的
**新 target-id 永不被检视**。故:向 probe 加新 target-id,对**既有 3 份(尚未重采的)基线**完全惰性
(不产生 MISSING/EXTRA/TELL,gate 不变)。实证:当前 `chrome-mac × macos-chrome-v148` 为
**EXTRA=0 / TELL=5**(5 个全是 yvq.15 的 `ownKeys.order`),证实 yvq.6 的壳未扰动既有 target。

**但这条惰性只对"新 target-id"成立,对"既有对象上的新 key"不成立。** `navigator`/`Navigator.prototype`/
`screen`/`window.chrome` 以 `objectRecord` + `complete=true` 全量采 ownKeys 并开 EXTRA 检测
(`diffObject` line 104-117)。若把某盲区面采成**这些既有 target 的一个 key**,会对旧基线触发 EXTRA →
fatal → gate FAIL,不再惰性。

→ **硬设计约束**:plugins/mimeTypes/userAgentData/visualViewport/indexedDB 一律采成**各自独立的
new target-id**,绝不改动既有 target 的键集。(plugins/mimeTypes/userAgentData 虽挂在 navigator 上,
但它们在 `Navigator.prototype` 是 accessor key、已被既有 target 采到 key 存在性;本方案只**新增**指向
其实例的独立 target,不碰 `Navigator.prototype` 的键集本身。)

## 3. 阶段切分(按外部依赖切)

唯一不可约的外部依赖是**真机重采**(linux + android Chrome)。据此切两阶段:

### Phase 1 — 纯代码,现在可做,gate 保持绿 ✅ 已落地

落地:`harness/probe.js`(collectionRecord + `C` 工厂 + 8 个新 target + buildSnapshot 接入)、
`harness/diff.js`(diffCollection 值级 TELL + FATAL 收 collection.length/item)、`harness/test.js`
(+4 引擎测)、`harness/collection-probe.test.js`(新,12 测,接入 npm test)。全套绿、惰性实证
(chrome-mac×macos 仍 EXTRA=0 / TELL=5 / MISSING=173)。下列为原始计划。


1. **扩 probe schema:collection 采集**(probe.js)
   - 新 `kind:'collection'` 的 object target:在 `objectRecord` 基础上额外采
     `length`(**数值**)+ `items[]`(逐索引项的**字段值**,字段由 target 显式声明 `itemFields`)。
   - 这是对 probe "只采结构不采身份值" 契约的**有意分叉**,就地一句注释说明理由:plugins 是
     **host 固定的不变量集**(Chrome 统一 PDF viewer 后固定 5 plugin × 2 mimeType),不是 per-device
     身份值 → 属结构 harness 守护范畴,不归 `profile.validate()`。
   - 仍守 probe 铁律:只把 string/number/boolean 跨回 Node(plugins 的 name/filename/description/
     suffixes/type 全是 primitive,JSON.stringify 安全)。
   - 字段表对齐壳实测(已读 `patch/plugins.js`):
     - PluginArray 项(Plugin):`name` / `filename`(`'internal-pdf-viewer'`)/ `description` /
       内嵌 mimeTypes 的 `length`。
     - MimeTypeArray 项(MimeType):`type` / `suffixes` / `description`。

2. **扩 diff:collection 的值级比对**(diff.js)
   - `length` 不等、`items[i].<字段>` 不等 → **TELL**(值级谎言,可被识破)。
   - 项数不等也是 TELL(`items.length` 直接对应 `plugins.length`)。
   - 走部分基线纪律:基线未给 `items`/`length` 时跳过(不反推)。

3. **加新 TARGETS**(probe.js)
   - 结构类(category 既有):`navigator.plugins`(collection)、`navigator.mimeTypes`(collection)、
     `navigator.userAgentData`(object/instance)、`window.visualViewport`(object/instance)、
     `window.indexedDB`(object/instance)。
   - 可 new 类:`window.Worker`/`window.RTCPeerConnection`/`window.Notification` 采成
     `category:'function'`(fnTell 采构造器 name/length/native/hasPrototype);其 `.prototype` 形态
     如需守再各加一个 object target(`Worker.prototype` 等)——首版可只采构造器壳,原型留待基线对照后定。

4. **Phase 1 单测**(新增 `harness/*.test.js`,接入 `npm test`)
   - collection 采集:对 mimic 跑 probe,断言 `navigator.plugins` target 出 length=5 + 5 个项的字段。
   - diff 值级:手写**种子基线**(length=5 的 plugins)对比 mimic → 0 TELL;手写一份 length=0 的
     "headless 基线" → 断言 diff 报 length TELL(证明探针能抓 `length=0` 这类经典 tell)。
   - 惰性回归:断言 `chrome-mac × macos-chrome-v148` 仍 EXTRA=0(新 target 对旧基线惰性)。
   - 测试标题/注释**不含 issue-id**;种子基线就地注明"手写,非真机采集"。

### Phase 2 — 设备闸,真机重采后接入 gate

5. **真机重采基线**:`capture/server.js:79` 已直读 `harness/probe.js` 服 `/probe.js`,采集服务与
   mimic 侧**共用同一份 probe** → 改完 probe.js,重采自动含新 target/collection 数据。**不被 yvq.26
   阻塞**(yvq.26 是合并双服务,probe 路径今已通)。真机访问 capture 页采 linux + android 各一份,
   `saveBaseline` 落 `harness/baselines/`。
   - ⚠️ **基线必须用 Phase 1 改完后的 probe.js 采**(否则新字段不在基线里,diff 无可比)。
6. **接入 per-profile 结构 gate**:把新基线纳入 `harness/diff-gate.test.js` 的配对表,修 Phase 2 暴露的
   真 TELL(预期点:plugins 项字段、UAData 高熵值需真机校,visualViewport/indexedDB 原型链)。
   按 host+ff 粒度分别守(android-webview vs linux-chrome plugins 集可能不同)。

   **已知必现 tell(重采后会暴露,需在 patch 修)**:`patch/plugins.js` 把 PluginArray/Plugin 的
   `length` 作**实例 own data**(line 30 自述简化),真机 `length` 在 prototype 为 accessor。Phase 1
   的 collection 采集只比 length **值**(两侧都 5,不报);但 Phase 2 一旦真机基线含 PluginArray 实例的
   **ownKeys**,mimic 多出的 own `length` 键会判 EXTRA → 须把 length 改挂 prototype accessor 才消。
   (首版未顺手修:无真机基线时无法验证 accessor 形态,留 Phase 2 一并校。)

## 4. 触达面 / 改动文件

- `harness/probe.js`:+`kind:'collection'` 采集分支、+`itemFields`、+~8 个 TARGETS。
- `harness/diff.js`:+collection(length/items)值级 TELL 分支。
- `harness/*.test.js`:Phase 1 新测(collection 采集 + diff 值级 + 惰性回归)。
- (Phase 2)`harness/baselines/*.json`:linux/android 重采;`harness/diff-gate.test.js`:配对表纳入。

## 5. 风险 / 注记

- **collection 深度**:首版只采一层(plugins → 项的标量字段 + 内嵌 mimeTypes 的 length),不递归采
  `plugins[0].mimeTypes[0]` 全字段。够抓 `length=0` 与项 name 错配;更深保真留后续(对应 patch 已有
  mimeType↔plugin 反指,probe 暂不验环引用,避免循环序列化)。
- **UAData 高熵值**:`getHighEntropyValues` 是 Promise,probe 同步快照采不到;首版只采 `brands`/
  `mobile`/`platform` 低熵同步面,高熵留 `profile.validate()` / 后续异步 probe。
- **可 new 类原型**:Worker/RTC/Notification 的 `.prototype` own 键集需真机基线才有意义,首版先采
  构造器壳,避免无基线时凭空写断言。
