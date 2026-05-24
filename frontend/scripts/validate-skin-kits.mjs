import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const rootDir = path.resolve(new URL('..', import.meta.url).pathname);
const fixedDir = path.join(rootDir, 'src/skins/neo-tokyo-console/fixed');
const layoutContractPath = path.join(rootDir, 'src/skins/SKIN_LAYOUT_CONTRACT_V1.json');
const layoutContract = JSON.parse(await fs.readFile(layoutContractPath, 'utf8'));
const mobilePortrait = layoutContract.profiles.mobilePortrait;
const mobileCompact = layoutContract.profiles.mobileCompact;
const buttonStates = mobilePortrait.requiredStates.buttons;
const materialKinds = Object.keys(mobilePortrait.materials ?? {});
const profileRoles = new Set(['default', 'variant', 'prototype', 'legacy']);
const cropVariantKinds = new Set(['button', 'toggle-button', 'status-indicator', 'combat-led']);
const materialRenderModes = new Set(['tinted', 'source']);
const metadataTokenPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const renderThemeKeys = [
  'primary',
  'primaryText',
  'primaryDimText',
  'secondary',
  'secondaryText',
  'lcdFill',
  'panelFill',
  'controlFrame',
  'buttonFrame',
  'titleText',
  'bodyText',
  'mutedText',
  'combat',
  'combatText'
];
const hexColorPattern = /^#[0-9a-fA-F]{6}$/;
const mobileKitSummaries = [];

const failures = [];
const kitPaths = await findSkinKits(fixedDir);

if (kitPaths.length === 0) {
  failures.push(`No skin-kit.json files found under ${path.relative(rootDir, fixedDir)}`);
}

for (const kitPath of kitPaths) {
  await validateKit(kitPath);
}

validateMobileDefaultSelection();

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

  if (kit.kind === 'mobilePortrait' || kit.kind === 'mobileCompact') {
    mobileKitSummaries.push({
      id: kit.id ?? path.basename(kitDir),
      role: kit.meta?.role,
      defaultPriority: kit.meta?.defaultPriority
    });
  }

  if (kit.kind !== 'mobilePortrait' && kit.kind !== 'mobileCompact' && kit.kind !== 'desktopWide') {
    failures.push(`${prefix} invalid kind "${kit.kind}"`);
  }

  if (!kit.size || kit.size.width <= 0 || kit.size.height <= 0) {
    failures.push(`${prefix} missing positive size`);
  }

  validateRequiredContract(prefix, kit);
  validateRenderTheme(prefix, kit);
  validateFixedAssetGeometry(prefix, kit);
  await validateAsset(kitDir, prefix, 'chassis', kit.assets?.chassis);
  await validateMaterials(kitDir, prefix, kit);

  for (const [name, asset] of Object.entries(kit.assets?.buttons ?? {})) {
    const stateAssets = [];
    for (const state of buttonStatesForKit(kit, name)) {
      const png = await validateAsset(kitDir, prefix, `${name}.${state}`, {
        ...asset,
        path: `${asset.prefix}-${state}.png`
      });
      if (png) {
        stateAssets.push({ state, sha256: png.sha256 });
      }
    }
    validateDistinctStateAssets(prefix, `button ${name}`, stateAssets);
  }

  for (const [name, asset] of Object.entries(kit.assets?.indicators ?? {})) {
    const stateAssets = [];
    if (asset.files) {
      for (const file of asset.files) {
        const png = await validateAsset(kitDir, prefix, `${name}.${file}`, { ...asset, path: file });
        if (png) {
          stateAssets.push({ state: file, sha256: png.sha256 });
        }
      }
      validateDistinctStateAssets(prefix, `indicator ${name}`, stateAssets);
      continue;
    }

    for (const state of asset.states ?? []) {
      const png = await validateAsset(kitDir, prefix, `${name}.${state}`, {
        ...asset,
        path: `${asset.prefix}-${state}.png`
      });
      if (png) {
        stateAssets.push({ state, sha256: png.sha256 });
      }
    }
    validateDistinctStateAssets(prefix, `indicator ${name}`, stateAssets);
  }

  validateRegions(prefix, kit);
  await validateBuildPlan(kitDir, prefix, kit);
}

