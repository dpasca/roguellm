import fs from 'node:fs/promises';
import path from 'node:path';
import { buildStateSheetLayout } from './skin-state-sheet-layout.mjs';

const rootDir = path.resolve(new URL('..', import.meta.url).pathname);
const contractPath = path.join(rootDir, 'src/skins/SKIN_LAYOUT_CONTRACT_V1.json');
const contract = JSON.parse(await fs.readFile(contractPath, 'utf8'));
const args = process.argv.slice(2);
const parsedArgs = parseArgs(args);

const profileName = parsedArgs.positionals[0] ?? 'mobilePortrait';
const profile = contract.profiles?.[profileName];
const theme = parsedArgs.options.theme ?? 'premium neo-tokyo cyberdeck, dark graphite, green and amber luminous hardware';
const outputKind = parsedArgs.options.output ?? 'source pack';

if (!profile) {
  console.error(`Unknown profile "${profileName}". Expected one of: ${Object.keys(contract.profiles ?? {}).join(', ')}`);
  process.exit(1);
}

console.log(buildPrompt(profileName, profile, theme, outputKind));

function buildPrompt(profileName, profile, theme, outputKind) {
  const canvas = `${profile.size.width}x${profile.size.height}`;
  const sourcePack = outputKind === 'source pack' || outputKind === 'source-pack';
  const stateSheet = buildStateSheetLayout(profile);
  return [
    `Create a polished mobile roguelike cyberdeck skin ${outputKind}.`,
    '',
    `Canvas: ${canvas}.`,
    `Layout contract: RogueLLM Skin Layout Contract ${contract.version}, profile ${profileName}.`,
    `Style/theme: ${theme}.`,
    'Visual target: premium skeuomorphic handheld console, tactile fixed hardware, crisp bevels, clean live apertures, strong readability.',
    '',
    'Live regions that must stay clean:',
    formatRectList(profile.regions, liveRegionNotes()),
    '',
    'Button and toggle crop targets:',
    formatRectList(profile.layout.buttons, buttonNotes(profile.requiredStates)),
    '',
    'Optional source-owned widget state sheet:',
    `- source-state-sheet.png: exact ${stateSheet.size.width}x${stateSheet.size.height}. Use it when you want every button/toggle/indicator state hand-authored instead of generated from the idle crop.`,
    formatStateSheet(stateSheet),
    '',
    'Indicator crop targets:',
    formatRectList(profile.layout.indicators, indicatorNotes(profile.requiredStates)),
    '',
    'Reusable material assets to deliver as separate PNGs:',
    formatMaterialList(profile.materials),
    'Optional material sheet layout for scaffold --materials-source: panel row y=0, LCD row y=104, button row y=208; fill tile at x=0, frame at x=104.',
    '',
    ...(sourcePack ? [
      'Required source-pack files:',
      `- source-chassis.png: exact ${canvas} clean chassis art. Include shell, bezels, wells, screws, rails, glass frames, and decorative permanent labels only. Leave live regions clean.`,
      `- source-widgets.png: exact ${canvas} widget crop art. Align every button/toggle/indicator to the crop rectangles above. Keep button interiors clean enough for Phaser-rendered icons/text unless a label is intentionally permanent.`,
      '- source-state-sheet.png: optional but preferred for premium skins. Follow the exact state-sheet slots above when states should have unique drawn lighting, depth, or on/off hardware.',
      '- source-materials.png: at least 160x304. Use row y=0 for panel material, y=104 for LCD material, y=208 for button material. In each row, put a repeat-safe 96x96 fill tile at x=0 and a transparent 48x48 nine-slice frame at x=104.',
      '- Optional contact sheet: useful for review, but it must not be used as runtime source art.',
      ''
    ] : []),
    'Runtime meter rectangles:',
    formatRectList(profile.layout.fills, meterNotes()),
    '',
    'Runtime text and icon slots Phaser will draw from the manifest:',
    formatRuntimeSlots(profile.runtime),
    '',
    'Hard rules:',
    '- This is a source artboard for a skin kit, not a gameplay screenshot.',
    '- Leave all live regions clean and empty enough for Phaser-rendered runtime content.',
    '- Do not include map tiles, player markers, enemies, items, HP values, stat values, enemy names, inventory names, chat/log text, terminal copy, or model status text.',
    '- Do not bake labels that change at runtime.',
    '- Make button and toggle wells suitable for separate transparent crops in idle, hover, pressed, and disabled states.',
    '- Log and Inventory toggles also need a distinct active/on state.',
    '- Make status and combat LED wells suitable for separate state sprites.',
    '- Provide reusable panel, LCD, and button material fill tiles plus matching nine-slice frames; decorative detail must be tile-safe or frame-safe, never stretched across runtime panels.',
    '- Pressed, hover, disabled, on, and off states must be variants of fixed-size widgets, not elastic layout treatments.',
    '- Keep edges crisp. No blur over live content apertures.',
    '- No watermark, no brand logos.',
    '',
    'Delivery expectation:',
    ...(sourcePack
      ? [
        '- Deliver the three required PNG files with the exact filenames above.',
        '- The scaffold will crop fixed-size runtime assets from those files; do not change the rectangle coordinates.'
      ]
      : [
        `- One full ${canvas} chassis/source artboard aligned exactly to the rectangles above.`,
        '- Optional separate state sprite source strips are allowed, but they must preserve the same crop sizes.'
      ]),
    '- Dynamic game content must remain absent from the art.'
  ].join('\n');
}

