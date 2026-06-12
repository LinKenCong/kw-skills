---
name: project-spec-design
description: Use this skill before implementation when starting a new project, product, or feature, or when a vague build request needs to become a clear requirements/design spec and later implementation task plan. Trigger for requests about designing requirements, shaping product/function form, writing a spec/PRD, clarifying MVP scope, defining acceptance criteria, planning before coding, or preparing sub-agent-friendly implementation slices. When mature product, open-source, architecture, or best-practice research could shape the design, ask the user for preferred references or search direction before researching. After spec approval, use it to create `docs/implementations/YYYY-MM-DD-<topic>/INDEX.md` and sequential task plan files such as `001-<task>.md`, with each task representing a verifiable feature/module slice. Do not use it for trivial edits with already-clear requirements.
---

# Project Spec Design

Use this skill to turn a project idea, product concept, feature request, workflow/configuration change, or vague build request into an approved requirements spec and, when requested after approval, a sequential implementation task plan.

The skill's output is not code. Its job is to establish a stable target for later implementation planning and development: what to build, what not to build, why this shape is appropriate, and how success will be judged.

## When to use

Use this skill when the user wants to:

- start a new project, product, or feature;
- shape a vague "build this" request into a clear requirements/design spec;
- write a spec, PRD, MVP definition, or acceptance criteria;
- clarify product/function form before coding;
- research mature products, open-source projects, architectures, or best practices before deciding what to build;
- turn an approved spec into implementation task documents for later development.

Do not use this skill for trivial edits with already-clear requirements, pure code review, or implementation work based on an already-approved plan.

## Operating principles

- **Clarify before designing**: inspect enough context to avoid inventing requirements.
- **Scope before solution**: decide what is in and out before discussing implementation detail.
- **Smallest useful version**: design the minimum closed loop that satisfies the user's goal.
- **Mature practice, not cargo cult**: use external references to sharpen boundaries and tradeoffs, not to copy features blindly.
- **Sequential tasks, internal parallelism**: top-level implementation tasks run in order; subagents may work in parallel only within the current task when ownership boundaries are clear.
- **Approval before persistence**: do not write final spec or implementation plan files until the user approves the corresponding draft.

## Gates

### Gate 1: spec approval

Before spec approval, do not write code, create implementation task documents, scaffold files, or call implementation-focused skills. Keep the work at requirements/design level.

After the user approves the spec draft, write it to:

```text
docs/specs/YYYY-MM-DD-<topic>-spec.md
```

Use a different path only when the user explicitly requests it.

### Gate 2: implementation plan approval

Only after spec approval should you slice implementation tasks. Present the task split for user review before writing the implementation plan files.

After approval, write:

```text
docs/implementations/YYYY-MM-DD-<topic>/INDEX.md
docs/implementations/YYYY-MM-DD-<topic>/001-<task>.md
docs/implementations/YYYY-MM-DD-<topic>/002-<task>.md
```

Do not start coding from these plans unless the user explicitly asks.

## Workflow

1. **Frame the request**: identify whether this is a new project/product, new feature, feature change, configuration/workflow change, UI/UX design, or technical requirement framing.
2. **Inspect context**: for existing projects, check README, docs, agent instructions, related modules, similar features, and relevant conventions. For new projects, clarify target users, platform, constraints, and desired minimum useful version.
3. **Ask for reference direction**: before external best-practice research, ask whether the user has preferred reference products, open-source projects, architecture directions, or wants to skip research.
4. **Research mature patterns if approved**: extract product shape, information architecture, workflow, data concepts, permission/security boundaries, operational constraints, and scope tradeoffs. Do not turn research into code-level implementation steps.
5. **Resolve blocking questions**: ask only questions that change the design. For complex decisions, ask one at a time. For small clarifications, ask up to three together and include a recommended option when useful.
6. **Draft the spec**: cover goal, users, shape, scope, non-goals, reference influence, functional behavior, data/state/config, flows, edge cases, and acceptance criteria.
7. **Persist the approved spec**: write the approved spec to `docs/specs/YYYY-MM-DD-<topic>-spec.md`, unless the user explicitly requests another path.
8. **Slice implementation tasks**: after spec approval, create sequential feature/module task slices that can be completed and verified one at a time.
9. **Persist the approved implementation plan**: write `INDEX.md` plus one task document per sequential task.

## Reference research rules

Before searching, ask the user for direction. Offer choices such as:

```text
I recommend checking mature references before finalizing the design. Which direction should I use?
A. Reference products or projects you provide
B. Open-source projects and common architecture patterns
C. Mature product/competitor flows and information architecture
D. Skip external research and design from current context
```

When using references, report:

- what was referenced;
- what is worth borrowing;
- what should not be copied;
- how the reference changes this spec's scope, shape, or constraints.

## Spec rules

A spec records the approved target, not the implementation recipe. It should make later implementation planning easier without prescribing every file or function.

Use the user's language for document prose unless project conventions or the user specify another language. Keep file names, paths, commands, and code identifiers in English.

When writing a formal spec, read `references/spec-template.md` and use the full or lightweight template based on complexity. Keep these sections unless the task is extremely small:

- goals;
- scope;
- non-goals;
- acceptance criteria.

If implementation planning reveals that the spec is incomplete, contradictory, or wrong, return to the spec, update it, and ask for user confirmation before continuing. Do not hide requirement changes inside task documents.

## Implementation slicing rules

Top-level tasks are sequential by default. Do not design the plan around multiple top-level tasks running in parallel. Parallel work belongs inside the current task as subagent work items with clear ownership boundaries.

A good implementation task is a feature or module slice that:

- produces a verifiable system state;
- has clear scope and non-goals;
- can be reviewed as a meaningful diff;
- can contain 2-4 independent subagent work items when useful;
- avoids broad overlap with later tasks;
- has explicit verification evidence.

A task is too small if it only creates a file, adds a helper, changes a button, or cannot be validated without several other tasks. A task is too large if it contains multiple unrelated user flows, spans many independent domains, or cannot be reviewed as one coherent change.

Each task document should define:

- goal and source spec sections;
- in-scope and out-of-scope work;
- sequential dependency;
- ownership boundary;
- optional subagent work items;
- integration plan;
- verification plan;
- completion record.

## Implementation index rules

`INDEX.md` is the task todo list and execution ledger. It should include:

- source spec path;
- execution model;
- sequential task table;
- current status;
- task document links;
- short task summaries;
- dependency notes;
- Git hash or commit range after completion;
- final acceptance checklist.

Use simple status values unless the project already has a convention:

```text
pending | in-progress | blocked | completed
```

Record Git hashes only when commits exist. Do not create commits unless the user explicitly asks.

## Handoff

When finishing a spec or implementation plan, report:

- document paths created or updated;
- approved scope and non-goals;
- remaining open questions or risks;
- next step, usually implementation planning after spec approval or coding after implementation-plan approval.