function validateRenderTheme(prefix, kit) {
  if (isProductionMobileMeta(kit.meta) && !kit.renderTheme) {
    failures.push(`${prefix} production mobile kit must declare renderTheme`);
    return;
  }

  if (!kit.renderTheme) {
    return;
  }

  if (typeof kit.renderTheme !== 'object' || Array.isArray(kit.renderTheme)) {
    failures.push(`${prefix} renderTheme must be an object`);
    return;
  }

  for (const key of renderThemeKeys) {
    const value = kit.renderTheme[key];
    if (!hexColorPattern.test(value ?? '')) {
      failures.push(`${prefix} renderTheme.${key} must be a #rrggbb color`);
    }
  }

  for (const key of Object.keys(kit.renderTheme)) {
    if (!renderThemeKeys.includes(key)) {
      failures.push(`${prefix} unknown renderTheme key ${key}`);
    }
  }
}

function validateRequiredContract(prefix, kit) {
  if (kit.kind !== 'mobilePortrait' && kit.kind !== 'mobileCompact') {
    return;
  }

  const contract = kit.kind === 'mobileCompact' ? mobileCompact : mobilePortrait;

  if (kit.size?.width !== contract.size.width || kit.size?.height !== contract.size.height) {
    failures.push(`${prefix} ${kit.kind} size must be ${contract.size.width}x${contract.size.height}`);
  }

  validateMetadata(prefix, kit);

  for (const region of Object.keys(contract.regions)) {
    if (!kit.regions?.[region]) {
      failures.push(`${prefix} missing required region ${region}`);
    }
  }

  for (const button of Object.keys(contract.layout.buttons)) {
    if (!kit.assets?.buttons?.[button]) {
      failures.push(`${prefix} missing required button asset ${button}`);
    }
  }

  for (const button of contract.requiredStates.toggleButtons ?? []) {
    if (!kit.assets?.buttons?.[button]) {
      failures.push(`${prefix} missing required toggle button asset ${button}`);
    }
  }

  for (const material of materialKinds) {
    if (!kit.assets?.materials?.[material]) {
      failures.push(`${prefix} missing required material asset ${material}`);
    }
  }

  const statusStates = kit.assets?.indicators?.status?.states ?? [];
  for (const state of contract.requiredStates.status) {
    if (!statusStates.includes(state)) {
      failures.push(`${prefix} status indicator missing state ${state}`);
    }
  }

  const combatLedFiles = kit.assets?.indicators?.combatLed?.files ?? [];
  for (const file of contract.requiredStates.combatLedFiles) {
    if (!combatLedFiles.includes(file)) {
      failures.push(`${prefix} combatLed indicator missing file ${file}`);
    }
  }

  for (const [group, rects] of Object.entries(contract.layout)) {
    for (const name of Object.keys(rects)) {
      const rect = kit.layout?.[group]?.[name];
      if (!rect) {
        failures.push(`${prefix} missing required layout ${group}.${name}`);
        continue;
      }
      validateRect(prefix, kit, `layout ${group}.${name}`, rect);
    }
  }

  if (isProductionMobileMeta(kit.meta)) {
    validateRuntimeLayout(prefix, kit, contract);
    validateProductionMobileGeometry(prefix, kit, contract);
  }
}

function buttonStatesForKit(kit, buttonName) {
  if (kit.kind !== 'mobilePortrait' && kit.kind !== 'mobileCompact') {
    return buttonStates;
  }

  const contract = kit.kind === 'mobileCompact' ? mobileCompact : mobilePortrait;
  const toggleButtons = new Set(contract.requiredStates.toggleButtons ?? []);
  if (isProductionMobileMeta(kit.meta) && toggleButtons.has(buttonName)) {
    return contract.requiredStates.toggleButtonStates ?? buttonStates;
  }

  return buttonStates;
}

