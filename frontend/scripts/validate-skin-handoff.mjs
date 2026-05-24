import fs from 'node:fs/promises';
import path from 'node:path';
import { buildStateSheetLayout } from './skin-state-sheet-layout.mjs';

const rootDir = path.resolve(new URL('..', import.meta.url).pathname);
const repoRoot = path.resolve(rootDir, '..');
const contractPath = path.join(rootDir, 'src/skins/SKIN_LAYOUT_CONTRACT_V1.json');
const artBlueprintPath = path.join(rootDir, 'src/skins/SKIN_ART_BLUEPRINT_V1.json');
const contract = JSON.parse(await fs.readFile(contractPath, 'utf8'));
const artBlueprint = JSON.parse(await fs.readFile(artBlueprintPath, 'utf8'));
const parsedArgs = parseArgs(process.argv.slice(2));
const handoffArg = parsedArgs.positionals[0];
const requireSources = Boolean(parsedArgs.options['require-sources']);
const jsonOutput = Boolean(parsedArgs.options.json);

if (parsedArgs.options.help || !handoffArg) {
  printUsage();
  process.exit(parsedArgs.options.help ? 0 : 1);
}

const handoffPath = await normalizeHandoffPath(handoffArg);
const handoffDir = path.dirname(handoffPath);
const plan = JSON.parse(await fs.readFile(handoffPath, 'utf8'));
const report = await validateHandoff(plan, handoffDir, handoffPath);

if (jsonOutput) {
  console.log(`${JSON.stringify(report, null, 2)}\n`);
} else {
  printReport(report);
}

if (!report.ok) {
  process.exitCode = 1;
}

async function validateHandoff(plan, dir, planPath) {
  const issues = [];
  const warnings = [];
  const profile = contract.profiles?.[plan.profile];
  const expectedSplitPrompts = [
    'prompts/source-chassis.prompt.txt',
    'prompts/source-widgets.prompt.txt',
    'prompts/source-state-sheet.prompt.txt',
    'prompts/source-materials.prompt.txt'
  ];
  const expectedSources = [
    'source-chassis.png',
    'source-widgets.png',
    'source-state-sheet.png',
    'source-materials.png'
  ];

  if (!plan.skinId) {
    issues.push('handoff.json must declare skinId');
  }
  if (plan.contract !== contract.version) {
    issues.push(`handoff contract must be ${contract.version}, got ${plan.contract ?? 'missing'}`);
  }
  if (!profile) {
    issues.push(`handoff profile "${plan.profile ?? 'missing'}" is not in the layout contract`);
  }
  if (!['default', 'variant', 'prototype', 'legacy'].includes(plan.role)) {
    issues.push(`handoff role must be default, variant, prototype, or legacy; got ${plan.role ?? 'missing'}`);
  }
  if (isPromotedRole(plan.role) && plan.stateSheet !== 'required') {
    issues.push(`promoted handoff role "${plan.role}" must require a source-state-sheet.png`);
  }
  if (profile && (plan.size?.width !== profile.size.width || plan.size?.height !== profile.size.height)) {
    issues.push(
      `handoff size ${plan.size?.width ?? 'missing'}x${plan.size?.height ?? 'missing'} ` +
      `must match ${plan.profile} ${profile.size.width}x${profile.size.height}`
    );
  }
  if (plan.artBlueprint?.version !== artBlueprint.version || plan.artBlueprint?.name !== artBlueprint.name) {
    issues.push(`handoff art blueprint must be ${artBlueprint.name} ${artBlueprint.version}`);
  }
  if (plan.artBlueprint?.targetProfile !== artBlueprint.targetProfile) {
    issues.push(`handoff art blueprint target must be ${artBlueprint.targetProfile}`);
  }

  const promptFiles = await filePresence(dir, plan.files?.splitPrompts ?? [], expectedSplitPrompts);
  const guideFiles = await filePresence(dir, plan.files?.guides ?? [], []);
  const documentationFiles = await filePresence(dir, [
    plan.files?.prompt,
    plan.files?.artDirection,
    plan.files?.qualityBar
  ].filter(Boolean), ['prompt.txt', 'ART_DIRECTION.md', 'QUALITY_BAR.md']);
  const sourceFiles = await sourceFilePresence(dir, plan.files?.expectedSourcePack ?? expectedSources, profile);

  if (promptFiles.missing.length > 0) {
    issues.push(`missing split prompt file(s): ${promptFiles.missing.join(', ')}`);
  }
  if (guideFiles.expected.length === 0 || guideFiles.missing.length > 0) {
    issues.push(`missing guide/template file(s): ${(guideFiles.missing.length ? guideFiles.missing : ['none declared']).join(', ')}`);
  }
  if (documentationFiles.missing.length > 0) {
    issues.push(`missing handoff documentation file(s): ${documentationFiles.missing.join(', ')}`);
  }
  if (requireSources && sourceFiles.missing.length > 0) {
    issues.push(`missing generated source file(s): ${sourceFiles.missing.join(', ')}`);
  }

  if (profile) {
    await validatePromptContent(dir, profile, expectedSplitPrompts, issues, warnings);
  }

  for (const source of sourceFiles.files) {
    if (source.present && source.issue) {
      issues.push(source.issue);
    }
  }

  const sourceMissing = sourceFiles.missing.length;
  const structuralIssues = issues.filter((issue) => !issue.startsWith('missing generated source file(s):'));
  const phase = structuralIssues.length > 0
    ? 'needs-fixes'
    : requireSources && sourceMissing > 0
      ? 'missing-source-art'
      : sourceMissing > 0
      ? 'waiting-source-art'
      : 'source-art-ready';

  return {
    ok: structuralIssues.length === 0 && (!requireSources || sourceMissing === 0),
    phase,
    requireSources,
    skinId: plan.skinId ?? null,
    profile: plan.profile ?? null,
    role: plan.role ?? null,
    stateSheet: plan.stateSheet ?? null,
    path: relativePath(planPath),
    dir: relativePath(dir),
    issues,
    warnings,
    prompts: summarizePresence(promptFiles),
    guides: summarizePresence(guideFiles),
    documentation: summarizePresence(documentationFiles),
    sources: {
      present: sourceFiles.present.length,
      total: sourceFiles.expected.length,
      presentFiles: sourceFiles.present,
      missingFiles: sourceFiles.missing,
      files: sourceFiles.files
    },
    nextAction: nextActionForPhase(phase, sourceFiles.missing)
  };
}

