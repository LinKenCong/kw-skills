import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { compareImages, cropImage } from '../dist/verify/pixel.js';

async function writePng(filePath, color, width = 10, height = 10) {
  await sharp({ create: { width, height, channels: 4, background: color } }).png().toFile(filePath);
}

test('pixel compare detects identical and changed images', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frr-pixel-'));
  const a = path.join(dir, 'a.png');
  const b = path.join(dir, 'b.png');
  const c = path.join(dir, 'c.png');
  await writePng(a, '#ffffff');
  await writePng(b, '#ffffff');
  await writePng(c, '#000000');
  const same = await compareImages(a, b, path.join(dir, 'same.diff.png'));
  assert.equal(same.diffRatio, 0);
  const different = await compareImages(a, c, path.join(dir, 'changed.diff.png'));
  assert.ok(different.diffRatio > 0.9);
});

test('crop image writes requested region', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frr-crop-'));
  const source = path.join(dir, 'source.png');
  const crop = path.join(dir, 'crop.png');
  await writePng(source, '#ff0000', 20, 20);
  assert.equal(await cropImage(source, { x: 5, y: 6, w: 7, h: 8 }, crop), true);
  const meta = await sharp(crop).metadata();
  assert.equal(meta.width, 7);
  assert.equal(meta.height, 8);
});
