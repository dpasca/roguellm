import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const rootDir = path.resolve(new URL('..', import.meta.url).pathname);
const contractPath = path.join(rootDir, 'src/skins/SKIN_LAYOUT_CONTRACT_V1.json');
const contract = JSON.parse(await fs.readFile(contractPath, 'utf8'));
const parsedArgs = parseArgs(process.argv.slice(2));
const sourceArg = parsedArgs.positionals[0];
const skinId = parsedArgs.positionals[1];
const profileName = parsedArgs.positionals[2] ?? 'mobileCompact';
const profile = contract.profiles?.[profileName];

if (parsedArgs.options.help || !sourceArg || !skinId) {
  printUsage();
  process.exit(parsedArgs.options.help ? 0 : 1);
}

if (!profile) {
  console.error(`Unknown profile "${profileName}". Expected one of: ${Object.keys(contract.profiles ?? {}).join(', ')}`);
  process.exit(1);
}

const sourcePath = path.resolve(process.cwd(), sourceArg);
await fs.access(sourcePath);

const outDir = path.resolve(rootDir, parsedArgs.options.out ?? `../_artifacts/skin-kits/${skinId}`);
const theme = parsedArgs.options.theme ?? 'neon-shrine';
const role = parsedArgs.options.role ?? 'prototype';
const label = parsedArgs.options.label ?? labelFromId(skinId);
const tags = parsedArgs.options.tags ?? 'ai-reference,cyberpunk,handheld,rain-city';
const mood = parsedArgs.options.mood ?? 'premium,nocturnal,tactile';
const palette = parsedArgs.options.palette ?? 'jade,magenta,brass';
const defaultPriority = parsedArgs.options['default-priority'] ?? '0';
const referenceGravity = parsedArgs.options.gravity ?? 'center';
const keepReferenceSources = parsedArgs.options['keep-reference'] === 'true';

if (!['center', 'north'].includes(referenceGravity)) {
  console.error(`Unknown --gravity "${referenceGravity}". Expected center or north.`);
  process.exit(1);
}

await fs.mkdir(outDir, { recursive: true });
await runNode('skin-source-prototype.mjs', [
  skinId,
  profileName,
  '--theme',
  theme,
  '--out',
  outDir
]);

const originalPath = path.join(outDir, 'source-reference-original.png');
const normalizedPath = path.join(
  outDir,
  keepReferenceSources ? 'source-reference-normalized.png' : '.source-reference-normalized.tmp.png'
);
const chassisPath = path.join(outDir, 'source-chassis.png');

if (keepReferenceSources) {
  await fs.copyFile(sourcePath, originalPath);
}
await normalizeReference(sourcePath, normalizedPath, profile.size, referenceGravity);
await writeSanitizedChassis(normalizedPath, chassisPath, profile);
if (!keepReferenceSources) {
  await fs.rm(normalizedPath, { force: true });
}
await runNode('skin-layout-scaffold.mjs', [
  skinId,
  profileName,
  '--label',
  label,
  '--role',
  role,
  '--tags',
  tags,
  '--mood',
  mood,
  '--palette',
  palette,
  '--default-priority',
  defaultPriority,
  '--generation',
  `imagegen-reference-import:${referenceGravity}-gravity`,
  '--source',
  'source-widgets.png',
  '--chassis-source',
  'source-chassis.png',
  '--state-source',
  'source-state-sheet.png',
  '--materials-source',
  'source-materials.png',
  '--material-render-mode',
  'source',
  '--out',
  outDir
]);
await fs.writeFile(
  path.join(outDir, 'REFERENCE_IMPORT.md'),
  referenceNotes({ sourcePath, skinId, profileName, theme, role, label, outDir }),
  'utf8'
);

console.error(`Imported reference source pack to ${path.relative(process.cwd(), outDir)}`);

async function normalizeReference(inputPath, outputPath, size, gravity) {
  await magick([
    inputPath,
    '-auto-orient',
    '-resize',
    `${size.width}x${size.height}^`,
    '-gravity',
    gravity,
    '-extent',
    `${size.width}x${size.height}`,
    '-strip',
    png32(outputPath)
  ]);
}

async function writeSanitizedChassis(inputPath, outputPath, selectedProfile) {
  await magick([
    inputPath,
    ...shellDarkenArgs(),
    ...regionDrawArgs(selectedProfile),
    '-strip',
    png32(outputPath)
  ]);
}

function shellDarkenArgs() {
  return [
    '-modulate',
    '74,112,100',
    '-fill',
    'rgba(0,0,0,0.20)',
    '-draw',
    'rectangle 0,0 10000,10000'
  ];
}