async function validatePromptContent(dir, profile, expectedPrompts, issues, warnings) {
  const stateSheet = buildStateSheetLayout(profile);
  const expectations = {
    'prompts/source-chassis.prompt.txt': [
      'Output file: source-chassis.png',
      `exact ${profile.size.width}x${profile.size.height}`,
      'Live regions must remain visually calm and empty',
      'Forbidden dynamic content'
    ],
    'prompts/source-widgets.prompt.txt': [
      'Output file: source-widgets.png',
      `exact ${profile.size.width}x${profile.size.height}`,
      'Button/toggle crop rectangles',
      'Indicator crop rectangles',
      'Runtime meter/readout crop rectangles',
      'Forbidden dynamic content'
    ],
    'prompts/source-state-sheet.prompt.txt': [
      'Output file: source-state-sheet.png',
      `exact ${stateSheet.size.width}x${stateSheet.size.height}`,
      'Exact state slots',
      'Do not collapse states into near-identical copies',
      'Forbidden dynamic content'
    ],
    'prompts/source-materials.prompt.txt': [
      'Output file: source-materials.png',
      'Material layout',
      '96x96 fill tiles are seamless',
      '48x48 frames keep visual detail',
      'Forbidden dynamic content'
    ]
  };

  for (const fileName of expectedPrompts) {
    const text = await readTextIfPresent(path.join(dir, fileName));
    if (!text) {
      continue;
    }
    for (const expected of expectations[fileName] ?? []) {
      if (!text.includes(expected)) {
        issues.push(`${fileName} must include "${expected}"`);
      }
    }
    for (const forbidden of artBlueprint.forbiddenDynamicContent ?? []) {
      if (!text.includes(forbidden)) {
        warnings.push(`${fileName} does not explicitly mention forbidden dynamic content "${forbidden}"`);
      }
    }
  }
}

async function filePresence(dir, declaredFiles, requiredFiles) {
  const expected = unique([...requiredFiles, ...declaredFiles].filter(Boolean));
  const files = await Promise.all(expected.map(async (file) => ({
    file,
    present: await exists(path.join(dir, file))
  })));
  return {
    expected,
    files,
    present: files.filter((entry) => entry.present).map((entry) => entry.file),
    missing: files.filter((entry) => !entry.present).map((entry) => entry.file)
  };
}

