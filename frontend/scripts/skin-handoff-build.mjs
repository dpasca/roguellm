import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(new URL('..', import.meta.url).pathname);
const repoRoot = path.resolve(rootDir, '..');
const scriptDir = path.join(rootDir, 'scripts');
const parsedArgs = parseArgs(process.argv.slice(2));
const handoffArg = parsedArgs.positionals[0];
const jsonOutput = parsedArgs.options.json === 'true';
const dryRun = parsedArgs.options['dry-run'] === 'true';
const allowWarnings = parsedArgs.options['allow-warnings'] === 'true';

if (parsedArgs.options.help || !handoffArg) {
  printUsage();
  process.exit(parsedArgs.options.help ? 0 : 1);
}

const handoffPath = await normalizeHandoffPath(handoffArg);
const handoffDir = path.dirname(handoffPath);
const plan = JSON.parse(await fs.readFile(handoffPath, 'utf8'));
const skinId = requiredString(plan.skinId, 'handoff skinId');
const profile = requiredString(plan.profile, 'handoff profile');
const role = parsedArgs.options.role ?? requiredString(plan.role, 'handoff role');
const sourceFiles = plan.files?.expectedSourcePack ?? [
  'source-chassis.png',
  'source-widgets.png',
  'source-state-sheet.png',
  'source-materials.png'
];
const outDir = path.resolve(
  rootDir,
  parsedArgs.options.out ?? path.relative(rootDir, handoffDir)
);
const reviewOut = path.resolve(
  rootDir,
  parsedArgs.options['review-out'] ?? `../_artifacts/skin-reviews/${skinId}-handoff/index.html`
);
const reviewFailureFlag = allowWarnings ? '--fail-on-issue' : '--fail-on-warning';
const report = {
  skinId,
  profile,
  role,
  handoff: relativePath(handoffDir),
  out: relativePath(outDir),
  reviewOut: relativePath(reviewOut),
  reviewFailureFlag,
  dryRun,
  steps: []
};

await runStep('validate handoff sources', process.execPath, [
  path.join(scriptDir, 'validate-skin-handoff.mjs'),
  handoffDir,
  '--require-sources'
]);

await prepareOutputDir(handoffDir, outDir, sourceFiles);
await runStep('write source overlay guide', process.execPath, [
  path.join(scriptDir, 'skin-layout-guide.mjs'),
  profile,
  '--view',
  'all',
  '--source',
  path.join(outDir, 'source-chassis.png'),
  '--out',
  path.join(outDir, 'source-overlay.png')
]);
await runStep('scaffold fixed skin manifest', process.execPath, [
  path.join(scriptDir, 'skin-layout-scaffold.mjs'),
  skinId,
  profile,
  '--label',
  parsedArgs.options.label ?? labelFromId(skinId),
  '--role',
  role,
  '--tags',
  parsedArgs.options.tags ?? 'cyberpunk,handheld',
  '--mood',
  parsedArgs.options.mood ?? 'premium,nocturnal',
  '--palette',
  parsedArgs.options.palette ?? 'graphite,cyan',
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
await runStep('validate source pack geometry', process.execPath, [
  path.join(scriptDir, 'validate-skin-source-packs.mjs'),
  outDir
]);
await runStep('review source art strictly', process.execPath, [
  path.join(scriptDir, 'skin-source-review.mjs'),
  outDir,
  '--json',
  reviewFailureFlag,
  '--out',
  reviewOut
]);
await runStep('build fixed skin crops', process.execPath, [
  path.join(scriptDir, 'build-skin-kit.mjs'),
  outDir
]);
await runStep('validate built skin kit', process.execPath, [
  path.join(scriptDir, 'validate-skin-kits.mjs'),
  outDir
]);

if (jsonOutput) {
  console.log(`${JSON.stringify(report, null, 2)}\n`);
} else {
  console.log(`${dryRun ? 'Planned' : 'Built'} handoff skin ${skinId} at ${relativePath(outDir)}.`);
  console.log(`Review: ${relativePath(reviewOut)}`);
}

async function prepareOutputDir(sourceDir, targetDir, files) {
  if (dryRun) {
    report.steps.push({
      name: 'prepare output directory',
      target: relativePath(targetDir),
      skipped: true
    });
    return;
  }

  await fs.mkdir(targetDir, { recursive: true });
  if (samePath(sourceDir, targetDir)) {
    report.steps.push({
      name: 'prepare output directory',
      skipped: true,
      reason: 'handoff directory is output directory'
    });
    return;
  }

  for (const file of files) {
    await copyIfPresent(path.join(sourceDir, file), path.join(targetDir, file));
  }
  for (const file of ['handoff.json', 'ART_DIRECTION.md', 'QUALITY_BAR.md', 'README.md']) {
    await copyIfPresent(path.join(sourceDir, file), path.join(targetDir, file));
  }
  await copyDirIfPresent(path.join(sourceDir, 'prompts'), path.join(targetDir, 'prompts'));
  report.steps.push({
    name: 'prepare output directory',
    copiedSources: files,
    target: relativePath(targetDir)
  });
}

async function runStep(name, command, args) {
  const step = {
    name,
    command: shellCommand(command, args)
  };
  report.steps.push(step);

  if (dryRun) {
    step.skipped = true;
    return;
  }

  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: rootDir,
      maxBuffer: 16 * 1024 * 1024
    });
    step.ok = true;
    step.stdout = stdout.trim();
    step.stderr = stderr.trim();
  } catch (error) {
    step.ok = false;
    step.stdout = (error.stdout ?? '').trim();
    step.stderr = (error.stderr ?? '').trim();
    if (!jsonOutput) {
      console.error(`${name} failed.`);
      if (step.stdout) {
        console.error(step.stdout);
      }
      if (step.stderr) {
        console.error(step.stderr);
      }
    }
    throw error;
  }
}

