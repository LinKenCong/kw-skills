#!/usr/bin/env node

/**
 * Visual diff between a design screenshot and an HTML file.
 *
 * Launches headless Chrome to capture the HTML page, resizes the design
 * screenshot to match, then runs pixelmatch to produce a diff image and
 * mismatch percentage.
 *
 * Supports optional region-based diffing via --regions for per-section
 * mismatch analysis. Regions are defined by Figma bounding boxes.
 *
 * @example
 *   node visual-diff.mjs --design screenshot.png --html golden-reference.html --out-dir ./.figma-to-code/43-1047
 *   node visual-diff.mjs --design screenshot.png --html golden-reference.html --out-dir ./.figma-to-code/43-1047 --regions '[{"name":"hero","x":0,"y":0,"w":1280,"h":600}]' --json
 */

import { parseArgs } from 'node:util';
import { resolve, join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const DEVICE_SCALE_FACTOR = 2;
const MAX_REGION_DIFF_IMAGES = 2;

function parseCliArgs() {
  const { values } = parseArgs({
    options: {
      design:    { type: 'string', short: 'd' },
      html:      { type: 'string', short: 'h' },
      'out-dir': { type: 'string', short: 'o' },
      threshold: { type: 'string', short: 't' },
      width:     { type: 'string', short: 'w' },
      regions:   { type: 'string', short: 'r' },
      json:      { type: 'boolean' },
      help:      { type: 'boolean' },
    },
    strict: false,
  });

  if (values.help) {
    console.log(`Usage: visual-diff.mjs --design <png> --html <html-file> --out-dir <dir>

Options:
  --design, -d     Path to the design screenshot (PNG)
  --html, -h       Path to the HTML file to screenshot
  --out-dir, -o    Directory to write output files (html-screenshot.png, visual-diff.png)
  --threshold, -t  Pixel match threshold 0-1 (default: 0.1, lower = stricter)
  --width, -w      Viewport width for HTML screenshot (default: auto-detect from design image)
  --regions, -r    JSON array of regions [{name, x, y, w, h}] in Figma logical coords, or path to JSON file
  --json           Output result as JSON
  --help           Show this help`);
    process.exit(0);
  }

  if (!values.design || !values.html || !values['out-dir']) {
    console.error('Error: --design, --html, and --out-dir are required');
    process.exit(1);
  }

  let regions = null;
  if (values.regions) {
    try {
      const regionsInput = values.regions.trim();
      if (regionsInput.startsWith('[')) {
        regions = JSON.parse(regionsInput);
      } else {
        regions = JSON.parse(readFileSync(resolve(regionsInput), 'utf-8'));
      }
    } catch (err) {
      console.error(`Error parsing --regions: ${err.message}`);
      process.exit(1);
    }
  }

  return {
    designPath:  resolve(values.design),
    htmlPath:    resolve(values.html),
    outDir:      resolve(values['out-dir']),
    threshold:   values.threshold ? parseFloat(values.threshold) : 0.1,
    viewportWidth: values.width ? parseInt(values.width, 10) : null,
    regions,
    jsonOutput:  !!values.json,
  };
}

async function captureHtmlScreenshot(htmlPath, viewportWidth) {
  const puppeteer = await import('puppeteer');
  const browser = await puppeteer.default.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: viewportWidth, height: 800, deviceScaleFactor: DEVICE_SCALE_FACTOR });

    const fileUrl = pathToFileURL(htmlPath).href;
    await page.goto(fileUrl, { waitUntil: 'networkidle0', timeout: 30_000 });

    await page.evaluate(() => document.fonts?.ready);

    const screenshotBuffer = await page.screenshot({ fullPage: true });
    return screenshotBuffer;
  } finally {
    await browser.close();
  }
}

async function padToSize(sharpModule, sourceBuffer, targetWidth, targetHeight) {
  const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };
  const resized = await sharpModule(sourceBuffer)
    .resize(targetWidth, null, { fit: 'inside' })
    .png()
    .toBuffer();
  const meta = await sharpModule(resized).metadata();
  const padBottom = targetHeight - meta.height;
  if (padBottom <= 0) {
    return sharpModule(resized).resize(targetWidth, targetHeight, { fit: 'cover', position: 'top' }).png().toBuffer();
  }
  return sharpModule(resized)
    .extend({ top: 0, bottom: padBottom, left: 0, right: 0, background: WHITE })
    .png()
    .toBuffer();
}

async function runDiff(designBuffer, htmlBuffer, pixelThreshold) {
  const { default: pixelmatch } = await import('pixelmatch');
  const { PNG } = await import('pngjs');

  const designPng = PNG.sync.read(designBuffer);
  const htmlPng = PNG.sync.read(htmlBuffer);

  const { width, height } = designPng;
  const diffPng = new PNG({ width, height });

  const mismatchedPixels = pixelmatch(
    designPng.data,
    htmlPng.data,
    diffPng.data,
    width,
    height,
    { threshold: pixelThreshold, alpha: 0.3, diffColor: [255, 0, 0] }
  );

  const totalPixels = width * height;
  const mismatchRate = mismatchedPixels / totalPixels;
  const diffBuffer = PNG.sync.write(diffPng);

  return { mismatchRate, mismatchedPixels, totalPixels, diffBuffer };
}

/**
 * Clamp region coordinates to fit within image dimensions.
 * Coordinates are in pixel space (already scaled by DEVICE_SCALE_FACTOR).
 */
