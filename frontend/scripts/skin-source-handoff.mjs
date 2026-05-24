import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(new URL('..', import.meta.url).pathname);
const scriptDir = path.join(rootDir, 'scripts');
const contractPath = path.join(rootDir, 'src/skins/SKIN_LAYOUT_CONTRACT_V1.json');
const artBlueprintPath = path.join(rootDir, 'src/skins/SKIN_ART_BLUEPRINT_V1.json');
const contract = JSON.parse(await fs.readFile(contractPath, 'utf8'));
const artBlueprint = JSON.parse(await fs.readFile(artBlueprintPath, 'utf8'));
const parsedArgs = parseArgs(process.argv.slice(2));
const skinId = parsedArgs.positionals[0];
const profileName = parsedArgs.options.profile ?? parsedArgs.positionals[1] ?? 'mobileCompact';
const profile = contract.profiles?.[profileName];
const theme = parsedArgs.options.theme ?? 'premium rain-slick neo-tokyo cyberdeck, black glass, brushed titanium, cyan signal LEDs';
const guideFormat = parsedArgs.options['guide-format'] ?? 'png';
const role = normalizeRole(parsedArgs.options.role ?? 'variant');
const stateSheetMode = parsedArgs.options['state-sheet'] ?? (isPromotedRole(role) ? 'required' : 'optional');

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

if (!['required', 'optional'].includes(stateSheetMode)) {
  console.error('State sheet mode must be required or optional');
  process.exit(1);
}

if (isPromotedRole(role) && stateSheetMode !== 'required') {
  console.error(`Role "${role}" handoffs must use --state-sheet required`);
  process.exit(1);
}

const outDir = path.resolve(rootDir, parsedArgs.options.out ?? `../_artifacts/skin-handoffs/${skinId}`);
await fs.mkdir(outDir, { recursive: true });

const contractPrompt = await captureScript('skin-layout-prompt.mjs', [
  profileName,
  '--theme',
  theme,
  '--output',
  'source-pack',
  '--state-sheet',
  stateSheetMode
]);
const prompt = `${contractPrompt.trim()}\n\n${promptArtDirection(artBlueprint, profileName)}\n`;
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

