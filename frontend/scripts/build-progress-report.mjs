import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const rootDir = path.resolve(new URL('..', import.meta.url).pathname);
const repoRoot = path.resolve(rootDir, '..');
const defaultReportPath = path.join(repoRoot, '_artifacts/visual/rain-city-production-default/report.json');
const reportPath = path.resolve(process.env.PROGRESS_VISUAL_REPORT ?? defaultReportPath);
const outPath = path.resolve(process.env.PROGRESS_OUT ?? path.join(repoRoot, '_artifacts/progress.html'));
const outDir = path.dirname(outPath);
const execFileAsync = promisify(execFile);

const summary = JSON.parse(await fs.readFile(reportPath, 'utf8'));
await fs.mkdir(outDir, { recursive: true });

const compactFocus = summary.compactQualityFocus ?? inferCompactFocus(summary);
const compactProfile = summary.profileSummaries?.find((profile) => profile.id === compactFocus?.id) ?? null;
const compactAsset = summary.skinAssetSummaries?.find((asset) => asset.id === compactFocus?.id) ?? null;
const imageCards = await buildImageCards(summary, compactFocus?.id ?? 'ai-cyberdeck-reference-v1');
const sourceReview = await loadSourceReview(compactFocus?.id);
const handoff = await loadProgressHandoff();
const gitStatus = await loadGitStatus();
const styleBoundary = await loadStyleBoundary();

await fs.writeFile(outPath, buildHtml({
  summary,
  reportPath,
  compactFocus,
  compactProfile,
  compactAsset,
  imageCards,
  sourceReview,
  handoff,
  gitStatus,
  styleBoundary
}), 'utf8');

console.log(`Wrote ${path.relative(process.cwd(), outPath)}`);

async function loadGitStatus() {
  try {
    const [branch, sha, subject, status] = await Promise.all([
      gitOutput(['rev-parse', '--abbrev-ref', 'HEAD']),
      gitOutput(['rev-parse', '--short', 'HEAD']),
      gitOutput(['log', '-1', '--pretty=%s']),
      gitOutput(['status', '--short'])
    ]);
    const statusLines = status.split('\n').map((line) => line.trim()).filter(Boolean);
    return {
      branch,
      sha,
      subject,
      dirtyCount: statusLines.length
    };
  } catch {
    return null;
  }
}

async function loadStyleBoundary() {
  const manifestPath = path.join(repoRoot, 'static/game2/.vite/manifest.json');
  const srcCssFiles = await findFiles(path.join(rootDir, 'src'), (file) => /\.css$/i.test(file));
  const issues = [];
  let manifest = null;

  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  } catch {
    issues.push('built Vite manifest missing; run pnpm -C frontend build before trusting CSS boundary metrics');
  }

  const manifestEntries = manifest ? Object.values(manifest) : [];
  const appEntry = manifest?.['index.html'];
  const phaserEntry = manifestEntries.find((entry) => entry?.name === 'phaser-no-physics');
  const entryCss = appEntry?.css ?? [];
  const phaserCss = phaserEntry?.css ?? [];
  const cssAssets = manifestEntries
    .map((entry) => String(entry?.file ?? ''))
    .filter((file) => file.endsWith('.css'));

  if (entryCss.length > 0) {
    issues.push(`index.html loads CSS assets: ${entryCss.join(', ')}`);
  }
  if (phaserCss.length > 0) {
    issues.push(`phaser-no-physics chunk loads CSS assets: ${phaserCss.join(', ')}`);
  }
  if (cssAssets.length > 0) {
    issues.push(`Vite manifest contains CSS assets: ${cssAssets.join(', ')}`);
  }
  if (srcCssFiles.length > 0) {
    issues.push(`frontend/src contains CSS files: ${srcCssFiles.map((file) => path.relative(rootDir, file)).join(', ')}`);
  }

  return {
    ok: issues.length === 0,
    manifestPath,
    entryCssCount: entryCss.length,
    phaserCssCount: phaserCss.length,
    cssAssetCount: cssAssets.length,
    sourceCssCount: srcCssFiles.length,
    issues
  };
}

