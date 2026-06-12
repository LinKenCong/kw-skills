# implementation-executor Skill Design

## Status

Draft v0.1. This document records confirmed design decisions before writing the final `SKILL.md` and references.

## Purpose

`implementation-executor` is a strong implementation workflow executor skill. It consumes an already-approved implementation task and guides the main agent through scoped execution, TDD, optional parallel subagent delegation, validation, review, acceptance evidence, documentation updates, integration, cleanup, and handoff.

It does not design product requirements, write initial specs, or turn vague feature requests into plans. That remains the responsibility of a separate design/spec skill such as `project-spec-design`.

## Confirmed Direction

- First version should be a strong workflow executor, not a lightweight checklist.
- The skill should be reusable across projects and must not hardcode project-specific domains, branch names, test commands, docs paths, or review skills.
- Project-local instructions, task documents, and user instructions override this skill when they are more specific.
- The main agent owns orchestration, final acceptance, integration, and user reporting.
- Subagents are implementation workers. They do not own final acceptance, merge, push, cleanup, or task completion status.
- Main-to-worker prompts, worker reports, worker fix requests, acceptance matrices, run ledgers, handoff notes, and final user reports need fixed templates.
- The main agent should prefer parallel subagents when ownership boundaries and dependencies are clear.
- Parallel worker outputs should be accepted through a queue; execution can be parallel, but integration/acceptance must be controlled by the main agent.
- The main agent should write TDD contract tests when feasible before implementation.
- Worker agents must preserve assigned main-agent contract tests and pass them before being considered done.
- If a worker believes a contract test is wrong, it must return a blocked report with evidence; the main agent evaluates and may amend the test before sending the worker back.
- Low-coupling work should be parallelized early. Shared foundations and high-coupling integration should be done serially.
- A project-local run cache should record execution state and evidence so a new agent can recover after interruptions.
- The workflow should default to automatic local commits and merges for workflow-managed branches so subagent work can be integrated deterministically.
- Worker outputs should be committed on worker branches when useful, but worker-to-task-branch integration does not need a preserved Git merge record. The main agent may choose merge, cherry-pick, patch application, squash-style integration, or equivalent local integration while recording worker provenance in the run cache.
- The task branch should be merged into the target branch with a preserved Git merge record after final acceptance when the user asked to execute the implementation task, unless project rules or the user explicitly say not to.
- `git push` is never automatic and always requires explicit user authorization for the current push.
- If subagents are required by the workflow or project rules but unavailable, the main agent must stop and ask the user whether to downgrade to main-agent execution. It must not silently complete the whole implementation alone.
- After explicit user approval to downgrade, the main agent may execute the task directly while preserving the run cache, TDD contract, validation, review, acceptance matrix, and local commit/merge discipline.
- If a formal implementation task document or index exists, final documentation backfill is mandatory. The main agent must update status, acceptance evidence, validation commands, review result, branch names, commits, and merge commits according to project conventions.
- If no formal implementation task document exists, the skill must not invent project documentation unless asked, but it must write completion records to the run cache.
- Run cache is temporary execution state and cannot replace formal project completion records when those records exist.
- Version 1 should be Markdown-only. Do not include scripts yet. Keep templates and state shapes structured enough that scripts can be added later after real usage stabilizes the workflow.
- The skill does not strictly require a formal implementation task document, but it does require clear approved scope. If scope is vague or still in requirements design, the agent must not execute and should use or recommend a spec/design workflow instead.
- When no formal task document exists, the run cache becomes the execution ledger and acceptance matrix location, but the skill must not invent project documentation unless the user asks.
- Triggering should be explicit by default because this is a specialized workflow. Users or project instructions should invoke `implementation-executor` for approved implementation-task execution; the skill should not aggressively trigger for ordinary small coding requests.
- Worker-to-task-branch integration does not require preserving Git merge records. The main agent may use regular commits, cherry-pick, patch application, squash-style integration, or merge according to project preference, as long as worker provenance and evidence are recorded in the run cache.
- Task-branch-to-target-branch integration must preserve a Git merge record by default.
- Keep the skill structure generic and portable across agents. Do not add Codex-specific `agents/openai.yaml` in v1. Use the most common Skill structure: `SKILL.md` plus optional `references/`.
- Subagents must use dedicated git worktrees, not just branches. All workflow-managed subagent worktrees live under `<project>/.agent-runs/.worktree/<run-id>/<worker-id>-<slug>/`.
- Executor worker outputs are not code-reviewed directly by the main agent. The main agent dispatches an independent reviewer subagent to inspect each worker result first.
- Reviewer subagents are read-only. They should use their own review worktree, preferably checked out at the worker commit, and must not modify code.
- If reviewer findings are valid must-fix items, the main agent returns them to the original executor worker. If review passes, the main agent integrates the worker result into the task branch.
- Executor worker worktrees are cleaned after the result is review-passed, integrated into the task branch, and recorded in the run cache. Reviewer worktrees are cleaned after the review report is accepted.
- The main agent performs code-level review only on the final aggregate task-branch diff against the target branch, after all accepted worker results have been integrated.
- Reviewer findings are scope-gated. A reviewer must cite a violated task requirement, contract test, allowed-scope rule, safety/correctness rule, or current-scope regression before marking a finding as must-fix.
- Review-fix loops have a budget. Each worker gets at most two automatic fix attempts before the main agent must stop the automatic loop and make a decision or ask the user.
- Parallel subagents are capped by default: at most 3 executor workers, at most 2 reviewer workers, and at most 4 total subagents running concurrently. High-resource validation is serialized.
- Workspace protocol violations stop the affected worker immediately and trigger quarantine/recovery. The main agent must not merge or clean suspicious changes until their origin and safety are established.

