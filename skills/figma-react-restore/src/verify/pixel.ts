import fs from 'node:fs';
import path from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import sharp from 'sharp';
import type { Box } from '../schema.js';

export type ImageCompareResult = {
  width: number;
  height: number;
  totalPixels: number;
  diffPixels: number;
  diffRatio: number;
  expectedPath: string;
  actualPath: string;
  diffPath: string;
};

export async function compareImages(expectedPath: string, actualPath: string, diffPath: string): Promise<ImageCompareResult> {
  const expectedMeta = await sharp(expectedPath).metadata();
  const actualMeta = await sharp(actualPath).metadata();
  const width = Math.max(expectedMeta.width || 0, actualMeta.width || 0);
  const height = Math.max(expectedMeta.height || 0, actualMeta.height || 0);
  if (width <= 0 || height <= 0) throw new Error('Cannot compare empty images');

  const expected = await normalizeImage(expectedPath, width, height);
  const actual = await normalizeImage(actualPath, width, height);
  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(expected, actual, diff.data, width, height, {
    threshold: 0.12,
    includeAA: false,
    alpha: 0.35,
  });
  fs.mkdirSync(path.dirname(diffPath), { recursive: true });
  fs.writeFileSync(diffPath, PNG.sync.write(diff));
  const totalPixels = width * height;
  return { width, height, totalPixels, diffPixels, diffRatio: totalPixels === 0 ? 0 : diffPixels / totalPixels, expectedPath, actualPath, diffPath };
}

export async function cropImage(sourcePath: string, box: Box, outputPath: string): Promise<boolean> {
  const meta = await sharp(sourcePath).metadata();
  const sourceWidth = meta.width || 0;
  const sourceHeight = meta.height || 0;
  const left = clamp(Math.floor(box.x), 0, sourceWidth);
  const top = clamp(Math.floor(box.y), 0, sourceHeight);
  const right = clamp(Math.ceil(box.x + box.w), 0, sourceWidth);
  const bottom = clamp(Math.ceil(box.y + box.h), 0, sourceHeight);
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) return false;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await sharp(sourcePath).extract({ left, top, width, height }).png().toFile(outputPath);
  return true;
}

export async function getImageSize(sourcePath: string): Promise<{ width: number; height: number }> {
  const meta = await sharp(sourcePath).metadata();
  return { width: meta.width || 0, height: meta.height || 0 };
}

async function normalizeImage(sourcePath: string, width: number, height: number): Promise<Buffer> {
  const meta = await sharp(sourcePath).metadata();
  const sourceWidth = meta.width || 0;
  const sourceHeight = meta.height || 0;
  return sharp(sourcePath)
    .ensureAlpha()
    .extend({
      right: Math.max(0, width - sourceWidth),
      bottom: Math.max(0, height - sourceHeight),
      background: { r: 255, g: 255, b: 255, alpha: 0 },
    })
    .raw()
    .toBuffer();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
