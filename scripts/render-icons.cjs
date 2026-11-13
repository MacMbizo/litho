'use strict';
/**
 * Renders the Litho app icon from assets/brand/*.svg using the Electron already in devDependencies
 * (no image libraries). Run from the repo root:   npx electron scripts/render-icons.cjs
 *
 * Writes:
 *   assets/brand/build/litho-{16,24,32,48,64,128,256,512}.png
 *   assets/brand/build/litho.ico           (16..256, PNG entries)
 *   public/favicon.svg, public/favicon-32.png
 * Sizes up to 32 px use litho-small.svg (heavier strokes); larger sizes use litho.svg.
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { packIco } = require('./ico.cjs');

const ROOT = path.resolve(__dirname, '..');
const BRAND = path.join(ROOT, 'assets', 'brand');
const OUT = path.join(BRAND, 'build');
const PUBLIC = path.join(ROOT, 'public');
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512];
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const SMALL_MAX = 32;

const readSvg = (name) => fs.readFileSync(path.join(BRAND, name), 'utf8');

// Runs in the page: rasterises an SVG string at an exact pixel size and returns base64 PNG data.
function rasterize(svg, size) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      canvas.getContext('2d').drawImage(img, 0, 0, size, size);
      resolve(canvas.toDataURL('image/png').split(',')[1]);
    };
    img.onerror = () => reject(new Error('SVG failed to load'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
}

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({ show: false });
    await win.loadURL('data:text/html,<!doctype html><title>render</title>');
    const sources = { master: readSvg('litho.svg'), small: readSvg('litho-small.svg') };
    fs.mkdirSync(OUT, { recursive: true });

    const pngs = {};
    for (const size of SIZES) {
      // Give the SVG an explicit pixel size so it is rasterised at the target resolution, not scaled.
      const svg = (size <= SMALL_MAX ? sources.small : sources.master).replace('<svg ', `<svg width="${size}" height="${size}" `);
      const b64 = await win.webContents.executeJavaScript(`(${rasterize.toString()})(${JSON.stringify(svg)}, ${size})`);
      pngs[size] = Buffer.from(b64, 'base64');
      fs.writeFileSync(path.join(OUT, `litho-${size}.png`), pngs[size]);
    }

    fs.writeFileSync(path.join(OUT, 'litho.ico'), packIco(ICO_SIZES.map((size) => ({ size, png: pngs[size] }))));
    fs.mkdirSync(PUBLIC, { recursive: true });
    fs.copyFileSync(path.join(BRAND, 'litho-small.svg'), path.join(PUBLIC, 'favicon.svg'));
    fs.writeFileSync(path.join(PUBLIC, 'favicon-32.png'), pngs[32]);

    console.log(`Rendered ${SIZES.length} PNGs, litho.ico and favicons into ${path.relative(ROOT, OUT)} and public/`);
    app.exit(0);
  } catch (err) {
    console.error(err);
    app.exit(1);
  }
});