const plan = buildPlan(skinId, profileName, theme, guides, role, stateSheetMode);
await fs.writeFile(path.join(outDir, 'handoff.json'), `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
await fs.writeFile(path.join(outDir, 'ART_DIRECTION.md'), artDirection(plan, artBlueprint), 'utf8');
await fs.writeFile(path.join(outDir, 'README.md'), readme(plan), 'utf8');
await fs.writeFile(path.join(outDir, 'QUALITY_BAR.md'), qualityBar(plan), 'utf8');

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

function buildPlan(id, selectedProfile, selectedTheme, guideNames, selectedRole, selectedStateSheetMode) {
  const sourceDir = `../_artifacts/skin-handoffs/${id}`;
  const kitDir = sourceDir;
  const reviewFailureMode = isPromotedRole(selectedRole) ? '--fail-on-warning' : '--fail-on-issue';
  return {
    skinId: id,
    contract: contract.version,
    profile: selectedProfile,
    role: selectedRole,
    stateSheet: selectedStateSheetMode,
    size: contract.profiles[selectedProfile].size,
    theme: selectedTheme,
    artBlueprint: {
      version: artBlueprint.version,
      name: artBlueprint.name,
      targetProfile: artBlueprint.targetProfile,
      file: 'ART_DIRECTION.md'
    },
    files: {
      prompt: 'prompt.txt',
      artDirection: 'ART_DIRECTION.md',
      qualityBar: 'QUALITY_BAR.md',
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
      `pnpm -C frontend skin:scaffold ${id} ${selectedProfile} --label "${labelFromId(id)}" --role ${selectedRole} --tags cyberpunk,handheld --mood premium,nocturnal --palette graphite,cyan --source source-widgets.png --chassis-source source-chassis.png --state-source source-state-sheet.png --materials-source source-materials.png --material-render-mode source --out ${kitDir}`,
      `pnpm -C frontend validate:skin-source-packs ${kitDir}`,
      `pnpm -C frontend skin:review-source ${kitDir} --json ${reviewFailureMode}`,
      `pnpm -C frontend build:skin-kit ${kitDir}`,
      'pnpm -C frontend validate:skins'
    ],
    afterPromotion: [
      `VISUAL_SCENARIOS=mobile-${id}-production-diagnostics pnpm -C frontend inspect:visual`,
      'pnpm -C frontend check:visual:production'
    ]
  };
}

function promptArtDirection(blueprint, selectedProfile) {
  return [
    'Premium art direction:',
    `- Blueprint: ${blueprint.name} ${blueprint.version}; primary target ${blueprint.targetProfile}.`,
    `- This handoff profile is ${selectedProfile}; ${selectedProfile === blueprint.targetProfile ? 'use the blueprint exactly.' : 'keep the same fixed-widget discipline while adapting to this profile geometry.'}`,
    `- Intent: ${blueprint.intent}`,
    `- Visual target: ${blueprint.visualTarget}`,
    '- Source-file responsibilities:',
    ...Object.entries(blueprint.sourceFiles ?? {}).flatMap(([fileName, source]) => [
      `  - ${fileName}: ${source.purpose}`,
      ...((source.must ?? []).map((rule) => `    Must: ${rule}`)),
      ...((source.mustNot ?? []).map((rule) => `    Must not: ${rule}`))
    ]),
    '- Widget families:',
    ...((blueprint.widgetFamilies ?? []).map((family) => {
      const states = family.states?.length ? ` States: ${family.states.join(', ')}.` : '';
      return `  - ${family.id}: ${family.shape}; assets ${family.assets.join(', ')}.${states}`;
    })),
    '- Hard art-quality gates:',
    ...((blueprint.qualityGates ?? []).map((rule) => `  - ${rule}`)),
    '- Forbidden dynamic content:',
    `  - ${blueprint.forbiddenDynamicContent.join(', ')}.`
  ].join('\n');
}

function artDirection(plan, blueprint) {
  return `# ${plan.skinId} Art Direction

Blueprint: ${blueprint.name} ${blueprint.version}
Contract profile: ${plan.profile}
Primary blueprint target: ${blueprint.targetProfile}

${blueprint.intent}

${blueprint.visualTarget}

## Layout Intent

${(blueprint.layoutStack ?? []).map((entry) => {
  const heading = `### ${titleFromId(entry.id)}${entry.region ? ` (${entry.region})` : ''}`;
  const must = entry.must?.length ? `\nMust:\n${markdownList(entry.must)}` : '';
  const mustNot = entry.mustNot?.length ? `\nMust not:\n${markdownList(entry.mustNot)}` : '';
  return `${heading}\n\n${entry.purpose}${must}${mustNot}`;
}).join('\n\n')}

## Source Files

${Object.entries(blueprint.sourceFiles ?? {}).map(([fileName, source]) => {
  const must = source.must?.length ? `\nMust:\n${markdownList(source.must)}` : '';
  const mustNot = source.mustNot?.length ? `\nMust not:\n${markdownList(source.mustNot)}` : '';
  return `### ${fileName}\n\n${source.purpose}${must}${mustNot}`;
}).join('\n\n')}

## Widget Families

${(blueprint.widgetFamilies ?? []).map((family) => [
  `### ${titleFromId(family.id)}`,
  '',
  `Assets: \`${family.assets.join('`, `')}\``,
  `Shape: ${family.shape}`,
  family.states?.length ? `States: \`${family.states.join('`, `')}\`` : null,
  family.must?.length ? `Must:\n${markdownList(family.must)}` : null
].filter(Boolean).join('\n')).join('\n\n')}

## State Language

${Object.entries(blueprint.stateLanguage ?? {}).map(([state, note]) => `- \`${state}\`: ${note}`).join('\n')}

## Material Rules

${markdownList(blueprint.materialRules ?? [])}

## Forbidden Dynamic Content

${markdownList(blueprint.forbiddenDynamicContent ?? [])}

## Quality Gates

${markdownList(blueprint.qualityGates ?? [])}

## Required Review Scenarios

${markdownList(blueprint.reviewScenarios ?? [])}
`;
}

function readme(plan) {
  return `# ${plan.skinId} Skin Handoff

Contract: ${plan.contract}
Profile: ${plan.profile}
Role: ${plan.role}
State sheet: ${plan.stateSheet}
Art blueprint: ${plan.artBlueprint.name} ${plan.artBlueprint.version}
Canvas: ${plan.size.width}x${plan.size.height}
Theme: ${plan.theme}

## Files

- \`prompt.txt\`: paste this into the image generator.
- \`ART_DIRECTION.md\`: premium mobile skin blueprint for the generated source pack.
- \`QUALITY_BAR.md\`: human review standard before promotion.
- \`${plan.files.guides.join('`, `')}\`: exact live-region, crop-target, runtime-slot, state-sheet, and combined guides.
- Expected generated files: \`${plan.files.expectedSourcePack.join('`, `')}\`.

## Runtime Rule

The generated art becomes fixed PNG assets for the Phaser renderer. Do not use
CSS, DOM stylesheets, or responsive stretching to place or skin runtime widgets.
This handoff is not a gameplay screenshot or a final mockup; it is source art
that will be cropped into fixed runtime assets.

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
tile or nine-slice cleanly. Production-role handoffs treat measured review
warnings as blockers so collapsed state sprites and weak materials cannot slip
into promotion. Also reject it if \`ART_DIRECTION.md\` makes the result feel
like a collage rather than one coherent fixed handheld console.
`;
}