function regionDrawArgs(selectedProfile) {
  const args = [];

  for (const name of ['log', 'inventory', 'endState', 'controls']) {
    const rect = selectedProfile.regions[name];
    args.push(...roundedPanelArgs(rect, {
      fill: '#010807',
      stroke: '#17342f',
      radius: name === 'controls' ? 12 : 9,
      width: 0.75
    }));
  }

  for (const name of ['map', 'latest', 'title', 'player', 'combat']) {
    const rect = selectedProfile.regions[name];
    args.push(...roundedPanelArgs(rect, {
      fill: '#010807',
      stroke: name === 'combat' ? '#ff2d76' : '#5dffd0',
      radius: name === 'map' ? 12 : 7,
      width: name === 'map' ? 1.5 : 1
    }));
  }

  for (const [name, rect] of Object.entries(selectedProfile.layout.buttons)) {
    args.push(...roundedPanelArgs(rect, {
      fill: name === 'attack' ? '#21030e' : '#030908',
      stroke: name === 'attack' || name === 'run' ? '#ff2d76' : '#b58946',
      radius: name.startsWith('move') ? 8 : 10,
      width: 1
    }));
  }

  const controls = selectedProfile.regions.controls;
  args.push(
    '-fill',
    'none',
    '-stroke',
    '#b58946',
    '-strokewidth',
    '1',
    '-draw',
    roundRectDraw(controls, 12, { inset: 2 })
  );

  return args;
}

function roundedPanelArgs(rect, options) {
  return [
    '-fill',
    options.fill,
    '-stroke',
    options.stroke,
    '-strokewidth',
    String(options.width),
    '-draw',
    roundRectDraw(rect, options.radius)
  ];
}

function roundRectDraw(rect, radius, options = {}) {
  const inset = options.inset ?? 0;
  const x1 = rect.x + inset;
  const y1 = rect.y + inset;
  const x2 = rect.x + rect.width - 1 - inset;
  const y2 = rect.y + rect.height - 1 - inset;
  return `roundrectangle ${x1},${y1} ${x2},${y2} ${radius},${radius}`;
}

async function runNode(scriptName, args) {
  await run(process.execPath, [path.join(rootDir, 'scripts', scriptName), ...args]);
}

async function magick(args) {
  await run('magick', args);
}

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with ${code}`));
      }
    });
  });
}

function referenceNotes({ sourcePath, skinId, profileName, theme, role, label, outDir }) {
  const relativeOut = path.relative(rootDir, outDir);
  return `# ${label} Reference Import

Skin id: \`${skinId}\`
Profile: \`${profileName}\`
Role: \`${role}\`
Prototype theme preset: \`${theme}\`
Reference crop gravity: \`${referenceGravity}\`

This source pack was seeded from an external bitmap reference:

\`${sourcePath}\`

The import keeps that generated image as reference material, normalizes it to
the fixed contract size, darkens it, and sanitizes live regions so Phaser still
owns map tiles, text, icons, HP values, log rows, inventory rows, and button
labels. The state sheet and materials remain contract-aligned source files from
\`skin:source-prototype\`.

Follow-up checks:

\`\`\`bash
pnpm -C frontend validate:skin-source-packs ${relativeOut}
pnpm -C frontend build:skin-kit ${relativeOut}
pnpm -C frontend skin:review-source ${relativeOut} --out ../_artifacts/skin-reviews/${skinId}/index.html --json --fail-on-issue
\`\`\`

This is a reference-import candidate, not promoted production art.
`;
}

function labelFromId(id) {
  return id
    .split('-')
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function png32(outputPath) {
  return `PNG32:${outputPath}`;
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
    'Usage: pnpm -C frontend skin:import-reference <source-image> <skin-id> [mobilePortrait|mobileCompact] [options]',
    '',
    'Options:',
    '  --theme <obsidian-rain|amber-foundry|neon-shrine>  Prototype preset for widgets/materials. Defaults to neon-shrine.',
    '  --out <path>              Output source-pack directory. Defaults to ../_artifacts/skin-kits/<skin-id>.',
    '  --label <name>            Human-readable label.',
    '  --role <role>             default, variant, prototype, or legacy. Defaults to prototype.',
    '  --tags <a,b,c>            Metadata tokens. Defaults to ai-reference,cyberpunk,handheld,rain-city.',
    '  --mood <a,b,c>            Metadata tokens. Defaults to premium,nocturnal,tactile.',
    '  --palette <a,b,c>         Metadata tokens. Defaults to jade,magenta,brass.',
    '  --default-priority <n>    Manifest selection priority. Defaults to 0.',
    '  --gravity <mode>          Reference crop gravity: center or north. Defaults to center.',
    '  --keep-reference true     Keep source-reference-original/normalized beside the source pack.'
  ].join('\n'));
}
