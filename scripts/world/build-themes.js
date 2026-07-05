/* Generates one complete MapLibre style per theme into world-data/build/styles/<id>.json,
   by taking the base style (world-data/style.json, the Classic palette) and merging each
   theme's per-layer paint overrides from world-data/themes.json. Keeping the base structure
   in one file (DRY) means adding a layer later doesn't require editing every theme. */
const fs = require("fs");
const path = require("path");

const BASE = path.join("world-data", "style.json");
const THEMES = path.join("world-data", "themes.json");
const OUT = path.join("world-data", "build", "styles");

const base = JSON.parse(fs.readFileSync(BASE, "utf8"));
const { themes } = JSON.parse(fs.readFileSync(THEMES, "utf8"));

fs.mkdirSync(OUT, { recursive: true });

for (const theme of themes) {
  const style = JSON.parse(JSON.stringify(base)); // deep clone
  style.name = `Exandria — ${theme.label}`;
  for (const layer of style.layers) {
    const ov = theme.overrides[layer.id];
    if (!ov) continue;
    layer.paint = { ...(layer.paint || {}), ...ov };
  }
  const file = path.join(OUT, `${theme.id}.json`);
  fs.writeFileSync(file, JSON.stringify(style, null, 2));
  console.log(`wrote ${file}`);
}

// Emit a lean manifest (id + label + default) alongside the styles for consumers.
const manifest = themes.map((t) => ({ id: t.id, label: t.label, default: !!t.default }));
fs.writeFileSync(path.join(OUT, "themes.json"), JSON.stringify({ themes: manifest }, null, 2));
console.log(`wrote ${path.join(OUT, "themes.json")} (${manifest.length} themes)`);
