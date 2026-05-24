import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(new URL('..', import.meta.url).pathname);
const repoRoot = path.resolve(rootDir, '..');
const fixedDir = path.join(rootDir, 'src/skins/neo-tokyo-console/fixed');
const sourcePackFiles = ['source-chassis.png', 'source-widgets.png', 'source-materials.png'];
const promotedRoles = new Set(['default', 'variant']);
const args = process.argv.slice(2);
const allPacks = args.includes('--all');
const positionalArgs = args.filter((arg) => !arg.startsWith('--'));

if (args.includes('--help')) {
  printUsage();
  process.exit(0);
}

const packDirs = positionalArgs.length > 0
  ? await Promise.all(positionalArgs.map(resolvePackDir))
  : await findSourcePackDirs(fixedDir);

const reviewed = [];
const skipped = [];
const failures = [];

for (const packDir of packDirs) {
  const kit = await readSkinKit(packDir);
  if (!kit) {
    failures.push(`${relativePath(packDir)}: source pack must sit beside skin-kit.json`);
    continue;
  }

  const role = kit.meta?.role ?? 'unknown';
  if (!allPacks && !promotedRoles.has(role)) {
    skipped.push(`${kit.id ?? path.basename(packDir)} (${role})`);
    continue;
  }

  const skinId = kit.id ?? path.basename(packDir);
  const outPath = path.join(repoRoot, '_artifacts/skin-reviews/validation', skinId, 'index.html');
  try {
    await execFileAsync(process.execPath, [
      path.join(rootDir, 'scripts/skin-source-review.mjs'),
      packDir,
      '--json',
      '--fail-on-warning',
      '--out',
      outPath
    ], {
      cwd: rootDir,
      maxBuffer: 8 * 1024 * 1024
    });
    reviewed.push(skinId);
  } catch (error) {
    const output = [error.stdout, error.stderr]
      .filter(Boolean)
      .join('\n')
      .trim();
    failures.push(`${skinId} source review failed${output ? `:\n${indent(output)}` : ''}`);
  }
}

if (failures.length > 0) {
  console.error('Skin source-review validation failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  const skippedNote = skipped.length > 0 ? ` (${skipped.length} prototype/legacy skipped)` : '';
  console.log(`Reviewed ${reviewed.length} promoted skin source pack${reviewed.length === 1 ? '' : 's'}${skippedNote}.`);
}

async function findSourcePackDirs(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const names = new Set(entries.map((entry) => entry.name));
  const dirs = [];

  if (sourcePackFiles.every((file) => names.has(file))) {
    dirs.push(dir);
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      dirs.push(...await findSourcePackDirs(path.join(dir, entry.name)));
    }
  }

  return dirs;
}

async function resolvePackDir(input) {
  const resolved = path.resolve(rootDir, input);
  const stat = await fs.stat(resolved);
  return stat.isDirectory() ? resolved : path.dirname(resolved);
}

async function readSkinKit(packDir) {
  try {
    return JSON.parse(await fs.readFile(path.join(packDir, 'skin-kit.json'), 'utf8'));
  } catch {
    return null;
  }
}

function relativePath(filePath) {
  return path.relative(rootDir, filePath) || '.';
}

function indent(value) {
  return value
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
}

function printUsage() {
  console.error([
    'Usage: pnpm -C frontend validate:skin-source-reviews [skin-pack-dir|skin-kit.json ...]',
    '',
    'Runs skin:review-source with --fail-on-warning for promoted source packs.',
    'By default, only role="default" and role="variant" packs are reviewed.',
    '',
    'Options:',
    '  --all   Include prototype and legacy source packs.'
  ].join('\n'));
}
