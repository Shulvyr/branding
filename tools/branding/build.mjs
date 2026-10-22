import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const destination = path.join(root, 'assets/brand');
const master = JSON.parse(fs.readFileSync(path.join(destination, 'source/shulvyr-pixels.json'), 'utf8'));
const compact = JSON.parse(fs.readFileSync(path.join(destination, 'source/shulvyr-pixels-16.json'), 'utf8'));
const checkOnly = process.argv.includes('--check');
const renderPreviews = process.argv.includes('--render-previews');
if (checkOnly && renderPreviews) throw new Error('--check cannot be combined with preview generation.');
for (const [source, size] of [[master, 32], [compact, 16]]) {
  if (source.width !== size || source.height !== size || source.rows.length !== size || source.rows.some(row => row.length !== size)) {
    throw new Error(`The native Shulvyr ${size}px source must have exactly ${size} rows of ${size} cells.`);
  }
  if (JSON.stringify(source.palette) !== JSON.stringify(master.palette)) throw new Error('Both native grids must share the project palette.');
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const key = source.rows[y][x];
    if (key !== '.' && !Object.hasOwn(source.palette, key)) throw new Error(`Unknown pixel ${key}`);
  }
}
for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
  if (master.rows[y][x] !== compact.rows[Math.floor(y / 2)][Math.floor(x / 2)]) throw new Error(`32px grid must preserve every 16px cell at 2x. Mismatch at ${x},${y}.`);
}
const rgb = hex => [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16));
const themePalettes = {
  light: master.palette,
  dark: { ...master.palette, o: '#E2D2F3' },
  black: Object.fromEntries(Object.keys(master.palette).map(key => [key, ['a', 'l'].includes(key) ? null : '#000000'])),
  white: Object.fromEntries(Object.keys(master.palette).map(key => [key, ['a', 'l'].includes(key) ? null : '#FFFFFF'])),
};
const palettes = Object.fromEntries(Object.entries(themePalettes).map(([name, colors]) => [name, {
  ...Object.fromEntries(Object.entries(colors).map(([key, hex]) => [key, hex ? [...rgb(hex), 255] : [0, 0, 0, 0]])),
  '.': [0, 0, 0, 0],
}]));

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let value = n;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(data) {
  let value = 0xffffffff;
  for (const byte of data) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const label = Buffer.from(type);
  const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([label, data])));
  return Buffer.concat([size, label, data, checksum]);
}
function png(width, height, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) pixels.copy(scanlines, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(scanlines, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function scaledPixels(size, background = null, source = size === 16 ? compact : master, variant = 'light') {
  if (size < source.width || size % source.width !== 0) throw new Error('Pixel exports require integer enlargement of a native grid.');
  const scale = size / source.width;
  const result = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const key = source.rows[Math.floor(y / scale)][Math.floor(x / scale)];
    const nativeColor = palettes[variant][key];
    const color = nativeColor[3] === 0 && background ? [...rgb(background), 255] : nativeColor;
    result.set(color, (y * size + x) * 4);
  }
  return result;
}
function rects(variant = 'light', source = master) {
  let result = '';
  for (let y = 0; y < source.height; y++) {
    let x = 0;
    while (x < source.width) {
      const key = source.rows[y][x]; let end = x + 1;
      while (end < source.width && source.rows[y][end] === key) end++;
      const color = themePalettes[variant][key];
      if (key !== '.' && color) result += `<rect x="${x}" y="${y}" width="${end - x}" height="1" fill="${color}"/>`;
      x = end;
    }
  }
  return result;
}
const glyphs = {
  S: ['01111','10000','10000','01110','00001','00001','11110'],
  h: ['10000','10000','10110','11001','10001','10001','10001'],
  u: ['00000','00000','10001','10001','10001','10011','01101'],
  l: ['01100','00100','00100','00100','00100','00100','00010'],
  v: ['00000','00000','10001','10001','10001','01010','00100'],
  y: ['00000','00000','10001','10001','01111','00001','01110'],
  r: ['00000','00000','10110','11001','10000','10000','10000'],
};
function wordmark(x, y, scale, color) {
  let output = `<g transform="translate(${x} ${y}) scale(${scale})" fill="${color}">`;
  [...'Shulvyr'].forEach((letter, index) => glyphs[letter].forEach((row, gy) => [...row].forEach((cell, gx) => {
    if (cell === '1') output += `<rect x="${index * 6 + gx}" y="${gy}" width="1" height="1"/>`;
  })));
  return output + '</g>';
}
const svg = (width, height, content, label) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}" shape-rendering="crispEdges"><title>${label}</title>${content}</svg>\n`;
const iconAt = (x, y, size, source = master, variant = 'light') => {
  if (size % source.width !== 0) throw new Error('SVG placements must use integer pixel scales.');
  return `<g transform="translate(${x} ${y}) scale(${size / source.width})">${rects(variant, source)}</g>`;
};
const outputs = new Map();
for (const variant of Object.keys(themePalettes)) for (const size of [16, 32, 128, 256]) {
  const suffix = variant === 'light' ? '' : `-${variant}`;
  outputs.set(`shulvyr-icon${suffix}-${size}.png`, png(size, size, scaledPixels(size, null, size === 16 ? compact : master, variant)));
}
outputs.set('shulvyr-avatar-512.png', png(512, 512, scaledPixels(512, '#F3EFF8')));
outputs.set('shulvyr-avatar-dark-512.png', png(512, 512, scaledPixels(512, '#191423', master, 'dark')));
outputs.set('shulvyr-mark.svg', svg(32, 32, rects(), 'Shulvyr square shell mascot'));
outputs.set('shulvyr-mark-dark.svg', svg(32, 32, rects('dark'), 'Shulvyr color mark for dark backgrounds'));
outputs.set('shulvyr-mark-black.svg', svg(32, 32, rects('black'), 'Shulvyr black positive mark'));
outputs.set('shulvyr-mark-white.svg', svg(32, 32, rects('white'), 'Shulvyr white negative mark'));
outputs.set('shulvyr-mark-mono.svg', svg(32, 32, rects('black'), 'Shulvyr monochrome mark'));
outputs.set('shulvyr-wordmark.svg', svg(512, 96, iconAt(8, 16, 64) + wordmark(104, 20, 8, '#221A35'), 'Shulvyr wordmark'));
outputs.set('shulvyr-wordmark-light.svg', svg(512, 96, iconAt(8, 16, 64, master, 'dark') + wordmark(104, 20, 8, '#E2D2F3'), 'Shulvyr color wordmark for dark backgrounds'));
outputs.set('shulvyr-wordmark-black.svg', svg(512, 96, iconAt(8, 16, 64, master, 'black') + wordmark(104, 20, 8, '#000000'), 'Shulvyr black positive wordmark'));
outputs.set('shulvyr-wordmark-white.svg', svg(512, 96, iconAt(8, 16, 64, master, 'white') + wordmark(104, 20, 8, '#FFFFFF'), 'Shulvyr white negative wordmark'));
outputs.set('shulvyr-banner.svg', svg(1280, 320,
  '<rect width="1280" height="320" fill="#191423"/>' + iconAt(32, 32, 256, master, 'dark') + wordmark(336, 80, 17, '#E2D2F3') +
  '<text x="339" y="253" fill="#B79ADD" font-family="Segoe UI,Arial,sans-serif" font-size="26" shape-rendering="auto">A Bedrock server project in Zig.</text>', 'Shulvyr project banner'));