async function sourceFilePresence(dir, declaredFiles, profile) {
  const expected = unique(declaredFiles.filter(Boolean));
  const files = await Promise.all(expected.map(async (file) => {
    const filePath = path.join(dir, file);
    const png = await readPngHeaderIfPresent(filePath);
    const issue = png?.present && profile ? sourceDimensionIssue(file, png, profile) : null;
    return {
      file,
      present: png?.present ?? false,
      width: png?.width ?? null,
      height: png?.height ?? null,
      issue
    };
  }));
  return {
    expected,
    files,
    present: files.filter((entry) => entry.present).map((entry) => entry.file),
    missing: files.filter((entry) => !entry.present).map((entry) => entry.file)
  };
}

function sourceDimensionIssue(file, png, profile) {
  const stateSheet = buildStateSheetLayout(profile);
  if (file === 'source-chassis.png' || file === 'source-widgets.png') {
    if (png.width !== profile.size.width || png.height !== profile.size.height) {
      return `${file} is ${png.width}x${png.height}; expected ${profile.size.width}x${profile.size.height}`;
    }
  }
  if (file === 'source-state-sheet.png') {
    if (png.width !== stateSheet.size.width || png.height !== stateSheet.size.height) {
      return `${file} is ${png.width}x${png.height}; expected ${stateSheet.size.width}x${stateSheet.size.height}`;
    }
  }
  if (file === 'source-materials.png') {
    if (png.width < 152 || png.height < 304) {
      return `${file} is ${png.width}x${png.height}; expected at least 152x304`;
    }
  }
  return null;
}

async function readPngHeaderIfPresent(filePath) {
  let data;
  try {
    data = await fs.readFile(filePath);
  } catch {
    return { present: false };
  }

  if (data.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    return { present: true, width: 0, height: 0 };
  }

  return {
    present: true,
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20)
  };
}

async function readTextIfPresent(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

async function normalizeHandoffPath(input) {
  const resolved = path.resolve(rootDir, input);
  const stat = await fs.stat(resolved);
  return stat.isDirectory() ? path.join(resolved, 'handoff.json') : resolved;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function summarizePresence(presence) {
  return {
    present: presence.present.length,
    total: presence.expected.length,
    presentFiles: presence.present,
    missingFiles: presence.missing
  };
}

function nextActionForPhase(phase, missingSources) {
  if (phase === 'needs-fixes') {
    return 'Fix handoff structure before generating source art.';
  }
  if (phase === 'waiting-source-art' || phase === 'missing-source-art') {
    return `Generate ${missingSources[0] ?? 'the missing source PNGs'} with the split prompts, then rerun with --require-sources.`;
  }
  return 'Run skin:scaffold, validate:skin-source-packs, skin:review-source --json --fail-on-warning, and build:skin-kit.';
}

function printReport(report) {
  console.log(`${report.skinId}: ${report.phase}`);
  console.log(`Prompts: ${report.prompts.present}/${report.prompts.total}`);
  console.log(`Guides: ${report.guides.present}/${report.guides.total}`);
  console.log(`Sources: ${report.sources.present}/${report.sources.total}`);
  if (report.issues.length > 0) {
    console.log('Issues:');
    for (const issue of report.issues) {
      console.log(`- ${issue}`);
    }
  }
  if (report.warnings.length > 0) {
    console.log('Warnings:');
    for (const warning of report.warnings) {
      console.log(`- ${warning}`);
    }
  }
  console.log(`Next: ${report.nextAction}`);
}

function isPromotedRole(role) {
  return role === 'default' || role === 'variant';
}

function unique(values) {
  return [...new Set(values)];
}

function relativePath(filePath) {
  return path.relative(repoRoot, filePath) || '.';
}

function parseArgs(values) {
  const options = {};
  const positionals = [];

  for (const value of values) {
    if (value.startsWith('--')) {
      options[value.slice(2)] = true;
    } else {
      positionals.push(value);
    }
  }

  return { options, positionals };
}

function printUsage() {
  console.error([
    'Usage: pnpm -C frontend skin:validate-handoff <handoff-dir|handoff.json> [--json] [--require-sources]',
    '',
    'Validates a generated skin handoff bundle before image generation or before source-pack scaffolding.',
    'Without --require-sources, missing source PNGs are reported as waiting-source-art instead of failures.'
  ].join('\n'));
}
