# Implementation Executor Workflow

This workflow executes approved implementation scope. It does not design requirements, invent acceptance criteria, or convert vague requests into plans.

## Phase Checklist

### 1. Intake

- Identify the approved task, task document, issue, PRD slice, or explicit user-approved scope.
- Extract in-scope items, out-of-scope items, acceptance criteria, required validation, and forbidden changes.
- If scope is unclear or still being designed, stop and route to the appropriate spec/design workflow.

### 2. Preflight

- Read project instructions and only the task-relevant context.
- Check git status, current branch, target branch, ignored paths, and existing dirty files.
- Record user changes already present. Do not overwrite or revert them.
- Identify required tools, sandbox limits, approval limits, and subagent availability.

### 3. Run State Setup

- Create or resume `<project>/.agent-runs/implementation-executor/<run-id>/`.
- Confirm `.agent-runs/` is gitignored before writing run artifacts.
- Initialize `RUN.md`, `TODO.md`, `state.json`, and evidence files.
- If resuming, read `RUN.md`, `state.json`, latest evidence, and `HANDOFF.md` before acting.

### 4. Task Branch Setup

- Follow project branch rules first.
- If no rule exists, create a dedicated task branch from the target branch for non-trivial work.
- Record target branch, task branch, starting commit, and branch setup command in the run cache.

### 5. TDD Contract

- Write behavior-focused contract tests before implementation for non-trivial code-changing work unless infeasible.
- Verify they fail for the expected reason before sending implementation work to a worker.
- If TDD is infeasible, record the reason and alternative validation plan.
- Treat project-required TDD as mandatory.

### 6. Delegation Planning

- Split work by ownership boundary, not by technology layer alone.
- Prefer tracer-bullet slices that each produce observable behavior.
- Parallelize only low-coupling write sets.
- Keep shared foundations, migrations, broad API shapes, and final integration serial unless the project explicitly supports parallel work there.
- For non-trivial code-changing work, plan at least one executor worker and one independent reviewer unless subagents are unavailable or the user explicitly approves a main-agent downgrade.

### 7. Executor Worker Implementation

- Assign each executor worker a dedicated worktree under `<project>/.agent-runs/.worktree/<run-id>/`.
- Give each worker allowed paths, forbidden paths, expected output, required tests, and report template.
- Require a worker commit and clean assigned worktree before the worker reports done.
- Workers must not change, weaken, delete, skip, or rename main-agent contract tests without authorization.
- Do not accept a stdout-only implementation report. The worker result must have a durable report, commit id, changed-file list, and validation evidence.

### 8. Reviewer Worker Review

- Dispatch an independent read-only reviewer worker for each executor result.
- Prefer checking out the worker commit in a separate reviewer worktree.
- Reviewer scope is objective compliance, allowed scope, contract test preservation, validation evidence, correctness, security, and regressions.
- Reviewer findings must be categorized and scope-gated.

### 9. Fix Loop

- Return only unresolved valid `must-fix` findings to the original executor worker.
- Use stable finding IDs across attempts.
- Default to at most two automatic fix attempts per worker.
- After the budget is exhausted, stop automatic looping and make a main-agent decision or ask the user.

### 10. Integration Gate

Before integrating a worker result, confirm:

- worker report exists and is complete;
- worker cwd, branch, and worktree path match assignment;
- worker commit exists and belongs to the assigned worker branch/worktree;
- assigned contract tests passed;
- reviewer status is `pass`;
- unresolved `must-fix` count is zero;
- changed files stay within allowed scope;
- run-cache evidence and integration plan are recorded.

### 11. Worker Result Integration

- Integrate accepted worker output into the task branch by project-preferred method.
- Worker-to-task integration does not require a preserved Git merge record.
- Record worker id, worker branch/commit, reviewer report, validation evidence, integration method, and resulting task-branch commit.

### 12. Final Aggregate Validation And Review

- Run project-appropriate validation on the integrated task branch.
- Review the final aggregate diff against the target branch.
- Fix only current-scope findings and rerun relevant validation.
- Do not rely only on worker-level results for final acceptance.
- Record final aggregate validation and review in the run cache before any formal completion signal.

### 13. Acceptance Matrix

- Map every in-scope item to implementation evidence and validation evidence.
- Mark gaps explicitly. Do not claim completion from generic "tests pass" statements.
- Record non-goals and out-of-scope findings as follow-up candidates only.

### 14. Documentation Backfill

- If a formal task doc or implementation index exists, update it with status, evidence, validation commands, review results, branch names, commits, and merge commits.
- If no formal task doc exists, do not invent project docs unless the user asks; record completion in the run cache.

### 15. Task Branch Merge

- Merge the accepted task branch to the target branch with a preserved merge record by default.
- Do not push without explicit user authorization for the current push.
- Record merge command, merge commit, and post-merge validation.
- If project rules, user instructions, or the runner require a local merge before task completion, do not mark the task completed until the merge is done and recorded.
- If merge is intentionally deferred, record who allowed the deferral, the reason, and the exact next command; report the task as partial or blocked, not complete, unless the user explicitly accepts no-merge completion.

### 16. Cleanup And Final Report

- Clean reviewer worktrees after their reports are accepted.
- Clean executor worktrees only after review pass, integration, evidence recording, and no unrecorded work remains.
- Clean task branches only when project rules and user intent allow it.
- Final report summarizes scope completed, files changed, validation, review, acceptance matrix result, docs backfill, commits, cleanup, and remaining risks.

### 17. Completion Signal Gate

Before printing a runner completion signal or marking a formal implementation task `completed`, verify and record all of:

- run cache is current and contains `RUN.md`, `TODO.md`, `state.json`, `HANDOFF.md`, and evidence files;
- contract tests have RED and GREEN evidence, or TDD skip is explicitly justified;
- executor workers have durable reports, worker commits, clean assigned worktrees, and required validation evidence, or a documented downgrade exists;
- reviewer reports exist and no unresolved current-scope `must-fix` findings remain;
- final aggregate validation and review have run after integration;
- acceptance matrix has no unexplained gaps;
- formal task docs or indexes are backfilled when they exist;
- current-scope changes are committed on the task branch and commit ids are recorded;
- merge to target branch is complete when required, or deferral is explicitly allowed and reported as not fully complete;
- final worktree state and cleanup decisions are recorded.

If any required item is missing, do not emit the completion signal. Emit a blocked or partial result with the missing gate and safe resume instructions.

## Resume Rules

When resuming a run:

- Read `RUN.md`, `state.json`, `TODO.md`, `HANDOFF.md`, and latest evidence files.
- Re-check git status and branch state before trusting previous records.
- Continue from the last durable gate, not from memory.
- If records conflict with repository state, pause and reconcile before editing.
