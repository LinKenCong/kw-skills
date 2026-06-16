# Acceptance Matrix And Finalization

The acceptance matrix is the final proof that the approved scope was implemented. It maps every in-scope item to code evidence, validation evidence, and review status.

## When To Write It

Write an acceptance matrix for every non-trivial run and every code-changing run with a formal task document, implementation index, issue, or runner completion signal.

If a formal implementation task document or index exists, backfill the matrix or an equivalent record there before declaring the task complete.

If no formal task document exists, write the matrix in the run cache and do not create project docs unless the user asks.

## Matrix Template

```markdown
# Acceptance Matrix

| Scope item | Implementation evidence | Validation evidence | Review evidence | Result |
| --- | --- | --- | --- | --- |
| <item> | `<file>` / commit `<sha>` | `<command>` passed / artifact | reviewer pass / final review | pass |
| <item> | - | - | - | gap |

## Gaps Or Follow-Ups

- GAP-001:
  - Scope item:
  - Missing evidence:
  - Decision:

## Non-Goals Confirmed

- <non-goal was not implemented>

## Residual Risks

- <risk and mitigation>
```

## Evidence Quality

Good evidence:

- points to changed files, public behavior, or commits;
- names validation commands or manual flows;
- states pass/fail clearly;
- maps to one scope item;
- identifies env-gated or skipped validation honestly.

Weak evidence:

- "tests pass";
- "implemented runtime";
- "reviewed";
- "should work";
- "covered by worker".

Replace weak evidence with specific file paths, commands, artifacts, commits, or explicit gaps.

## Documentation Backfill

When formal docs exist, update them according to project conventions. Include:

- status;
- task branch;
- worker branches and commits when relevant;
- implementation commits;
- merge commit;
- validation commands and results;
- review result;
- acceptance matrix or link to equivalent evidence;
- known gaps or follow-ups.

Do not let the run cache be the only completion record when project docs require backfill.

## Merge And Completion Gate

Before merging task branch to target branch:

- acceptance matrix has no unexplained gaps;
- final aggregate validation is complete or residual risk is explicitly accepted;
- final aggregate review has no unresolved current-scope must-fix items;
- formal docs are backfilled when they exist;
- run cache has integration and cleanup records;
- user/project rules allow local merge now.

Task-branch-to-target-branch merge preserves a Git merge record by default.

Never run `git push` without explicit user authorization for the current push.

Before marking a formal task complete or printing a runner completion signal:

- current-scope changes are committed on the task branch;
- implementation commit ids are recorded in the run cache and formal docs when they exist;
- merge commit is recorded when merge is required;
- if merge is deferred, the deferral is explicitly allowed and the final status is partial or blocked unless the user accepts no-merge completion;
- final worktree status is recorded and uncommitted current-scope changes are not left behind.

## Cleanup Gate

Clean resources only after evidence is durable:

- reviewer worktrees after reviewer reports are accepted;
- executor worktrees after review pass, task-branch integration, integration record, and no unrecorded work remains;
- task branch after merge and only when project rules allow branch deletion;
- run cache only if the user asks and formal records are complete.

If any worktree may contain user changes or unrecorded useful drafts, do not delete it.
