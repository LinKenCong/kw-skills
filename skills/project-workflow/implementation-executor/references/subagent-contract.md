# Subagent Contract

Subagents are scoped workers. The main agent owns orchestration, final acceptance, integration, task completion status, target-branch merge, push decisions, and cleanup decisions.

## Roles

Executor worker:

- implements assigned current-scope work;
- preserves assigned contract tests;
- runs assigned local validation;
- creates a worker commit;
- reports changed files, evidence, risks, and blockers.

Reviewer worker:

- reviews one executor result;
- uses a separate read-only review worktree;
- checks objective, allowed scope, forbidden files, contract test preservation, validation evidence, correctness, security, and regressions;
- reports findings with categories and stable ids;
- does not edit code.

## Worktree Layout

All workflow-managed subagent worktrees live under:

```text
<project>/.agent-runs/.worktree/<run-id>/<worker-id>-<slug>/
```

Examples:

```text
<project>/.agent-runs/.worktree/<run-id>/W01-storage/
<project>/.agent-runs/.worktree/<run-id>/R-W01-review-storage/
```

Subagents must not work in the project root, target branch, task branch, or another subagent's worktree unless the main agent explicitly assigns a recovery action.

## Executor Assignment Must Include

- worker id and slug;
- objective;
- scope source;
- assigned worktree path;
- assigned branch name;
- base commit or task-branch commit;
- allowed paths;
- forbidden paths;
- required contract tests;
- required validation commands;
- expected output and report path;
- stop conditions.

## Executor Done Criteria

An executor worker may report done only when:

- cwd, branch, and worktree match assignment;
- assigned changes are committed on the worker branch;
- assigned worktree is clean;
- assigned contract tests are preserved and pass;
- required validation evidence is recorded;
- changed files stay within allowed scope;
- worker report is complete.

## Reviewer Assignment Must Include

- reviewer id;
- worker id and worker commit;
- review worktree path;
- worker prompt and worker report path;
- scope source and allowed scope;
- contract tests to verify unchanged;
- required validation evidence to inspect;
- finding categories;
- report path.

## Reviewer Finding Categories

`must-fix`:

- Violates a contract test, worker objective, allowed scope, security/correctness rule, build/test requirement, or current task acceptance criterion.
- Must cite the violated requirement, test, scope rule, or concrete regression.

`question`:

- Reviewer is uncertain and needs a main-agent decision.

`suggestion`:

- Quality improvement that is not required for current task completion.

`out-of-scope`:

- Real issue or improvement outside current task scope. Record as a follow-up only.

Only valid unresolved `must-fix` findings may be automatically returned to the executor worker.

The main agent must reject or downgrade findings that are imprecise, unsupported, or expand scope.

## Fix Loop

- Use stable finding ids such as `MF-001`.
- Send only unresolved valid `must-fix` findings back to the original executor worker.
- Default to at most two automatic fix attempts per worker.
- After two attempts, stop automatic looping and choose: shrink/split scope, amend invalid contract test, dispatch new worker, accept non-blocking risk, ask user, or downgrade only if user and project rules allow it.

## Protocol Violations

A protocol violation occurs when a subagent works in:

- the wrong worktree;
- the wrong branch;
- the project root;
- the task branch;
- the target branch;
- unassigned paths that change ownership boundaries.

On violation:

1. Stop that subagent's result from moving forward.
2. Mark status `protocol-violation` in `state.json` and `RUN.md`.
3. Inspect only necessary git metadata first.
4. Quarantine the worktree or branch if changes are isolated.
5. If changes landed in the project root, task branch, or target branch, stop the run and ask the user unless project rules provide a safe recovery path and the changes are proven to be exclusively from that subagent.
6. Never reset, revert, delete, or overwrite user changes.
7. Re-delegate in a fresh assigned worktree if the task should continue.

## State Values

Executor worker states:

```text
queued
running
reported-done
reviewing
review-failed
fixing
review-passed
integrating
integrated
cleaned
blocked
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
