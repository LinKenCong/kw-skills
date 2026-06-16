---
name: implementation-executor
description: "Executes an approved implementation task with a strong, auditable workflow: run cache, task branch setup, TDD contract tests, isolated subagent worktrees, independent reviewer subagents, validation, acceptance evidence, local integration, and cleanup. Use when the user explicitly asks to run implementation-executor, execute an approved implementation task, continue an implementation run, or complete a scoped task from an implementation plan; do not use for vague requirements, initial spec design, pure review, or trivial edits."
---

# Implementation Executor

Use this skill to execute already-approved implementation scope. The main agent owns orchestration, final acceptance, integration, final aggregate code review, user reporting, completion-signal decisions, and cleanup decisions.

Subagents are workers or reviewers. They do not own final acceptance, merge to target branch, push, final task completion status, or cleanup outside their assigned flow.

## Start Gate

Before changing code, confirm:

- The scope is clear and approved. If scope is vague, still in requirements design, or missing acceptance criteria, stop and route to a spec/design workflow.
- Project-local instructions, task documents, and user instructions have been read enough to identify overrides.
- The current repository state, target branch, dirty files, and sandbox/approval limits are understood.
- Non-trivial work has a run cache at `<project>/.agent-runs/implementation-executor/<run-id>/`.
- `.agent-runs/` is ignored before writing run artifacts.

Trivial edits may skip the run cache only when there is no task document, no subagent delegation, no TDD contract, and no multi-step validation or review.

## Execution Flow

Follow the full workflow in [workflow.md](references/workflow.md):

1. Intake and preflight.
2. Run state setup or resume.
3. Task branch setup.
4. TDD contract tests and RED check, or a recorded infeasibility decision.
5. Delegation planning.
6. Executor worker implementation in isolated worktrees.
7. Independent reviewer worker review.
8. Fix loop for valid unresolved `must-fix` findings.
9. Integration gate and worker result integration.
10. Final aggregate validation, review, acceptance matrix, documentation backfill, commit, merge or recorded deferral, cleanup, and report.

## Required Defaults

- Use `<project>/.agent-runs/implementation-executor/<run-id>/` for run state; see [run-state.md](references/run-state.md).
- Put workflow-managed subagent worktrees under `<project>/.agent-runs/.worktree/<run-id>/`.
- Write behavior-focused TDD contract tests for non-trivial code-changing work unless infeasible, and record RED/GREEN evidence or a skip decision; see [tdd-contract.md](references/tdd-contract.md).
- Prefer parallel executor workers only when write sets and ownership boundaries are clearly isolated; see [parallel-delegation.md](references/parallel-delegation.md).
- Delegate non-trivial implementation to executor workers in isolated worktrees and use independent read-only reviewer workers before integrating executor output; see [subagent-contract.md](references/subagent-contract.md).
- Record validation evidence, review evidence, integration decisions, and acceptance mapping; see [validation.md](references/validation.md) and [acceptance-matrix.md](references/acceptance-matrix.md).
- Use the templates in [report-templates.md](references/report-templates.md) for prompts, reports, fix requests, evidence, handoffs, and final summaries.

## Completion Signal Gate

If the caller, runner, task document, or project workflow uses a completion signal such as `<ralph>COMPLETE</ralph>` or a task status such as `completed`, treat that signal as an acceptance gate, not a progress update. Do not emit it until all current-scope completion evidence is durable.

Before printing a completion signal or marking a formal task complete, confirm and record:

- run cache exists for non-trivial work and has current `RUN.md`, `TODO.md`, `state.json`, `HANDOFF.md`, and evidence files;
- TDD contract has RED and GREEN evidence, or an explicit infeasibility decision with alternative validation;
- non-trivial implementation was delegated to executor workers with worker reports, worker commits, clean assigned worktrees, and preserved contract tests, or a documented user-approved/main-agent downgrade;
- independent reviewer evidence exists and there are no unresolved current-scope `must-fix` findings;
- final aggregate validation and review have run on the integrated task branch;
- acceptance matrix maps every in-scope item to implementation, validation, and review evidence with no unexplained gaps;
- formal task docs or indexes are backfilled when they exist;
- current-scope code and doc changes are committed on the task branch, with commit ids recorded;
- task branch is merged to the target branch when project rules require it, or a deferral is explicitly allowed and recorded as incomplete/blocked instead of completed;
- final worktree state, remaining branches/worktrees, cleanup actions, and residual risks are recorded.

## Git And Integration

- Do not push unless the user explicitly authorizes the current push.
- Worker-to-task-branch integration may use merge, cherry-pick, patch application, squash-style integration, or manual integration, but provenance must be recorded.
- Task-branch-to-target-branch integration preserves a Git merge record by default unless project rules or the user say otherwise.
- Do not treat uncommitted changes as completed work. Commit current-scope changes before declaring acceptance, unless the user explicitly requested a no-commit dry run.
- If subagents are required but unavailable, stop and ask whether to downgrade to main-agent execution. Do not silently complete the task alone.

## Stop Conditions

Stop or ask before continuing when:

- Approved scope is unclear or expands beyond the task.
- A subagent modifies the wrong worktree, branch, project root, task branch, or target branch.
- A worker changes, deletes, weakens, skips, or renames main-agent contract tests without authorization.
- The review/fix loop budget is exhausted.
- Required validation cannot be run or its evidence is insufficient for acceptance.
- Project rules require a step that cannot be satisfied in the current environment.
