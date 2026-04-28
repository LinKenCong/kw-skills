import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// Browser verification requires a local Playwright Chromium that can launch in the host OS.
// Run outside restrictive sandboxes with: npm run test:browser
const enabled = process.env.FRR_BROWSER_TEST === '1';

test('browser capture records screenshot, mapped DOM, and raster overlay issues', { skip: !enabled }, async () => {
  const { captureRoute } = await import('../dist/verify/capture.js');
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frr-browser-'));
  const server = http.createServer((req, res) => {
    if (req.url === '/large.png') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lwqYuwAAAABJRU5ErkJggg==', 'base64'));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><html><body style="margin:0">
      <img class="overlay" src="/large.png" style="position:absolute; inset:0; width:100vw; height:80vh; object-fit:cover" />
      <main data-figma-node="1:1" style="font: 16px/20px sans-serif; color: rgb(1, 2, 3)">Exact Copy</main>
    </body></html>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const capture = await captureRoute({
      route: `http://127.0.0.1:${port}`,
      viewport: { width: 320, height: 240, dpr: 1 },
      outputPath: path.join(outputDir, 'actual.png'),
    });
    assert.ok(fs.existsSync(capture.screenshotPath));
    assert.equal(capture.domNodes[0].nodeId, '1:1');
    assert.match(capture.visibleText, /Exact Copy/);
    assert.ok(capture.rasterOverlayIssues.some((issue) => issue.selector.includes('img')));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
