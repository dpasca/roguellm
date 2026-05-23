import fs from 'node:fs/promises';
import path from 'node:path';

const rootDir = path.resolve(new URL('..', import.meta.url).pathname);
const contractPath = path.join(rootDir, 'src/skins/SKIN_LAYOUT_CONTRACT_V1.json');
const contract = JSON.parse(await fs.readFile(contractPath, 'utf8'));
const args = process.argv.slice(2);
const parsedArgs = parseArgs(args);

const profileName = parsedArgs.positionals[0] ?? 'mobilePortrait';
const profile = contract.profiles?.[profileName];
const theme = parsedArgs.options.theme ?? 'premium neo-tokyo cyberdeck, dark graphite, green and amber luminous hardware';
const outputKind = parsedArgs.options.output ?? 'source artboard';

if (!profile) {
  console.error(`Unknown profile "${profileName}". Expected one of: ${Object.keys(contract.profiles ?? {}).join(', ')}`);
  process.exit(1);
}

console.log(buildPrompt(profileName, profile, theme, outputKind));

function buildPrompt(profileName, profile, theme, outputKind) {
  const canvas = `${profile.size.width}x${profile.size.height}`;
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
    formatRectList(profile.layout.buttons, buttonNotes(profile.requiredStates.buttons)),
    '',
    'Indicator crop targets:',
    formatRectList(profile.layout.indicators, indicatorNotes(profile.requiredStates)),
    '',
    'Reusable material assets to deliver as separate PNGs:',
    formatMaterialList(profile.materials),
    '',
    'Runtime meter rectangles:',
    formatRectList(profile.layout.fills, meterNotes()),
    '',
    'Hard rules:',
    '- This is a source artboard for a skin kit, not a gameplay screenshot.',
    '- Leave all live regions clean and empty enough for Phaser-rendered runtime content.',
    '- Do not include map tiles, player markers, enemies, items, HP values, stat values, enemy names, inventory names, chat/log text, terminal copy, or model status text.',
    '- Do not bake labels that change at runtime.',
    '- Make button and toggle wells suitable for separate transparent crops in idle, hover, pressed, and disabled states.',
    '- Make status and combat LED wells suitable for separate state sprites.',
    '- Provide reusable panel, LCD, and button material fill tiles plus matching nine-slice frames; do not stretch decorative details into runtime panels.',
    '- Keep edges crisp. No blur over live content apertures.',
    '- No watermark, no brand logos.',
    '',
    'Delivery expectation:',
    `- One full ${canvas} chassis/source artboard aligned exactly to the rectangles above.`,
    '- Optional separate state sprite source strips are allowed, but they must preserve the same crop sizes.',
    '- Dynamic game content must remain absent from the art.'
  ].join('\n');
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

function buttonNotes(states) {
  return Object.fromEntries(
    ['attack', 'run', 'restart', 'log', 'inventory', 'moveN', 'moveS', 'moveE', 'moveW']
      .map((name) => [name, `Required states: ${states.join(', ')}.`])
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
