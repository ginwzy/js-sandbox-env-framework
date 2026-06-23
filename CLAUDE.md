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
