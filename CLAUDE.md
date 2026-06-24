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

本项目注释的既有风格是高信息密度、解释"为什么"(根因 / 不变量 / 跨层契约 /
`[实测]` 证据 / 对照 sdenv 来源),不复述"做什么"。延续它,并遵守以下约束
——这是对上面 beads/任务规则的**补充**(原规则未字面涉及注释)。

### 1. 不把 beads issue-id 写进 prose 注释

源码注释、JSDoc、测试标题里**禁止**用 issue-id(`yvq.N` / epic 简写 `.NN` /
评审号 `rNN`)做"为什么"的装饰或指针。理由:issue 是瞬态工件(会关闭 / 重编号),
源码长寿;读者未必有 br 访问权;issue 关闭后引用即腐烂(本项目曾大面积出现指向
已 closed issue 的悬空注释)。

正确做法:把 issue 承载的"为什么"**就地写成自解释的散文**——根因、机制、判据。
需要表达"这是一类单独的、刻意推迟的泄漏/缺口"时,直说"另一类泄漏,单独清理" /
"已知未尽项",**保留"已知/推迟"信号但不写 issue 号**。任务跟踪留在 br,知识留在
docs/spec 或 issue notes。

### 2. 例外:issue-id 可作"脚手架移除锚点"(机器可读字段,非 prose)

当一段代码是**临时脚手架**且其存续与某 issue 严格绑定时,允许在**代码字段**里保留
issue-id 作"何时移除"的锚点。判据:issue-id 是**可执行的删除条件**(非描述性装饰),
且必有并列的自解释 `reason`。当前唯一合法用例:`harness/whitelist.js` 每条豁免规则的
`issue:` 字段(配 `reason:` 自解释语义;对应 br open issue 修复后删掉此规则,gate 即
重新守住)。新增此类脚手架(skip 标记 / 临时豁免)沿用同形态。

### 3. 不写 inline TODO/FIXME;stub 只陈述现状

源码里**禁止** `TODO/FIXME/XXX/HACK` 任务清单——它是 br 之外的平行任务工件,与
"用 br 跟踪所有任务"冲突且易失同步。未尽功能进 br issue。stub / 未实现单元的注释
**只陈述事实**:"当前为 stub""X 尚未实现",可描述缺口方向供理解,但不带 `TODO:`
前缀、不写成待办祈使句。删 TODO 前先确认其待办已在 br 有 issue;若无则先建,
避免抹掉信号而非转移信号。

### 4. 保留的优秀实践

`[实测]` / `现状[实测]:` 标注经验证的根因;`对照 sdenv …` 标注移植来源;原语 /
分工说明(如 mask 的 fn/wrap/hook/mixin 边界)。这些是高价值注释,继续写。
