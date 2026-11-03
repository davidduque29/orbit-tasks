// Generate app icons without extra npm dependencies. Run before Vite builds.
import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

const folder = new URL('../public/icons/', import.meta.url);
await mkdir(folder, { recursive: true });

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, checksum]);
}

function icon(size) {
  const pixels = Buffer.alloc(size * (size * 4 + 1));
  const scale = size / 192;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const pos = y * (size * 4 + 1) + 1 + 4 * x;
      const px = x / scale - 96;
      const py = y / scale - 96;
      const radius = Math.hypot(px, py);
      const outerRing = Math.abs(radius - 67) < 5;
      const ellipse = Math.abs((px * px) / (54 * 54) + (py * py) / (27 * 27) - 1) < 0.21;
      const core = radius < 13;
      const star = Math.abs(x / scale - 145) + Math.abs(y / scale - 42) < 15;
      const pale = ellipse && !core;
      const white = outerRing || core || star;
      pixels[pos] = white ? 255 : pale ? 227 : 117;
      pixels[pos + 1] = white ? 255 : pale ? 223 : 88;
      pixels[pos + 2] = white ? 255 : pale ? 255 : 223;
      pixels[pos + 3] = 255;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // 8-bit
  header[9] = 6; // RGBA
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [192, 512]) {
  await writeFile(new URL(`icon-${size}.png`, folder), icon(size));
}
