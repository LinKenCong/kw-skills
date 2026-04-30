# Workflow

Read this file when starting a restore task, running the CLI, managing the Figma plugin connection, or deciding whether to stop/clean up. Do not read this file for a narrow React/CSS repair if the current `agent-brief.json` already gives enough context.

## Project Root Rule

The artifact root belongs to the target React project root: `<react-project>/.figma-react-restore`.

- Run commands from the React project root, or pass the same `--project <react-project>` to `doctor`, `service start/dev`, `sessions`, `extract`, `build-ir`, `verify`, and `restore`.
- Do not run `service start` from a parent folder that only contains the app as a child; use `--project ./app` or `cd app` first.
- `doctor` is a non-mutating preflight and must not create `.figma-react-restore`; the runtime creates it only when a service/run needs artifacts.
- If two `.figma-react-restore` folders appear, the one containing `service.json` or `runs/<runId>/run.json` is the active root; an empty sibling/parent folder is stale and should not be used.

## Runtime Service Lifecycle

The runtime service is only needed for Figma Desktop plugin connection and extraction. After `extract` finishes, `build-ir`, `verify`, `repair-plan`, `brief`, and `restore` read project artifacts directly and do not require the service.

- Prefer `figma-react-restore extract --selection --manage-service`; it starts the service if needed, waits for a plugin session by default, and stops the service after extraction if it started it.
- Start `figma-react-restore service start` only when a plugin session or extraction is needed; do not keep it running during React implementation or verification loops.
- During skill development, use `figma-react-restore service dev`; it rebuilds TypeScript and restarts the runtime service when `dist/**/*.js` changes.
- If you manually start the service, keep a handle to the process and run `figma-react-restore service stop --project <react-project>` after extraction.
- Avoid unmanaged `nohup`, detached shells, or background processes without cleanup.
- After `figma-react-restore extract --selection` returns a terminal job state, stop the service before running `build-ir`; keep `.figma-react-restore/runs/<runId>/` intact.
- If multiple immediate extractions are needed, keep the service only across those extraction commands, then stop it before code repair begins.
- If a service was already running before this task, do not terminate it unless the lockfile proves it is this project's `figma-react-restore` service and it is safe to close; otherwise report the existing service and leave it running.

## Default Workflow

1. Run `figma-react-restore doctor` from the React project root.
2. Select one frame/component/region in Figma Desktop.
3. Start extraction. Prefer starting the managed extraction first, then run the `Figma React Restore` development plugin while the CLI waits for a session:

   ```bash
   figma-react-restore extract --selection --manage-service
   ```

   The plugin connects automatically to `http://localhost:49327`; no token, Register button, or Event button is required. If the plugin was opened before the managed service exists, it may briefly show a connection failure; leave it open or reopen it so it can reconnect.

4. If you already have the plugin open and connected, the same extraction command will use that session.
5. Ensure the runtime service is stopped after extraction completes. `--manage-service` stops services it started; otherwise run:

   ```bash
   figma-react-restore service stop --project .
   ```

6. Build restoration evidence:

   ```bash
   figma-react-restore build-ir --run <runId>
   ```

7. Verify or restore the React route:

   ```bash
   figma-react-restore restore --project . --route http://localhost:3000 --run <runId> --max-iterations 3
   ```

8. Read `agent-brief.json` and `text-manifest.json` first, patch the React code, then rerun `restore` until it passes or reports `blocked`.

## Optional Manual Service Flow

Use this only for debugging or repeated extractions:

```bash
figma-react-restore service start
figma-react-restore sessions
figma-react-restore extract --selection
figma-react-restore service stop --project .
```

## Restore Loop Semantics

`restore` runs verification, creates a repair plan, writes an agent brief, records the attempt, and returns one of:

- `passed`: fidelity gates passed.
- `needs-agent-patch`: read the brief/manifest, patch React/CSS, and rerun.
- `blocked`: stop and report the `blockedReason` or top failure category.

The loop blocks when the environment is unusable, design evidence is insufficient, max iterations are reached, or recent attempts show no improvement.

## Final Cleanup Rule

After final verification passes and the user confirms acceptance, automatically clean the project-scoped runtime artifacts and close any remaining local plugin runtime service. Do not ask for a second cleanup confirmation after acceptance.

- The normal flow should already stop `service start` or `service dev` immediately after extraction; at final cleanup, close only a still-running service that was started for this task.
- If needed, terminate the `pid` in `<react-project>/.figma-react-restore/service.json` only after confirming it belongs to this project's `figma-react-restore` service.
- Remove `<react-project>/.figma-react-restore/` after the service exits.
- Never delete outside the active React project artifact root.
- Do not clean before final verification and user acceptance because the artifacts are evidence.
- If cleanup is blocked by permissions or a non-owned/shared service, report the exact path or PID that still needs manual cleanup.
