import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { Box, RouteStateContract, RouteStateCookie, StateResult, Viewport } from '../schema.js';

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
  semanticKind?: 'image-src' | 'background-image' | 'css-mask' | 'inline-svg' | 'sprite-symbol' | 'icon-component';
  source?: string;
  backgroundImage?: string;
  maskImage?: string;
  spriteHref?: string;
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
  stateResults: StateResult[];
  visibleText: string;
};

export async function captureRoute(options: {
  route: string;
  viewport: Viewport;
  outputPath: string;
  tracePath?: string;
  waitMs?: number;
  routeState?: RouteStateContract;
}): Promise<BrowserCapture> {
  fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    return await captureWithBrowser(browser, options);
  } finally {
    await browser.close();
  }
}

async function prepareRouteState(context: BrowserContext, route: string, state?: RouteStateContract): Promise<StateResult[]> {
  const results: StateResult[] = [];
  if (!state) return results;
  if (state.cookies.length > 0) {
    try {
      await context.addCookies(state.cookies.map((cookie) => normalizeCookie(cookie, route)));
    } catch (error) {
      results.push({
        type: 'cookie',
        status: 'failed',
        message: `Route state cookie setup failed: ${error instanceof Error ? error.message : String(error)}`,
        expected: { cookies: state.cookies.map((cookie) => cookie.name) },
      });
    }
  }
  if (Object.keys(state.localStorage || {}).length > 0 || state.setupScript) {
    try {
      await context.addInitScript(({ localStorageEntries, setupScript }) => {
        const target = window as unknown as { __FRR_ROUTE_STATE_SETUP_ERRORS__?: string[] };
        target.__FRR_ROUTE_STATE_SETUP_ERRORS__ = [];
        for (const [key, value] of localStorageEntries) {
          try {
            window.localStorage.setItem(key, value);
          } catch (error) {
            target.__FRR_ROUTE_STATE_SETUP_ERRORS__.push(`localStorage.${key}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        if (setupScript) {
          try {
            new Function(setupScript)();
          } catch (error) {
            target.__FRR_ROUTE_STATE_SETUP_ERRORS__.push(`setupScript: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }, {
        localStorageEntries: Object.entries(state.localStorage || {}),
        setupScript: state.setupScript || '',
      });
    } catch (error) {
      results.push({
        type: 'setup-script',
        status: 'failed',
        message: `Route state setup script could not be registered: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  return results;
}

function normalizeCookie(cookie: RouteStateCookie, route: string): Parameters<BrowserContext['addCookies']>[0][number] {
  return {
    name: cookie.name,
    value: cookie.value,
    ...(cookie.domain ? { domain: cookie.domain, path: cookie.path || '/' } : { url: cookie.url || route }),
    ...(cookie.domain && cookie.path ? { path: cookie.path } : {}),
    ...(cookie.expires !== undefined ? { expires: cookie.expires } : {}),
    ...(cookie.httpOnly !== undefined ? { httpOnly: cookie.httpOnly } : {}),
    ...(cookie.secure !== undefined ? { secure: cookie.secure } : {}),
    ...(cookie.sameSite ? { sameSite: cookie.sameSite } : {}),
  };
}

async function waitForRouteState(page: Page, state?: RouteStateContract): Promise<StateResult[]> {
  if (!state?.waitForSelector) return [];
  try {
    await page.waitForSelector(state.waitForSelector, { state: 'visible', timeout: state.waitTimeoutMs || 5000 });
    return [{
      type: 'wait-for-selector',
      status: 'passed',
      selector: state.waitForSelector,
      expected: { visible: true },
    }];
  } catch (error) {
    return [{
      type: 'wait-for-selector',
      status: 'failed',
      selector: state.waitForSelector,
      message: `Route state wait selector was not visible: ${state.waitForSelector}`,
      expected: { visible: true, timeoutMs: state.waitTimeoutMs || 5000 },
      actual: { error: error instanceof Error ? error.message : String(error) },
    }];
  }
}

async function readSetupScriptResults(page: Page, state?: RouteStateContract): Promise<StateResult[]> {
  if (!state || (!state.setupScript && Object.keys(state.localStorage || {}).length === 0)) return [];
  const errors = await page.evaluate(() => {
    const target = window as unknown as { __FRR_ROUTE_STATE_SETUP_ERRORS__?: string[] };
    return target.__FRR_ROUTE_STATE_SETUP_ERRORS__ || [];
  }).catch((error: unknown) => [`setupResultRead: ${error instanceof Error ? error.message : String(error)}`]);
  if (errors.length > 0) {
    return [{
      type: 'setup-script',
      status: 'failed',
      message: 'Route state setup produced browser-side errors',
      expected: {
        localStorageKeys: Object.keys(state.localStorage || {}),
        setupScript: Boolean(state.setupScript),
      },
      actual: { errors },
    }];
  }
  const results: StateResult[] = [];
  if (Object.keys(state.localStorage || {}).length > 0) {
    results.push({
      type: 'local-storage',
      status: 'passed',
      expected: { keys: Object.keys(state.localStorage || {}) },
    });
  }
  if (state.setupScript) {
    results.push({
      type: 'setup-script',
      status: 'passed',
      expected: { setupScript: true },
    });
  }
  return results;
}

async function evaluateRouteState(page: Page, state?: RouteStateContract): Promise<StateResult[]> {
  if (!state || (state.expectedVisibleText.length === 0 && state.assertions.length === 0)) return [];
  return page.evaluate(({ expectedVisibleText, assertions }) => {
    function normalizeText(value: string): string {
      return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    }
    function visibleText(): string {
      return normalizeText(document.body?.innerText || '');
    }
    function isVisible(element: Element | null): boolean {
      if (!element) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number.parseFloat(style.opacity || '1') > 0.05 && rect.width > 0 && rect.height > 0;
    }
    function cookieValue(name: string): string | undefined {
      const prefix = `${encodeURIComponent(name)}=`;
      const item = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix));
      return item ? decodeURIComponent(item.slice(prefix.length)) : undefined;
    }
    const pageText = visibleText();
    const results: StateResult[] = [];
    for (const text of expectedVisibleText) {
      const expected = normalizeText(text);
      const passed = expected.length === 0 || pageText.includes(expected);
      results.push({
        type: 'visible-text',
        status: passed ? 'passed' : 'failed',
        ...(passed ? {} : { message: `Expected visible text is not present for route state: ${expected}` }),
        expected: { text: expected },
        actual: { visibleText: pageText.slice(0, 500) },
      });
    }
    for (const assertion of assertions) {
      if (assertion.type === 'visible-text') {
        const expected = normalizeText(assertion.text || assertion.value || '');
        const passed = expected.length === 0 || pageText.includes(expected);
        results.push({
          type: 'visible-text',
          status: expected ? (passed ? 'passed' : 'failed') : 'skipped',
          ...(passed || !expected ? {} : { message: `Expected visible text is not present for route state: ${expected}` }),
          expected: { text: expected },
          actual: { visibleText: pageText.slice(0, 500) },
        });
      } else if (assertion.type === 'selector-visible') {
        const element = assertion.selector ? document.querySelector(assertion.selector) : null;
        const passed = isVisible(element);
        results.push({
          type: 'selector-visible',
          status: assertion.selector ? (passed ? 'passed' : 'failed') : 'skipped',
          ...(assertion.selector ? { selector: assertion.selector } : {}),
          ...(passed || !assertion.selector ? {} : { message: `Expected selector is not visible for route state: ${assertion.selector}` }),
          expected: { visible: true },
          actual: { visible: passed },
        });
      } else if (assertion.type === 'selector-text') {
        const element = assertion.selector ? document.querySelector(assertion.selector) : null;
        const actual = normalizeText(element?.textContent || '');
        const expected = normalizeText(assertion.text || assertion.value || '');
        const passed = Boolean(assertion.selector && expected && actual.includes(expected));
        results.push({
          type: 'selector-text',
          status: assertion.selector && expected ? (passed ? 'passed' : 'failed') : 'skipped',
          ...(assertion.selector ? { selector: assertion.selector } : {}),
          ...(passed || !assertion.selector || !expected ? {} : { message: `Expected selector text is not present for route state: ${assertion.selector}` }),
          expected: { text: expected },
          actual: { text: actual },
        });
      } else if (assertion.type === 'url-contains') {
        const expected = assertion.text || assertion.value || '';
        const passed = expected.length === 0 || window.location.href.includes(expected);
        results.push({
          type: 'url-contains',
          status: expected ? (passed ? 'passed' : 'failed') : 'skipped',
          ...(passed || !expected ? {} : { message: `Current URL does not match route state expectation: ${expected}` }),
          expected: { text: expected },
          actual: { url: window.location.href },
        });
      } else if (assertion.type === 'local-storage') {
        const actual = assertion.key ? window.localStorage.getItem(assertion.key) : null;
        const passed = Boolean(assertion.key) && (assertion.value === undefined || actual === assertion.value);
        results.push({
          type: 'local-storage',
          status: assertion.key ? (passed ? 'passed' : 'failed') : 'skipped',
          expected: { key: assertion.key || '', value: assertion.value },
          actual: { value: actual },
          ...(passed || !assertion.key ? {} : { message: `localStorage route state assertion failed: ${assertion.key}` }),
        });
      } else if (assertion.type === 'cookie') {
        const actual = assertion.name ? cookieValue(assertion.name) : undefined;
        const passed = Boolean(assertion.name) && (assertion.value === undefined || actual === assertion.value);
        results.push({
          type: 'cookie',
          status: assertion.name ? (passed ? 'passed' : 'failed') : 'skipped',
          expected: { name: assertion.name || '', value: assertion.value },
          actual: { value: actual || '' },
          ...(passed || !assertion.name ? {} : { message: `Cookie route state assertion failed: ${assertion.name}` }),
        });
      }
    }
    return results;
  }, {
    expectedVisibleText: state.expectedVisibleText,
    assertions: state.assertions,
  });
}

async function captureWithBrowser(browser: Browser, options: {
  route: string;
  viewport: Viewport;
  outputPath: string;
  tracePath?: string;
  waitMs?: number;
  routeState?: RouteStateContract;
}): Promise<BrowserCapture> {
  const context = await browser.newContext({
    viewport: { width: options.viewport.width, height: options.viewport.height },
    deviceScaleFactor: options.viewport.dpr,
  });
  const setupResults = await prepareRouteState(context, options.route, options.routeState);
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
    const stateResults = [
      ...setupResults,
      ...await waitForRouteState(page, options.routeState),
    ];
    if (options.waitMs && options.waitMs > 0) await page.waitForTimeout(options.waitMs);
    stateResults.push(
      ...await readSetupScriptResults(page, options.routeState),
      ...await evaluateRouteState(page, options.routeState)
    );
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
        const maskImage = (style.getPropertyValue('mask-image') || style.getPropertyValue('-webkit-mask-image') || '').trim();
        const hasMask = /url\(/i.test(maskImage);
        const use = element instanceof SVGUseElement ? element : element.querySelector('use');
        const spriteHref = use?.getAttribute('href') || use?.getAttribute('xlink:href') || '';
        const inlineSvg = element instanceof SVGSVGElement;
        const className = typeof element.getAttribute('class') === 'string' ? element.getAttribute('class') || '' : '';
        const iconComponent = /\b(icon|lucide|heroicon|tabler|phosphor|material-icons|fa-|bi-|ri-)\b/i.test(className)
          || element.getAttribute('role') === 'img';
        if (!source && !hasUrlBackground && !hasMask && !spriteHref && !inlineSvg && !iconComponent) return [];
        const mappedNode = element.getAttribute('data-figma-node') || element.closest('[data-figma-node]')?.getAttribute('data-figma-node') || '';
        const semanticKind = (source
          ? 'image-src'
          : hasUrlBackground
            ? 'background-image'
            : hasMask
              ? 'css-mask'
              : spriteHref
                ? 'sprite-symbol'
                : inlineSvg
                  ? 'inline-svg'
                  : 'icon-component') as 'image-src' | 'background-image' | 'css-mask' | 'inline-svg' | 'sprite-symbol' | 'icon-component';
        return [{
          selector: selectorFor(element),
          ...(mappedNode ? { nodeId: mappedNode } : {}),
          tagName,
          box,
          semanticKind,
          ...(source ? { source } : {}),
          ...(hasUrlBackground ? { backgroundImage: style.backgroundImage || '' } : {}),
          ...(hasMask ? { maskImage } : {}),
          ...(spriteHref ? { spriteHref } : {}),
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
      stateResults,
      visibleText: dom.visibleText,
    };
  } finally {
    await context.close();
  }
}
