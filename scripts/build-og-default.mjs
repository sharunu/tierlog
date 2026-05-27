import sharp from "sharp";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const W = 1200;
const H = 630;

const markBuf = readFileSync(resolve(repoRoot, "public/brand/tierlog-mark-1024.png"));

const resizedMark = await sharp(markBuf)
  .resize(280, 280, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer();

const svgBackground = `
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0b0d24"/>
      <stop offset="55%" stop-color="#1a1d3a"/>
      <stop offset="100%" stop-color="#0b0d24"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <text x="600" y="490" font-family="Helvetica, Arial, sans-serif" font-size="64" font-weight="700" fill="#e8eaf4" text-anchor="middle">Tierlog</text>
  <text x="600" y="540" font-family="Helvetica, Arial, sans-serif" font-size="22" font-weight="400" fill="#8a8fa3" text-anchor="middle">デュエプレ・ポケポケの対戦記録と環境分析</text>
</svg>
`;

const background = await sharp(Buffer.from(svgBackground)).png().toBuffer();

const composed = await sharp(background)
  .composite([{ input: resizedMark, top: 90, left: (W - 280) / 2 }])
  .png()
  .toBuffer();

const out = resolve(repoRoot, "public/og-default.png");
writeFileSync(out, composed);

const meta = await sharp(composed).metadata();
console.log(`Wrote ${out}: ${meta.width}x${meta.height} (${composed.length} bytes)`);
