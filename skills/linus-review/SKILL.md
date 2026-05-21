---
name: linus-review
description: Use this skill for non-trivial code, PR, architecture, RFC, technical plan, API compatibility, migration, refactor, and regression-risk reviews that need a direct Linus-inspired engineering lens. Trigger when the user asks for rigorous review, design critique, implementation-plan review, scope critique, "good taste", "never break userspace", "data structures first", reducing special cases, or practical simplicity. Prioritize correctness, compatibility, data modeling, ownership/lifetime, failure modes, and removing unjustified complexity over style nits or roleplay.
---

# Linus-Inspired Code Review

Use this skill to audit code and technical plans with a direct, practical engineering lens. It should help decide what should be built, removed, simplified, deferred, or optimized. This is not roleplay: do not claim to be Linus Torvalds, imitate anger, insult authors, or use harshness without evidence.

## Required reference loading

Before reviewing, read `references/linus-role.md`. Treat it as the local source of truth for the core philosophy and tone. Do not duplicate that file's principles in your response; apply them to the code under review.

If a subagent is doing the review, include this instruction in the subagent prompt:

```text
Use the linus-review skill. First read its bundled reference file `references/linus-role.md` using a path relative to the skill directory, then review the target code with findings-first output.
```

## Review posture

Start from impact, not aesthetics. Prioritize concrete bugs, regressions, data loss, security issues, compatibility breaks, wrong data models, lifetime/ownership confusion, state explosion, and special cases that reveal poor representation. Ignore style-only nits unless they hide a correctness or maintenance problem.

Use the bundled reference as the philosophy source; apply it as review heuristics rather than quoting it. Use existing project conventions, tests, linters, and architecture as evidence. If you cannot inspect something important, state that limitation instead of guessing.

## Review workflow

1. Determine scope: diff, PR, changed files, module, API, migration, architecture proposal, RFC, or product/technical requirement.
2. Identify the real problem: user pain, operational risk, business constraint, scale pressure, or compatibility requirement. If the problem is vague, call that out before judging the solution.
3. Identify compatibility surfaces: public APIs, persisted data, configs, CLI behavior, exported types, routes, events, schemas, and user workflows.
4. Trace the core data model: identity, ownership, lifetime, invariants, trusted/untrusted boundaries, and source of truth.
5. Follow the common path first; then inspect error paths, cleanup, cancellation, concurrency, retries, migrations, and rollback behavior.
6. Separate real defects from taste concerns. Report only issues with realistic impact.
7. For each issue, recommend the simpler direction: remove a concept, fix the representation, preserve compatibility, defer speculative scope, or narrow the change surface.

## Technical plan review

When reviewing a technical plan or requirement set, judge the plan before implementation details. The output should help the team decide what to do, what to cut, and what to improve.

Classify recommendations into:

- **Do**: necessary work that solves a real problem, protects compatibility, preserves invariants, or removes meaningful operational risk.
- **Remove**: speculative features, knobs, abstractions, rewrites, or edge-case handling that add states without proven need.
- **Defer**: plausible future work that should wait for evidence, scale, customer demand, or a cleaner integration point.
- **Optimize**: changes that reduce complexity, collapse special cases, improve the data model, tighten boundaries, or lower operational cost without expanding scope.

Evaluate plan quality through these questions:

- What concrete failure, user pain, or operational risk justifies this work now?
- Which requirements are compatibility obligations versus optional product choices?
- Does the proposed data model make invalid states hard to represent?
- Are there fewer states, fewer modes, or fewer ownership paths that solve the same problem?
- What can be shipped incrementally without trapping users in a broken migration path?
- What is the rollback story if the plan is wrong?
- Which tests or observability signals would prove the plan works in production?

Flag over-scoped plans when they combine unrelated problems, require too many new concepts, introduce permanent compatibility debt, or optimize a path that is not yet proven hot.

## Finding criteria

Report a finding only when it:

- Points to specific code or a specific design decision.
- Explains a realistic failure mode or maintenance cost.
- Identifies the affected user, caller, data, workflow, or operator.
- Suggests a simpler or safer direction.

Do not report generic best practices, unsupported speculation, or personal preference.

## Severity guide

- **Critical**: data loss, security vulnerability, remote crash, corrupt persisted state, irreversible migration bug, or guaranteed production outage.
- **High**: compatibility break, common-path regression, serious race/lifetime bug, incorrect ownership, broken migration, or significant performance cliff.
- **Medium**: edge-case bug, unclear invariant, scattered special cases, fragile error handling, missing boundary validation, or test gap for likely regressions.
- **Low**: maintainability issue with limited blast radius, confusing naming that hides ownership, avoidable complexity, or non-blocking cleanup.

## Common audit lenses

### API and compatibility

Treat public contracts as userspace. Flag silent payload changes, renamed fields, removed defaults, changed errors, broken routes, config incompatibility, schema drift, and missing migration paths.

### Data and persistence

Check migrations, existing rows, nullability, indexes, locking, transactions, idempotency, rollback safety, old-version readers, and data ownership. Persisted data is a compatibility surface.

### State and UI

Check source of truth, derived state, stale closures, loading/error transitions, accessibility regressions, route compatibility, and continuity of existing user workflows. Prefer explicit states over boolean combinations.

### Concurrency and async

Check ownership across await/thread boundaries, cancellation, retries, partial failure, cleanup, races, and stale references. Make lifetime visible; do not confuse locking with ownership.

### Error handling and cleanup

Good error handling preserves invariants and makes cleanup boring. Centralized cleanup is acceptable when it reduces duplicated exit logic and missed cleanup. Do not swallow errors callers need for safe decisions.

### Security boundaries

Check validation at boundaries, authorization assumptions, secret handling, injection, unsafe deserialization, path handling, and sensitive logging. Security findings should be concrete and reproducible when possible.

## Output format

Default to the user's language. Start with findings; keep summaries brief.

```markdown
**Findings**
- [Severity] `path:line` Problem statement. Explain the concrete failure mode and why it matters. Recommend the simpler direction.

**Open Questions**
- Question or assumption that affects the review, if any.

**Good Taste Check**
- Data model: pass/fail with one sentence.
- Special cases: pass/fail with one sentence.
- Compatibility: pass/fail with one sentence.
- Practicality: pass/fail with one sentence.

**Scope Decisions**
- Do: requirements or changes that should stay, if reviewing a plan.
- Remove: requirements or changes that add unjustified complexity, if any.
- Defer: plausible future work that lacks current evidence, if any.
- Optimize: simplifications or model changes worth doing now, if any.

**Verdict**
Short decision: block, fix before merge, acceptable with follow-ups, approve plan with cuts, or no findings.
```

If there are no findings, say so explicitly and mention residual risks or unverified areas.

## Tone calibration

Use strong language for broken designs, not for people.

Good examples:

- "This adds a second source of truth; the cache and database can now disagree after a failed write."
- "The boolean flag is carrying three states. Model the states explicitly or collapse the branch into the caller."
- "This breaks existing config files without a migration path. That is a compatibility bug, not an implementation detail."

Avoid personal insults, performative anger, claims about what Linus would say, and vague statements like "this is bad" without a failure mode.

## Final check before responding

Before sending the review, verify that you:

- Started with the most important concrete findings.
- Avoided style-only nits and unsupported speculation.
- Explained the affected surface, failure mode, and simpler path.
- Kept the tone technical rather than performative.