async function normalizeHandoffPath(input) {
  const resolved = path.resolve(rootDir, input);
  const stat = await fs.stat(resolved);
  return stat.isDirectory() ? path.join(resolved, 'handoff.json') : resolved;
}

async function copyIfPresent(source, target) {
  try {
    await fs.copyFile(source, target);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

async function copyDirIfPresent(source, target) {
  try {
    await fs.cp(source, target, { recursive: true });
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

function requiredString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Missing ${label}`);
  }
  return value;
}

function labelFromId(id) {
  return id
    .split('-')
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function samePath(left, right) {
  return path.resolve(left) === path.resolve(right);
}

function relativePath(filePath) {
  return path.relative(repoRoot, filePath) || '.';
}

function shellCommand(command, args) {
  return [path.relative(rootDir, command) || command, ...args.map((arg) => {
    if (typeof arg !== 'string') {
      return String(arg);
    }
    return path.isAbsolute(arg) && arg.startsWith(rootDir)
      ? path.relative(rootDir, arg)
      : arg;
  })].map(shellQuote).join(' ');
}

function shellQuote(value) {
  return /[^A-Za-z0-9_./:=,+-]/.test(value) ? JSON.stringify(value) : value;
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
    'Usage: pnpm -C frontend skin:build-handoff <handoff-dir|handoff.json> [options]',
    '',
    'Validates a completed generated-skin handoff, scaffolds a fixed skin kit,',
    'runs strict source-art review, builds crops, and validates the built kit.',
    '',
    'Options:',
    '  --out <dir>              Output kit directory. Defaults to the handoff directory.',
    '  --review-out <path>      Source review HTML path. Defaults to _artifacts/skin-reviews/<skin>-handoff/index.html.',
    '  --label <name>           Override generated manifest label.',
    '  --role <role>            Override handoff role.',
    '  --tags <a,b,c>           Override metadata tags. Defaults to cyberpunk,handheld.',
    '  --mood <a,b,c>           Override metadata mood. Defaults to premium,nocturnal.',
    '  --palette <a,b,c>        Override metadata palette. Defaults to graphite,cyan.',
    '  --allow-warnings         Use --fail-on-issue instead of strict --fail-on-warning review.',
    '  --dry-run                Print/emit planned steps without writing derived files.',
    '  --json                   Emit a JSON execution report.'
  ].join('\n'));
}