function formatStateSheet(stateSheet) {
  return stateSheet.sections
    .map((section) => {
      const rows = section.rows.flatMap((row) =>
        row.states.map((state) => {
          const slot = row.slots[state];
          return `  - ${row.id}.${state}: ${row.assetPathForState(state)} x=${slot.x} y=${slot.y} w=${slot.width} h=${slot.height}.`;
        })
      );
      return `- ${section.title}:\n${rows.join('\n')}`;
    })
    .join('\n');
}

function formatRectList(rects, notes) {
  return Object.entries(rects)
    .map(([name, rect]) => {
      const note = notes[name] ? ` ${notes[name]}` : '';
      return `- ${name}: x=${rect.x} y=${rect.y} w=${rect.width} h=${rect.height}.${note}`;
    })
    .join('\n');
}

function formatMaterialList(materials) {
  return Object.entries(materials ?? {})
    .map(([name, material]) => {
      const fill = material.fill;
      const frame = material.frame;
      return `- ${name}: ${fill.path} ${fill.width}x${fill.height} tile, ${frame.path} ${frame.width}x${frame.height} nine-slice frame, slice=${material.slice}.`;
    })
    .join('\n');
}

function formatRuntimeSlots(runtime) {
  const entries = [];
  collectRuntimeSlots('', runtime, entries);
  return entries
    .map(([name, rect]) => `- ${name}: x=${rect.x} y=${rect.y} w=${rect.width} h=${rect.height}.`)
    .join('\n');
}

function collectRuntimeSlots(prefix, value, entries) {
  if (!value || typeof value !== 'object') {
    return;
  }

  if (isRect(value)) {
    entries.push([prefix, value]);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      const name = entry?.id ? `${prefix}.${entry.id}` : `${prefix}[${index}]`;
      collectRuntimeSlots(name, entry, entries);
    });
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (key === 'rowHeight' || key === 'id' || (key === 'label' && typeof nested === 'string')) {
      continue;
    }
    collectRuntimeSlots(prefix ? `${prefix}.${key}` : key, nested, entries);
  }
}

function isRect(value) {
  return ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(value[key]));
}

function liveRegionNotes() {
  return {
    map: 'Runtime Phaser board and overlay icons.',
    latest: 'Newest top-first message.',
    log: 'Expanded message history drawer.',
    inventory: 'Expanded inventory drawer.',
    title: 'Player icon and game title.',
    player: 'HP, attack, defense, XP, and current tile.',
    combat: 'Mode plate, enemy badge/name/HP.',
    controls: 'D-pad and action control deck.',
    endState: 'Defeat/victory panel copy, stats, and restart button.'
  };
}

function buttonNotes(requiredStates) {
  const toggleButtons = new Set(requiredStates.toggleButtons ?? []);
  const buttonStates = requiredStates.buttons ?? [];
  const toggleStates = requiredStates.toggleButtonStates ?? buttonStates;
  return Object.fromEntries(
    ['attack', 'run', 'restart', 'log', 'inventory', 'moveN', 'moveS', 'moveE', 'moveW']
      .map((name) => [
        name,
        `Required states: ${(toggleButtons.has(name) ? toggleStates : buttonStates).join(', ')}.`
      ])
  );
}

function indicatorNotes(requiredStates) {
  return {
    status: `Required states: ${requiredStates.status.join(', ')}.`,
    combatLed: `Required files/states: ${requiredStates.combatLedFiles.join(', ')}.`
  };
}

function meterNotes() {
  return {
    playerHp: 'Runtime HP fill only; art should frame the meter.',
    enemyHp: 'Runtime enemy HP fill only; art should frame the meter.',
    playerStats: 'Runtime stat plates; art should frame the stat row.'
  };
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
