import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const rootDir = path.resolve(new URL('..', import.meta.url).pathname);
const [, , kitArg, ...args] = process.argv;
const dryRun = args.includes('--dry-run');

if (!kitArg) {
  console.error('Usage: pnpm build:skin-kit <path-to-skin-kit-dir|skin-kit.json> [--dry-run]');
  process.exit(1);
}

const kitPath = await resolveKitPath(kitArg);
const kitDir = path.dirname(kitPath);
const kit = JSON.parse(await fs.readFile(kitPath, 'utf8'));
const build = kit.build;

if (!build?.source || !Array.isArray(build.crops) || build.crops.length === 0) {
  console.log(`${kit.id ?? path.basename(kitDir)} has no build.source/crops; nothing to build.`);
  process.exit(0);
}

const sourcePath = path.resolve(kitDir, build.source);
await assertReadable(sourcePath);

for (const crop of build.crops) {
  const cropSourcePath = crop.source ? path.resolve(kitDir, crop.source) : sourcePath;
  if (cropSourcePath !== sourcePath) {
    await assertReadable(cropSourcePath);
  }
  await buildCrop(cropSourcePath, kitDir, crop);
}

console.log(`${dryRun ? 'Planned' : 'Built'} ${build.crops.length} crop${build.crops.length === 1 ? '' : 's'} for ${kit.id ?? path.basename(kitDir)}.`);

async function resolveKitPath(input) {
  const resolved = path.resolve(rootDir, input);
  const stat = await fs.stat(resolved);
  return stat.isDirectory() ? path.join(resolved, 'skin-kit.json') : resolved;
}

async function assertReadable(filePath) {
  try {
    await fs.access(filePath);
  } catch {
    throw new Error(`Cannot read ${filePath}`);
  }
}

async function buildCrop(sourcePath, kitDir, crop) {
  const rect = crop.rect;
  if (!crop.path || !rect || rect.width <= 0 || rect.height <= 0) {
    throw new Error(`Invalid crop entry: ${JSON.stringify(crop)}`);
  }

  const outputPath = path.join(kitDir, crop.path);
  const cropSpec = `${rect.width}x${rect.height}+${rect.x}+${rect.y}`;
  const baseArgs = [sourcePath, '-crop', cropSpec, '+repage'];

  if (crop.alphaRadius) {
    const mask = `roundrectangle 0,0 ${rect.width - 1},${rect.height - 1} ${crop.alphaRadius},${crop.alphaRadius}`;
    baseArgs.push(
      '-alpha',
      'set',
      '(',
      '-size',
      `${rect.width}x${rect.height}`,
      'xc:none',
      '-fill',
      'white',
      '-draw',
      mask,
      ')',
      '-compose',
      'CopyOpacity',
      '-composite'
    );
  }

  await magick([...baseArgs, png32(outputPath)]);

  if (crop.variants === 'button') {
    await writeVariant(outputPath, outputPath.replace('-idle.png', '-hover.png'), ['-modulate', '116,118,100']);
    await writeVariant(outputPath, outputPath.replace('-idle.png', '-pressed.png'), ['-modulate', '72,116,100']);
    await writeVariant(outputPath, outputPath.replace('-idle.png', '-disabled.png'), ['-colorspace', 'Gray', '-modulate', '46,42,100']);
  } else if (crop.variants === 'status-indicator') {
    await writeVariant(outputPath, replaceSuffix(outputPath, '-ready.png', '-thinking.png'), [
      '-fill',
      '#68d8ff',
      '-colorize',
      '24',
      '-modulate',
      '120,130,100'
    ]);
    await writeVariant(outputPath, replaceSuffix(outputPath, '-ready.png', '-error.png'), [
      '-fill',
      '#ff4d6d',
      '-colorize',
      '45',
      '-modulate',
      '115,140,100'
    ]);
    await writeVariant(outputPath, replaceSuffix(outputPath, '-ready.png', '-offline.png'), [
      '-colorspace',
      'Gray',
      '-modulate',
      '48,70,100'
    ]);
  } else if (crop.variants === 'combat-led') {
    await writeVariant(outputPath, replaceSuffix(outputPath, 'led-off.png', 'led-on.png'), [
      '-alpha',
      'set',
      '-fill',
      '#7cff6a',
      '-colorize',
      '55',
      '-modulate',
      '140,160,100'
    ]);
  }
}

async function writeVariant(sourcePath, outputPath, operations) {
  if (sourcePath === outputPath) {
    throw new Error(`Variant output must differ from source: ${sourcePath}`);
  }
  await magick([sourcePath, ...operations, png32(outputPath)]);
}

function replaceSuffix(value, expectedSuffix, replacementSuffix) {
  if (!value.endsWith(expectedSuffix)) {
    throw new Error(`Expected ${value} to end with ${expectedSuffix}`);
  }

  return `${value.slice(0, -expectedSuffix.length)}${replacementSuffix}`;
}

function png32(outputPath) {
  return `PNG32:${outputPath}`;
}

async function magick(args) {
  if (dryRun) {
    console.log(`magick ${args.map(shellQuote).join(' ')}`);
    return;
  }

  await new Promise((resolve, reject) => {
    const child = spawn('magick', args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`magick exited with ${code}`));
      }
    });
  });
}

function shellQuote(value) {
  return /[^A-Za-z0-9_./:=,+-]/.test(value) ? JSON.stringify(value) : value;
}
