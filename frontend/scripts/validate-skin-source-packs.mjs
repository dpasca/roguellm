import fs from 'node:fs/promises';
import path from 'node:path';
import { buildStateSheetLayout, stateSheetCropsForProfile, stateSheetSourceFile } from './skin-state-sheet-layout.mjs';

const rootDir = path.resolve(new URL('..', import.meta.url).pathname);
const fixedDir = path.join(rootDir, 'src/skins/neo-tokyo-console/fixed');
const contractPath = path.join(rootDir, 'src/skins/SKIN_LAYOUT_CONTRACT_V1.json');
const contract = JSON.parse(await fs.readFile(contractPath, 'utf8'));
const sourcePackFiles = ['source-chassis.png', 'source-widgets.png', 'source-materials.png'];
const materialRows = ['panel', 'lcd', 'button'];
const failures = [];
const args = process.argv.slice(2);

if (args.includes('--help')) {
  printUsage();
  process.exit(0);
}

const packDirs = args.length > 0
  ? await Promise.all(args.map(resolvePackDir))
  : await findSourcePackDirs(fixedDir);

for (const packDir of packDirs) {
  await validateSourcePack(packDir);
}

if (failures.length > 0) {
  console.error('Skin source-pack validation failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Validated ${packDirs.length} skin source pack${packDirs.length === 1 ? '' : 's'}.`);
}

async function findSourcePackDirs(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const dirs = [];
  const names = new Set(entries.map((entry) => entry.name));

  if (sourcePackFiles.some((file) => names.has(file))) {
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

async function validateSourcePack(packDir) {
  const relativeDir = path.relative(rootDir, packDir);
  const prefix = `${relativeDir}:`;
  const kitPath = path.join(packDir, 'skin-kit.json');
  let kit;

  try {
    kit = JSON.parse(await fs.readFile(kitPath, 'utf8'));
  } catch {
    failures.push(`${prefix} source pack must sit beside skin-kit.json`);
    return;
  }

  const profile = contract.profiles?.[kit.kind];
  if (!profile) {
    failures.push(`${prefix} skin-kit kind "${kit.kind ?? 'none'}" is not a source-pack contract profile`);
    return;
  }

  const stateSheetLayout = buildStateSheetLayout(profile);
  const chassis = await validatePng(prefix, packDir, 'source-chassis.png', profile.size.width, profile.size.height);
  const widgets = await validatePng(prefix, packDir, 'source-widgets.png', profile.size.width, profile.size.height);
  const materials = await validatePng(prefix, packDir, 'source-materials.png');
  if (usesStateSheet(kit)) {
    await validatePng(prefix, packDir, stateSheetSourceFile, stateSheetLayout.size.width, stateSheetLayout.size.height);
  }

  if (chassis && chassis.hasAlpha === false) {
    failures.push(`${prefix} source-chassis.png should keep an alpha channel for clean crop/export parity`);
  }
  if (widgets && widgets.hasAlpha === false) {
    failures.push(`${prefix} source-widgets.png should keep an alpha channel for button and indicator crops`);
  }

  if (materials) {
    validateMaterialSheet(prefix, materials, profile);
  }

  validateBuildHandoff(prefix, kit, profile);
}

async function validatePng(prefix, dir, fileName, expectedWidth, expectedHeight) {
  let png;
  try {
    png = await readPngHeader(path.join(dir, fileName));
  } catch (error) {
    failures.push(`${prefix} ${fileName} ${error.message}`);
    return null;
  }

  if (expectedWidth !== undefined && png.width !== expectedWidth) {
    failures.push(`${prefix} ${fileName} width ${png.width}px must be ${expectedWidth}px`);
  }
  if (expectedHeight !== undefined && png.height !== expectedHeight) {
    failures.push(`${prefix} ${fileName} height ${png.height}px must be ${expectedHeight}px`);
  }

  return png;
}

function validateMaterialSheet(prefix, png, profile) {
  const minimumWidth = 104 + Math.max(...materialRows.map((name) => profile.materials[name].frame.width));
  const minimumHeight = 208 + Math.max(...materialRows.map((name) => profile.materials[name].fill.height));

  if (png.width < minimumWidth || png.height < minimumHeight) {
    failures.push(
      `${prefix} source-materials.png ${png.width}x${png.height} is too small; ` +
      `expected at least ${minimumWidth}x${minimumHeight}`
    );
    return;
  }

  for (const [index, name] of materialRows.entries()) {
    const material = profile.materials[name];
    const rowY = index * 104;
    validateInBounds(prefix, `source-materials ${name} fill`, png, {
      x: 0,
      y: rowY,
      width: material.fill.width,
      height: material.fill.height
    });
    validateInBounds(prefix, `source-materials ${name} frame`, png, {
      x: 104,
      y: rowY,
      width: material.frame.width,
      height: material.frame.height
    });
  }
}

function validateBuildHandoff(prefix, kit, profile) {
  const build = kit.build;
  if (!build) {
    failures.push(`${prefix} source pack must declare build.source and build.crops`);
    return;
  }

  if (build.source !== 'source-widgets.png') {
    failures.push(`${prefix} build.source must be source-widgets.png for source-pack skins`);
  }

  if (!Array.isArray(build.crops)) {
    failures.push(`${prefix} build.crops must be an array`);
    return;
  }

  const chassisCrop = build.crops.find((crop) => crop.path === 'chassis.png');
  if (!chassisCrop) {
    failures.push(`${prefix} build.crops must include chassis.png crop`);
  } else {
    validateExactCrop(prefix, 'chassis crop', chassisCrop, {
      source: 'source-chassis.png',
      rect: { x: 0, y: 0, width: profile.size.width, height: profile.size.height }
    });
  }

  const stateSheetCrops = stateSheetCropsForProfile(profile);
  const hasStateSheetCrops = build.crops.some((crop) => isStateSheetSource(crop.source));

  for (const [name, rect] of Object.entries(profile.layout.buttons)) {
    const crop = build.crops.find((entry) => entry.path === `${buttonPrefix(name)}-idle.png`);
    const expectedVariants = (profile.requiredStates.toggleButtons ?? []).includes(name) ? 'toggle-button' : 'button';
    if (!crop) {
      failures.push(`${prefix} build.crops missing ${buttonPrefix(name)}-idle.png`);
      continue;
    }
    if (isStateSheetSource(crop.source)) {
      validateStateSheetCropSet(prefix, build.crops, stateSheetCrops, name);
      continue;
    }
    validateExactCrop(prefix, `${name} button crop`, crop, { rect });
    if (crop.variants !== expectedVariants) {
      failures.push(`${prefix} ${name} button crop must declare variants="${expectedVariants}"`);
    }
  }

  if (hasStateSheetCrops) {
    validateStateSheetCropSet(prefix, build.crops, stateSheetCrops, 'status');
    validateStateSheetCropSet(prefix, build.crops, stateSheetCrops, 'combatLed');
  } else {
    const statusCrop = build.crops.find((entry) => entry.path === 'status-ready.png');
    if (!statusCrop) {
      failures.push(`${prefix} build.crops missing status-ready.png`);
    } else {
      validateExactCrop(prefix, 'status indicator crop', statusCrop, { rect: profile.layout.indicators.status });
      if (statusCrop.variants !== 'status-indicator') {
        failures.push(`${prefix} status indicator crop must declare variants="status-indicator"`);
      }
    }

    const ledCrop = build.crops.find((entry) => entry.path === 'led-off.png');
    if (!ledCrop) {
      failures.push(`${prefix} build.crops missing led-off.png`);
    } else {
      validateExactCrop(prefix, 'combat LED crop', ledCrop, { rect: profile.layout.indicators.combatLed });
      if (ledCrop.variants !== 'combat-led') {
        failures.push(`${prefix} combat LED crop must declare variants="combat-led"`);
      }
    }
  }

  for (const [index, name] of materialRows.entries()) {
    const material = profile.materials[name];
    const rowY = index * 104;
    validateNamedMaterialCrop(prefix, build.crops, material.fill.path, {
      source: 'source-materials.png',
      rect: { x: 0, y: rowY, width: material.fill.width, height: material.fill.height }
    });
    validateNamedMaterialCrop(prefix, build.crops, material.frame.path, {
      source: 'source-materials.png',
      rect: { x: 104, y: rowY, width: material.frame.width, height: material.frame.height }
    });
  }
}

function validateStateSheetCropSet(prefix, crops, expectedCrops, id) {
  for (const expected of expectedCrops.filter((crop) => crop.id === id)) {
    const crop = crops.find((entry) => entry.path === expected.path);
    if (!crop) {
      failures.push(`${prefix} build.crops missing state-sheet crop ${expected.path}`);
      continue;
    }
    if (!isStateSheetSource(crop.source)) {
      failures.push(`${prefix} ${expected.path} crop source must be ${stateSheetSourceFile}`);
    }
    if (crop.variants) {
      failures.push(`${prefix} ${expected.path} state-sheet crop must not declare generated variants`);
    }
    validateExactCrop(prefix, `${expected.path} state-sheet crop`, crop, { rect: expected.rect });
  }
}

function validateNamedMaterialCrop(prefix, crops, outputPath, expected) {
  const crop = crops.find((entry) => entry.path === outputPath && entry.source === expected.source);
  if (!crop) {
    failures.push(`${prefix} build.crops missing material crop ${outputPath} from ${expected.source}`);
    return;
  }
  validateExactCrop(prefix, `${outputPath} crop`, crop, expected);
}

function validateExactCrop(prefix, label, crop, expected) {
  if (expected.source !== undefined && crop.source !== expected.source) {
    failures.push(`${prefix} ${label} source must be ${expected.source}`);
  }

  for (const key of ['x', 'y', 'width', 'height']) {
    if (crop.rect?.[key] !== expected.rect[key]) {
      failures.push(`${prefix} ${label} rect.${key} ${crop.rect?.[key]} must be ${expected.rect[key]}`);
    }
  }
}

function validateInBounds(prefix, label, png, rect) {
  if (rect.x + rect.width > png.width || rect.y + rect.height > png.height) {
    failures.push(`${prefix} ${label} crop ${rect.width}x${rect.height}+${rect.x}+${rect.y} escapes ${png.width}x${png.height}`);
  }
}

function usesStateSheet(kit) {
  return (kit.build?.crops ?? []).some((crop) => isStateSheetSource(crop.source));
}

function isStateSheetSource(source) {
  return source === stateSheetSourceFile || path.basename(source ?? '') === stateSheetSourceFile;
}

async function readPngHeader(assetPath) {
  const data = await fs.readFile(assetPath);
  const signature = data.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a') {
    throw new Error('is not a PNG');
  }

  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
    colorType: data[25],
    hasAlpha: data[25] === 4 || data[25] === 6
  };
}

function buttonPrefix(name) {
  return {
    moveN: 'dpad-n',
    moveS: 'dpad-s',
    moveE: 'dpad-e',
    moveW: 'dpad-w'
  }[name] ?? name;
}

function printUsage() {
  console.error([
    'Usage: pnpm -C frontend validate:skin-source-packs [skin-pack-dir|skin-kit.json ...]',
    '',
    'Without arguments, scans committed fixed skins for source-chassis.png, source-widgets.png, and source-materials.png.',
    'With arguments, validates those exact source-pack directories before cropping/building.'
  ].join('\n'));
}