async function findFiles(dir, predicate) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const matches = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      matches.push(...await findFiles(fullPath, predicate));
    } else if (predicate(fullPath)) {
      matches.push(fullPath);
    }
  }
  return matches;
}

async function gitOutput(args) {
  const result = await execFileAsync('git', ['-C', repoRoot, ...args], {
    maxBuffer: 1024 * 1024
  });
  return result.stdout.trim();
}

async function buildImageCards(report, profileId) {
  const sourceDir = path.join(rootDir, 'src/skins/neo-tokyo-console/fixed', profileId);
  const cards = [
    {
      kind: 'SOURCE ART',
      title: 'Clean Source Chassis',
      description: 'Skin-owned fixed source art. Live gameplay regions should be empty and ready for Phaser content.',
      image: await existingRelativePath(path.join(sourceDir, 'source-chassis.png'))
    },
    {
      kind: 'SOURCE ART',
      title: 'Widget State Sheet',
      description: 'Authored button, toggle, status, and LED states cropped into runtime sprites.',
      image: await existingRelativePath(path.join(sourceDir, 'source-state-sheet.png'))
    },
    {
      kind: 'LIVE RUNTIME',
      title: 'Ready State',
      description: 'Actual non-workbench Phaser runtime render from the visual inspection run.',
      image: resultImage(report, profileId, 'production-runtime-ready')
    },
    {
      kind: 'LIVE RUNTIME',
      title: 'Log Drawer',
      description: 'Actual non-workbench Phaser runtime render with the top-first log drawer open.',
      image: resultImage(report, profileId, 'production-runtime-log')
    },
    {
      kind: 'LIVE RUNTIME',
      title: 'Inventory Drawer',
      description: 'Actual non-workbench Phaser runtime render with inventory rows and text backplates.',
      image: resultImage(report, profileId, 'production-runtime-inventory')
    },
    {
      kind: 'LIVE RUNTIME',
      title: 'Combat State',
      description: 'Actual non-workbench Phaser runtime render with combat controls and lock state.',
      image: resultImage(report, profileId, 'production-runtime-combat')
    },
    {
      kind: 'LIVE RUNTIME',
      title: 'Runtime Defeat Terminal',
      description: 'Actual non-workbench Phaser runtime fixture render for the defeat end-state and restart hardware.',
      image: resultImage(report, profileId, 'production-runtime-defeat')
    },
    {
      kind: 'LIVE RUNTIME',
      title: 'Runtime Victory Terminal',
      description: 'Actual non-workbench Phaser runtime fixture render for the victory end-state and restart hardware.',
      image: resultImage(report, profileId, 'production-runtime-victory')
    },
    {
      kind: 'WORKBENCH SCREENSHOT',
      title: 'Defeat Terminal',
      description: 'Deterministic Phaser workbench render for the terminal end-state surface.',
      image: resultImage(report, profileId, 'production-defeat')
    },
    {
      kind: 'GUIDE/TEMPLATE',
      title: 'State Sheet Guide',
      description: 'Template for future generated skins. This is a crop guide, not a runtime screen.',
      image: await existingRelativePath(path.join(repoRoot, '_artifacts/skin-guides/mobile-compact-state-sheet.png'))
    }
  ];

  return cards.filter((card) => card.image);
}

