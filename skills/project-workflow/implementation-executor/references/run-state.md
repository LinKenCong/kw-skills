# Run State And Cache

The run cache is temporary execution state for this workflow. It helps another agent recover the run and gives the main agent a ledger for delegation, validation, review, integration, acceptance, and cleanup.

## When To Create It

Create a run cache for every non-trivial implementation execution.

Trivial edits may skip the run cache only when all are true:

- no formal implementation task document exists;
- no subagent delegation is used;
- no TDD contract is written;
- no multi-step validation or review is needed.

## Location

Use this path:

```text
<project>/.agent-runs/implementation-executor/<run-id>/
```

Suggested run id:

```text
YYYY-MM-DD-<task-id-or-slug>
```

Subagent worktrees managed by the workflow live under:

```text
<project>/.agent-runs/.worktree/<run-id>/
```

## Ignore Rule

Before writing any run artifact:

1. Check whether `.agent-runs/` is ignored.
2. If not ignored, add an ignore entry according to project conventions.
3. Never commit `.agent-runs/` contents.

If project rules forbid changing ignore files, stop and ask how to store run state safely.

## Directory Shape

```text
.agent-runs/
  implementation-executor/
    <run-id>/
      RUN.md
      TODO.md
      state.json
      contract-tests.md
      delegations/
        W01-<slug>.prompt.md
        W01-<slug>.report.md
        W01-<slug>.fix-request-1.md
      reviews/
        R-W01-<slug>.prompt.md
        R-W01-<slug>.report.md
      evidence/
        validation.md
        review.md
        integration.md
      quarantine/
        <worker-id>-<reason>.md
      HANDOFF.md
  .worktree/
    <run-id>/
      W01-<slug>/
      R-W01-review-<slug>/
```

## Required Records

`RUN.md` records:

- objective;
- scope source;
- target branch and task branch;
- run id and cache path;
- project overrides;
- phase history;
- current status;
- important decisions.

`TODO.md` records:

- phase checklist;
- active worker queue;
- pending gates;
- cleanup checklist.

`state.json` records machine-readable status. Keep it simple and editable.

`contract-tests.md` records:

- contract test files;
- expected RED result;
- assigned workers that must preserve each test;
- later GREEN evidence.

`evidence/validation.md` records validation commands and summarized results.

`evidence/review.md` records reviewer summaries, final aggregate review, and unresolved risks.

`evidence/integration.md` records accepted worker provenance and integration results.

`evidence/finalization.md` records task-branch commits, merge or merge deferral, final worktree state, cleanup actions, and whether a runner completion signal was emitted.

`HANDOFF.md` records enough context for a new main agent to resume safely.

## Example `state.json`

```json
{
  "runId": "YYYY-MM-DD-task-slug",
  "status": "running",
  "projectRoot": "<project>",
  "targetBranch": "<target>",
  "taskBranch": "<task-branch>",
  "scopeSource": "<task-doc-or-user-request>",
  "currentPhase": "review",
  "contractTests": [
    {
      "id": "CT01",
      "path": "tests/example.test",
      "status": "green",
      "assignedWorkers": ["W01"]
    }
  ],
  "workers": [
    {
      "id": "W01",
      "slug": "example",
      "worktree": ".agent-runs/.worktree/<run-id>/W01-example",
      "branch": "work/<run-id>/W01-example",
      "commit": "<sha>",
      "status": "review-passed",
      "fixAttempts": 1
    }
  ],
  "reviewers": [
    {
      "id": "R-W01",
      "workerId": "W01",
      "status": "pass",
      "report": ".agent-runs/implementation-executor/<run-id>/reviews/R-W01-example.report.md"
    }
  ],
  "integration": [
    {
      "workerId": "W01",
      "method": "cherry-pick",
      "taskBranchCommit": "<sha>"
    }
  ],
  "finalization": {
    "implementationCommits": ["<sha>"],
    "mergeCommit": "<sha-or-null>",
    "mergeDeferredReason": null,
    "worktreeClean": true,
    "completionSignalEmitted": false
  }
}
```

## Security

Do not store:

- secrets, tokens, passwords, private keys, mnemonics, or seed material;
- full `.env` values;
- raw request or response bodies containing sensitive data;
- complete logs that may include secrets or user data;
- production credentials or private endpoints unless already public and non-sensitive.

Store command names, concise summaries, changed file lists, redacted snippets, and evidence conclusions instead.

## Formal Docs Do Not Disappear

If a formal task document, implementation index, issue, or project ledger exists, backfill it during finalization. The run cache does not replace formal project completion records.

If no formal task document exists, the run cache is the execution ledger and acceptance matrix location. Do not invent project docs unless the user asks.

## Completion Signals

If an external runner consumes a completion signal, record the exact signal and the gate evidence in the run cache before emitting it. A completion signal is only valid when the formal docs, git state, validation, review, acceptance matrix, and cleanup records all agree with the completed status. If any gate is missing, write a handoff and emit a blocked or partial result instead.
