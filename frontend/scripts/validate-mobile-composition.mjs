import fs from 'node:fs/promises';
import path from 'node:path';

const rootDir = path.resolve(new URL('..', import.meta.url).pathname);
const contractPath = path.join(rootDir, 'src/skins/SKIN_LAYOUT_CONTRACT_V1.json');
const compositionPath = path.join(rootDir, 'src/skins/SKIN_MOBILE_COMPOSITION_V1.json');

const contract = JSON.parse(await fs.readFile(contractPath, 'utf8'));
const composition = JSON.parse(await fs.readFile(compositionPath, 'utf8'));
const failures = [];

if (composition.version !== 'v1') {
  failures.push(`Composition version must be "v1", got "${composition.version ?? 'missing'}".`);
}

const profile = contract.profiles?.[composition.targetProfile];
if (!profile) {
  failures.push(
    `Composition targetProfile "${composition.targetProfile ?? 'missing'}" must exist in ` +
    `${path.relative(rootDir, contractPath)}.`
  );
}

const floors = composition.floors ?? {};

if (profile) {
  validateProfile(profile);
}

if (failures.length > 0) {
  console.error('Mobile composition validation failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(
  `Mobile composition OK: ${composition.targetProfile} ` +
  `${profile.size.width}x${profile.size.height}, drawer rows ${drawerCapacity(profile, 'log')}/${drawerCapacity(profile, 'inventory')}.`
);

function validateProfile(selectedProfile) {
  const { width, height } = selectedProfile.size ?? {};
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    failures.push('Target profile must have finite size.');
    return;
  }

  for (const regionName of [
    ...(composition.closedStateRegions ?? []),
    ...(composition.drawerRegions ?? []),
    'endState'
  ]) {
    if (!selectedProfile.regions?.[regionName]) {
      failures.push(`Target profile missing region "${regionName}".`);
    }
  }

  for (const regionName of composition.closedStateRegions ?? []) {
    validateRectInsideScreen(`region ${regionName}`, selectedProfile.regions?.[regionName], width, height);
  }

  validateClosedRegionsDoNotOverlap(selectedProfile);
  validateRegionStack(selectedProfile);
  validateSurfaceBudgets(selectedProfile, width, height);
  validateDrawers(selectedProfile);
  validateRuntimeSlots(selectedProfile);
  validateControls(selectedProfile);
}

function validateClosedRegionsDoNotOverlap(selectedProfile) {
  const regionNames = composition.closedStateRegions ?? [];
  for (let leftIndex = 0; leftIndex < regionNames.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < regionNames.length; rightIndex += 1) {
      const leftName = regionNames[leftIndex];
      const rightName = regionNames[rightIndex];
      const left = selectedProfile.regions?.[leftName];
      const right = selectedProfile.regions?.[rightName];
      if (left && right && rectsOverlap(left, right)) {
        failures.push(`Closed-state regions ${leftName} and ${rightName} must not overlap.`);
      }
    }
  }
}

function validateRegionStack(selectedProfile) {
  const hierarchy = composition.hierarchy ?? [];
  for (let index = 1; index < hierarchy.length; index += 1) {
    const previousName = hierarchy[index - 1];
    const currentName = hierarchy[index];
    const previous = selectedProfile.regions?.[previousName];
    const current = selectedProfile.regions?.[currentName];
    if (previous && current && previous.y + previous.height > current.y) {
      failures.push(`${currentName} must start below ${previousName} in the closed mobile stack.`);
    }
  }
}

function validateSurfaceBudgets(selectedProfile, width, height) {
  const map = selectedProfile.regions?.map;
  const latest = selectedProfile.regions?.latest;
  const player = selectedProfile.regions?.player;
  const combat = selectedProfile.regions?.combat;
  const controls = selectedProfile.regions?.controls;
  const latestMessage = selectedProfile.runtime?.latest?.message;

  if (map) {
    const mapAreaRatio = (map.width * map.height) / (width * height);
    validateRange('map area ratio', mapAreaRatio, floors.mapAreaRatioMin, floors.mapAreaRatioMax);
    if (map.y > floors.compactChromeTopMax) {
      failures.push(`map starts too low for compact chrome: y ${map.y} > ${floors.compactChromeTopMax}.`);
    }
    if (latest && latest.y - (map.y + map.height) < floors.mapToLatestGapMin) {
      failures.push(
        `map/latest gap ${latest.y - (map.y + map.height)}px < ${floors.mapToLatestGapMin}px.`
      );
    }
  }

  validateMin('latest height', latest?.height, floors.latestHeightMin);
  validateMin('latest message slot height', latestMessage?.height, floors.latestMessageHeightMin);
  validateMax('player region height', player?.height, floors.playerHeightMax);
  validateMax('combat region height', combat?.height, floors.combatHeightMax);
  validateMin('controls region height', controls?.height, floors.controlsHeightMin);

  if (controls) {
    const bottomGap = height - (controls.y + controls.height);
    if (bottomGap > floors.controlsBottomGapMax) {
      failures.push(`controls bottom gap ${bottomGap}px > ${floors.controlsBottomGapMax}px.`);
    }
  }
}

