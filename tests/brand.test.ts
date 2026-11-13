import assert from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const BRAND = path.resolve('assets/brand');
const read = (name: string) => fs.readFileSync(path.join(BRAND, name), 'utf8');

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
