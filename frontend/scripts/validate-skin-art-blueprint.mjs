import fs from 'node:fs/promises';
import path from 'node:path';

const rootDir = path.resolve(new URL('..', import.meta.url).pathname);
const contractPath = path.join(rootDir, 'src/skins/SKIN_LAYOUT_CONTRACT_V1.json');
const blueprintPath = path.join(rootDir, 'src/skins/SKIN_ART_BLUEPRINT_V1.json');

const contract = JSON.parse(await fs.readFile(contractPath, 'utf8'));
const blueprint = JSON.parse(await fs.readFile(blueprintPath, 'utf8'));
const failures = [];

if (blueprint.version !== 'v1') {
  failures.push(`Blueprint version must be "v1", got "${blueprint.version ?? 'missing'}".`);
}

const profile = contract.profiles?.[blueprint.targetProfile];
if (!profile) {
  failures.push(
    `Blueprint targetProfile "${blueprint.targetProfile ?? 'missing'}" must exist in ${path.relative(rootDir, contractPath)}.`
  );
}

for (const fileName of ['source-chassis.png', 'source-widgets.png', 'source-state-sheet.png', 'source-materials.png']) {
  if (!blueprint.sourceFiles?.[fileName]) {
    failures.push(`Blueprint sourceFiles must describe ${fileName}.`);
  }
}

if (profile) {
  for (const entry of blueprint.layoutStack ?? []) {
    if (entry.region && !profile.regions?.[entry.region]) {
      failures.push(`Blueprint layoutStack.${entry.id ?? 'unknown'} references missing region "${entry.region}".`);
    }
  }

  for (const family of blueprint.widgetFamilies ?? []) {
    const kind = family.kind;
    const assets = family.assets ?? [];
    if (!assets.length) {
      failures.push(`Blueprint widget family "${family.id ?? 'unknown'}" must list assets.`);
    }

    for (const asset of assets) {
      if (kind === 'button' && !profile.layout?.buttons?.[asset]) {
        failures.push(`Blueprint widget family "${family.id}" references missing button "${asset}".`);
      } else if (kind === 'indicator' && !profile.layout?.indicators?.[asset]) {
        failures.push(`Blueprint widget family "${family.id}" references missing indicator "${asset}".`);
      } else if (kind === 'fill' && !profile.layout?.fills?.[asset]) {
        failures.push(`Blueprint widget family "${family.id}" references missing fill "${asset}".`);
      } else if (!['button', 'indicator', 'fill'].includes(kind)) {
        failures.push(`Blueprint widget family "${family.id ?? 'unknown'}" has unknown kind "${kind ?? 'missing'}".`);
      }
    }
  }
}

for (const [section, minCount] of [
  ['layoutStack', 6],
  ['widgetFamilies', 5],
  ['materialRules', 3],
  ['forbiddenDynamicContent', 8],
  ['qualityGates', 6],
  ['reviewScenarios', 6]
]) {
  if (!Array.isArray(blueprint[section]) || blueprint[section].length < minCount) {
    failures.push(`Blueprint ${section} must contain at least ${minCount} entries.`);
  }
}

if (typeof blueprint.intent !== 'string' || blueprint.intent.length < 40) {
  failures.push('Blueprint intent must be a concrete sentence.');
}

if (typeof blueprint.visualTarget !== 'string' || blueprint.visualTarget.length < 40) {
  failures.push('Blueprint visualTarget must be a concrete sentence.');
}

if (failures.length > 0) {
  console.error('Skin art blueprint validation failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Skin art blueprint OK: ${blueprint.name} targets ${blueprint.targetProfile}.`);