const swatches = [...new Set(Object.values(master.palette))].map((hex, index) => {
  const x = 520 + index * 136;
  return `<rect x="${x}" y="510" width="112" height="76" fill="${hex}"/><text x="${x}" y="621" fill="#48335F" font-family="Segoe UI,Arial,sans-serif" font-size="21" shape-rendering="auto">${hex}</text>`;
}).join('');
const board = '<rect width="1440" height="1040" fill="#F3EFF8"/>' + iconAt(48, 24, 256) + wordmark(336, 82, 19, '#221A35') +
  '<text x="339" y="263" fill="#48335F" font-family="Segoe UI,Arial,sans-serif" font-size="28" shape-rendering="auto">An independent Bedrock server project in Zig.</text>' +
  '<path d="M64 316H1376" stroke="#D6C9E6" stroke-width="2"/>' + iconAt(72, 344, 320) +
  '<text x="520" y="397" fill="#221A35" font-family="Segoe UI,Arial,sans-serif" font-size="40" shape-rendering="auto">A small face. A sturdy shell.</text>' +
  '<text x="520" y="448" fill="#48335F" font-family="Segoe UI,Arial,sans-serif" font-size="26" shape-rendering="auto">A flat pixel mascot with a square silhouette.</text>' +
  '<text x="113" y="695" fill="#48335F" font-family="Segoe UI,Arial,sans-serif" font-size="24" shape-rendering="auto">32 × 32 px icon</text>' + swatches +
  '<text x="520" y="699" fill="#48335F" font-family="Segoe UI,Arial,sans-serif" font-size="24" shape-rendering="auto">16px native grid. Exact integer enlargement.</text>' +
  '<rect y="760" width="1440" height="280" fill="#191423"/>' + iconAt(72, 784, 224, master, 'dark') + wordmark(336, 820, 16, '#E2D2F3') +
  '<text x="339" y="988" fill="#B79ADD" font-family="Segoe UI,Arial,sans-serif" font-size="26" shape-rendering="auto">github.com/Shulvyr</text>';
