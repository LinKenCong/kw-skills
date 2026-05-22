# Project Spec Design Templates

Use these templates when the main skill needs to persist an approved spec or implementation plan. Adapt section depth to project complexity, but keep scope, non-goals, and acceptance criteria explicit.

## Full Spec Template

```markdown
# <Project or Feature Name> Requirements Spec

## 1. Background

Explain why this work exists, what problem it solves, and what context matters.

## 2. Goals

List the outcomes this spec must achieve.

## 3. Users and Scenarios

Describe target users, usage context, frequency, skill level, and core scenarios.

## 4. Product or Function Shape

Describe the intended form: CLI, web page, background job, API, workflow, configuration surface, automation, integration, or another shape. Explain why this shape fits the goal.

## 5. Scope

### 5.1 In Scope

List what this iteration includes.

### 5.2 Non-Goals

List what this iteration explicitly does not include.

## 6. References and Mature Practices

- User-provided references:
- Search direction:
- References reviewed:
- Borrowed patterns:
- Patterns not adopted:
- Impact on this spec:

## 7. Recommended Design

Explain the chosen approach, key tradeoffs, and why it is the best fit for current constraints.

## 8. Functional Requirements

Describe behavior in user-understandable modules. Avoid file-by-file implementation steps.

## 9. Data, State, and Configuration

Describe core data objects, state transitions, inputs/outputs, configuration, persistence, and source-of-truth decisions.

## 10. Flows

Describe key user flows, system flows, or operational flows.

## 11. Errors and Edge Cases

Cover empty states, invalid input, permissions, privacy/security, data loss, retries, rollback, and failure reporting.

## 12. Acceptance Criteria

Use verifiable statements. Each item should be testable by automated tests, CLI output, browser behavior, document inspection, or manual verification.

## 13. Open Questions

Only include questions that genuinely block or affect later decisions. Do not leave placeholders.
```

## Lightweight Spec Template

Use for small but non-trivial requests.

```markdown
# <Project or Feature Name> Requirements Spec

## Goal

## Scope

## Non-Goals

## Recommended Shape

## Key Behavior

## Acceptance Criteria

## Open Questions
```

## Candidate Design Format

Use this before the user approves a spec when more than one path is realistic.

```markdown
## Candidate Designs

### Option A: <Recommended Name> (Recommended)
- Shape:
- Fits because:
- Benefits:
- Costs or risks:
- What it excludes:

### Option B: <Alternative Name>
- Shape:
- Fits when:
- Benefits:
- Costs or risks:
- Why it is not recommended now:
```

If there is only one reasonable path, do not invent weak alternatives. State the constraint and present the single recommended path.

## Implementation INDEX Template

```markdown
# <Topic> Implementation Plan

## Source Spec

- Spec: `docs/specs/YYYY-MM-DD-<topic>-spec.md`
- Spec status: approved
- Last updated: YYYY-MM-DD

## Execution Model

Tasks are executed sequentially by default. Do not start the next task until the current task is implemented, verified, and recorded here. Subagents may work in parallel only within the current task when ownership boundaries are clear.

## Task List

| ID | Task | Status | Depends On | Commit | Summary |
| --- | --- | --- | --- | --- | --- |
| 001 | <task name> | pending | - | - | <short description> |
| 002 | <task name> | pending | 001 | - | <short description> |

## Integration Notes

Record shared files, cross-task risks, required merge order, and final integration concerns.

## Final Acceptance

List the spec-level checks that must pass after all tasks are complete.
```

## Sequential Task Template

```markdown
# 001 - <Task Name>

## Goal

State the feature/module closed loop this task completes.

## Source Spec

- Spec: `docs/specs/YYYY-MM-DD-<topic>-spec.md`
- Related sections:

## Scope

### In Scope

### Out of Scope

## Execution Order

- Previous task:
- Next task:
- Do not start the next task until this task is implemented, verified, and recorded in `INDEX.md`.

## Ownership Boundary

- Allowed paths:
- Avoid paths:
- Shared integration points:

## Subagent Work Items

Use this section only when the task can be split safely inside one sequential task.

### Work Item A: <Name>
- Goal:
- Allowed paths:
- Avoid paths:
- Expected output:
- Verification:

### Work Item B: <Name>
- Goal:
- Allowed paths:
- Avoid paths:
- Expected output:
- Verification:

## Integration Plan

Explain how the main agent should combine, review, or sequence subagent outputs for this task.

## Verification

- Automated:
- Manual:
- Acceptance criteria:

## Risks

List task-specific risks and mitigation.

## Completion Record

- Status: pending
- Commit: -
- Verification evidence:
- Notes:
```

## Task Sizing Guide

A task is usually the right size when:

- it represents one feature closed loop, module boundary, or stage of system capability;
- it can be validated independently;
- it can be reviewed as a coherent diff;
- it contains roughly 3-7 acceptance checks;
- it can optionally split into 2-4 subagent work items with non-overlapping ownership.

A task is too small when it only says "create types", "add helper", "update button", or "write tests" without a verifiable behavior or module outcome.

A task is too large when it covers multiple unrelated user flows, crosses many independent domains, or needs several unresolved design decisions before it can be completed.

## Language Rules

- Match the prose language to the user's language unless project conventions or the user specify otherwise.
- Keep file names, paths, commands, code identifiers, and commit hashes in English-compatible formats.
- Prefer short English kebab-case topics for file and directory names.
