import fs from 'node:fs/promises';
import path from 'node:path';

const rootDir = path.resolve(new URL('..', import.meta.url).pathname);
const contractPath = path.join(rootDir, 'src/skins/SKIN_LAYOUT_CONTRACT_V1.json');
const contract = JSON.parse(await fs.readFile(contractPath, 'utf8'));
const parsedArgs = parseArgs(process.argv.slice(2));
const skinId = parsedArgs.positionals[0];
const profileName = parsedArgs.positionals[1] ?? 'mobilePortrait';
const profile = contract.profiles?.[profileName];

if (parsedArgs.options.help || !skinId) {
  printUsage();
  process.exit(parsedArgs.options.help ? 0 : 1);
}

if (!profile) {
  console.error(`Unknown profile "${profileName}". Expected one of: ${Object.keys(contract.profiles ?? {}).join(', ')}`);
  process.exit(1);
}

const manifest = buildManifest(skinId, profileName, profile, parsedArgs.options);
const output = `${JSON.stringify(manifest, null, 2)}\n`;

if (parsedArgs.options.out) {
  const outputPath = resolveOutputPath(parsedArgs.options.out);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, output, 'utf8');
  console.error(`Wrote ${path.relative(process.cwd(), outputPath)}`);
} else {
  process.stdout.write(output);
}

function buildManifest(id, kind, selectedProfile, options) {
  const palette = parseList(options.palette, ['graphite', 'green']);
  const buttonAssets = Object.fromEntries(
    Object.entries(selectedProfile.layout.buttons)
      .map(([name, rect]) => [
        name,
        {
          prefix: buttonPrefix(name),
          width: rect.width,
          height: rect.height,
          alpha: true
        }
      ])
  );

  const statusRect = selectedProfile.layout.indicators.status;
  const combatLedRect = selectedProfile.layout.indicators.combatLed;

  return {
    id,
    meta: {
      label: options.label ?? labelFromId(id),
      family: options.family ?? 'Generated Contract V1',
      role: options.role ?? 'prototype',
      tags: parseList(options.tags, ['prototype', 'contract-v1']),
      mood: parseList(options.mood, ['premium', 'experimental']),
      palette,
      defaultPriority: parseNumber(options['default-priority'], 0),
      generation: options.generation ?? 'skin-layout-contract-v1-scaffold'
    },
    kind,
    size: cloneRect(selectedProfile.size),
    renderTheme: renderThemeForPalette(palette),
    regions: cloneRectMap(selectedProfile.regions),
    assets: {
      chassis: {
        path: 'chassis.png',
        width: selectedProfile.size.width,
        height: selectedProfile.size.height
      },
      materials: cloneMaterialMap(selectedProfile.materials),
      buttons: buttonAssets,
      indicators: {
        status: {
          prefix: 'status',
          states: [...selectedProfile.requiredStates.status],
          width: statusRect.width,
          height: statusRect.height,
          alpha: true
        },
        combatLed: {
          files: [...selectedProfile.requiredStates.combatLedFiles],
          width: combatLedRect.width,
          height: combatLedRect.height,
          alpha: true
        }
      }
    },
    layout: {
      buttons: cloneRectMap(selectedProfile.layout.buttons),
      indicators: cloneRectMap(selectedProfile.layout.indicators),
      fills: cloneRectMap(selectedProfile.layout.fills)
    },
    build: {
      source: options.source ?? 'source-artboard.png',
      crops: buildCrops(selectedProfile, options)
    }
  };
}

function buildCrops(selectedProfile, options) {
  const materialSource = options['materials-source'] ?? options['material-source'];
  const crops = [
    {
      path: 'chassis.png',
      ...(options['chassis-source'] ? { source: options['chassis-source'] } : {}),
      rect: {
        x: 0,
        y: 0,
        width: selectedProfile.size.width,
        height: selectedProfile.size.height
      }
    }
  ];

  for (const [name, rect] of Object.entries(selectedProfile.layout.buttons)) {
    crops.push({
      path: `${buttonPrefix(name)}-idle.png`,
      rect: cloneRect(rect),
      alphaRadius: buttonAlphaRadius(name),
      variants: 'button'
    });
  }

  crops.push({
    path: 'status-ready.png',
    rect: cloneRect(selectedProfile.layout.indicators.status),
    alphaRadius: 6,
    variants: 'status-indicator'
  });

  crops.push({
    path: 'led-off.png',
    rect: cloneRect(selectedProfile.layout.indicators.combatLed),
    alphaRadius: 9,
    variants: 'combat-led'
  });

  if (materialSource) {
    crops.push(...buildMaterialCrops(selectedProfile.materials, materialSource));
  }

  return crops;
}

function buildMaterialCrops(materials, source) {
  const rows = ['panel', 'lcd', 'button'];
  return rows.flatMap((name, rowIndex) => {
    const material = materials[name];
    const y = rowIndex * 104;
    return [
      {
        path: material.fill.path,
        source,
        rect: {
          x: 0,
          y,
          width: material.fill.width,
          height: material.fill.height
        }
      },
      {
        path: material.frame.path,
        source,
        rect: {
          x: 104,
          y,
          width: material.frame.width,
          height: material.frame.height
        }
      }
    ];
  });
}