function qualityBar(plan) {
  return `# ${plan.skinId} Quality Bar

This handoff should be reviewed as a fixed skin source pack, not as a pretty
screenshot. The generated files are acceptable only if they can become cropped
runtime assets without stretching or repainting around dynamic content.

Use \`ART_DIRECTION.md\` as the first human-review pass. If the result does not
look like one coherent premium handheld device, reject it even when geometry and
measured gates pass.

## Required Source Files

- \`source-chassis.png\`: exact ${plan.size.width}x${plan.size.height}; polished shell, frame, glass, screws, rails, decorative permanent labels, and empty live regions.
- \`source-widgets.png\`: exact ${plan.size.width}x${plan.size.height}; every crop target aligned to the guide, no shifted controls.
- \`source-state-sheet.png\`: ${plan.stateSheet}; every button, toggle, status, and LED state has a visibly distinct fixed-size sprite.
- \`source-materials.png\`: repeat-safe panel, LCD, and button fills plus transparent nine-slice frames.

## Visual Acceptance

- The art should read like a premium handheld console skin at first glance, not a flat dashboard.
- Buttons need tactile depth: idle, hover, pressed, disabled, active, and on/off states should differ by lighting, inset depth, glow, or hardware latch.
- Live regions must remain clean: no baked map tiles, player/enemy/item icons, HP numbers, stat values, log copy, inventory names, or model status text.
- Material tiles must be safe to repeat, and frames must be safe to nine-slice; avoid unique center ornaments that would visibly duplicate.
- Measured review warnings are promotion blockers for default/variant skins: state-sheet variants must be visibly different, widget crops cannot be flat, and live regions must stay quiet.
- The compact profile is the mobile quality target. Desktop should get a separate profile later instead of stretching this art.

## Promotion Commands

\`\`\`bash
${plan.commands.join('\n')}
\`\`\`

## Runtime Verification After Promotion

\`\`\`bash
${plan.afterPromotion.join('\n')}
\`\`\`
`;
}

function markdownList(values) {
  return values.map((value) => `- ${value}`).join('\n');
}

function titleFromId(id) {
  return String(id ?? '')
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
}

function labelFromId(id) {
  return id
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
}

function normalizeRole(value) {
  if (['default', 'variant', 'prototype', 'legacy'].includes(value)) {
    return value;
  }

  console.error(`Unknown role "${value}". Expected default, variant, prototype, or legacy.`);
  process.exit(1);
}

function isPromotedRole(value) {
  return value === 'default' || value === 'variant';
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
  pnpm skin:handoff <skin-id> [profile] [--theme "..."] [--role default|variant|prototype|legacy] [--state-sheet required|optional] [--out <dir>] [--guide-format png|svg]

Examples:
  pnpm skin:handoff rain-city-deck mobileCompact --theme "premium rain-city cyberdeck, black glass, brass switches"
  pnpm skin:handoff temple-radio mobilePortrait --guide-format svg
`);
}
