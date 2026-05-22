import fs from 'node:fs/promises';
import path from 'node:path';

const rootDir = path.resolve(new URL('..', import.meta.url).pathname);
const fixedDir = path.join(rootDir, 'src/skins/neo-tokyo-console/fixed');
const buttonStates = ['idle', 'hover', 'pressed', 'disabled'];
const mobilePortrait = {
  size: { width: 390, height: 844 },
  regions: ['map', 'latest', 'log', 'inventory', 'title', 'player', 'combat', 'controls', 'endState'],
  buttons: ['attack', 'run', 'restart', 'log', 'inventory', 'moveN', 'moveS', 'moveE', 'moveW'],
  indicators: {
    status: ['ready', 'thinking', 'error', 'offline'],
    combatLed: ['led-on.png', 'led-off.png']
  },
  layout: {
    buttons: ['attack', 'run', 'restart', 'log', 'inventory', 'moveN', 'moveS', 'moveE', 'moveW'],
    indicators: ['status', 'combatLed'],
    fills: ['playerHp', 'enemyHp', 'playerStats']
  }
};

const failures = [];
const kitPaths = await findSkinKits(fixedDir);

if (kitPaths.length === 0) {
  failures.push(`No skin-kit.json files found under ${path.relative(rootDir, fixedDir)}`);
}

for (const kitPath of kitPaths) {
  await validateKit(kitPath);
}

if (failures.length > 0) {
  console.error('Skin kit validation failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Validated ${kitPaths.length} skin kit${kitPaths.length === 1 ? '' : 's'}.`);
}

async function findSkinKits(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const kits = [];

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      kits.push(...await findSkinKits(entryPath));
    } else if (entry.name === 'skin-kit.json') {
      kits.push(entryPath);
    }
  }

  return kits;
}

async function validateKit(kitPath) {
  const kitDir = path.dirname(kitPath);
  const kit = JSON.parse(await fs.readFile(kitPath, 'utf8'));
  const prefix = `${kit.id ?? path.basename(kitDir)}:`;

  if (kit.kind !== 'mobilePortrait' && kit.kind !== 'desktopWide') {
    failures.push(`${prefix} invalid kind "${kit.kind}"`);
  }

  if (!kit.size || kit.size.width <= 0 || kit.size.height <= 0) {
    failures.push(`${prefix} missing positive size`);
  }

  validateRequiredContract(prefix, kit);
  await validateAsset(kitDir, prefix, 'chassis', kit.assets?.chassis);

  for (const [name, asset] of Object.entries(kit.assets?.buttons ?? {})) {
    for (const state of buttonStates) {
      await validateAsset(kitDir, prefix, `${name}.${state}`, {
        ...asset,
        path: `${asset.prefix}-${state}.png`
      });
    }
  }

  for (const [name, asset] of Object.entries(kit.assets?.indicators ?? {})) {
    if (asset.files) {
      for (const file of asset.files) {
        await validateAsset(kitDir, prefix, `${name}.${file}`, { ...asset, path: file });
      }
      continue;
    }

    for (const state of asset.states ?? []) {
      await validateAsset(kitDir, prefix, `${name}.${state}`, {
        ...asset,
        path: `${asset.prefix}-${state}.png`
      });
    }
  }

  validateRegions(prefix, kit);
}

function validateRequiredContract(prefix, kit) {
  if (kit.kind !== 'mobilePortrait') {
    return;
  }

  if (kit.size?.width !== mobilePortrait.size.width || kit.size?.height !== mobilePortrait.size.height) {
    failures.push(`${prefix} mobilePortrait size must be ${mobilePortrait.size.width}x${mobilePortrait.size.height}`);
  }

  for (const region of mobilePortrait.regions) {
    if (!kit.regions?.[region]) {
      failures.push(`${prefix} missing required region ${region}`);
    }
  }

  for (const button of mobilePortrait.buttons) {
    if (!kit.assets?.buttons?.[button]) {
      failures.push(`${prefix} missing required button asset ${button}`);
    }
  }

  const statusStates = kit.assets?.indicators?.status?.states ?? [];
  for (const state of mobilePortrait.indicators.status) {
    if (!statusStates.includes(state)) {
      failures.push(`${prefix} status indicator missing state ${state}`);
    }
  }

  const combatLedFiles = kit.assets?.indicators?.combatLed?.files ?? [];
  for (const file of mobilePortrait.indicators.combatLed) {
    if (!combatLedFiles.includes(file)) {
      failures.push(`${prefix} combatLed indicator missing file ${file}`);
    }
  }

  for (const [group, names] of Object.entries(mobilePortrait.layout)) {
    for (const name of names) {
      const rect = kit.layout?.[group]?.[name];
      if (!rect) {
        failures.push(`${prefix} missing required layout ${group}.${name}`);
        continue;
      }
      validateRect(prefix, kit, `layout ${group}.${name}`, rect);
    }
  }
}

async function validateAsset(kitDir, prefix, label, asset) {
  if (!asset?.path) {
    failures.push(`${prefix} ${label} missing path`);
    return;
  }

  const assetPath = path.join(kitDir, asset.path);
  let png;
  try {
    png = await readPngHeader(assetPath);
  } catch (error) {
    failures.push(`${prefix} ${label} ${error.message}`);
    return;
  }

  if (asset.width && png.width !== asset.width) {
    failures.push(`${prefix} ${label} width ${png.width}px !== ${asset.width}px`);
  }

  if (asset.height && png.height !== asset.height) {
    failures.push(`${prefix} ${label} height ${png.height}px !== ${asset.height}px`);
  }

  if (asset.alpha && !png.hasAlpha) {
    failures.push(`${prefix} ${label} expected alpha channel`);
  }
}

async function readPngHeader(assetPath) {
  const data = await fs.readFile(assetPath);
  const signature = data.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a') {
    throw new Error(`${path.basename(assetPath)} is not a PNG`);
  }

  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
    colorType: data[25],
    hasAlpha: data[25] === 4 || data[25] === 6
  };
}

function validateRegions(prefix, kit) {
  for (const [name, rect] of Object.entries(kit.regions ?? {})) {
    validateRect(prefix, kit, `region ${name}`, rect);
  }
}

function validateRect(prefix, kit, label, rect) {
  if (!isPositiveRect(rect)) {
    failures.push(`${prefix} ${label} is not a positive rectangle`);
    return;
  }

  if (rect.x + rect.width > kit.size.width || rect.y + rect.height > kit.size.height) {
    failures.push(`${prefix} ${label} exceeds ${kit.size.width}x${kit.size.height}`);
  }
}

function isPositiveRect(rect) {
  return rect &&
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.width > 0 &&
    rect.height > 0;
}