function buttonPrefix(name) {
  return {
    moveN: 'dpad-n',
    moveS: 'dpad-s',
    moveE: 'dpad-e',
    moveW: 'dpad-w'
  }[name] ?? name;
}

function buttonAlphaRadius(name) {
  if (name === 'log' || name === 'inventory') {
    return 6;
  }

  if (name.startsWith('move')) {
    return 10;
  }

  return 12;
}

function cloneRectMap(rects) {
  return Object.fromEntries(
    Object.entries(rects).map(([name, rect]) => [name, cloneRect(rect)])
  );
}

function cloneMaterialMap(materials) {
  return Object.fromEntries(
    Object.entries(materials ?? {}).map(([name, material]) => [
      name,
      {
        fill: { ...material.fill },
        frame: { ...material.frame },
        slice: material.slice
      }
    ])
  );
}

function cloneRect(rect) {
  return { ...rect };
}

function labelFromId(id) {
  return id
    .split('-')
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function parseList(value, fallback) {
  if (!value) {
    return fallback;
  }

  return value
    .split(',')
    .map((item) => item.trim().toLowerCase().replaceAll(/\s+/g, '-'))
    .filter(Boolean);
}

function parseNumber(value, fallback) {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function renderThemeForPalette(palette) {
  const tokens = new Set(palette);

  if (tokens.has('amber')) {
    return {
      primary: '#ffa441',
      primaryText: '#ffc46d',
      primaryDimText: '#a86f3c',
      secondary: '#68dfff',
      secondaryText: '#8feaff',
      lcdFill: '#24180c',
      panelFill: '#20170f',
      controlFrame: '#8f5e2f',
      buttonFrame: '#ffa441',
      titleText: '#fff4dc',
      bodyText: '#f6ead7',
      mutedText: '#cab69d',
      combat: '#ff5f73',
      combatText: '#ff8c9b'
    };
  }

  if (tokens.has('gold')) {
    return {
      primary: '#ffd15a',
      primaryText: '#ffe38a',
      primaryDimText: '#a08b48',
      secondary: '#8dff70',
      secondaryText: '#aaff8d',
      lcdFill: '#29250f',
      panelFill: '#22200f',
      controlFrame: '#9f8642',
      buttonFrame: '#ffd15a',
      titleText: '#fff7dc',
      bodyText: '#f7edd7',
      mutedText: '#c8bfa8',
      combat: '#ff6682',
      combatText: '#ff8fa0'
    };
  }

  if (tokens.has('cyan') || tokens.has('signal')) {
    return {
      primary: '#64dfff',
      primaryText: '#93efff',
      primaryDimText: '#5f9dab',
      secondary: '#ff7188',
      secondaryText: '#ff9daf',
      lcdFill: '#0a2630',
      panelFill: '#0d2026',
      controlFrame: '#3aaec6',
      buttonFrame: '#ff7188',
      titleText: '#eefcff',
      bodyText: '#d8edf0',
      mutedText: '#9db5ba',
      combat: '#ff7188',
      combatText: '#ff9daf'
    };
  }

  return {
    primary: '#8dff70',
    primaryText: '#aaff8d',
    primaryDimText: '#7ba58a',
    secondary: '#ffa441',
    secondaryText: '#ffc46d',
    lcdFill: '#0d2615',
    panelFill: '#122019',
    controlFrame: '#5b8d66',
    buttonFrame: '#ff7188',
    titleText: '#f6fff3',
    bodyText: '#f3fff1',
    mutedText: '#b8c7bc',
    combat: '#ff7188',
    combatText: '#ff8fa0'
  };
}

function resolveOutputPath(value) {
  const resolved = path.resolve(rootDir, value);
  return path.extname(resolved) === '.json' ? resolved : path.join(resolved, 'skin-kit.json');
}

function parseArgs(values) {
  const options = {};
  const positionals = [];

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith('--')) {
      positionals.push(value);
      continue;
    }

    const key = value.slice(2);
    const next = values[index + 1];
    if (next && !next.startsWith('--')) {
      options[key] = next;
      index += 1;
    } else {
      options[key] = 'true';
    }
  }

  return { options, positionals };
}

function printUsage() {
  console.error([
    'Usage: pnpm -C frontend skin:scaffold <skin-id> [mobilePortrait|mobileCompact] [options]',
    '',
    'Options:',
    '  --label <name>              Human-readable skin name.',
    '  --family <name>             Skin family metadata.',
    '  --role <role>               default, variant, prototype, or legacy. Defaults to prototype.',
    '  --tags <a,b,c>              Lowercase metadata tokens.',
    '  --mood <a,b,c>              Lowercase metadata tokens.',
    '  --palette <a,b,c>           Lowercase metadata tokens.',
    '  --default-priority <0-100>  Selection priority metadata. Defaults to 0.',
    '  --generation <value>        Generation/source note.',
    '  --source <path>             Widget/source artboard path relative to the skin dir.',
    '  --chassis-source <path>     Optional clean chassis artboard for the chassis crop.',
    '  --materials-source <path>   Optional material sheet for panel/LCD/button tiles and frames.',
    '  --out <path>                Write skin-kit.json to a file or directory instead of stdout.'
  ].join('\n'));
}