outputs.set('shulvyr-brand-board.svg', svg(1440, 1040, board, 'Shulvyr visual identity: shell mascot, wordmark and palette'));
const pixelReview = '<rect width="896" height="640" fill="#F3EFF8"/>' +
  '<text x="48" y="55" fill="#221A35" font-family="Segoe UI,Arial,sans-serif" font-size="28" shape-rendering="auto">Shulvyr · a square shell mascot</text>' +
  iconAt(48, 96, 320) + iconAt(480, 96, 320, compact) +
  '<text x="48" y="458" fill="#48335F" font-family="Segoe UI,Arial,sans-serif" font-size="22" shape-rendering="auto">32 × 32 · 10× view</text>' +
  '<text x="480" y="458" fill="#48335F" font-family="Segoe UI,Arial,sans-serif" font-size="22" shape-rendering="auto">16 × 16 · 20× view</text>' +
  '<text x="48" y="520" fill="#48335F" font-family="Segoe UI,Arial,sans-serif" font-size="20" shape-rendering="auto">Native size:</text>' + iconAt(184, 496, 32) + iconAt(256, 504, 16, compact) +
  '<text x="48" y="593" fill="#48335F" font-family="Segoe UI,Arial,sans-serif" font-size="20" shape-rendering="auto">The 32px mark repeats every 16px cell exactly 2 × 2.</text>';
outputs.set('shulvyr-pixel-review.svg', svg(896, 640, pixelReview, 'Shulvyr square mark at 32px and 16px'));
const variantTiles = [
  { variant: 'light', x: 0, y: 0, background: '#F3EFF8', text: '#221A35', label: 'COLOR / LIGHT', note: 'Dark outline · dark eyes' },
  { variant: 'dark', x: 640, y: 0, background: '#191423', text: '#E2D2F3', label: 'COLOR / DARK', note: 'Light outline · dark eyes' },
  { variant: 'black', x: 0, y: 440, background: '#FFFFFF', text: '#000000', label: 'BLACK / POSITIVE', note: 'Pure #000000 · face and rim cutouts' },
  { variant: 'white', x: 640, y: 440, background: '#000000', text: '#FFFFFF', label: 'WHITE / NEGATIVE', note: 'Pure #FFFFFF · face and rim cutouts' },
].map(tile => `<rect x="${tile.x}" y="${tile.y}" width="640" height="440" fill="${tile.background}"/>` +
  iconAt(tile.x + 192, tile.y + 32, 256, master, tile.variant) +
  `<text x="${tile.x + 48}" y="${tile.y + 347}" fill="${tile.text}" font-family="Segoe UI,Arial,sans-serif" font-size="28" font-weight="600" shape-rendering="auto">${tile.label}</text>` +
  `<text x="${tile.x + 48}" y="${tile.y + 391}" fill="${tile.text}" font-family="Segoe UI,Arial,sans-serif" font-size="22" shape-rendering="auto">${tile.note}</text>`).join('');
outputs.set('shulvyr-variants.svg', svg(1280, 880, variantTiles, 'Shulvyr color on light, color on dark, black positive and white negative'));
outputs.set('palette.json', JSON.stringify({ schema_version: 2, project: 'Shulvyr', colors: master.palette, variants: themePalettes, surfaces: { light: '#F3EFF8', dark: '#191423', white: '#FFFFFF', black: '#000000' } }, null, 2) + '\n');

for (const [name, data] of outputs) {
  const filename = path.join(destination, name);
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (checkOnly) {
    if (!fs.existsSync(filename) || !fs.readFileSync(filename).equals(buffer)) throw new Error(`Generated asset differs: ${name}`);
  } else fs.writeFileSync(filename, buffer);
}
if (renderPreviews) {
  const sharpModule = process.env.SHULVYR_SHARP_MODULE;
  if (!sharpModule) throw new Error('Set SHULVYR_SHARP_MODULE to the installed sharp module entry point for optional SVG preview exports.');
  const imported = await import(pathToFileURL(sharpModule).href);
  const sharp = imported.default;
  for (const name of ['shulvyr-brand-board', 'shulvyr-banner', 'shulvyr-wordmark', 'shulvyr-wordmark-light', 'shulvyr-wordmark-black', 'shulvyr-wordmark-white', 'shulvyr-pixel-review', 'shulvyr-variants']) {
    await sharp(path.join(destination, `${name}.svg`)).png().toFile(path.join(destination, `${name}.png`));
  }
}
const hashes = Object.fromEntries([...outputs].map(([name, data]) => [name, crypto.createHash('sha256').update(data).digest('hex')]));
console.log(JSON.stringify({ action: checkOnly ? 'verified' : 'built', canonical_assets: outputs.size, native_sizes: [16, 32], hashes }, null, 2));