async function loadProgressHandoff() {
  const explicitPath = process.env.PROGRESS_SKIN_HANDOFF
    ? path.resolve(process.env.PROGRESS_SKIN_HANDOFF)
    : null;
  const handoffPath = explicitPath
    ? await normalizeHandoffPath(explicitPath)
    : await latestHandoffPath();
  if (!handoffPath) {
    return null;
  }

  const handoffDir = path.dirname(handoffPath);
  const plan = JSON.parse(await fs.readFile(handoffPath, 'utf8'));
  return {
    dir: handoffDir,
    path: handoffPath,
    plan,
    guideImages: (plan.files?.guides ?? [])
      .filter((file) => /\.(png|jpg|jpeg|webp)$/i.test(file))
      .map((file) => ({
        file,
        image: path.relative(outDir, path.join(handoffDir, file))
      })),
    promptFiles: plan.files?.splitPrompts ?? [],
    steps: plan.generationSteps ?? []
  };
}

async function loadSourceReview(profileId) {
  if (!profileId) {
    return null;
  }

  const candidates = [
    path.join(repoRoot, '_artifacts/skin-reviews', 'validation', profileId, 'review.json'),
    path.join(repoRoot, '_artifacts/skin-reviews', `${profileId}-coherence`, 'review.json'),
    path.join(repoRoot, '_artifacts/skin-reviews', profileId, 'review.json')
  ];

  for (const reviewPath of candidates) {
    try {
      const review = JSON.parse(await fs.readFile(reviewPath, 'utf8'));
      return {
        path: reviewPath,
        review,
        stateDeltas: review.metrics?.stateDeltas ?? [],
        sourceCoherence: review.metrics?.sourceCoherence ?? []
      };
    } catch {
      continue;
    }
  }

  return null;
}

async function normalizeHandoffPath(candidatePath) {
  try {
    const stat = await fs.stat(candidatePath);
    return stat.isDirectory() ? path.join(candidatePath, 'handoff.json') : candidatePath;
  } catch {
    return null;
  }
}

async function latestHandoffPath() {
  const handoffRoot = path.join(repoRoot, '_artifacts/skin-handoffs');
  let entries;
  try {
    entries = await fs.readdir(handoffRoot, { withFileTypes: true });
  } catch {
    return null;
  }

  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const handoffPath = path.join(handoffRoot, entry.name, 'handoff.json');
    try {
      const stat = await fs.stat(handoffPath);
      candidates.push({ handoffPath, mtimeMs: stat.mtimeMs });
    } catch {
      continue;
    }
  }

  return candidates.sort((left, right) => right.mtimeMs - left.mtimeMs)[0]?.handoffPath ?? null;
}

async function existingRelativePath(filePath) {
  try {
    await fs.access(filePath);
    return path.relative(outDir, filePath);
  } catch {
    return null;
  }
}

function resultImage(report, profileId, nameToken) {
  const result = report.results?.find((entry) =>
    entry.metrics?.fixedProfile === profileId &&
    entry.name?.includes(nameToken)
  );
  if (!result?.screenshotPath) {
    return null;
  }
  return path.relative(outDir, result.screenshotPath);
}

function inferCompactFocus(report) {
  const compactProfiles = (report.productionMobileProfiles ?? [])
    .filter((profile) => profile.kind === 'mobileCompact');
  const highestPriorityCompact = compactProfiles[0]?.id ?? null;
  const profile = report.profileSummaries?.find((entry) => entry.id === highestPriorityCompact);
  return {
    id: highestPriorityCompact,
    ok: Boolean(report.ok && profile && profile.failures === 0),
    highestPriorityCompact,
    failures: [],
    requiredStates: [],
    coveredStates: [],
    metrics: compactMetrics(profile?.metrics),
    assetMetrics: compactMetrics(report.skinAssetSummaries?.find((entry) => entry.id === highestPriorityCompact)?.metrics)
  };
}

function compactMetrics(metrics) {
  if (!metrics) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(metrics)
      .filter(([, value]) => Number.isFinite(value))
      .map(([key, value]) => [key, Math.round(value * 1000) / 1000])
  );
}

