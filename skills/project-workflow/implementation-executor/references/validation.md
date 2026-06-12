# Validation And Review Evidence

Validation proves that current-scope behavior works and that the integrated task branch is safe enough to accept. Worker validation is useful, but final acceptance belongs to the main agent.

## Validation Levels

Use the smallest validation that proves the relevant behavior, then widen as risk increases.

Common levels:

- targeted unit or integration tests for the changed behavior;
- contract tests written by the main agent;
- typecheck, lint, format, or build commands required by the project;
- manual browser, CLI, API, or runtime smoke only when the task requires observable flow evidence;
- full suite only when project rules require it or risk justifies cost.

Do not run high-resource validations in parallel unless explicitly authorized.

## Evidence Rules

Record evidence in `evidence/validation.md`:

- command or manual action;
- working directory or route;
- purpose;
- result;
- short failure summary when failed;
- rerun evidence after fixes;
- what acceptance item the evidence supports.

Do not paste full logs unless necessary. Summarize and link to local artifacts when useful. Redact secrets and sensitive data.

## Worker Validation

Worker reports must include:

- assigned contract test results;
- targeted validation run in the worker worktree;
- commands requested from the main agent when validation is too resource-heavy;
- known risks or unvalidated paths.

The main agent should not treat worker validation as final aggregate validation after integration.

## Reviewer Review

Reviewer reports should verify:

- worker objective was satisfied;
- changed files are inside allowed scope;
- forbidden files were not changed;
- contract tests were not weakened;
- required validation evidence exists;
- behavior does not regress current-scope requirements;
- security, data-loss, compatibility, and concurrency risks were considered when relevant.

Reviewer `pass` is required before the integration gate, but it does not replace final aggregate review.

## Final Aggregate Review

After accepted worker results are integrated into the task branch:

- compare task branch against target branch;
- review the combined diff for cross-worker interaction bugs;
- confirm no contract tests were weakened;
- confirm no unrelated scope creep landed;
- run project-appropriate validation;
- record findings, fixes, and evidence.

Use project-required review skills or review workflows when available. If none exist, perform a generic correctness, security, compatibility, and test-coverage review.

## Handling Failures

When validation fails:

- classify whether the failure is current-scope, unrelated existing failure, environment/tooling issue, or invalid test;
- fix current-scope failures;
- record unrelated or environment failures with evidence and residual risk;
- do not claim completion if required validation for current scope is missing.

When a required command cannot run:

- record the command;
- record why it could not run;
- run the best narrower substitute if possible;
- state the residual risk in final report and acceptance matrix.