function validateMetadata(prefix, kit) {
  const meta = kit.meta;
  if (!meta) {
    failures.push(`${prefix} missing required mobilePortrait meta`);
    return;
  }

  for (const key of ['label', 'family']) {
    if (!isNonEmptyString(meta[key])) {
      failures.push(`${prefix} meta.${key} must be a non-empty string`);
    }
  }

  if (!profileRoles.has(meta.role)) {
    failures.push(`${prefix} meta.role must be one of ${Array.from(profileRoles).join(', ')}`);
  }

  for (const key of ['tags', 'mood', 'palette']) {
    if (!isNonEmptyStringArray(meta[key])) {
      failures.push(`${prefix} meta.${key} must be a non-empty string array`);
    } else {
      validateMetadataTokens(prefix, key, meta[key]);
    }
  }

  if (!Number.isFinite(meta.defaultPriority) || meta.defaultPriority < 0 || meta.defaultPriority > 100) {
    failures.push(`${prefix} meta.defaultPriority must be a finite number from 0 to 100`);
  }
}

function validateMetadataTokens(prefix, key, tokens) {
  const seen = new Set();

  for (const token of tokens) {
    if (!metadataTokenPattern.test(token)) {
      failures.push(`${prefix} meta.${key} token "${token}" must be lowercase kebab-case`);
    }

    if (seen.has(token)) {
      failures.push(`${prefix} meta.${key} token "${token}" is duplicated`);
    }

    seen.add(token);
  }
}

function validateProductionMobileGeometry(prefix, kit, contract) {
  for (const [name, expected] of Object.entries(contract.regions)) {
    validateExactRect(prefix, `region ${name}`, kit.regions?.[name], expected);
  }

  for (const [group, rects] of Object.entries(contract.layout)) {
    for (const [name, expected] of Object.entries(rects)) {
      validateExactRect(prefix, `layout ${group}.${name}`, kit.layout?.[group]?.[name], expected);
    }
  }

  validateNoOverlap(prefix, kit, ['map', 'latest', 'title', 'player', 'combat', 'controls']);

  validateContainedRect(prefix, 'layout fills.playerHp', kit.layout?.fills?.playerHp, kit.regions?.player);
  validateContainedRect(prefix, 'layout fills.playerStats', kit.layout?.fills?.playerStats, kit.regions?.player);
  validateContainedRect(prefix, 'layout fills.enemyHp', kit.layout?.fills?.enemyHp, kit.regions?.combat);
  validateContainedRect(prefix, 'layout buttons.restart', kit.layout?.buttons?.restart, kit.regions?.endState);

  for (const name of ['attack', 'run', 'moveN', 'moveS', 'moveE', 'moveW']) {
    validateContainedRect(prefix, `layout buttons.${name}`, kit.layout?.buttons?.[name], kit.regions?.controls);
  }

  validateButtonSize(prefix, 'attack', kit.layout?.buttons?.attack, { minWidth: 140, minHeight: 52 });
  validateButtonSize(prefix, 'run', kit.layout?.buttons?.run, { minWidth: 140, minHeight: 52 });
  validateButtonSize(prefix, 'restart', kit.layout?.buttons?.restart, { minWidth: 180, minHeight: 52 });

  for (const name of ['moveN', 'moveS', 'moveE', 'moveW']) {
    validateButtonSize(prefix, name, kit.layout?.buttons?.[name], { minWidth: 52, minHeight: 52 });
  }

  for (const name of ['log', 'inventory']) {
    validateButtonSize(prefix, name, kit.layout?.buttons?.[name], { minWidth: 38, minHeight: 24 });
  }
}

