import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import type { Box, Viewport } from '../schema.js';

export type CapturedDomNode = {
  nodeId: string;
  selector: string;
  box: Box;
  computed: Record<string, string>;
};

export type OverflowIssue = {
  selector: string;
  box: Box;
  scrollWidth: number;
  scrollHeight: number;
  clientWidth: number;
  clientHeight: number;
};

export type MissingAssetIssue = {
  selector: string;
  src: string;
  message: string;
};

export type BrowserCapture = {
  screenshotPath: string;
  domNodes: CapturedDomNode[];
  overflowIssues: OverflowIssue[];
  missingAssets: MissingAssetIssue[];
  failedRequests: { url: string; failure: string }[];
};

export async function captureRoute(options: {
  route: string;
  viewport: Viewport;
  outputPath: string;
  waitMs?: number;
}): Promise<BrowserCapture> {
  fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    return await captureWithBrowser(browser, options);
  } finally {
    await browser.close();
  }
}

async function captureWithBrowser(browser: Browser, options: {
  route: string;
  viewport: Viewport;
  outputPath: string;
  waitMs?: number;
}): Promise<BrowserCapture> {
  const context = await browser.newContext({
    viewport: { width: options.viewport.width, height: options.viewport.height },
    deviceScaleFactor: options.viewport.dpr,
  });
  const page = await context.newPage();
  const failedRequests: { url: string; failure: string }[] = [];
  page.on('requestfailed', (request) => {
    failedRequests.push({ url: request.url(), failure: request.failure()?.errorText || 'request failed' });
  });
  try {
    await page.goto(options.route, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined);
    await page.evaluate(() => document.fonts?.ready).catch(() => undefined);
    if (options.waitMs && options.waitMs > 0) await page.waitForTimeout(options.waitMs);
    await page.screenshot({ path: options.outputPath, fullPage: true, animations: 'disabled', scale: 'css' });
    const dom = await page.evaluate(() => {
      function boxFor(element: Element) {
        const rect = element.getBoundingClientRect();
        return { x: rect.left + window.scrollX, y: rect.top + window.scrollY, w: rect.width, h: rect.height };
      }
      function selectorFor(element: Element) {
        const nodeId = element.getAttribute('data-figma-node');
        if (nodeId) return `[data-figma-node="${nodeId.replace(/"/g, '\\"')}"]`;
        const id = element.getAttribute('id');
        if (id) return `#${id}`;
        return element.tagName.toLowerCase();
      }
      const styleKeys = [
        'display',
        'position',
        'width',
        'height',
        'fontFamily',
        'fontSize',
        'fontWeight',
        'lineHeight',
        'letterSpacing',
        'color',
        'backgroundColor',
        'borderRadius',
        'boxShadow',
        'objectFit',
        'overflow',
        'paddingTop',
        'paddingRight',
        'paddingBottom',
        'paddingLeft',
        'gap',
      ];
      const nodes = Array.from(document.querySelectorAll('[data-figma-node]')).map((element) => {
        const computedStyle = window.getComputedStyle(element);
        const computed: Record<string, string> = {};
        for (const key of styleKeys) computed[key] = computedStyle.getPropertyValue(key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)) || (computedStyle as unknown as Record<string, string>)[key] || '';
        return {
          nodeId: element.getAttribute('data-figma-node') || '',
          selector: selectorFor(element),
          box: boxFor(element),
          computed,
        };
      });
      const overflowIssues = Array.from(document.querySelectorAll('body *')).flatMap((element) => {
        const html = element as HTMLElement;
        const style = window.getComputedStyle(html);
        const overflowHidden = ['hidden', 'clip'].includes(style.overflowX) || ['hidden', 'clip'].includes(style.overflowY);
        const overflows = html.scrollWidth > html.clientWidth + 1 || html.scrollHeight > html.clientHeight + 1;
        if (!overflowHidden || !overflows) return [];
        return [{
          selector: selectorFor(element),
          box: boxFor(element),
          scrollWidth: html.scrollWidth,
          scrollHeight: html.scrollHeight,
          clientWidth: html.clientWidth,
          clientHeight: html.clientHeight,
        }];
      }).slice(0, 50);
      const missingAssets = Array.from(document.querySelectorAll('img')).flatMap((element) => {
        const image = element as HTMLImageElement;
        if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) return [];
        return [{ selector: selectorFor(element), src: image.currentSrc || image.src || '', message: 'Image did not load or has empty natural size' }];
      });
      return { nodes, overflowIssues, missingAssets };
    });
    return { screenshotPath: options.outputPath, domNodes: dom.nodes, overflowIssues: dom.overflowIssues, missingAssets: dom.missingAssets, failedRequests };
  } finally {
    await context.close();
  }
}
