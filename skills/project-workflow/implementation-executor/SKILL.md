---
name: implementation-executor
description: Executes an approved implementation task with a strong, auditable workflow: run cache, task branch setup, TDD contract tests, isolated subagent worktrees, independent reviewer subagents, validation, acceptance evidence, local integration, and cleanup. Use when the user explicitly asks to run implementation-executor, execute an approved implementation task, continue an implementation run, or complete a scoped task from an implementation plan; do not use for vague requirements, initial spec design, pure review, or trivial edits.
---

# Implementation Executor

Use this skill to execute already-approved implementation scope. The main agent owns orchestration, final acceptance, integration, final aggregate code review, user reporting, and cleanup decisions.

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
4. TDD contract tests and RED check when feasible.
5. Delegation planning.
6. Executor worker implementation in isolated worktrees.
7. Independent reviewer worker review.
8. Fix loop for valid unresolved `must-fix` findings.
9. Integration gate and worker result integration.
10. Final aggregate validation, review, acceptance matrix, documentation backfill, merge, cleanup, and report.

## Required Defaults

- Use `<project>/.agent-runs/implementation-executor/<run-id>/` for run state; see [run-state.md](references/run-state.md).
- Put workflow-managed subagent worktrees under `<project>/.agent-runs/.worktree/<run-id>/`.
- Attempt behavior-focused TDD contract tests for non-trivial work; see [tdd-contract.md](references/tdd-contract.md).
- Prefer parallel executor workers only when write sets and ownership boundaries are clearly isolated; see [parallel-delegation.md](references/parallel-delegation.md).
- Use independent read-only reviewer workers before integrating executor output; see [subagent-contract.md](references/subagent-contract.md).
- Record validation evidence, review evidence, integration decisions, and acceptance mapping; see [validation.md](references/validation.md) and [acceptance-matrix.md](references/acceptance-matrix.md).
- Use the templates in [report-templates.md](references/report-templates.md) for prompts, reports, fix requests, evidence, handoffs, and final summaries.

## Git And Integration

- Do not push unless the user explicitly authorizes the current push.
- Worker-to-task-branch integration may use merge, cherry-pick, patch application, squash-style integration, or manual integration, but provenance must be recorded.
- Task-branch-to-target-branch integration preserves a Git merge record by default unless project rules or the user say otherwise.
- If subagents are required but unavailable, stop and ask whether to downgrade to main-agent execution. Do not silently complete the task alone.

## Stop Conditions

Stop or ask before continuing when:

- Approved scope is unclear or expands beyond the task.
- A subagent modifies the wrong worktree, branch, project root, task branch, or target branch.
- A worker changes, deletes, weakens, skips, or renames main-agent contract tests without authorization.
- The review/fix loop budget is exhausted.
- Required validation cannot be run or its evidence is insufficient for acceptance.
- Project rules require a step that cannot be satisfied in the current environment.
