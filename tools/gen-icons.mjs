import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const OUT = new URL('../assets/icons/', import.meta.url);
const svg = await readFile(new URL('icon-source.svg', OUT));

const sizes = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
  ['favicon-32.png', 32],
];

for (const [name, size] of sizes) {
  await sharp(svg, { density: 384 }).resize(size, size).png().toFile(fileURLToPath(new URL(name, OUT)));
  console.log('wrote', name);
}
