# Manual E2E Checklist

Use after automated tests pass.

1. Run `npm install && npm run build` inside `skills/figma-react-restore`.
2. Start a target React route, for example `tests/fixtures/react-vite` with `npm install && npm run dev`.
3. Start runtime service from the target React project root, or pass it explicitly: `node <skill-dir>/dist/cli/index.js service start --project <react-project>`.
4. In Figma Desktop, import `plugin/manifest.json`, select one frame, then open the development plugin. It should auto-connect to `http://localhost:49327` without token entry or Register/Event clicks.
   - This uses a development plugin and must not require Dev Mode, REST API access, Marketplace publishing, or plugin payments. Starter plan files should work; Organization or Enterprise files may still have seat/admin restrictions.
5. Run `extract --selection`, `build-ir --run <runId> --route <route>`, then `restore --project <project> --route <route> --run <runId>`.
6. Confirm `.figma-react-restore/runs/<runId>/text-manifest.json` contains all visible Figma text, including deeply nested component text.
7. Confirm `.figma-react-restore/runs/<runId>/restore/attempts/001/` contains `expected.png`, `actual.png`, `diff.png`, `trace.zip`, `report.json`, `repair-plan.json`, and `agent-brief.json`.
8. Confirm `report.json` has `textResults`, and deliberate text mismatch produces `text-content` failures before typography/layout tuning.
9. If a design font is unavailable locally, confirm exact text/style pass can downgrade residual text-region pixel diff to `TEXT_PIXEL_DIFF_TOLERATED_FONT_RENDERING` warning rather than repeated text repair.
10. Confirm `agent-brief.json` contains top failures, next actions, `textManifestPath`, and artifact paths without embedding raw extraction, DesignIR, trace, or all DOM/style data.
11. Confirm a failed restore produces concrete text/layout/typography/color/asset actions, and after three non-improving attempts it blocks with a plateau or max-iterations reason.