function buildHtml({ summary, reportPath, compactFocus, compactProfile, compactAsset, imageCards, sourceReview, handoff, gitStatus, styleBoundary }) {
  const reportRelative = path.relative(outDir, reportPath);
  const reportHtmlRelative = reportRelative.replace(/\.json$/, '.html');
  const contractRelative = path.relative(outDir, path.join(rootDir, 'src/skins/SKIN_LAYOUT_CONTRACT_V1.md'));
  const blueprintRelative = path.relative(outDir, path.join(rootDir, 'src/skins/SKIN_ART_BLUEPRINT_V1.json'));
  const profileFlags = compactProfile?.reviewFlags ?? [];
  const failures = compactFocus?.failures ?? [];
  const generatedAt = summary.generatedAt ?? 'unknown';
  const gitSummary = gitStatus
    ? `${gitStatus.sha} ${gitStatus.subject}`
    : 'unavailable';
  const worktreeLabel = gitStatus
    ? gitStatus.dirtyCount === 0 ? 'clean' : `${gitStatus.dirtyCount} changed file${gitStatus.dirtyCount === 1 ? '' : 's'}`
    : 'unknown';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>RogueLLM Progress Evidence</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #070a0a;
      color: #edf7ef;
    }
    body {
      max-width: 1160px;
      margin: 0 auto;
      padding: 28px;
      background: #070a0a;
    }
    h1,
    h2,
    h3,
    p {
      margin: 0;
    }
    h1 {
      font-size: 30px;
      letter-spacing: 0;
    }
    h2 {
      margin-top: 28px;
      color: #eaffdf;
      font-size: 20px;
    }
    h3 {
      color: #9cff7c;
      font-size: 15px;
    }
    p,
    li {
      color: #b8c7c2;
      line-height: 1.55;
    }
    a {
      color: #b8ff9d;
    }
    code {
      color: #d8ffd1;
      background: #101716;
      padding: 2px 5px;
    }
    .lede {
      margin-top: 10px;
      max-width: 840px;
      color: #d9e8e2;
    }
    .panel {
      margin-top: 16px;
      padding: 14px;
      border: 1px solid #26423d;
      background: #0b1111;
    }
    .status {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 10px;
      margin-top: 14px;
    }
    .metric {
      padding: 11px;
      border: 1px solid #203332;
      background: #07100f;
    }
    .metric span {
      display: block;
      color: #8ca49e;
      font-size: 11px;
      font-weight: 900;
      text-transform: uppercase;
    }
    .metric strong {
      display: block;
      margin-top: 4px;
      color: #f2fff4;
      font-size: 17px;
    }
    .ok {
      color: #8dff74;
    }
    .warn {
      color: #ff8ea1;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 10px;
    }
    .chips span {
      padding: 4px 7px;
      border: 1px solid #2d4641;
      color: #d6ffe1;
      font-size: 12px;
      background: #07100f;
    }
    .legend {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
      gap: 10px;
      margin-top: 14px;
    }
    .legend div {
      border: 1px solid #203332;
      padding: 11px;
      background: #07100f;
    }
    .legend strong {
      display: block;
      margin-bottom: 4px;
      color: #9cff7c;
      font-size: 12px;
      text-transform: uppercase;
    }
    .legend p {
      font-size: 13px;
    }
    .shots {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 14px;
      margin-top: 14px;
    }
    figure {
      margin: 0;
      border: 1px solid #253737;
      background: #0b1111;
    }
    figure img {
      display: block;
      width: 100%;
      height: auto;
      background: #040707;
    }
    figcaption {
      padding: 10px;
    }
    figcaption span {
      display: inline-block;
      margin-bottom: 6px;
      padding: 3px 6px;
      color: #061006;
      font-size: 10px;
      font-weight: 900;
      background: #8dff77;
    }
    figcaption p {
      color: #a8b7b4;
      font-size: 13px;
    }
    ul {
      margin: 10px 0 0;
      padding-left: 22px;
    }
  </style>
