import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import type { Box, Viewport } from '../schema.js';

export type CapturedDomNode = {
  nodeId: string;
  selector: string;
  box: Box;
  computed: Record<string, string>;
  textContent: string;
  innerText: string;
  ariaLabel: string;
  alt: string;
  value: string;
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

export type RasterOverlayIssue = {
  selector: string;
  tagName: string;
  box: Box;
  areaRatio: number;
  source?: string;
  backgroundImage?: string;
  position: string;
  zIndex: string;
  opacity: string;
  reason: string;
};

export type CapturedAssetUsage = {
  selector: string;
  nodeId?: string;
  tagName: string;
  box: Box;
  source?: string;
  backgroundImage?: string;
};

export type BrowserCapture = {
  screenshotPath: string;
  tracePath?: string;
  domNodes: CapturedDomNode[];
  overflowIssues: OverflowIssue[];
  missingAssets: MissingAssetIssue[];
  rasterOverlayIssues: RasterOverlayIssue[];
  assetUsages: CapturedAssetUsage[];
  failedRequests: { url: string; failure: string }[];
  visibleText: string;
};

export async function captureRoute(options: {
  route: string;
  viewport: Viewport;
  outputPath: string;
  tracePath?: string;
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
  tracePath?: string;
  waitMs?: number;
}): Promise<BrowserCapture> {
  const context = await browser.newContext({
    viewport: { width: options.viewport.width, height: options.viewport.height },
    deviceScaleFactor: options.viewport.dpr,
  });
  if (options.tracePath) {
    fs.mkdirSync(path.dirname(options.tracePath), { recursive: true });
    await context.tracing.start({ screenshots: true, snapshots: true }).catch(() => undefined);
  }
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
        'backgroundImage',
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
          textContent: element.textContent || '',
          innerText: element instanceof HTMLElement ? element.innerText || '' : '',
          ariaLabel: element.getAttribute('aria-label') || '',
          alt: element instanceof HTMLImageElement ? element.alt || '' : '',
          value: element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.value || '' : '',
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
      const assetUsages = Array.from(document.querySelectorAll('body *')).flatMap((element) => {
        const html = element as HTMLElement;
        const style = window.getComputedStyle(html);
        const box = boxFor(element);
        const tagName = element.tagName.toLowerCase();
        const image = element instanceof HTMLImageElement ? element : null;
        const source = image ? image.currentSrc || image.src || '' : '';
        const hasUrlBackground = /url\(/i.test(style.backgroundImage || '');
        if (!source && !hasUrlBackground) return [];
        return [{
          selector: selectorFor(element),
          ...(element.getAttribute('data-figma-node') ? { nodeId: element.getAttribute('data-figma-node') || '' } : {}),
          tagName,
          box,
          ...(source ? { source } : {}),
          ...(hasUrlBackground ? { backgroundImage: style.backgroundImage || '' } : {}),
        }];
      }).slice(0, 200);
      const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
      const rasterOverlayIssues = Array.from(document.querySelectorAll('body *')).flatMap((element) => {
        const html = element as HTMLElement;
        const style = window.getComputedStyle(html);
        if (style.display === 'none' || style.visibility === 'hidden' || Number.parseFloat(style.opacity || '1') <= 0.05) return [];
        const box = boxFor(element);
        if (box.w < 8 || box.h < 8) return [];
        const tagName = element.tagName.toLowerCase();
        const image = element instanceof HTMLImageElement ? element : null;
        const hasUrlBackground = /url\(/i.test(style.backgroundImage || '');
        const isRasterSurface = Boolean(image) || tagName === 'canvas' || hasUrlBackground;
        if (!isRasterSurface) return [];
        const source = image ? image.currentSrc || image.src || '' : '';
        const rasterRef = source || style.backgroundImage || '';
        const knownExtractedAsset = /\/assets\/asset_[^)'"]+/i.test(rasterRef) || /runs\/[^/]+\/assets\//i.test(rasterRef);
        if (knownExtractedAsset) return [];
        const areaRatio = (box.w * box.h) / viewportArea;
        const coversViewport = box.w >= window.innerWidth * 0.85 && box.h >= window.innerHeight * 0.55;
        const overlayPosition = ['fixed', 'absolute', 'sticky'].includes(style.position);
        const suspiciousName = /figma|screenshot|baseline|shot_|run_|\.figma-react-restore/i.test(rasterRef);
        const reason = suspiciousName && areaRatio >= 0.2
          ? 'screenshot-like source covers a large page area'
          : areaRatio >= 0.55
            ? 'raster surface covers most of the viewport'
            : coversViewport
              ? 'raster surface has viewport-like dimensions'
              : overlayPosition && areaRatio >= 0.35
                ? 'positioned raster surface behaves like an overlay'
                : '';
        if (!reason) return [];
        return [{
          selector: selectorFor(element),
          tagName,
          box,
          areaRatio,
          ...(source ? { source } : {}),
          ...(hasUrlBackground ? { backgroundImage: (style.backgroundImage || '').slice(0, 240) } : {}),
          position: style.position,
          zIndex: style.zIndex,
          opacity: style.opacity,
          reason,
        }];
      }).slice(0, 20);
      return { nodes, overflowIssues, missingAssets, assetUsages, rasterOverlayIssues, visibleText: document.body?.innerText || '' };
    });
    if (options.tracePath) {
      await context.tracing.stop({ path: options.tracePath }).catch(() => undefined);
    }
    return {
      screenshotPath: options.outputPath,
      ...(options.tracePath ? { tracePath: options.tracePath } : {}),
      domNodes: dom.nodes,
      overflowIssues: dom.overflowIssues,
      missingAssets: dom.missingAssets,
      rasterOverlayIssues: dom.rasterOverlayIssues,
      assetUsages: dom.assetUsages,
      failedRequests,
      visibleText: dom.visibleText,
    };
  } finally {
    await context.close();
  }
}
