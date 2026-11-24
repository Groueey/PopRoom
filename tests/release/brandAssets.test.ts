import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';

const ASSETS_DIR = path.resolve(process.cwd(), 'assets');
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

interface PngInfo {
  width: number;
  height: number;
  colorType: number;
  topLeftAlpha: number;
  centerAlpha: number;
}

function inspectPng(filePath: string): PngInfo {
  const buf = fs.readFileSync(filePath);
  expect(buf.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const colorType = buf.readUInt8(25);

  const idats: Buffer[] = [];
  let offset = 8;
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') {
      idats.push(buf.subarray(offset + 8, offset + 8 + length));
    }
    offset += 12 + length;
  }

  const raw = zlib.inflateSync(Buffer.concat(idats));
  const bpp = colorType === 6 ? 4 : 3;
  const stride = 1 + width * bpp;
  const topLeftAlpha = colorType === 6 ? (raw[4] ?? -1) : 255;
  const cy = Math.floor(height / 2);
  const cx = Math.floor(width / 2);
  const centerAlpha = colorType === 6 ? (raw[cy * stride + 1 + cx * 4 + 3] ?? -1) : 255;
  return { width, height, colorType, topLeftAlpha, centerAlpha };
}

describe('PopRoom brand PNG assets', () => {
  it('provides valid 1024x1024 opaque icon.png', () => {
    const info = inspectPng(path.join(ASSETS_DIR, 'icon.png'));
    expect(info.width).toBe(1024);
    expect(info.height).toBe(1024);
    expect(info.topLeftAlpha).toBe(255);
    expect(info.centerAlpha).toBe(255);
  });

  it('provides valid 1024x1024 adaptive-icon.png with transparent outer safe-zone margin', () => {
    const info = inspectPng(path.join(ASSETS_DIR, 'adaptive-icon.png'));
    expect(info.width).toBe(1024);
    expect(info.height).toBe(1024);
    expect(info.colorType).toBe(6);
    expect(info.topLeftAlpha).toBe(0);
    expect(info.centerAlpha).toBe(255);
  });

  it('provides valid 1024x1024 splash-icon.png with transparent background', () => {
    const info = inspectPng(path.join(ASSETS_DIR, 'splash-icon.png'));
    expect(info.width).toBe(1024);
    expect(info.height).toBe(1024);
    expect(info.colorType).toBe(6);
    expect(info.topLeftAlpha).toBe(0);
    expect(info.centerAlpha).toBe(255);
  });

  it('provides valid 48x48 favicon.png', () => {
    const info = inspectPng(path.join(ASSETS_DIR, 'favicon.png'));
    expect(info.width).toBe(48);
    expect(info.height).toBe(48);
    expect(info.centerAlpha).toBe(255);
  });
});
