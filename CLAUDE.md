<!-- BEGIN BEADS INTEGRATION (br / beads_rust) -->
## Beads Issue Tracker (br)

This project uses **br (beads_rust)** for issue tracking — a local-first
tracker backed by SQLite with JSONL export for git collaboration.
Run `br robot-docs` to see the concise command reference for agents.

### Quick Reference

```bash
br ready                # Find available work (open, unblocked, not deferred)
br show <id>            # View issue details
br update <id> --claim  # Atomically claim work (assignee=you + in_progress)
br close <id>           # Complete work
br q "<title>"          # Quick capture a new issue, prints ID

Rules

- Use br for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run br robot-docs (and br capabilities) for the full command reference and contracts
- For persistent knowledge use issue fields/comments — br update <id> --notes "..."
or br comments — do NOT use MEMORY.md files. Durable contracts go in docs/spec/

Session Completion

When ending a work session, you MUST complete ALL steps below. Work is NOT
complete until git push succeeds.

MANDATORY WORKFLOW:

1. File issues for remaining work - Create issues for anything that needs follow-up (br create / br q)
2. Run quality gates (if code changed) - Tests, linters, builds
3. Update issue status - Close finished work (br close), update in-progress items
4. PUSH TO REMOTE - This is MANDATORY. br sync NEVER runs git, so you must:
br sync --flush-only   # export SQLite DB -> .beads/*.jsonl
git add .beads/
git pull --rebase
git add -A             # stage code + JSONL changes
git commit -m "<message>"   # if there is anything to commit
git push
git status             # MUST show "up to date with origin"
5. Clean up - Clear stashes, prune remote branches
6. Verify - All changes committed AND pushed
7. Hand off - Provide context for next session

CRITICAL RULES:
- Work is NOT complete until git push succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->


Task Tracking

This project uses br (beads_rust) only for task tracking and cross-session
context. Create, claim, update, and close work with br; do not create
parallel task artifacts in markdown or another workflow system.

Knowledge sinks:

- Short decisions / cross-session context → issue notes/comments
(br update <id> --notes, br comments).
- Durable technical contracts and coding guidance → docs/spec/.

Session close: follow the br "PUSH TO REMOTE" protocol above. Work is not
complete until the git branch is pushed.

## 注释规约(Comment Discipline)

既有风格是高信息密度、解释"为什么"(根因 / 不变量 / 跨层契约 / `[实测]` 证据 /
对照 sdenv 来源),不复述"做什么"。这是本项目的核心资产 —— 反检测代码里"为什么"
几乎无法由代码自表达(`setPrototypeOf(Navigator.prototype, OP)` 读不出"检测器测
`getPrototypeOf === Object.prototype`,一行即破")。延续它,但守住下面的"度"。

### 1. 写"为什么",且只写一次

- 解释代码读不出的东西(根因 / 检测向量 / 不变量 / 跨层契约);不复述代码本身
  ("装 getter""遍历表")。能由命名和结构自解释的代码,让它自解释、别配注释。
- 同一个机制 / 判定 / 分工**只在一处权威说明**,旁处一句指针(`见 X`)即可:
  - 不在 `fn / wrap / hook / deproto` 每个函数里重述同一套 `dropOwnToString` /
    reparent 规则 —— 说一次(模块头或锚函数),其余引用。
  - 模块头与行内不各推导一遍同一机制 —— 头讲根因 + 策略,行内只留一句标记。
- 散文宁可锋利不要冗长:多种等价形态举一个代表 + "N 种形态",胜过逐一列全。

### 2. 不把 beads issue-id 写进 prose 注释

源码注释、JSDoc、测试标题里**禁止**用 issue-id(`yvq.N` / `.NN` / `rNN`)做"为什么"
的装饰或指针 —— issue 瞬态(会关闭 / 重编号)而源码长寿,读者未必有 br 访问权,
issue 关闭后引用即腐烂。正确做法:把"为什么"就地写成自解释散文(根因 / 机制 / 判据)。
要表达"这是刻意推迟的另一类泄漏",直说"另一类泄漏,单独清理",**保留信号不写 issue 号**。

### 3. 例外:issue-id 作"脚手架移除锚点"(机器可读字段,非 prose)

代码是**临时脚手架**且存续严格绑定某 issue 时,允许在**代码字段**里留 issue-id 作
"何时移除"锚点 —— 判据是它为**可执行的删除条件**(非描述性装饰)且必有并列的自解释
`reason`。当前唯一合法用例:`harness/whitelist.js` 每条豁免规则的 `issue:` 字段(对应
br open issue 修复后删此规则,gate 即重新守住)。新增同类脚手架沿用此形态。

### 4. 不写 inline TODO/FIXME;stub 只陈述现状

**禁止** `TODO/FIXME/XXX/HACK` —— 平行任务工件易失同步,未尽功能进 br issue。
stub / 未实现单元**只陈述事实**("当前为 stub""X 尚未实现",可描述缺口方向),
不带 `TODO:` 前缀、不写成待办祈使句。删 TODO 前先确认其待办已在 br 有 issue。

### 5. 保留的优秀实践

`[实测]` / `现状[实测]:` 标经验证根因;`对照 sdenv …` 标移植来源;原语分工
(mask 的 fn/wrap/hook/mixin 边界)——但分工只在原语定义处讲全,调用点不重复。
