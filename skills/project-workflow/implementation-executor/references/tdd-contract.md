# TDD Contract

The TDD contract gives the workflow an objective implementation target before coding starts. It is mandatory when project rules or the user require TDD, and the default attempt for non-trivial implementation work.

## When To Write Contract Tests

Write contract tests when:

- behavior can be verified through public interfaces;
- acceptance criteria are stable enough to test;
- the task changes runtime behavior, API behavior, UI behavior, persistence, or integration flow;
- workers will implement code and need a shared target.

You may skip TDD only when infeasible. Record the reason and alternative validation in `contract-tests.md`.

Common valid reasons:

- pure documentation update;
- mechanical rename with existing coverage;
- external system cannot be exercised and no useful fake boundary exists;
- project has a stronger existing verification gate for this exact change.

## Contract Test Principles

- Test observable behavior, not internal implementation details.
- Prefer public APIs, CLI commands, UI flows, library exports, or integration boundaries.
- Prefer tracer bullets: one failing behavior test, minimal implementation, then repeat.
- Avoid horizontal slicing such as "write all tests, then all implementation" for broad tasks.
- Do not refactor while tests are RED.
- Keep tests specific enough that a worker cannot pass them with a no-op or placeholder.
- Avoid overspecifying private names, file layout, or incidental timing.

## RED Gate

Before delegating implementation:

1. Add the contract test.
2. Run the smallest relevant command.
3. Confirm it fails for the expected missing behavior.
4. Record command, expected failure, and evidence in `contract-tests.md`.

If a test fails for an unrelated reason, fix the test setup or record the blocker before delegation.

## Worker Protection Rule

Workers may not change, delete, weaken, skip, rename, or bypass main-agent contract tests unless explicitly authorized by the main agent.

If a worker believes a contract test is invalid, the worker must report blocked with:

- test id;
- failing command;
- actual output summary;
- why the test conflicts with approved scope or project behavior;
- suggested correction.

The main agent decides whether to amend the test, reject the objection, or ask the user.

## Contract Test Record Template

```markdown
# Contract Tests

## CT01 - <behavior>

- Source acceptance item:
- Test path:
- Public interface exercised:
- Expected RED command:
- Expected RED result:
- Actual RED evidence:
- Assigned workers:
- GREEN command:
- GREEN evidence:
- Notes:
```

## Alternative Validation Record

Use when TDD is infeasible:

```markdown
## TDD Skipped - <reason>

- Scope item:
- Why a contract test is infeasible:
- Alternative validation:
- Risk:
- Main-agent decision:
```
