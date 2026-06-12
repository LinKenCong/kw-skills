# Report Templates

Use these templates as starting points. Keep reports concise, factual, and scoped to the approved task.

## `RUN.md`

```markdown
# Implementation Executor Run

- Run id:
- Objective:
- Scope source:
- Project root:
- Target branch:
- Task branch:
- Start commit:
- Current phase:
- Status:

## Project Overrides

- User instructions:
- Project instructions:
- Task document rules:

## Phase Log

| Phase | Status | Evidence |
| --- | --- | --- |
| Intake | pending | - |
| Preflight | pending | - |
| TDD contract | pending | - |
| Delegation | pending | - |
| Integration | pending | - |
| Final validation | pending | - |
| Acceptance | pending | - |
| Cleanup | pending | - |

## Decisions

- DEC-001:
```

## `TODO.md`

```markdown
# Run TODO

## Active Gates

- [ ] Scope approved
- [ ] `.agent-runs/` ignored
- [ ] Task branch ready
- [ ] Contract tests RED or TDD skip recorded
- [ ] Worker plan recorded
- [ ] Reviews accepted
- [ ] Integration evidence recorded
- [ ] Acceptance matrix complete
- [ ] Docs backfilled if required
- [ ] Cleanup complete

## Worker Queue

| Worker | Status | Dependency | Notes |
| --- | --- | --- | --- |
| W01-<slug> | queued | - | - |
```

## Executor Worker Prompt

```markdown
# Executor Worker Assignment: W01-<slug>

## Objective

<one scoped objective>

## Scope Source

- <task doc, issue, or user-approved scope>

## Worktree And Branch

- Project:
- Worktree:
- Branch:
- Base commit:

Start by reporting cwd, branch, worktree root, and current commit. Stop if any do not match.

## Allowed Paths

- `<path>`

## Forbidden Paths

- `<path>`

## Contract Tests

- CT01: `<path>`; must preserve and pass.

## Required Validation

- `<command>`:

## Rules

- Do not change, delete, weaken, skip, or rename assigned contract tests.
- Do not expand scope or refactor unrelated code.
- Produce a worker commit before reporting done.
- Leave the assigned worktree clean.

## Report Path

`<run-cache>/delegations/W01-<slug>.report.md`
```

## Executor Worker Report

```markdown
# Worker Report: W01-<slug>

- Status: done | blocked
- Cwd:
- Branch:
- Worktree:
- Start commit:
- Worker commit:

## Changed Files

- `<path>`:

## Implementation Summary

- <what changed and why>

## Contract Tests

- CT01: pass | blocked | not run

## Validation

- `<command>`: pass | fail | not run

## Deviations Or Blockers

- <none or details>

## Risks

- <none or details>
```

## Reviewer Prompt

```markdown
# Reviewer Assignment: R-W01-<slug>

Review worker `W01-<slug>` at commit `<sha>`.

## Review Worktree

- Worktree:
- Branch:
- Commit:

Use a read-only review workflow. Do not edit code.

## Inputs

- Worker prompt:
- Worker report:
- Scope source:
- Contract tests:

## Check

- Objective satisfied.
- Changed files are in allowed scope.
- Forbidden paths unchanged.
- Contract tests preserved.
- Required validation evidence exists.
- No current-scope correctness, security, compatibility, or regression issue.

## Finding Categories

- `must-fix`
- `question`
- `suggestion`
- `out-of-scope`

## Report Path

`<run-cache>/reviews/R-W01-<slug>.report.md`
```

## Reviewer Report

```markdown
# Reviewer Report: R-W01-<slug>

- Status: pass | fail | blocked
- Worker:
- Worker commit:
- Review worktree:

## Summary

- <short result>

## Findings

### MF-001 - <title>

- Category: must-fix
- Requirement violated:
- Evidence:
- Required fix:
- Status: open

### Q-001 - <title>

- Category: question
- Evidence:
- Main-agent decision needed:

## Scope Check

- Allowed paths: pass | fail
- Forbidden paths: pass | fail
- Contract tests preserved: pass | fail
- Validation evidence: pass | fail
```

## Fix Request

```markdown
# Fix Request: W01-<slug> Attempt <n>

Return to the same assigned worker worktree and fix only these unresolved valid `must-fix` findings.

## Findings To Fix

### MF-001 - <title>

- Requirement violated:
- Evidence:
- Required fix:

## Constraints

- Preserve contract tests.
- Stay within original allowed scope.
- Produce a new worker commit.
- Update the worker report with fix evidence.
```

## Integration Evidence

```markdown
# Integration Evidence

## W01-<slug>

- Worker worktree:
- Worker branch:
- Worker commit:
- Reviewer:
- Reviewer report:
- Integration method:
- Task branch before:
- Task branch after:
- Validation after integration:
- Cleanup status:
```

## Validation Evidence

```markdown
# Validation Evidence

| Evidence id | Command or action | Purpose | Result | Supports |
| --- | --- | --- | --- | --- |
| VAL-001 | `<command>` | <why> | pass | <scope item> |

## Failures Or Skips

- VAL-XXX:
  - Command:
  - Reason:
  - Risk:
  - Follow-up:
```

## Final User Report

```markdown
Implemented the approved task.

- Scope completed:
- Key files changed:
- Validation:
- Review:
- Acceptance:
- Documentation backfill:
- Commits and merge:
- Cleanup:
- Remaining risks or follow-ups:
```

## `HANDOFF.md`

```markdown
# Implementation Executor Handoff

## Current State

- Run id:
- Status:
- Current phase:
- Target branch:
- Task branch:

## Completed

- <durable completed work>

## Pending

- <next required gate>

## Important Paths

- Run cache:
- Task doc:
- Contract tests:
- Worker reports:
- Review reports:

## Git State To Verify

- Expected branch:
- Expected clean/dirty state:
- Latest relevant commits:

## Risks

- <risk>

## Resume Instruction

Start by reading `RUN.md`, `state.json`, `TODO.md`, this handoff, and current git status.
```
