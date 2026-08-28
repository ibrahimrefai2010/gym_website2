const fs = require("fs/promises");
const path = require("path");

const root = path.join(__dirname, "..");
const publicDir = path.join(root, "public");
const distDir = path.join(root, "dist");

async function copyDir(source, target) {
  await fs.mkdir(target, { recursive: true });
  const entries = await fs.readdir(source, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const sourcePath = path.join(source, entry.name);
      const targetPath = path.join(target, entry.name);
      if (entry.isDirectory()) {
        await copyDir(sourcePath, targetPath);
      } else {
        await fs.copyFile(sourcePath, targetPath);
      }
    })
  );
}

function minifyCss(input) {
  return input
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([{}:;,>])\s*/g, "$1")
    .trim();
}

function minifyJs(input) {
  return input
    .replace(/console\.(log|debug|info|warn)\([^;]*\);?/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\n\s*/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function transformFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const filePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await transformFiles(filePath);
        return;
      }

      if (entry.name.endsWith(".css")) {
        const input = await fs.readFile(filePath, "utf8");
        await fs.writeFile(filePath, minifyCss(input), "utf8");
      }

      if (entry.name.endsWith(".js")) {
        const input = await fs.readFile(filePath, "utf8");
        await fs.writeFile(filePath, minifyJs(input), "utf8");
      }
    })
  );
}

async function build() {
  await fs.rm(distDir, { recursive: true, force: true });
  await copyDir(publicDir, distDir);
  await transformFiles(distDir);
  await fs.writeFile(
    path.join(distDir, "build-manifest.json"),
    JSON.stringify({ builtAt: new Date().toISOString(), source: "public" }, null, 2),
    "utf8"
  );
  console.log(`Built static assets in ${distDir}`);
}

build().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
