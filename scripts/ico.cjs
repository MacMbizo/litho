'use strict';

/**
 * Packs PNG images into a Windows .ico (Vista+ PNG-compressed entries).
 * Layout: ICONDIR (6 bytes) + one ICONDIRENTRY (16 bytes) per image + the PNG data in input order.
 * A 256 px image is written with width/height byte 0, as the format requires.
 *
 * @param {Array<{ size: number, png: Buffer }>} images
 * @returns {Buffer}
 */
function packIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  const entries = Buffer.alloc(16 * images.length);
  let offset = header.length + entries.length;
  images.forEach(({ size, png }, i) => {
    const e = 16 * i;
    const dim = size >= 256 ? 0 : size;
    entries.writeUInt8(dim, e); // width
    entries.writeUInt8(dim, e + 1); // height
    entries.writeUInt8(0, e + 2); // palette colours
    entries.writeUInt8(0, e + 3); // reserved
    entries.writeUInt16LE(1, e + 4); // colour planes
    entries.writeUInt16LE(32, e + 6); // bits per pixel
    entries.writeUInt32LE(png.length, e + 8);
    entries.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });

  return Buffer.concat([header, entries, ...images.map((img) => img.png)]);
}

module.exports = { packIco };