</head>
<body>
  <h1>RogueLLM Progress Evidence</h1>
  <p class="lede">
    This is a generated local evidence page. It is not the game screen and not a single mockup.
    It separates real Phaser screenshots, implemented skin source art, and future handoff guides.
  </p>

  <section class="panel">
    <h2>Current Status</h2>
    <div class="status">
      <div class="metric">
        <span>Visual Report</span>
        <strong class="${summary.ok ? 'ok' : 'warn'}">${summary.ok ? 'passing' : 'failing'}</strong>
      </div>
      <div class="metric">
        <span>Scenarios</span>
        <strong>${summary.results?.length ?? 0}</strong>
      </div>
      <div class="metric">
        <span>Compact Focus</span>
        <strong class="${compactFocus?.ok ? 'ok' : 'warn'}">${escapeHtml(compactFocus?.id ?? 'missing')}</strong>
      </div>
      <div class="metric">
        <span>Source Review</span>
        <strong class="${sourceReviewOk(sourceReview) ? 'ok' : 'warn'}">${escapeHtml(sourceReviewLabel(sourceReview))}</strong>
      </div>
      <div class="metric">
        <span>Runtime CSS</span>
        <strong class="${styleBoundary?.ok ? 'ok' : 'warn'}">${styleBoundary?.ok ? 'none' : 'check'}</strong>
      </div>
      <div class="metric">
        <span>Generated</span>
        <strong>${escapeHtml(generatedAt)}</strong>
      </div>
      <div class="metric">
        <span>Branch</span>
        <strong>${escapeHtml(gitStatus?.branch ?? 'unknown')}</strong>
      </div>
      <div class="metric">
        <span>Repo Commit</span>
        <strong>${escapeHtml(gitStatus?.sha ?? 'unknown')}</strong>
      </div>
      <div class="metric">
        <span>Worktree</span>
        <strong class="${gitStatus?.dirtyCount === 0 ? 'ok' : 'warn'}">${escapeHtml(worktreeLabel)}</strong>
      </div>
    </div>
    <p class="lede">
      Source of truth: <a href="${escapeHtml(contractRelative)}">layout contract</a> and
      <a href="${escapeHtml(blueprintRelative)}">art blueprint</a>. Visual evidence:
      <a href="${escapeHtml(reportHtmlRelative)}">latest visual report</a> and
      <a href="${escapeHtml(reportRelative)}">report JSON</a>.
      Repo evidence: <code>${escapeHtml(gitSummary)}</code>.
    </p>
    <div class="legend">
      <div>
        <strong>Live Runtime</strong>
        <p>Actual non-workbench Phaser canvas output from automated browser inspection. This is the current game surface.</p>
      </div>
      <div>
        <strong>Workbench Screenshot</strong>
        <p>Deterministic Phaser canvas output used to prove hard-to-reach states such as defeat and victory.</p>
      </div>
      <div>
        <strong>Source Art</strong>
        <p>Implemented skin-owned art used to crop/build Phaser runtime assets. It can still need taste review.</p>
      </div>
      <div>
        <strong>Guide/Template</strong>
        <p>Future handoff material for image generation or cropping. This is not an implemented skin.</p>
      </div>
    </div>
  </section>

  <section class="panel">
    <h2>Canvas Skin Boundary</h2>
    <p>
      Fixed-skin gameplay UI is owned by Phaser canvas rendering and fixed PNG crops, not runtime DOM stylesheets.
      This progress page uses its own ignored HTML/CSS for evidence only; it is not part of the game bundle.
    </p>
    <div class="chips">
      <span>Vite CSS assets: ${styleBoundary?.cssAssetCount ?? 'unknown'}</span>
      <span>index.html CSS refs: ${styleBoundary?.entryCssCount ?? 'unknown'}</span>
      <span>Phaser chunk CSS refs: ${styleBoundary?.phaserCssCount ?? 'unknown'}</span>
      <span>frontend/src CSS files: ${styleBoundary?.sourceCssCount ?? 'unknown'}</span>
      <span>validator: pnpm -C frontend validate:phaser-style-boundary</span>
    </div>
    ${styleBoundary?.issues?.length
      ? `<ul>${styleBoundary.issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join('')}</ul>`
      : '<p class="lede ok">The built fixed-skin runtime has no stylesheet asset path. Only the Phaser host shell may size the canvas viewport.</p>'}
  </section>

  <section class="panel">
    <h2>Compact Skin Quality Focus</h2>
    <p>
      The promoted short-phone profile is <code>${escapeHtml(compactFocus?.id ?? 'missing')}</code>.
      This gate checks that it is the highest-priority compact profile, covers the required mobile states,
      has no text overflow, and meets minimum contrast, saturation, color-variety, shell-detail, and control-detail floors.
    </p>
    <div class="chips">
      ${(compactFocus?.requiredStates ?? []).map((state) =>
        `<span>${escapeHtml(state)}: ${(compactFocus.coveredStates ?? []).includes(state) ? 'covered' : 'missing'}</span>`
      ).join('')}
    </div>
    <div class="chips">
      ${Object.entries(compactFocus?.metrics ?? {}).map(([key, value]) =>
        `<span>${escapeHtml(key)} ${escapeHtml(value)}</span>`
      ).join('')}
      ${Object.entries(compactFocus?.assetMetrics ?? {}).map(([key, value]) =>
        `<span>${escapeHtml(`asset ${key}`)} ${escapeHtml(value)}</span>`
      ).join('')}
    </div>
    ${failures.length
      ? `<ul>${failures.map((failure) => `<li>${escapeHtml(failure)}</li>`).join('')}</ul>`
      : '<p class="lede ok">The compact focus gate is passing. Human visual review is still required for taste and cohesion.</p>'}
    <div class="chips">
      ${profileFlags.map((flag) => `<span>${escapeHtml(flag)}</span>`).join('')}
      ${compactAsset?.chassis ? `<span>${escapeHtml(`chassis ${compactAsset.chassis}`)}</span>` : ''}
    </div>
  </section>

  ${sourceReview ? sourceReviewSection(sourceReview) : ''}

  <section>
    <h2>Labeled Evidence</h2>
    <div class="shots">
      ${imageCards.map((card) => `
        <figure>
          <a href="${escapeHtml(card.image)}"><img src="${escapeHtml(card.image)}" alt="${escapeHtml(card.title)}"></a>
          <figcaption>
            <span>${escapeHtml(card.kind)}</span>
            <h3>${escapeHtml(card.title)}</h3>
            <p>${escapeHtml(card.description)}</p>
          </figcaption>
        </figure>
      `).join('')}
    </div>
  </section>
  ${handoff ? handoffSection(handoff) : ''}
