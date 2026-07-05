/* Generates MapLibre SDF glyph PBFs from static TTF fonts into
   world-data/build/glyphs/<fontstack>/<start>-<end>.pbf */
const fs = require("fs");
const path = require("path");
const https = require("https");
const fontnik = require("fontnik");

const OUT = path.join("world-data", "build", "glyphs");

// family name (used as the fontstack folder) -> static TTF download URL
const FONTS = {
  "Noto Sans Regular":
    "https://github.com/googlefonts/noto-fonts/raw/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf",
  "Noto Sans Bold":
    "https://github.com/googlefonts/noto-fonts/raw/main/hinted/ttf/NotoSans/NotoSans-Bold.ttf",
  "Noto Serif Italic":
    "https://github.com/googlefonts/noto-fonts/raw/main/hinted/ttf/NotoSerif/NotoSerif-Italic.ttf",
};

function download(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(download(res.headers.location));
        }
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      })
      .on("error", reject);
  });
}

function range(buf, start, end) {
  return new Promise((resolve, reject) =>
    fontnik.range({ font: buf, start, end }, (err, data) => (err ? reject(err) : resolve(data)))
  );
}

async function main() {
  for (const [stack, url] of Object.entries(FONTS)) {
    console.log(`Downloading ${stack}`);
    const ttf = await download(url);
    const dir = path.join(OUT, stack);
    fs.mkdirSync(dir, { recursive: true });
    // Latin + common punctuation/diacritics is enough for these maps; cover 0..3FFF.
    for (let start = 0; start < 0x4000; start += 256) {
      const end = start + 255;
      const pbf = await range(ttf, start, end);
      fs.writeFileSync(path.join(dir, `${start}-${end}.pbf`), pbf);
    }
    console.log(`  wrote ${stack} (${fs.readdirSync(dir).length} ranges)`);
  }
  console.log("Glyphs done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