function validateRuntimeLayout(prefix, kit, contract) {
  if (!kit.runtime) {
    failures.push(`${prefix} missing required runtime layout`);
    return;
  }

  validateExactRuntime(prefix, 'runtime', kit.runtime, contract.runtime);
  if (contract.runtime.title?.brand) {
    validateRuntimeRect(prefix, kit, 'runtime.title.brand', kit.runtime.title?.brand);
  }
  validateRuntimeRect(prefix, kit, 'runtime.title.playerIcon', kit.runtime.title?.playerIcon, kit.regions?.title);
  validateRuntimeRect(prefix, kit, 'runtime.title.gameTitle', kit.runtime.title?.gameTitle, kit.regions?.title);
  validateRuntimeRect(prefix, kit, 'runtime.latest.label', kit.runtime.latest?.label, kit.regions?.latest);
  validateRuntimeRect(prefix, kit, 'runtime.latest.message', kit.runtime.latest?.message, kit.regions?.latest);
  validateRuntimeRect(prefix, kit, 'runtime.player.hpLabel', kit.runtime.player?.hpLabel, kit.regions?.player);
  validateRuntimeRect(prefix, kit, 'runtime.player.hpValue', kit.runtime.player?.hpValue, kit.regions?.player);
  for (const [index, stat] of (kit.runtime.player?.stats ?? []).entries()) {
    validateRuntimeRect(prefix, kit, `runtime.player.stats[${index}].labelRect`, stat.labelRect, kit.regions?.player);
    validateRuntimeRect(prefix, kit, `runtime.player.stats[${index}].valueRect`, stat.valueRect, kit.regions?.player);
  }
  validateRuntimeRect(prefix, kit, 'runtime.combat.mode', kit.runtime.combat?.mode, kit.regions?.combat);
  validateRuntimeRect(prefix, kit, 'runtime.combat.exploreText', kit.runtime.combat?.exploreText, kit.regions?.combat);
  validateRuntimeRect(prefix, kit, 'runtime.combat.enemyIcon', kit.runtime.combat?.enemyIcon, kit.regions?.combat);
  validateRuntimeRect(prefix, kit, 'runtime.combat.enemyName', kit.runtime.combat?.enemyName, kit.regions?.combat);
  validateRuntimeRect(prefix, kit, 'runtime.combat.enemyHpValue', kit.runtime.combat?.enemyHpValue, kit.regions?.combat);

  const drawerGroups = [
    ['log', kit.runtime.drawers?.log, kit.regions?.log],
    ['inventory', kit.runtime.drawers?.inventory, kit.regions?.inventory]
  ];
  for (const [drawerName, drawer, region] of drawerGroups) {
    if (!drawer) {
      failures.push(`${prefix} missing runtime.drawers.${drawerName}`);
      continue;
    }
    if (!Number.isFinite(drawer.rowHeight) || drawer.rowHeight <= 0) {
      failures.push(`${prefix} runtime.drawers.${drawerName}.rowHeight must be a positive number`);
    }
    for (const [slotName, rect] of Object.entries(drawer)) {
      if (slotName === 'rowHeight') {
        continue;
      }
      validateRuntimeRect(prefix, kit, `runtime.drawers.${drawerName}.${slotName}`, rect, region);
    }
  }
}

function validateExactRuntime(prefix, label, actual, expected) {
  if (isRectLike(expected)) {
    validateExactRect(prefix, label, actual, expected);
    return;
  }

  if (typeof expected === 'number') {
    if (actual !== expected) {
      failures.push(`${prefix} ${label} ${actual} must match Skin Layout Contract v1 ${expected}`);
    }
    return;
  }

  if (typeof expected === 'string') {
    if (actual !== expected) {
      failures.push(`${prefix} ${label} "${actual}" must match Skin Layout Contract v1 "${expected}"`);
    }
    return;
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      failures.push(`${prefix} ${label} must be an array`);
      return;
    }
    if (actual.length !== expected.length) {
      failures.push(`${prefix} ${label} length ${actual.length} must match Skin Layout Contract v1 ${expected.length}`);
      return;
    }
    for (let index = 0; index < expected.length; index += 1) {
      validateExactRuntime(prefix, `${label}[${index}]`, actual[index], expected[index]);
    }
    return;
  }

  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) {
    failures.push(`${prefix} ${label} must be an object`);
    return;
  }

  for (const key of Object.keys(expected ?? {})) {
    validateExactRuntime(prefix, `${label}.${key}`, actual[key], expected[key]);
  }

  for (const key of Object.keys(actual)) {
    if (!(key in (expected ?? {}))) {
      failures.push(`${prefix} ${label}.${key} is not part of Skin Layout Contract v1`);
    }
  }
}

function validateRuntimeRect(prefix, kit, label, rect, container) {
  if (!rect) {
    failures.push(`${prefix} missing ${label}`);
    return;
  }
  validateRect(prefix, kit, label, rect);
  if (container) {
    validateContainedRect(prefix, label, rect, container);
  }
}

