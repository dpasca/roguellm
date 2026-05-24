import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(new URL('..', import.meta.url).pathname);
const scriptDir = path.join(rootDir, 'scripts');
const contractPath = path.join(rootDir, 'src/skins/SKIN_LAYOUT_CONTRACT_V1.json');
const contract = JSON.parse(await fs.readFile(contractPath, 'utf8'));
const parsedArgs = parseArgs(process.argv.slice(2));
const skinId = parsedArgs.positionals[0];
const profileName = parsedArgs.options.profile ?? parsedArgs.positionals[1] ?? 'mobileCompact';
const profile = contract.profiles?.[profileName];
const theme = parsedArgs.options.theme ?? 'premium rain-slick neo-tokyo cyberdeck, black glass, brushed titanium, cyan signal LEDs';
const guideFormat = parsedArgs.options['guide-format'] ?? 'png';

if (parsedArgs.options.help || !skinId) {
  printUsage();
  process.exit(parsedArgs.options.help ? 0 : 1);
}

if (!profile) {
  console.error(`Unknown profile "${profileName}". Expected one of: ${Object.keys(contract.profiles ?? {}).join(', ')}`);
  process.exit(1);
}

if (!['png', 'svg'].includes(guideFormat)) {
  console.error('Guide format must be png or svg');
  process.exit(1);
}

const outDir = path.resolve(rootDir, parsedArgs.options.out ?? `../_artifacts/skin-handoffs/${skinId}`);
await fs.mkdir(outDir, { recursive: true });

const prompt = await captureScript('skin-layout-prompt.mjs', [
  profileName,
  '--theme',
  theme,
  '--output',
  'source-pack'
]);
await fs.writeFile(path.join(outDir, 'prompt.txt'), prompt, 'utf8');

const guides = [];
for (const view of ['live', 'crops', 'runtime', 'all']) {
  const guideName = `${profileName}-${view}.${guideFormat}`;
  const guidePath = path.join(outDir, guideName);
  await runScript('skin-layout-guide.mjs', [
    profileName,
    '--view',
    view,
    '--out',
    path.relative(rootDir, guidePath)
  ]);
  guides.push(guideName);
}

const stateGuideName = `${profileName}-state-sheet.${guideFormat}`;
const stateGuidePath = path.join(outDir, stateGuideName);
await runScript('skin-state-sheet-guide.mjs', [
  profileName,
  '--out',
  path.relative(rootDir, stateGuidePath)
]);
guides.push(stateGuideName);

const plan = buildPlan(skinId, profileName, theme, guides);
await fs.writeFile(path.join(outDir, 'handoff.json'), `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
await fs.writeFile(path.join(outDir, 'README.md'), readme(plan), 'utf8');

console.error(`Wrote skin handoff bundle to ${path.relative(process.cwd(), outDir)}`);

async function captureScript(scriptName, args) {
  const { stdout } = await execFileAsync(process.execPath, [path.join(scriptDir, scriptName), ...args], {
    cwd: rootDir,
    maxBuffer: 8 * 1024 * 1024
  });
  return stdout;
}

async function runScript(scriptName, args) {
  await execFileAsync(process.execPath, [path.join(scriptDir, scriptName), ...args], {
    cwd: rootDir,
    maxBuffer: 8 * 1024 * 1024
  });
}

function buildPlan(id, selectedProfile, selectedTheme, guideNames) {
  const sourceDir = `../_artifacts/skin-handoffs/${id}`;
  const kitDir = sourceDir;
  return {
    skinId: id,
    contract: contract.version,
    profile: selectedProfile,
    size: contract.profiles[selectedProfile].size,
    theme: selectedTheme,
    files: {
      prompt: 'prompt.txt',
      guides: guideNames,
      expectedSourcePack: [
        'source-chassis.png',
        'source-widgets.png',
        'source-state-sheet.png',
        'source-materials.png'
      ]
    },
    commands: [
      `pnpm -C frontend skin:guide ${selectedProfile} --view all --source ${sourceDir}/source-chassis.png --out ${sourceDir}/source-overlay.${guideFormat}`,
      `pnpm -C frontend skin:scaffold ${id} ${selectedProfile} --label "${labelFromId(id)}" --tags cyberpunk,handheld --mood premium,nocturnal --palette graphite,cyan --source source-widgets.png --chassis-source source-chassis.png --state-source source-state-sheet.png --materials-source source-materials.png --material-render-mode source --out ${kitDir}`,
      `pnpm -C frontend validate:skin-source-packs ${kitDir}`,
      `pnpm -C frontend skin:review-source ${kitDir} --json --fail-on-issue`,
      `pnpm -C frontend build:skin-kit ${kitDir}`,
      'pnpm -C frontend validate:skins'
    ],
    afterPromotion: [
      `VISUAL_SCENARIOS=mobile-${id}-production-diagnostics pnpm -C frontend inspect:visual`,
      'pnpm -C frontend check:visual:production'
    ]
  };
}

function readme(plan) {
  return `# ${plan.skinId} Skin Handoff

Contract: ${plan.contract}
Profile: ${plan.profile}
Canvas: ${plan.size.width}x${plan.size.height}
Theme: ${plan.theme}

## Files

- \`prompt.txt\`: paste this into the image generator.
- \`${plan.files.guides.join('`, `')}\`: exact live-region, crop-target, runtime-slot, state-sheet, and combined guides.
- Expected generated files: \`${plan.files.expectedSourcePack.join('`, `')}\`.

## Runtime Rule

The generated art becomes fixed PNG assets for the Phaser renderer. Do not use
CSS, DOM stylesheets, or responsive stretching to place or skin runtime widgets.

## After Generation

Put the generated \`source-chassis.png\`, \`source-widgets.png\`,
\`source-state-sheet.png\`, and \`source-materials.png\` in this handoff
directory, then run:

\`\`\`bash
${plan.commands.join('\n')}
\`\`\`

After the built kit is copied into \`frontend/src/skins/neo-tokyo-console/fixed\`
and registered as a production profile, run:

\`\`\`bash
${plan.afterPromotion.join('\n')}
\`\`\`

Reject the source pack if the overlay shows baked gameplay/text inside live
regions, if button crops miss the fixed rectangles, or if material detail cannot
tile or nine-slice cleanly.
`;
}

function labelFromId(id) {
  return id
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
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
  console.log(`Usage:
  pnpm skin:handoff <skin-id> [profile] [--theme "..."] [--out <dir>] [--guide-format png|svg]

Examples:
  pnpm skin:handoff rain-city-deck mobileCompact --theme "premium rain-city cyberdeck, black glass, brass switches"
  pnpm skin:handoff temple-radio mobilePortrait --guide-format svg
`);
}