function validateDrawers(selectedProfile) {
  for (const drawerName of composition.drawerRegions ?? []) {
    const region = selectedProfile.regions?.[drawerName];
    const controls = selectedProfile.regions?.controls;
    const rowCapacity = drawerCapacity(selectedProfile, drawerName);

    validateMin(`${drawerName} drawer height`, region?.height, floors.drawerHeightMin);
    validateMin(`${drawerName} drawer row capacity`, rowCapacity, floors.drawerRowCapacityMin);

    if (region && controls) {
      const overlap = Math.max(0, Math.min(region.y + region.height, controls.y + controls.height) - Math.max(region.y, controls.y));
      if (overlap > floors.drawerControlsOverlapMax) {
        failures.push(
          `${drawerName} drawer overlaps controls by ${overlap}px > ${floors.drawerControlsOverlapMax}px.`
        );
      }
    }
  }
}

function validateRuntimeSlots(selectedProfile) {
  const runtime = selectedProfile.runtime ?? {};
  validateContained('runtime.latest.message', runtime.latest?.message, selectedProfile.regions?.latest);
  validateContained('runtime.title.gameTitle', runtime.title?.gameTitle, selectedProfile.regions?.title);
  validateContained('runtime.player.hpLabel', runtime.player?.hpLabel, selectedProfile.regions?.player);
  validateContained('runtime.player.hpValue', runtime.player?.hpValue, selectedProfile.regions?.player);
  validateContained('runtime.combat.enemyName', runtime.combat?.enemyName, selectedProfile.regions?.combat);
  validateContained('runtime.combat.enemyHpValue', runtime.combat?.enemyHpValue, selectedProfile.regions?.combat);
  validateMin('tile value slot width', runtime.player?.stats?.find((slot) => slot.id === 'tile')?.valueRect?.width, floors.tileValueWidthMin);
  validateMin('enemy name slot width', runtime.combat?.enemyName?.width, floors.enemyNameWidthMin);
  validateMin('enemy HP slot width', runtime.combat?.enemyHpValue?.width, floors.enemyHpWidthMin);

  for (const stat of runtime.player?.stats ?? []) {
    validateContained(`runtime.player.stats.${stat.id}.labelRect`, stat.labelRect, selectedProfile.regions?.player);
    validateContained(`runtime.player.stats.${stat.id}.valueRect`, stat.valueRect, selectedProfile.regions?.player);
  }
}

function validateControls(selectedProfile) {
  const buttons = selectedProfile.layout?.buttons ?? {};
  const controls = selectedProfile.regions?.controls;
  for (const name of ['attack', 'run', 'moveN', 'moveS', 'moveE', 'moveW']) {
    validateContained(`layout.buttons.${name}`, buttons[name], controls);
  }

  for (const name of ['attack', 'run']) {
    validateMin(`${name} button width`, buttons[name]?.width, floors.actionButtonWidthMin);
    validateMin(`${name} button height`, buttons[name]?.height, floors.actionButtonHeightMin);
  }

  for (const name of ['moveN', 'moveS', 'moveE', 'moveW']) {
    validateMin(`${name} button width`, buttons[name]?.width, floors.dpadButtonSizeMin);
    validateMin(`${name} button height`, buttons[name]?.height, floors.dpadButtonSizeMin);
  }

  for (const name of ['log', 'inventory']) {
    validateMin(`${name} toggle width`, buttons[name]?.width, floors.toggleWidthMin);
    validateMin(`${name} toggle height`, buttons[name]?.height, floors.toggleHeightMin);
    validateContained(`layout.buttons.${name}`, buttons[name], selectedProfile.regions?.[name]);
  }

  if (buttons.attack && buttons.run && buttons.attack.x !== buttons.run.x) {
    failures.push('attack and run buttons should align on the same action-button rail.');
  }
  if (buttons.attack && buttons.moveE && buttons.attack.x <= buttons.moveE.x + buttons.moveE.width) {
    failures.push('action buttons must sit to the right of the D-pad cluster.');
  }
}

function drawerCapacity(selectedProfile, drawerName) {
  const region = selectedProfile.regions?.[drawerName];
  const drawer = selectedProfile.runtime?.drawers?.[drawerName];
  const firstRow = drawerName === 'log' ? drawer?.rowText : drawer?.rowPanel;
  if (!region || !drawer || !firstRow || !Number.isFinite(drawer.rowHeight) || drawer.rowHeight <= 0) {
    return NaN;
  }
  return Math.floor((region.y + region.height - firstRow.y) / drawer.rowHeight);
}

function validateRectInsideScreen(label, rect, width, height) {
  if (!isRect(rect)) {
    failures.push(`${label} must be a rectangle.`);
    return;
  }
  validateContained(label, rect, { x: 0, y: 0, width, height });
}

function validateContained(label, rect, container) {
  if (!isRect(rect) || !isRect(container)) {
    failures.push(`${label} must be contained by a valid rectangle.`);
    return;
  }
  if (!containsRect(container, rect)) {
    failures.push(`${label} must stay inside its owning region.`);
  }
}

function validateRange(label, value, min, max) {
  validateMin(label, value, min);
  validateMax(label, value, max);
}

function validateMin(label, value, min) {
  if (Number.isFinite(min) && (!Number.isFinite(value) || value < min)) {
    failures.push(`${label} ${formatNumber(value)} < ${min}.`);
  }
}

function validateMax(label, value, max) {
  if (Number.isFinite(max) && (!Number.isFinite(value) || value > max)) {
    failures.push(`${label} ${formatNumber(value)} > ${max}.`);
  }
}

function isRect(value) {
  return value &&
    ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(value[key])) &&
    value.width > 0 &&
    value.height > 0;
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

function formatNumber(value) {
  return Number.isFinite(value) ? Number(value).toFixed(3) : 'missing';
}