function validateExactRect(prefix, label, actual, expected) {
  if (!actual || !expected) {
    return;
  }

  for (const key of ['x', 'y', 'width', 'height']) {
    if (actual[key] !== expected[key]) {
      failures.push(
        `${prefix} ${label}.${key} ${actual[key]} must match Skin Layout Contract v1 ${expected[key]}`
      );
    }
  }
}

async function validateMaterials(kitDir, prefix, kit) {
  const materials = kit.assets?.materials;
  if (!materials) {
    return;
  }

  for (const [name, material] of Object.entries(materials)) {
    if (!materialKinds.includes(name)) {
      failures.push(`${prefix} unknown material asset ${name}`);
      continue;
    }

    if (!material || typeof material !== 'object') {
      failures.push(`${prefix} material ${name} must be an object`);
      continue;
    }

    await validateAsset(kitDir, prefix, `material ${name}.fill`, material.fill);
    const frame = await validateAsset(kitDir, prefix, `material ${name}.frame`, material.frame);
    if (!Number.isFinite(material.slice) || material.slice <= 0) {
      failures.push(`${prefix} material ${name}.slice must be a positive number`);
    } else if (frame && material.slice * 2 >= Math.min(frame.width, frame.height)) {
      failures.push(`${prefix} material ${name}.slice ${material.slice} is too large for frame ${frame.width}x${frame.height}`);
    }

    if (material.renderMode !== undefined && !materialRenderModes.has(material.renderMode)) {
      failures.push(`${prefix} material ${name}.renderMode must be one of ${Array.from(materialRenderModes).join(', ')}`);
    }

    if (
      isProductionMobileMeta(kit.meta) &&
      material.renderMode === undefined &&
      (isLocalMaterialAsset(kitDir, material.fill) || isLocalMaterialAsset(kitDir, material.frame))
    ) {
      failures.push(`${prefix} local production material ${name} must declare renderMode`);
    }
  }
}

function validateFixedAssetGeometry(prefix, kit) {
  validateDeclaredAssetSize(prefix, 'assets.chassis', kit.assets?.chassis, kit.size);

  for (const name of Object.keys(kit.assets?.buttons ?? {})) {
    validateDeclaredAssetSize(
      prefix,
      `assets.buttons.${name}`,
      kit.assets?.buttons?.[name],
      kit.layout?.buttons?.[name]
    );
  }

  for (const name of Object.keys(kit.assets?.indicators ?? {})) {
    validateDeclaredAssetSize(
      prefix,
      `assets.indicators.${name}`,
      kit.assets?.indicators?.[name],
      kit.layout?.indicators?.[name]
    );
  }
}

function validateDeclaredAssetSize(prefix, label, asset, rect) {
  if (!asset || !rect) {
    return;
  }

  if (!Number.isFinite(asset.width) || !Number.isFinite(asset.height)) {
    failures.push(`${prefix} ${label} must declare fixed width and height`);
    return;
  }

  if (asset.width !== rect.width || asset.height !== rect.height) {
    failures.push(
      `${prefix} ${label} ${asset.width}x${asset.height} must match layout ${rect.width}x${rect.height}`
    );
  }
}

async function validateAsset(kitDir, prefix, label, asset) {
  if (!asset?.path) {
    failures.push(`${prefix} ${label} missing path`);
    return;
  }

  if (!isRelativePngPath(asset.path)) {
    failures.push(`${prefix} ${label}.path must be a relative PNG path`);
    return;
  }

  const assetPath = path.resolve(asset.sourceProfile
    ? path.join(fixedDir, asset.sourceProfile, asset.path)
    : path.join(kitDir, asset.path));
  if (!containsPath(rootDir, assetPath)) {
    failures.push(`${prefix} ${label}.path must stay inside ${path.relative(process.cwd(), rootDir)}`);
    return;
  }

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

  return png;
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
    hasAlpha: data[25] === 4 || data[25] === 6,
    sha256: createHash('sha256').update(data).digest('hex')
  };
}

function validateDistinctStateAssets(prefix, label, assets) {
  const seen = new Map();

  for (const asset of assets) {
    const existingState = seen.get(asset.sha256);
    if (existingState) {
      failures.push(`${prefix} ${label} states ${existingState} and ${asset.state} use identical PNG data`);
    } else {
      seen.set(asset.sha256, asset.state);
    }
  }
}