## Proposed Skill Layout

Use a generic portable Skill structure. Do not add Codex-specific `agents/openai.yaml` in v1.

```text
implementation-executor/
├── SKILL.md
└── references/
    ├── workflow.md
    ├── run-state.md
    ├── tdd-contract.md
    ├── parallel-delegation.md
    ├── subagent-contract.md
    ├── validation.md
    ├── acceptance-matrix.md
    └── report-templates.md
```

## Proposed Workflow

1. Intake: identify the approved implementation task and read only necessary project context.
2. Preflight: inspect project instructions, sandbox/approval limits, git status, current branch, and dirty worktree state.
3. Run state setup: create or resume a project-local run ledger/cache.
4. Task branch setup: follow project branch conventions, or use conservative defaults when no convention exists.
5. TDD contract: write behavior-focused contract tests via public interfaces when feasible; confirm RED.
6. Delegation planning: split work into shared foundation, parallel low-coupling workers, serial integration, and final evidence/doc tasks.
7. Implementation: workers or main agent implement only current task scope.
8. Worker queue acceptance: workers reporting done must pass assigned contract tests before diff review and acceptance.
9. Integration and validation: main agent integrates accepted work, runs relevant validation, and resolves conflicts.
10. Review loop: perform project-required review or generic review; fix findings and revalidate.
11. Acceptance matrix: map every in-scope item to implementation evidence and validation evidence.
12. Documentation and finalization: update task/index docs if the project uses them, clean up temporary resources safely, and report to the user.

## Proposed Run Cache

Confirmed rule: non-trivial implementation executions must create a project-local run cache. Trivial edits may skip it only when there is no implementation task document, no subagent delegation, no TDD contract, and no multi-step validation or review.

Default path:

```text
<project>/.agent-runs/implementation-executor/<run-id>/
```

Before writing run artifacts, the main agent must check that `.agent-runs/` is ignored by git. If it is not ignored, the main agent should add an ignore entry according to project conventions before storing artifacts.

Candidate contents:

```text
RUN.md
TODO.md
state.json
contract-tests.md
delegations/
  W01-<slug>.prompt.md
  W01-<slug>.report.md
  W01-<slug>.fix-request-1.md
reviews/
  R-W01-<slug>.prompt.md
  R-W01-<slug>.report.md
evidence/
  validation.md
  review.md
  integration.md
quarantine/
  <worker-id>-<reason>.md
HANDOFF.md
```

