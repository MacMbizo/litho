import assert from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { packIco } = require('../scripts/ico.cjs') as { packIco: (images: Array<{ size: number; png: Buffer }>) => Buffer };

const BRAND = path.resolve('assets/brand');

test('packIco: valid ICONDIR with PNG entries (256 written as 0)', () => {
  const a = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const b = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 9, 9, 9, 9]);
  const ico = packIco([{ size: 16, png: a }, { size: 256, png: b }]);
  assert.deepStrictEqual([...ico.subarray(0, 6)], [0, 0, 1, 0, 2, 0], 'ICONDIR: reserved, type 1, count 2');
  const entry = (i: number) => ico.subarray(6 + 16 * i, 6 + 16 * (i + 1));
  assert.strictEqual(entry(0)[0], 16);
  assert.strictEqual(entry(0)[1], 16);
  assert.strictEqual(entry(1)[0], 0, '256 px width is stored as 0');
  assert.strictEqual(entry(1)[1], 0, '256 px height is stored as 0');
  assert.strictEqual(entry(0).readUInt16LE(4), 1, 'planes');
  assert.strictEqual(entry(0).readUInt16LE(6), 32, 'bpp');
  const firstOffset = 6 + 16 * 2;
  assert.strictEqual(entry(0).readUInt32LE(8), a.length);
  assert.strictEqual(entry(0).readUInt32LE(12), firstOffset);
  assert.strictEqual(entry(1).readUInt32LE(8), b.length);
  assert.strictEqual(entry(1).readUInt32LE(12), firstOffset + a.length);
  assert.ok(ico.subarray(firstOffset, firstOffset + a.length).equals(a));
  assert.ok(ico.subarray(firstOffset + a.length).equals(b));
});
const read = (name: string) => fs.readFileSync(path.join(BRAND, name), 'utf8');

/** Minimal decoder for the 8-bit RGBA, non-interlaced PNGs the render script writes. */
function decodePng(buf: Buffer): { width: number; height: number; rgba: Buffer } {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const zlib = require('node:zlib');
  assert.ok(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'PNG signature');
  let pos = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.strictEqual(data[8], 8, 'bit depth 8');
      assert.strictEqual(data[9], 6, 'colour type RGBA');
      assert.strictEqual(data[12], 0, 'not interlaced');
    }
    if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const raw: Buffer = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const rgba = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= 4 ? rgba[y * stride + x - 4] : 0;
      const b = y > 0 ? rgba[(y - 1) * stride + x] : 0;
      const c = x >= 4 && y > 0 ? rgba[(y - 1) * stride + x - 4] : 0;
      let out = v;
      if (filter === 1) out = v + a;
      else if (filter === 2) out = v + b;
      else if (filter === 3) out = v + ((a + b) >> 1);
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        out = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      rgba[y * stride + x] = out & 0xff;
    }
  }
  return { width, height, rgba };
}

test('rendered icons: ICO has 7 sizes and the overprint overlap renders dark', () => {
  const build = path.join(BRAND, 'build');
  const ico = fs.readFileSync(path.join(build, 'litho.ico'));
  assert.deepStrictEqual([...ico.subarray(0, 6)], [0, 0, 1, 0, 7, 0]);
  for (const size of [16, 24, 32, 48, 64, 128, 256, 512]) {
    const png = decodePng(fs.readFileSync(path.join(build, `litho-${size}.png`)));
    assert.strictEqual(png.width, size, `litho-${size}.png width`);
    assert.strictEqual(png.height, size, `litho-${size}.png height`);
  }
  // In litho.svg the cyan stroke "M25 14 21 46" crosses the magenta "M18 29H50" at (23.1, 29) of 64.
  // Multiplied inks give a near-black navy there; without the blend it would be plain magenta (luma ~87).
  const big = decodePng(fs.readFileSync(path.join(build, 'litho-256.png')));
  const at = (x: number, y: number) => big.rgba.subarray((y * 256 + x) * 4, (y * 256 + x) * 4 + 4);
  const [r, g, b, alpha] = at(92, 116);
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  assert.strictEqual(alpha, 255);
  assert.ok(luma < 60, `overlap luma ${luma.toFixed(1)} (rgb ${r},${g},${b}) should be dark`);
  assert.strictEqual(at(0, 0)[3], 0, 'rounded corner is transparent');
  assert.ok(fs.existsSync(path.resolve('public/favicon.svg')) && fs.existsSync(path.resolve('public/favicon-32.png')), 'favicons');
});

test('brand assets: the three SVGs exist with the approved colours', () => {
  for (const name of ['litho.svg', 'litho-small.svg', 'docatlas.svg']) {
    const svg = read(name);
    assert.ok(svg.includes('viewBox="0 0 64 64"'), `${name}: viewBox`);
    assert.ok(svg.includes('xmlns="http://www.w3.org/2000/svg"'), `${name}: xmlns`);
    for (const colour of ['#FAF7F0', '#00AEEF', '#EC008C']) assert.ok(svg.includes(colour), `${name}: ${colour}`);
    assert.ok(svg.includes('multiply'), `${name}: multiply overprint`);
    assert.ok(!svg.includes('<script'), `${name}: no script`);
    assert.ok(!/\sid=/.test(svg), `${name}: no ids (inline copies must not clash)`);
  }
  assert.ok(read('litho.svg').includes('stroke-width="6.5"'), 'master # strokes');
  assert.ok(read('litho-small.svg').includes('stroke-width="9"'), 'small # strokes');
  assert.ok(read('docatlas.svg').includes('M11 18.5 24 14l16 5 13-4.5v31L40 50l-16-5-13 4.5z'), 'folded map');
});
