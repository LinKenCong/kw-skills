---
name: skill-template-manager
description: Manage a manager-owned skill store, reusable symlink-based skill templates, and project-level skill activation. Use this skill when the user wants shared skill profiles, template folders such as frontend-react, installing skills from npx skills or a user-specified repository into a controlled store, linking templates into .agents/skills, linking individual skills into a project, validating symlink health, or avoiding duplicate skill installations across projects.
allowed-tools: terminal, file
---

# Skill Template Manager

Manage shared agent skills with a manager-owned store and symlink templates.

Use the bundled script for filesystem operations. Do not hand-roll symlink changes unless the script is missing or cannot run.

## Core Model

```text
~/.skill-template-manager/
  store/
    <skill-name>/
      SKILL.md
      .stm/source.json

  templates/
    <template-name>/
      TEMPLATE.md
      skills/
        <skill-name> -> ../../../store/<skill-name>

  .staging/
    <install-id>/
      .agents/skills/<downloaded-skill>/
```

Project activation:

```text
project/.agents/skills -> ~/.skill-template-manager/templates/<template-name>/skills
```

Single-skill activation:

```text
project/.agents/skills/<skill-name> -> ~/.skill-template-manager/store/<skill-name>
```

Default project skills directory is `.agents/skills`. If the user explicitly requires another agent path, pass `--skills-dir <path>`.

## Non-Negotiable Rules

- The manager must own the real store. Never use user global skill directories as the store.
- Never install with `npx skills -g`.
- Use `npx skills` only as a search, listing, or staging-import source.
- Do not create or maintain a lock file for this manager.
- Use `store/<skill>/.stm/source.json` only as source metadata; it does not freeze versions.
- Template directories contain symlinks only under `templates/<name>/skills/`.
- Changing a template intentionally affects every project linked to that template.
- Never overwrite a real project `.agents/skills` directory. Stop and report the conflict.
- Remove only symlinks created by the manager. Never delete real skills unless the user explicitly asks to update or reinstall a store skill.

## Locate The Script

Before use, locate `**/skill-template-manager/scripts/stm.py`.

Use:

```bash
python3 <skill>/scripts/stm.py --help
```

All examples below use `<stm>` as shorthand for:

```bash
python3 <skill>/scripts/stm.py
```

Set a custom manager home only when the user asks:

```bash
STM_HOME=/path/to/manager <stm> init
```

## Initialize

When the user asks to set up the manager:

```bash
<stm> init
```

This creates:

```text
~/.skill-template-manager/store/
~/.skill-template-manager/templates/
~/.skill-template-manager/.staging/
```

## Search Or Inspect Upstream Skills

Use `npx skills` through the script so telemetry is disabled and command usage stays consistent.

Search:

```bash
<stm> npx-find react
```

List skills in a repository or source:

```bash
<stm> npx-list vercel-labs/agent-skills
<stm> npx-list https://github.com/user/repo --full-depth
```

If the user specifies a repository but not a skill, list available skills first. If multiple skills exist, ask the user to choose a specific skill unless they explicitly asked to import all.

## Import Skills Into The Manager Store

The manager imports through an isolated staging directory, then copies the resulting skill into `store/`.

Import a known `owner/repo@skill`:

```bash
<stm> import-npx vercel-labs/agent-skills@vercel-react-best-practices
```

Import a selected skill from a source:

```bash
<stm> import-npx vercel-labs/agent-skills --skill vercel-react-best-practices
```

Import from a user-specified repository:

```bash
<stm> npx-list https://github.com/user/repo
<stm> import-npx https://github.com/user/repo --skill custom-skill
```

Supported source forms are the same forms accepted by `npx skills add`, including:

```text
owner/repo@skill
owner/repo
https://github.com/user/repo
https://github.com/user/repo/tree/main/skills/my-skill
git@github.com:user/repo.git
https://gitlab.com/org/repo
local/path
```

Import and add to a template in one step:

```bash
<stm> import-npx vercel-labs/agent-skills@vercel-react-best-practices --template frontend-react
```

If `store/<skill>` already exists, do not overwrite it unless the user explicitly asked to update or reinstall:

```bash
<stm> import-npx vercel-labs/agent-skills@vercel-react-best-practices --force
```

## Adopt A Manually Placed Skill

If the user manually places a skill folder in the manager store, validate it:

```bash
<stm> store-list
<stm> doctor
```

If the user gives a local skill path outside the store and wants it managed:

```bash
<stm> adopt /path/to/my-skill
```

This copies the skill into the manager store and writes `source.json` with `type: manual`.

## Manage Templates

Create a template:

```bash
<stm> template-create frontend-react
```

Add a managed store skill to a template:

```bash
<stm> template-add frontend-react vercel-react-best-practices
```

Remove a skill from a template:

```bash
<stm> template-remove frontend-react vercel-react-best-practices
```

List templates:

```bash
<stm> template-list
```

Removing a skill from a template removes only the template symlink. It does not delete the store skill.

## Apply To Projects

Apply an entire template to the current project:

```bash
<stm> link-template frontend-react --project .
```

Apply to a specific project:

```bash
<stm> link-template frontend-react --project /path/to/project
```

This creates:

```text
<project>/.agents/skills -> ~/.skill-template-manager/templates/frontend-react/skills
```

If `<project>/.agents/skills` already exists as a real directory, stop. Do not replace it.

Link a single store skill to a project:

```bash
<stm> link-skill vercel-react-best-practices --project .
```

This creates:

```text
<project>/.agents/skills/vercel-react-best-practices -> ~/.skill-template-manager/store/vercel-react-best-practices
```

Do not use `link-skill` when the project skills directory is itself a symlink to a template; adding into that path would mutate the shared template.

Unlink a project template symlink:

```bash
<stm> unlink-project --project .
```

This only removes `.agents/skills` when it is a symlink to a manager template.

## Doctor

Run doctor after changes:

```bash
<stm> doctor
<stm> doctor --template frontend-react
<stm> doctor --project .
```

Doctor checks:

- manager home layout
- store skills with missing `SKILL.md`
- missing or invalid `source.json`
- template entries that are not symlinks
- broken template symlinks
- template symlinks pointing outside the manager store
- project `.agents/skills` symlink target

Use `--json` only when machine-readable output is needed:

```bash
<stm> doctor --project . --json
```

## Update Strategy

No manager lock file exists. Updating means re-importing a store skill from its recorded source:

```bash
<stm> update vercel-react-best-practices
```

The update flow:

1. Read `store/<skill>/.stm/source.json`.
2. Re-run the staging import from the recorded source.
3. Replace `store/<skill>` only after the new staged skill validates.
4. Leave template symlinks unchanged.
5. All linked projects immediately observe the updated store content.

If a manually adopted skill has no re-importable source, report that it cannot be updated automatically.

## Response Pattern

After performing an operation, report only:

- manager home path
- affected store skill or template
- project path if applicable
- whether symlinks were created, changed, or left unchanged
- any blocking safety issue

Do not present `npx skills` global install commands as the final solution.