Security rules:

- Do not store secrets, tokens, private keys, raw request bodies, complete `.env` values, or sensitive logs.
- Store command names, concise results, changed file lists, and summarized evidence only.
- Ensure the run cache path is ignored by git before writing artifacts.
- Treat run cache as temporary execution state, not as the final project completion record.

## Subagent Execution and Review Protocol

Confirmed model: executor workers implement, independent reviewer subagents review, and the main agent integrates only review-passed results. This is designed to preserve main-agent context by preventing per-worker code details from entering the main thread until final aggregate review.

### Worktree Layout

All subagents must use dedicated worktrees under the run-owned worktree root:

```text
<project>/.agent-runs/.worktree/<run-id>/<worker-id>-<slug>/
```

Examples:

```text
<project>/.agent-runs/.worktree/2026-06-12-001-example/W01-storage/
<project>/.agent-runs/.worktree/2026-06-12-001-example/R-W01-review-storage/
```

Rules:

- A subagent must not work directly in the project root, target branch, or task branch worktree unless explicitly authorized by the main agent for a recovery action.
- Each executor worker starts by reporting its `cwd`, git branch, worktree path, and current commit.
- Each executor worker reports done only after producing a worker commit and a clean assigned worktree.
- Each reviewer uses a separate read-only review worktree, preferably checked out at the worker commit being reviewed.
- Executor worktrees are cleaned only after review pass, task-branch integration, run-cache integration record, and confirmation that no unrecorded work remains.
- Reviewer worktrees are cleaned after the reviewer report is accepted by the main agent.

### Executor-to-Reviewer-to-Integration Flow

```text
executor worker worktree
  -> worker report with worker commit
  -> independent reviewer subagent
  -> review pass
      -> integration gate
      -> integrate to task branch
      -> cleanup executor/reviewer worktrees
  -> review fail
      -> main validates finding categories
      -> return must-fix findings to original executor worker
      -> worker fixes in same executor worktree
      -> repeat until pass, blocked, or loop budget exhausted
```

The main agent does not perform code-level review of individual worker outputs directly. It consumes structured worker reports, reviewer reports, validation summaries, and integration records. The main agent performs code-level review at the final aggregate task-branch diff stage.

### Reviewer Finding Categories

Reviewer findings must be scope-gated and classified:

```text
must-fix
  Violates contract tests, worker objective, allowed scope, security/correctness rules, build/test requirements, or current task acceptance criteria.

question
  Reviewer is uncertain and needs a main-agent decision.

suggestion
  Quality improvement that is not required for current task completion.

out-of-scope
  Real issue or improvement outside the current task scope; record as follow-up only.
```

Only `must-fix` findings can be automatically returned to the executor worker. `question`, `suggestion`, and `out-of-scope` findings require main-agent triage before any action. The main agent must reject or downgrade reviewer findings that do not cite a violated requirement, contract test, allowed-scope rule, safety/correctness issue, or current-scope regression.

### Review Loop Budget

Default loop budget:

```text
maxAutomaticFixAttemptsPerWorker = 2
```

After two automatic fix attempts, the main agent stops the review-fix loop and chooses one of:

- shrink or split the worker scope;
- amend an invalid contract test;
- dispatch a new worker;
- accept a clearly non-blocking risk;
- ask the user for a scope or quality decision;
- downgrade to main-agent handling only if the user approves and project rules allow it.

Repeated findings must be tracked by stable finding IDs. A fix request should include only unresolved `must-fix` findings and should not repeat resolved items.

### Concurrency Limits

Default concurrency limits:

```text
maxParallelExecutorWorkers = 3
maxParallelReviewerWorkers = 2
maxTotalParallelSubagents = 4
```

The main agent may lower these limits when tasks are resource-heavy, tests are slow, browser/chain/fork tooling is involved, or the CLI/runtime reports capacity pressure. High-resource validation is serialized by the main agent unless explicitly authorized otherwise.