function validateRegions(prefix, kit) {
  for (const [name, rect] of Object.entries(kit.regions ?? {})) {
    validateRect(prefix, kit, `region ${name}`, rect);
  }
}

async function validateBuildPlan(kitDir, prefix, kit) {
  const build = kit.build;
  if (!build) {
    return;
  }

  if (!isNonEmptyString(build.source)) {
    failures.push(`${prefix} build.source must be a non-empty relative PNG path`);
    return;
  }

  if (!Array.isArray(build.crops) || build.crops.length === 0) {
    failures.push(`${prefix} build.crops must be a non-empty array`);
    return;
  }

  const baseSource = await validateBuildSource(kitDir, prefix, 'build.source', build.source);
  const seenOutputs = new Set();

  for (let index = 0; index < build.crops.length; index += 1) {
    const crop = build.crops[index];
    const label = `build.crops[${index}]`;

    if (!crop || typeof crop !== 'object') {
      failures.push(`${prefix} ${label} must be an object`);
      continue;
    }

    validateCropOutputPath(kitDir, prefix, label, crop.path, seenOutputs);

    const source = crop.source
      ? await validateBuildSource(kitDir, prefix, `${label}.source`, crop.source)
      : baseSource;

    validateCropRect(prefix, `${label}.rect`, crop.rect, source);

    if (crop.alphaRadius !== undefined) {
      if (!Number.isFinite(crop.alphaRadius) || crop.alphaRadius < 0) {
        failures.push(`${prefix} ${label}.alphaRadius must be a non-negative number`);
      } else if (crop.rect && crop.alphaRadius > Math.min(crop.rect.width, crop.rect.height) / 2) {
        failures.push(`${prefix} ${label}.alphaRadius ${crop.alphaRadius} is too large for ${crop.rect.width}x${crop.rect.height}`);
      }
    }

    if (crop.variants !== undefined) {
      if (!cropVariantKinds.has(crop.variants)) {
        failures.push(`${prefix} ${label}.variants must be one of ${Array.from(cropVariantKinds).join(', ')}`);
      } else {
        validateCropVariantPath(prefix, label, crop);
      }
    }
  }
}

async function validateBuildSource(kitDir, prefix, label, sourcePath) {
  if (!isRelativePngPath(sourcePath)) {
    failures.push(`${prefix} ${label} must be a relative PNG path`);
    return;
  }

  const resolved = path.resolve(kitDir, sourcePath);
  if (!containsPath(rootDir, resolved)) {
    failures.push(`${prefix} ${label} must stay inside ${path.relative(process.cwd(), rootDir)}`);
    return;
  }

  let png;
  try {
    png = await readPngHeader(resolved);
  } catch (error) {
    failures.push(`${prefix} ${label} ${error.message}`);
    return;
  }

  return png;
}

function validateCropOutputPath(kitDir, prefix, label, cropPath, seenOutputs) {
  if (!isSafeRelativePath(cropPath)) {
    failures.push(`${prefix} ${label}.path must be a safe relative PNG path`);
    return;
  }

  if (!cropPath.endsWith('.png')) {
    failures.push(`${prefix} ${label}.path must end with .png`);
  }

  const resolved = path.resolve(kitDir, cropPath);
  if (!containsPath(kitDir, resolved)) {
    failures.push(`${prefix} ${label}.path must stay inside the skin-kit directory`);
  }

  if (seenOutputs.has(cropPath)) {
    failures.push(`${prefix} ${label}.path duplicates another build crop: ${cropPath}`);
  }

  seenOutputs.add(cropPath);
}

function validateCropRect(prefix, label, rect, source) {
  if (!isPositiveRect(rect)) {
    failures.push(`${prefix} ${label} is not a positive rectangle`);
    return;
  }

  if (source && (rect.x + rect.width > source.width || rect.y + rect.height > source.height)) {
    failures.push(`${prefix} ${label} exceeds source ${source.width}x${source.height}`);
  }
}

