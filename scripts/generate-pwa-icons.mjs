// Brand / PWA icons を SVG マスターから生成する。
// 実行: npx --yes --package=sharp@^0.33 -- node scripts/generate-pwa-icons.mjs
import sharp from "sharp";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const OUT_DIR = "public/icons";
const BRAND_DIR = "public/brand";
const ICON_SVG = `${OUT_DIR}/icon.svg`;
const MARK_SVG = `${BRAND_DIR}/tierlog-mark.svg`;

function createIco(images) {
  const headerSize = 6;
  const entrySize = 16;
  const directorySize = headerSize + entrySize * images.length;
  const header = Buffer.alloc(directorySize);

  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = directorySize;
  images.forEach(({ size, data }, index) => {
    const entryOffset = headerSize + entrySize * index;
    header.writeUInt8(size >= 256 ? 0 : size, entryOffset);
    header.writeUInt8(size >= 256 ? 0 : size, entryOffset + 1);
    header.writeUInt8(0, entryOffset + 2);
    header.writeUInt8(0, entryOffset + 3);
    header.writeUInt16LE(1, entryOffset + 4);
    header.writeUInt16LE(32, entryOffset + 6);
    header.writeUInt32LE(data.length, entryOffset + 8);
    header.writeUInt32LE(offset, entryOffset + 12);
    offset += data.length;
  });

  return Buffer.concat([header, ...images.map(({ data }) => data)]);
}

async function pngFromSvg(svg, size, out) {
  await sharp(svg).resize(size, size).png().toFile(out);
  console.log(`generated ${out}`);
}

await mkdir(OUT_DIR, { recursive: true });
await mkdir(BRAND_DIR, { recursive: true });

const iconSvg = await readFile(ICON_SVG);
const markSvg = await readFile(MARK_SVG);

await pngFromSvg(iconSvg, 180, `${OUT_DIR}/apple-touch-icon.png`);
await pngFromSvg(iconSvg, 192, `${OUT_DIR}/icon-192x192.png`);
await pngFromSvg(iconSvg, 512, `${OUT_DIR}/icon-512x512.png`);
await pngFromSvg(markSvg, 1024, `${BRAND_DIR}/tierlog-mark-1024.png`);

const faviconImages = await Promise.all(
  [16, 32, 48].map(async (size) => ({
    size,
    data: await sharp(iconSvg).resize(size, size).png().toBuffer(),
  })),
);
await writeFile("src/app/favicon.ico", createIco(faviconImages));
console.log("generated src/app/favicon.ico");
