const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");

const copyFile = (from, to) => {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
};

const copyDir = (from, to) => {
  fs.rmSync(to, { recursive: true, force: true });
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dest);
    else copyFile(src, dest);
  }
};

const htmlSource = ["index.html", "app.html"].find(file => fs.existsSync(path.join(dist, file)));
if (!htmlSource) throw new Error("Vite build did not emit an HTML entry.");

copyFile(path.join(dist, htmlSource), path.join(root, "index.html"));
copyDir(path.join(dist, "assets"), path.join(root, "assets"));

for (const file of ["manifest.json", "sw.js", "icon.svg", "icon-192.png", "icon-512.png"]) {
  const src = path.join(dist, file);
  if (fs.existsSync(src)) copyFile(src, path.join(root, file));
}