### Integration Gate

Reviewer `pass` is necessary but not sufficient for integration. Before integrating a worker result into the task branch, the main agent checks lightweight metadata:

- worker report exists and is complete;
- worker `cwd`, branch, and worktree path match the assigned worktree;
- worker commit exists and belongs to the assigned worker branch/worktree;
- assigned contract tests passed;
- reviewer report status is `pass`;
- unresolved `must-fix` findings count is zero;
- review/fix loop budget was not exceeded;
- changed files stay within allowed scope;
- run-cache evidence and integration plan are recorded.

Only then may the main agent integrate the worker result into the task branch. Worker-to-task integration does not need a preserved Git merge record, but the integration method and resulting task-branch commit must be recorded in the run cache.

### Workspace Protocol Violations

If a subagent works in the wrong worktree, wrong branch, project root, task branch, target branch, or any unassigned location, the main agent must stop that worker immediately.

Recovery procedure:

1. Mark the worker or reviewer as `protocol-violation` in `state.json` and `RUN.md`.
2. Freeze integration for that result.
3. Inspect only necessary git metadata first: status, branch, worktree root, worktree list, and latest commit.
4. If changes landed in an unintended but isolated workflow worktree, quarantine that worktree and decide whether to salvage a patch.
5. If changes landed in the project root, task branch, or target branch worktree, stop the run and ask the user unless the project rules explicitly allow a safe recovery and the changes are proven to be exclusively from the subagent.
6. Never reset, revert, delete, or overwrite user changes.
7. Recover by creating a fresh assigned worktree and re-delegating. A quarantined patch may be used only after review and redaction.

Additional worker states:

```text
reported-done
reviewing
review-failed
fixing
review-passed
integrating
integrated
cleaned
protocol-violation
quarantined
salvage-pending
reassigned
```

Reviewer states:

```text
queued
running
pass
fail
blocked
cleaned
protocol-violation
```

## TDD Contract Direction

The skill should absorb generic TDD principles:

- Tests verify observable behavior, not implementation details.
- Prefer public interfaces and integration-style tests.
- Avoid horizontal slicing: do not write all tests first and all implementation later.
- Prefer tracer bullets: one test, one minimal implementation, then repeat.
- Do not refactor while RED.
- Worker agents must pass assigned contract tests before reporting done.

If a project or session has a dedicated `tdd` skill available and TDD is requested or required, the main agent should load it. Otherwise it should use the built-in `references/tdd-contract.md`.

## Open Decisions

1. Decided: run cache is mandatory for non-trivial implementation executions and always uses `<project>/.agent-runs/implementation-executor/<run-id>/`; the main agent must ensure `.agent-runs/` is gitignored.
2. Decided: the skill defaults to automatic local commits and merges for workflow-managed branches. Worker branches are merged into the task branch after acceptance, and the task branch is merged into the target branch after final acceptance unless project/user rules say otherwise. `git push` is never automatic.
3. Decided: when subagents are required but unavailable, the main agent must stop and ask the user whether to downgrade to main-agent execution. It must not silently execute the whole task alone. After approval, it may execute directly while preserving the rest of the workflow.
4. Decided: formal implementation task docs/indexes must be backfilled when they exist; otherwise the skill records completion only in the run cache unless the user asks to create project docs.
5. Decided: v1 is Markdown-only. Scripts may be added later after the workflow stabilizes across real projects.
6. Decided: the skill does not require a formal implementation task document, but it does require clear approved scope. If no task doc exists, the run cache is the execution ledger; do not invent project docs unless asked.
7. Decided: triggering should be explicit by default because this is a specialized workflow. The skill should not aggressively trigger for ordinary small coding requests.
8. Decided: worker-to-task-branch integration does not require a preserved Git merge record, but task-branch-to-target-branch integration must preserve a Git merge record by default.
9. Decided: v1 uses the most generic Skill structure only: `SKILL.md` plus `references/`. Do not add Codex-specific `agents/openai.yaml`.