function clampRegion(left, top, width, height, imgWidth, imgHeight) {
  const clampedLeft = Math.max(0, Math.min(left, imgWidth - 1));
  const clampedTop = Math.max(0, Math.min(top, imgHeight - 1));
  const clampedWidth = Math.min(width, imgWidth - clampedLeft);
  const clampedHeight = Math.min(height, imgHeight - clampedTop);

  if (clampedWidth <= 0 || clampedHeight <= 0) return null;

  return { left: clampedLeft, top: clampedTop, width: clampedWidth, height: clampedHeight };
}

/**
 * Run per-region diffs on the already-padded design and HTML images.
 * Regions are in Figma logical coords; they get scaled by DEVICE_SCALE_FACTOR.
 */
async function runRegionDiffs(sharpModule, designBuffer, htmlBuffer, regions, pixelThreshold, imgWidth, imgHeight, outDir) {
  const regionResults = [];

  for (const region of regions) {
    if (typeof region.x !== 'number' || typeof region.y !== 'number' ||
        typeof region.w !== 'number' || typeof region.h !== 'number') {
      regionResults.push({
        name: region.name || 'unknown',
        mismatchRate: 0,
        box: { x: region.x, y: region.y, w: region.w, h: region.h },
        skipped: true,
      });
      continue;
    }

    const pixelLeft = Math.round(region.x * DEVICE_SCALE_FACTOR);
    const pixelTop = Math.round(region.y * DEVICE_SCALE_FACTOR);
    const pixelWidth = Math.round(region.w * DEVICE_SCALE_FACTOR);
    const pixelHeight = Math.round(region.h * DEVICE_SCALE_FACTOR);

    const clamped = clampRegion(pixelLeft, pixelTop, pixelWidth, pixelHeight, imgWidth, imgHeight);
    if (!clamped) {
      regionResults.push({
        name: region.name,
        mismatchRate: 0,
        box: { x: region.x, y: region.y, w: region.w, h: region.h },
        skipped: true,
      });
      continue;
    }

    const designCropped = await sharpModule(designBuffer).extract(clamped).png().toBuffer();
    const htmlCropped = await sharpModule(htmlBuffer).extract(clamped).png().toBuffer();

    const diffResult = await runDiff(designCropped, htmlCropped, pixelThreshold);

    regionResults.push({
      name: region.name,
      mismatchRate: parseFloat((diffResult.mismatchRate * 100).toFixed(2)),
      mismatchedPixels: diffResult.mismatchedPixels,
      totalPixels: diffResult.totalPixels,
      box: { x: region.x, y: region.y, w: region.w, h: region.h },
      diffBuffer: diffResult.diffBuffer,
    });
  }

  regionResults.sort((a, b) => (b.mismatchRate || 0) - (a.mismatchRate || 0));

  let savedCount = 0;
  for (const regionResult of regionResults) {
    if (savedCount >= MAX_REGION_DIFF_IMAGES) break;
    if (regionResult.skipped || regionResult.mismatchRate <= 0) continue;

    const safeName = regionResult.name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    const diffPath = join(outDir, `region-diff-${safeName}.png`);
    writeFileSync(diffPath, regionResult.diffBuffer);
    regionResult.diffImagePath = diffPath;
    savedCount++;
  }

  return regionResults.map(({ diffBuffer, ...rest }) => rest);
}

async function main() {
  const args = parseCliArgs();
  const sharp = (await import('sharp')).default;

  if (!existsSync(args.designPath)) {
    console.error(`Design screenshot not found: ${args.designPath}`);
    process.exit(1);
  }
  if (!existsSync(args.htmlPath)) {
    console.error(`HTML file not found: ${args.htmlPath}`);
    process.exit(1);
  }

  const designMeta = await sharp(args.designPath).metadata();
  const viewportWidth = args.viewportWidth || Math.round(designMeta.width / DEVICE_SCALE_FACTOR);

  const htmlScreenshotRaw = await captureHtmlScreenshot(args.htmlPath, viewportWidth);
  const htmlMeta = await sharp(htmlScreenshotRaw).metadata();

  const targetWidth = designMeta.width;
  const targetHeight = Math.max(designMeta.height, htmlMeta.height);

  const designResized = await padToSize(sharp, readFileSync(args.designPath), targetWidth, targetHeight);
  const htmlResized = await padToSize(sharp, htmlScreenshotRaw, targetWidth, targetHeight);

  const { mismatchRate, mismatchedPixels, totalPixels, diffBuffer } = await runDiff(
    designResized,
    htmlResized,
    args.threshold
  );

  mkdirSync(args.outDir, { recursive: true });

  const htmlScreenshotPath = join(args.outDir, 'html-screenshot.png');
  const diffImagePath = join(args.outDir, 'visual-diff.png');

  writeFileSync(htmlScreenshotPath, htmlResized);
  writeFileSync(diffImagePath, diffBuffer);

  const result = {
    mismatchRate: parseFloat((mismatchRate * 100).toFixed(2)),
    mismatchedPixels,
    totalPixels,
    htmlScreenshotPath,
    diffImagePath,
    designPath: args.designPath,
    dimensions: { width: targetWidth, height: targetHeight },
  };

  if (args.regions) {
    result.regions = await runRegionDiffs(
      sharp, designResized, htmlResized,
      args.regions, args.threshold,
      targetWidth, targetHeight,
      args.outDir
    );
  }

  if (args.jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Mismatch: ${result.mismatchRate}% (${mismatchedPixels}/${totalPixels} pixels)`);
    console.log(`HTML screenshot: ${htmlScreenshotPath}`);
    console.log(`Diff image: ${diffImagePath}`);
    if (result.regions) {
      console.log(`\nRegion breakdown (${result.regions.length} regions):`);
      for (const r of result.regions) {
        const marker = r.diffImagePath ? ' *' : '';
        console.log(`  ${r.name}: ${r.mismatchRate}%${marker}`);
      }
    }
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
