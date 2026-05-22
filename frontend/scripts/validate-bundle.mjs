import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(scriptDir, '..');
const outputDir = path.resolve(frontendDir, '..', 'static', 'game2');
const manifestPath = path.join(outputDir, '.vite', 'manifest.json');
const assetsDir = path.join(outputDir, 'assets');

const KiB = 1024;
const limits = {
  appChunk: 700 * KiB,
  phaserChunk: 1300 * KiB,
  totalJs: 2048 * KiB
};
const forbiddenTokens = [
  'phaser3spectorjs',
  'phaser-core',
  'ArcadePhysics',
  'ArcadePhysicsPlugin',
  'MatterPhysics',
  'MatterPhysicsPlugin'
];
const failures = [];

const manifest = await readJson(manifestPath);
const manifestEntries = Object.values(manifest);
const entry = manifest['index.html'];
const phaserEntry = manifestEntries.find((item) => item?.name === 'phaser-no-physics');
const jsFiles = await findJsFiles(assetsDir);
const sizes = new Map();

if (!entry) {
  failures.push('missing index.html entry in Vite manifest');
}

if (!phaserEntry) {
  failures.push('missing phaser-no-physics split chunk in Vite manifest');
}

if (manifestEntries.some((item) => String(item?.name ?? '').includes('phaser-core'))) {
  failures.push('phaser-core manifest entry found; Game2 should use phaser-no-physics');
}

if (entry && phaserEntry) {
  const importsPhaserChunk = (entry.imports ?? []).some((manifestKey) => manifest[manifestKey]?.name === 'phaser-no-physics');
  if (!importsPhaserChunk) {
    failures.push('index.html entry does not import the phaser-no-physics chunk');
  }
}

for (const file of jsFiles) {
  const relativePath = path.relative(outputDir, file);
  const stat = await fs.stat(file);
  sizes.set(relativePath, stat.size);
}

await expectManifestFile(entry?.file, limits.appChunk, 'app entry chunk');
await expectManifestFile(phaserEntry?.file, limits.phaserChunk, 'phaser no-physics chunk', (relativePath) => {
  if (!path.basename(relativePath).startsWith('phaser-no-physics-')) {
    failures.push(`phaser chunk filename must start with "phaser-no-physics-": ${relativePath}`);
  }
});

const totalJsBytes = Array.from(sizes.values()).reduce((sum, size) => sum + size, 0);
if (totalJsBytes > limits.totalJs) {
  failures.push(`total JS is ${formatBytes(totalJsBytes)}, over ${formatBytes(limits.totalJs)}`);
}

for (const file of jsFiles) {
  const source = await fs.readFile(file, 'utf8');
  const relativePath = path.relative(outputDir, file);

  for (const token of forbiddenTokens) {
    if (source.includes(token)) {
      failures.push(`forbidden bundle token "${token}" found in ${relativePath}`);
    }
  }
}

if (failures.length > 0) {
  console.error('Bundle validation failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  const appSize = formatBytes(sizes.get(entry.file));
  const phaserSize = formatBytes(sizes.get(phaserEntry.file));
  console.log(`Bundle OK: app ${appSize}, phaser ${phaserSize}, total JS ${formatBytes(totalJsBytes)}.`);
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    console.error(`Unable to read ${path.relative(frontendDir, file)}. Run pnpm build first.`);
    throw error;
  }
}

async function findJsFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await findJsFiles(entryPath));
    } else if (entry.name.endsWith('.js')) {
      files.push(entryPath);
    }
  }

  return files;
}

async function expectManifestFile(relativePath, maxBytes, label, validatePath = () => {}) {
  if (!relativePath) {
    return;
  }

  validatePath(relativePath);

  const absolutePath = path.join(outputDir, relativePath);
  try {
    await fs.access(absolutePath);
  } catch {
    failures.push(`${label} file is missing: ${relativePath}`);
    return;
  }

  const size = sizes.get(relativePath);
  if (!Number.isFinite(size)) {
    failures.push(`${label} is not in the JS asset list: ${relativePath}`);
    return;
  }

  if (size > maxBytes) {
    failures.push(`${label} is ${formatBytes(size)}, over ${formatBytes(maxBytes)}: ${relativePath}`);
  }
}

function formatBytes(bytes) {
  return `${(bytes / 1000).toFixed(1)} kB`;
}
