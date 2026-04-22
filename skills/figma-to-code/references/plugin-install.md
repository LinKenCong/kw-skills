# Plugin Installation Guide

## First-Time Installation

1. Open **Figma Desktop** (must be the desktop app, not the browser version)
2. Go to menu: **Plugins → Development → Import plugin from manifest...**
3. In the file picker, navigate to the resolved skill manifest path: `<skill>/plugin/manifest.json`
4. Click confirm to import

After successful import, **"Figma Bridge Extractor"** will appear under **Plugins → Development**.

(To update: remove existing plugin via Plugins → Development → Remove, then re-import manifest.json)

## Using the Plugin

1. Open the target design file in Figma Desktop
2. Go to **Plugins → Development → Figma Bridge Extractor**
3. The plugin window will show the Bridge SSE connection status:
   - "Bridge SSE Connected" (green) → Ready
   - "Bridge SSE Disconnected" (red) → Start the Bridge first: `node <skill>/scripts/bridge_client.mjs ensure`
4. Once connected, the plugin automatically waits for and relays extraction commands from the Bridge.

When guiding a user manually, prefer giving the resolved absolute manifest path instead of only a repo-relative fragment.

## Troubleshooting NO_PLUGIN_CONNECTION

| Check | Action |
|-------|--------|
| Bridge running? | `node <skill>/scripts/bridge_client.mjs health` |
| Plugin window visible + SSE status green? | Verify plugin window is open and shows "Bridge SSE Connected" |
| `allowedDomains` correct? | `manifest.json` must include `http://localhost:3333` |
