import { deflateSync } from 'node:zlib';
import { writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const width = 640;
const height = 360;
const raw = Buffer.alloc((width * 4 + 1) * height);

for (let y = 0; y < height; y += 1) {
  const row = y * (width * 4 + 1);
  raw[row] = 0;
  for (let x = 0; x < width; x += 1) {
    const offset = row + 1 + x * 4;
    const sky = y / height;
    const glow = Math.max(0, 1 - Math.hypot(x - width * 0.67, y - height * 0.35) / 150);
    const spark = Math.max(0, 1 - Math.hypot(x - width * 0.67, y - height * 0.35) / 60) ** 3;
    raw[offset] = Math.round(5 + 16 * sky + 120 * spark);
    raw[offset + 1] = Math.round(16 + 25 * sky + 83 * glow);
    raw[offset + 2] = Math.round(43 + 52 * sky + 63 * glow);
    raw[offset + 3] = 255;
  }
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(name, data) {
  const type = Buffer.from(name, 'ascii');
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  type.copy(header, 4);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([type, data])), 0);
  return Buffer.concat([header, data, checksum]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(width, 0);
ihdr.writeUInt32BE(height, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);

const output = resolve(dirname(fileURLToPath(import.meta.url)), '../wallpaper/preview.png');
await writeFile(output, png);
console.log(`Generated original Wallpaper Engine preview at ${output}`);
