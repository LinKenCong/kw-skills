# TDD Contract

The TDD contract gives the workflow an objective implementation target before coding starts. It is mandatory when project rules or the user require TDD, and the default for non-trivial code-changing implementation work.

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
- project has a stronger existing verification gate for this exact change and the run cache records why a new contract test would add no useful signal.

Do not skip TDD just because writing the test is slower than coding the feature. If a worker will implement behavior, the worker needs an objective target or a documented main-agent decision explaining why no useful target can be written first.

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

## GREEN Gate

After worker implementation and integration:

1. Run the same contract test command that produced RED unless the main agent amended the test with a recorded decision.
2. Confirm the contract test passes for the implemented behavior.
3. Record command, result, and the worker commit or task-branch commit that made it pass in `contract-tests.md`.
4. If the worker changed the contract test, verify the change was explicitly authorized and recorded.

Do not treat worker-level GREEN as final acceptance. The main agent must rerun or otherwise verify the contract evidence after integration into the task branch.

## Worker Protection Rule

Workers may not change, delete, weaken, skip, rename, or bypass main-agent contract tests unless explicitly authorized by the main agent.

If a worker believes a contract test is invalid, the worker must report blocked with:

- test id;
- failing command;
- actual output summary;
- why the test conflicts with approved scope or project behavior;
- suggested correction.

The main agent decides whether to amend the test, reject the objection, or ask the user.

## Evidence Quality

`contract-tests.md` must be specific enough for another agent to resume without trusting conversation memory:

- exact test path or public interface exercised;
- exact RED command and concise failure evidence;
- expected RED reason and whether actual RED matched;
- assigned worker ids that must preserve the test;
- exact GREEN command and concise pass evidence;
- commit id or integration state where GREEN was observed;
- explicit skip reason and alternative validation if no contract test was written.

Weak evidence such as "tests added", "TDD done", or "worker says it passed" is not enough to emit a completion signal.

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
- GREEN commit:
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