function validateCropVariantPath(prefix, label, crop) {
  const filename = path.basename(crop.path ?? '');
  if ((crop.variants === 'button' || crop.variants === 'toggle-button') && !filename.endsWith('-idle.png')) {
    failures.push(`${prefix} ${label}.path must end with -idle.png for ${crop.variants} variants`);
  }

  if (crop.variants === 'status-indicator' && !filename.endsWith('-ready.png')) {
    failures.push(`${prefix} ${label}.path must end with -ready.png for status-indicator variants`);
  }

  if (crop.variants === 'combat-led' && filename !== 'led-off.png') {
    failures.push(`${prefix} ${label}.path must be led-off.png for combat-led variants`);
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

function validateRectSize(prefix, label, rect, constraints) {
  if (!rect) {
    return;
  }

  if (constraints.minWidth && rect.width < constraints.minWidth) {
    failures.push(`${prefix} ${label} width ${rect.width}px < ${constraints.minWidth}px`);
  }

  if (constraints.minHeight && rect.height < constraints.minHeight) {
    failures.push(`${prefix} ${label} height ${rect.height}px < ${constraints.minHeight}px`);
  }

  if (constraints.maxHeight && rect.height > constraints.maxHeight) {
    failures.push(`${prefix} ${label} height ${rect.height}px > ${constraints.maxHeight}px`);
  }
}

function validateButtonSize(prefix, name, rect, constraints) {
  validateRectSize(prefix, `layout buttons.${name}`, rect, constraints);
}

function validateNoOverlap(prefix, kit, regionNames) {
  for (let leftIndex = 0; leftIndex < regionNames.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < regionNames.length; rightIndex += 1) {
      const leftName = regionNames[leftIndex];
      const rightName = regionNames[rightIndex];
      const left = kit.regions?.[leftName];
      const right = kit.regions?.[rightName];

      if (left && right && rectsOverlap(left, right)) {
        failures.push(`${prefix} production regions ${leftName} and ${rightName} overlap`);
      }
    }
  }
}

function validateContainedRect(prefix, label, rect, container) {
  if (!rect || !container) {
    return;
  }

  if (!containsRect(container, rect)) {
    failures.push(`${prefix} ${label} must stay inside its production region`);
  }
}

function rectsOverlap(left, right) {
  return Math.min(left.x + left.width, right.x + right.width) > Math.max(left.x, right.x) &&
    Math.min(left.y + left.height, right.y + right.height) > Math.max(left.y, right.y);
}

function containsRect(container, rect) {
  return rect.x >= container.x &&
    rect.y >= container.y &&
    rect.x + rect.width <= container.x + container.width &&
    rect.y + rect.height <= container.y + container.height;
}

function validateMobileDefaultSelection() {
  if (mobileKitSummaries.length === 0) {
    return;
  }

  const defaults = mobileKitSummaries.filter((kit) => kit.role === 'default');
  if (defaults.length !== 1) {
    failures.push(`Expected exactly one mobilePortrait default profile, found ${defaults.length}`);
  }

  const selected = mobileKitSummaries.reduce((best, kit) => {
    if (!Number.isFinite(kit.defaultPriority)) {
      return best;
    }

    if (!best || kit.defaultPriority > best.defaultPriority) {
      return kit;
    }

    return best;
  }, null);

  if (selected && selected.role !== 'default') {
    failures.push(`Highest-priority mobilePortrait profile must have role default, got ${selected.id} (${selected.role ?? 'none'})`);
  }
}

function isProductionMobileMeta(meta) {
  return meta?.role === 'default' || meta?.role === 'variant';
}

function isLocalMaterialAsset(kitDir, asset) {
  if (!asset?.path || asset.sourceProfile) {
    return false;
  }

  return containsPath(kitDir, path.resolve(kitDir, asset.path));
}

function isPositiveRect(rect) {
  return rect &&
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.width > 0 &&
    rect.height > 0;
}

function isRectLike(value) {
  return value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(value[key]));
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonEmptyStringArray(value) {
  return Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => isNonEmptyString(entry));
}

function isSafeRelativePath(value) {
  return isRelativePngPath(value) &&
    !value.split(/[\\/]/).includes('..');
}

function isRelativePngPath(value) {
  return isNonEmptyString(value) &&
    value.endsWith('.png') &&
    !path.isAbsolute(value) &&
    !value.split(/[\\/]/).includes('');
}

function containsPath(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
