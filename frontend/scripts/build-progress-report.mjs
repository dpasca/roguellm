import fs from 'node:fs/promises';
import path from 'node:path';

const rootDir = path.resolve(new URL('..', import.meta.url).pathname);
const repoRoot = path.resolve(rootDir, '..');
const defaultReportPath = path.join(repoRoot, '_artifacts/visual/rain-city-production-default/report.json');
const reportPath = path.resolve(process.env.PROGRESS_VISUAL_REPORT ?? defaultReportPath);
const outPath = path.resolve(process.env.PROGRESS_OUT ?? path.join(repoRoot, '_artifacts/progress.html'));
const outDir = path.dirname(outPath);

const summary = JSON.parse(await fs.readFile(reportPath, 'utf8'));
await fs.mkdir(outDir, { recursive: true });

const compactFocus = summary.compactQualityFocus ?? inferCompactFocus(summary);
const compactProfile = summary.profileSummaries?.find((profile) => profile.id === compactFocus?.id) ?? null;
const compactAsset = summary.skinAssetSummaries?.find((asset) => asset.id === compactFocus?.id) ?? null;
const imageCards = await buildImageCards(summary, compactFocus?.id ?? 'ai-cyberdeck-reference-v1');

await fs.writeFile(outPath, buildHtml({
  summary,
  reportPath,
  compactFocus,
  compactProfile,
  compactAsset,
  imageCards
}), 'utf8');

console.log(`Wrote ${path.relative(process.cwd(), outPath)}`);

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
      kind: 'RUNTIME SCREENSHOT',
      title: 'Movement State',
      description: 'Actual Phaser canvas render from the visual inspection run.',
      image: resultImage(report, profileId, 'production-movement')
    },
    {
      kind: 'RUNTIME SCREENSHOT',
      title: 'Log Drawer',
      description: 'Actual Phaser canvas render with the top-first log drawer open.',
      image: resultImage(report, profileId, 'production-log')
    },
    {
      kind: 'RUNTIME SCREENSHOT',
      title: 'Inventory Drawer',
      description: 'Actual Phaser canvas render with inventory rows and text backplates.',
      image: resultImage(report, profileId, 'production-inventory')
    },
    {
      kind: 'RUNTIME SCREENSHOT',
      title: 'Defeat Terminal',
      description: 'Actual Phaser canvas render for the terminal end-state surface.',
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

function buildHtml({ summary, reportPath, compactFocus, compactProfile, compactAsset, imageCards }) {
  const reportRelative = path.relative(outDir, reportPath);
  const reportHtmlRelative = reportRelative.replace(/\.json$/, '.html');
  const contractRelative = path.relative(outDir, path.join(rootDir, 'src/skins/SKIN_LAYOUT_CONTRACT_V1.md'));
  const blueprintRelative = path.relative(outDir, path.join(rootDir, 'src/skins/SKIN_ART_BLUEPRINT_V1.json'));
  const profileFlags = compactProfile?.reviewFlags ?? [];
  const failures = compactFocus?.failures ?? [];
  const generatedAt = summary.generatedAt ?? 'unknown';

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
    This is a generated local evidence page, not the canonical mockup. It labels each image as runtime output,
    source art, or a guide so the current state is easier to read.
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
        <span>Generated</span>
        <strong>${escapeHtml(generatedAt)}</strong>
      </div>
    </div>
    <p class="lede">
      Source of truth: <a href="${escapeHtml(contractRelative)}">layout contract</a> and
      <a href="${escapeHtml(blueprintRelative)}">art blueprint</a>. Visual evidence:
      <a href="${escapeHtml(reportHtmlRelative)}">latest visual report</a> and
      <a href="${escapeHtml(reportRelative)}">report JSON</a>.
    </p>
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
</body>
</html>
`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