</body>
</html>
`;
}

function sourceReviewOk(sourceReview) {
  if (!sourceReview) {
    return false;
  }

  return (sourceReview.review.issues?.length ?? 0) === 0 &&
    (sourceReview.review.warnings?.length ?? 0) === 0;
}

function sourceReviewLabel(sourceReview) {
  if (!sourceReview) {
    return 'missing';
  }

  const issueCount = sourceReview.review.issues?.length ?? 0;
  const warningCount = sourceReview.review.warnings?.length ?? 0;
  if (issueCount === 0 && warningCount === 0) {
    return 'clean';
  }
  return `${issueCount} issues / ${warningCount} warnings`;
}

function sourceReviewSection(sourceReview) {
  const reviewRelative = path.relative(outDir, sourceReview.path);
  const reviewHtmlRelative = reviewRelative.replace(/review\.json$/, 'index.html');
  const issueCount = sourceReview.review.issues?.length ?? 0;
  const warningCount = sourceReview.review.warnings?.length ?? 0;
  const weakestStateDeltas = sourceReview.stateDeltas
    .slice()
    .sort((left, right) => stateDeltaMargin(left) - stateDeltaMargin(right))
    .slice(0, 6);
  const coherenceWarnings = sourceReview.sourceCoherence.filter((metric) => metric.warning).length;
  const coherenceSummary = sourceReview.sourceCoherence.length
    ? `${sourceReview.sourceCoherence.length} source-pair checks, ${coherenceWarnings} warnings`
    : 'no source-pair checks available';
  const stateSummary = weakestStateDeltas.length
    ? `weakest authored state margin ${formatSignedNumber(stateDeltaMargin(weakestStateDeltas[0]), 4)}`
    : 'no authored state delta metrics available';

  return `
    <section class="panel">
      <h2>Source Pack Review</h2>
      <p>
        Latest available source-art review:
        <a href="${escapeHtml(reviewHtmlRelative)}">${escapeHtml(reviewHtmlRelative)}</a>
        and <a href="${escapeHtml(reviewRelative)}">${escapeHtml(reviewRelative)}</a>.
        Result: <strong class="${issueCount || warningCount ? 'warn' : 'ok'}">${issueCount} issues, ${warningCount} warnings</strong>.
      </p>
      <div class="chips">
        <span>${escapeHtml(coherenceSummary)}</span>
        <span>${escapeHtml(stateSummary)}</span>
      </div>
      <div class="chips">
        ${weakestStateDeltas.map((metric) => `
          <span>${escapeHtml(`${metric.name}.${metric.state}: delta ${formatNumber(metric.delta, 4)} / floor ${formatNumber(metric.floor, 4)} / margin ${formatSignedNumber(stateDeltaMargin(metric), 4)}`)}</span>
        `).join('')}
      </div>
    </section>
  `;
}

function stateDeltaMargin(metric) {
  if (Number.isFinite(metric.margin)) {
    return metric.margin;
  }
  if (Number.isFinite(metric.delta) && Number.isFinite(metric.floor)) {
    return metric.delta - metric.floor;
  }
  return Number.POSITIVE_INFINITY;
}

function formatNumber(value, digits = 3) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : 'n/a';
}

function formatSignedNumber(value, digits = 3) {
  if (!Number.isFinite(value)) {
    return 'n/a';
  }
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
}

function handoffSection(handoff) {
  const plan = handoff.plan;
  const handoffRelative = path.relative(outDir, handoff.path);
  const dirRelative = path.relative(outDir, handoff.dir);
  const promptLinks = handoff.promptFiles
    .map((file) => `<span><a href="${escapeHtml(path.relative(outDir, path.join(handoff.dir, file)))}">${escapeHtml(file)}</a></span>`)
    .join('');
  const guideFigures = handoff.guideImages
    .map((guide) => `
      <figure>
        <a href="${escapeHtml(guide.image)}"><img src="${escapeHtml(guide.image)}" alt="${escapeHtml(guide.file)}"></a>
        <figcaption>
          <span>GUIDE/TEMPLATE</span>
          <h3>${escapeHtml(guide.file)}</h3>
          <p>Future skin handoff guide for image generation/cropping. This is not a runtime screenshot.</p>
        </figcaption>
      </figure>
    `)
    .join('');

  return `
    <section class="panel">
      <h2>Next Skin Handoff</h2>
      <p>
        Latest local handoff: <code>${escapeHtml(plan.skinId)}</code>, profile
        <code>${escapeHtml(plan.profile)}</code>, role <code>${escapeHtml(plan.role)}</code>.
        Directory: <a href="${escapeHtml(dirRelative)}">${escapeHtml(dirRelative)}</a>.
        Plan JSON: <a href="${escapeHtml(handoffRelative)}">${escapeHtml(handoffRelative)}</a>.
      </p>
      <div class="chips">${promptLinks}</div>
      <ul>${handoff.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ul>
      <div class="shots">${guideFigures}</div>
    </section>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
