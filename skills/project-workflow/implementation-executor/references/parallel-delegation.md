# Parallel Delegation

Parallel delegation is optional. Use it to reduce turnaround time only when ownership boundaries are clear and results can be integrated safely.

## Default Limits

```text
maxParallelExecutorWorkers = 3
maxParallelReviewerWorkers = 2
maxTotalParallelSubagents = 4
maxAutomaticFixAttemptsPerWorker = 2
```

Lower these limits for slow tests, heavy builds, browser automation, chain/fork tooling, local service contention, or runtime capacity pressure.

High-resource validation is serialized by the main agent unless explicitly authorized otherwise.

## Good Parallel Work

Parallelize work items that:

- have disjoint write sets;
- have clear allowed and forbidden paths;
- do not require changing the same schema, API contract, core type, shared state machine, or migration;
- can be validated independently;
- can be integrated in any order or with an explicit low-risk order.

Examples:

- independent UI route and backend read-only endpoint after shared API contract is stable;
- separate adapters with no shared public type changes;
- documentation backfill and test fixture updates after implementation is stable.

## Poor Parallel Work

Keep serial when work touches:

- one shared data model or migration;
- one API contract used by multiple slices;
- one state machine, executor, scheduler, or persistence boundary;
- one generated artifact;
- files likely to conflict;
- a foundation that later slices depend on.

If write-set isolation cannot be proven, do not parallelize.

## Delegation Planning Steps

1. List all in-scope acceptance items.
2. Identify shared foundations and do them serially first.
3. Group remaining work by ownership boundary.
4. Mark each group with allowed paths, forbidden paths, dependencies, tests, and expected output.
5. Assign worker ids such as `W01-storage`, `W02-api`, `W03-ui`.
6. Queue reviewer ids such as `R-W01-storage`.
7. Record the plan in `TODO.md` and `state.json`.

## Worker Queue Rules

- Execution may be parallel; integration is controlled by the main agent.
- A worker result enters `reported-done` only with a worker report, worker commit, clean worktree, and required validation evidence.
- A worker result enters `reviewing` only after the main agent verifies the basic report metadata.
- A worker result enters `integrating` only after reviewer pass and integration gate.
- A worker result enters `integrated` only after the task branch contains the accepted result and integration evidence is recorded.

## Dependency Rules

- A worker may depend on another worker only through an integrated task-branch result, not through unreviewed draft changes.
- If a dependency emerges during implementation, stop that worker and revise the plan.
- Do not let one worker pull unreviewed code directly from another worker branch unless the main agent explicitly approves a recovery path.

## Main-Agent Context Control

The main agent should avoid deep code review of individual worker diffs before reviewer pass. Consume structured reports, metadata, and validation summaries. Save detailed code review for the final aggregate task-branch diff.
