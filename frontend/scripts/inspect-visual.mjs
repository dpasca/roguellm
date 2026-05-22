import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_URL = 'http://127.0.0.1:8127/game2?game_id=159e473b&fixture=1';
const DEFAULT_VITE_GAME_ID_URL = 'http://127.0.0.1:5273/game2?game_id=159e473b&fixture=1';
const DEFAULT_WORKBENCH_URL = 'http://127.0.0.1:5273/game2/workbench?workbench=skin';
const DEFAULT_FIXED_WORKBENCH_URL = 'http://127.0.0.1:5273/game2/workbench?workbench=fixed-skin';
const entryUrl = process.argv[2] ?? process.env.GAME2_VISUAL_URL ?? DEFAULT_URL;
const viteGameIdUrl = process.env.GAME2_VITE_GAME_ID_URL ?? DEFAULT_VITE_GAME_ID_URL;
const workbenchUrl = process.env.GAME2_WORKBENCH_URL ?? DEFAULT_WORKBENCH_URL;
const fixedWorkbenchUrl = process.env.GAME2_FIXED_WORKBENCH_URL ?? DEFAULT_FIXED_WORKBENCH_URL;
const withQueryParams = (url, params) => {
  const search = new URLSearchParams(params).toString();
  return `${url}${url.includes('?') ? '&' : '?'}${search}`;
};
const withQueryEntries = (url, entries) => {
  const nextUrl = new URL(url);
  for (const [key, value] of entries) {
    nextUrl.searchParams.append(key, value);
  }
  return nextUrl.toString();
};
const fixedWorkbenchProfileUrl = (profile) =>
  `${fixedWorkbenchUrl}${fixedWorkbenchUrl.includes('?') ? '&' : '?'}profile=${encodeURIComponent(profile)}`;
const defaultFixedProfile = 'reference-mobile-v3';
const fixedRuntimeUrl = withQueryParams(entryUrl, { ui: 'fixed-skin', profile: defaultFixedProfile });
const classicRuntimeUrl = withQueryParams(entryUrl, { ui: 'classic' });
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = process.env.VISUAL_OUT_DIR
  ? path.resolve(process.env.VISUAL_OUT_DIR)
  : path.resolve('visual-inspections', timestamp);

const scenarios = [
  {
    name: 'mobile-ready',
    viewport: { width: 390, height: 844 },
    mode: 'ready',
    url: classicRuntimeUrl
  },
  {
    name: 'mobile-combat',
    viewport: { width: 390, height: 844 },
    mode: 'combat',
    url: classicRuntimeUrl
  },
  {
    name: 'mobile-log-open',
    viewport: { width: 390, height: 844 },
    mode: 'log',
    url: classicRuntimeUrl
  },
  {
    name: 'mobile-short-ready',
    viewport: { width: 390, height: 667 },
    mode: 'ready',
    url: classicRuntimeUrl
  },
  {
    name: 'mobile-workbench',
    viewport: { width: 390, height: 844 },
    mode: 'workbench',
    url: workbenchUrl
  },
  {
    name: 'mobile-workbench-log',
    viewport: { width: 390, height: 844 },
    mode: 'workbench-log',
    url: workbenchUrl
  },
  {
    name: 'mobile-fixed-workbench',
    viewport: { width: 390, height: 844 },
    mode: 'fixed-workbench',
    url: fixedWorkbenchUrl
  },
  {
    name: 'mobile-fixed-workbench-log',
    viewport: { width: 390, height: 844 },
    mode: 'fixed-workbench-log',
    url: fixedWorkbenchUrl
  },
  {
    name: 'mobile-default-fixed-runtime-ready',
    viewport: { width: 390, height: 844 },
    mode: 'fixed-runtime-ready',
    url: entryUrl,
    expectedFixedProfile: defaultFixedProfile
  },
  {
    name: 'mobile-fixed-runtime-ready',
    viewport: { width: 390, height: 844 },
    mode: 'fixed-runtime-ready',
    url: fixedRuntimeUrl,
    expectedFixedProfile: defaultFixedProfile
  },
  {
    name: 'mobile-fixed-runtime-log',
    viewport: { width: 390, height: 844 },
    mode: 'fixed-runtime-log',
    url: fixedRuntimeUrl,
    expectedFixedProfile: defaultFixedProfile
  },
  {
    name: 'mobile-fixed-runtime-combat',
    viewport: { width: 390, height: 844 },
    mode: 'fixed-runtime-combat',
    url: fixedRuntimeUrl,
    expectedFixedProfile: defaultFixedProfile
  },
  {
    name: 'mobile-themed-amber-fixed-runtime-ready',
    viewport: { width: 390, height: 844 },
    mode: 'fixed-runtime-ready',
    url: withQueryParams(entryUrl, {
      ui: 'fixed-skin',
      skin_tags: 'industrial,relay',
      skin_mood: 'nocturnal',
      skin_palette: 'amber'
    }),
    expectedFixedProfile: 'amber-mobile'
  },
  {
    name: 'mobile-themed-signal-vite-redirect-runtime-ready',
    viewport: { width: 390, height: 844 },
    mode: 'fixed-runtime-ready',
    url: withQueryEntries(viteGameIdUrl, [
      ['ui', 'fixed-skin'],
      ['skin_tags', 'noir'],
      ['skin_tags', 'signal'],
      ['skin_mood', 'sleek'],
      ['skin_palette', 'cyan']
    ]),
    expectedFixedProfile: 'signal-noir-mobile'
  },
  {
    name: 'mobile-gold-fixed-workbench-movement',
    viewport: { width: 390, height: 844 },
    mode: 'fixed-workbench-movement',
    url: `${fixedWorkbenchProfileUrl('gold-mobile')}&scenario=movement`
  },
  {
    name: 'mobile-reference-v3-fixed-workbench-movement',
    viewport: { width: 390, height: 844 },
    mode: 'fixed-workbench-movement',
    url: `${fixedWorkbenchProfileUrl('reference-mobile-v3')}&scenario=movement`
  },
  {
    name: 'mobile-reference-v3-fixed-workbench-attack',
    viewport: { width: 390, height: 844 },
    mode: 'fixed-workbench-attack',
    url: fixedWorkbenchProfileUrl('reference-mobile-v3')
  },
  {
    name: 'mobile-reference-v3-fixed-workbench-run',
    viewport: { width: 390, height: 844 },
    mode: 'fixed-workbench-run',
    url: fixedWorkbenchProfileUrl('reference-mobile-v3')
  },
  {
    name: 'mobile-reference-v3-fixed-workbench-diagnostics',
    viewport: { width: 390, height: 844 },
    mode: 'fixed-workbench-diagnostics',
    url: `${fixedWorkbenchProfileUrl('reference-mobile-v3')}&scenario=diagnostics`
  },
  {
    name: 'mobile-reference-v3-fixed-workbench-escaped-copy',
    viewport: { width: 390, height: 844 },
    mode: 'fixed-workbench-escaped-copy',
    url: `${fixedWorkbenchProfileUrl('reference-mobile-v3')}&scenario=escaped-copy`
  },
  {
    name: 'mobile-signal-noir-fixed-workbench-diagnostics',
    viewport: { width: 390, height: 844 },
    mode: 'fixed-workbench-diagnostics',
    url: `${fixedWorkbenchProfileUrl('signal-noir-mobile')}&scenario=diagnostics`
  },
  {
    name: 'mobile-signal-noir-fixed-workbench-inventory',
    viewport: { width: 390, height: 844 },
    mode: 'fixed-workbench-inventory',
    url: fixedWorkbenchProfileUrl('signal-noir-mobile')
  },
  {
    name: 'mobile-themed-signal-fixed-workbench',
    viewport: { width: 390, height: 844 },
    mode: 'fixed-workbench',
    url: withQueryParams(fixedWorkbenchUrl, {
      skin_tags: 'noir,signal',
      skin_mood: 'sleek',
      skin_palette: 'cyan'
    }),
    expectedFixedProfile: 'signal-noir-mobile'
  },
  {
    name: 'mobile-reference-v3-fixed-workbench-inventory',
    viewport: { width: 390, height: 844 },
    mode: 'fixed-workbench-inventory',
    url: fixedWorkbenchProfileUrl('reference-mobile-v3')
  },
  {
    name: 'mobile-reference-v3-fixed-workbench-defeat',
    viewport: { width: 390, height: 844 },
    mode: 'fixed-workbench-defeat',
    url: `${fixedWorkbenchProfileUrl('reference-mobile-v3')}&scenario=defeat`
  },
  {
    name: 'mobile-reference-v3-fixed-workbench-victory',
    viewport: { width: 390, height: 844 },
    mode: 'fixed-workbench-victory',
    url: `${fixedWorkbenchProfileUrl('reference-mobile-v3')}&scenario=victory`
  },
  {
    name: 'mobile-reference-v3-fixed-workbench-restart',
    viewport: { width: 390, height: 844 },
    mode: 'fixed-workbench-restart',
    url: `${fixedWorkbenchProfileUrl('reference-mobile-v3')}&scenario=defeat`
  },
  {
    name: 'mobile-gold-fixed-workbench-diagnostics',
    viewport: { width: 390, height: 844 },
    mode: 'fixed-workbench-diagnostics',
    url: `${fixedWorkbenchProfileUrl('gold-mobile')}&scenario=diagnostics`
  },
  {
    name: 'mobile-amber-fixed-workbench-diagnostics',
    viewport: { width: 390, height: 844 },
    mode: 'fixed-workbench-diagnostics',
    url: `${fixedWorkbenchProfileUrl('amber-mobile')}&scenario=diagnostics`
  },
  {
    name: 'mobile-themed-amber-fixed-workbench',
    viewport: { width: 390, height: 844 },
    mode: 'fixed-workbench',
    url: withQueryParams(fixedWorkbenchUrl, {
      skin_tags: 'industrial,relay',
      skin_mood: 'nocturnal',
      skin_palette: 'amber'
    }),
    expectedFixedProfile: 'amber-mobile'
  },
  {
    name: 'mobile-gold-fixed-workbench-status',
    viewport: { width: 390, height: 844 },
    mode: 'fixed-workbench-status',
    url: `${fixedWorkbenchProfileUrl('gold-mobile')}&scenario=status`
  },
  {
    name: 'mobile-gold-fixed-workbench-inventory',
    viewport: { width: 390, height: 844 },
    mode: 'fixed-workbench-inventory',
    url: fixedWorkbenchProfileUrl('gold-mobile')
  },
  {
    name: 'mobile-amber-fixed-workbench-inventory',
    viewport: { width: 390, height: 844 },
    mode: 'fixed-workbench-inventory',
    url: fixedWorkbenchProfileUrl('amber-mobile')
  },
  {
    name: 'mobile-gold-fixed-workbench-inventory-use',
    viewport: { width: 390, height: 844 },
    mode: 'fixed-workbench-inventory-use',
    url: fixedWorkbenchProfileUrl('gold-mobile')
  },
  {
    name: 'mobile-gold-fixed-workbench-drawer-switch',
    viewport: { width: 390, height: 844 },
    mode: 'fixed-workbench-drawer-switch',
    url: fixedWorkbenchProfileUrl('gold-mobile')
  },
  {
    name: 'mobile-gold-fixed-workbench-defeat',
    viewport: { width: 390, height: 844 },
    mode: 'fixed-workbench-defeat',
    url: `${fixedWorkbenchProfileUrl('gold-mobile')}&scenario=defeat`
  },
  {
    name: 'mobile-gold-fixed-workbench-victory',
    viewport: { width: 390, height: 844 },
    mode: 'fixed-workbench-victory',
    url: `${fixedWorkbenchProfileUrl('gold-mobile')}&scenario=victory`
  },
  {
    name: 'mobile-gold-fixed-workbench-restart',
    viewport: { width: 390, height: 844 },
    mode: 'fixed-workbench-restart',
    url: `${fixedWorkbenchProfileUrl('gold-mobile')}&scenario=defeat`
  },
  {
    name: 'mobile-reference-fixed-workbench',
    viewport: { width: 390, height: 844 },
    mode: 'fixed-workbench',
    url: fixedWorkbenchProfileUrl('reference-mobile')
  },
  {
    name: 'mobile-reference-fixed-workbench-log',
    viewport: { width: 390, height: 844 },
    mode: 'fixed-workbench-log',
    url: fixedWorkbenchProfileUrl('reference-mobile')
  },
  {
    name: 'mobile-reference-v2-fixed-workbench',
    viewport: { width: 390, height: 844 },
    mode: 'fixed-workbench',
    url: fixedWorkbenchProfileUrl('reference-mobile-v2')
  },
  {
    name: 'mobile-reference-v2-fixed-workbench-log',
    viewport: { width: 390, height: 844 },
    mode: 'fixed-workbench-log',
    url: fixedWorkbenchProfileUrl('reference-mobile-v2')
  },
  {
    name: 'mobile-reference-v2-fixed-workbench-movement',
    viewport: { width: 390, height: 844 },
    mode: 'fixed-workbench-movement',
    url: `${fixedWorkbenchProfileUrl('reference-mobile-v2')}&scenario=movement`
  },
  {
    name: 'mobile-reference-v2-fixed-workbench-inventory',
    viewport: { width: 390, height: 844 },
    mode: 'fixed-workbench-inventory',
    url: fixedWorkbenchProfileUrl('reference-mobile-v2')
  },
  {
    name: 'mobile-reference-v2-fixed-workbench-drawer-switch',
    viewport: { width: 390, height: 844 },
    mode: 'fixed-workbench-drawer-switch',
    url: fixedWorkbenchProfileUrl('reference-mobile-v2')
  },
  {
    name: 'mobile-reference-v2-fixed-workbench-defeat',
    viewport: { width: 390, height: 844 },
    mode: 'fixed-workbench-defeat',
    url: `${fixedWorkbenchProfileUrl('reference-mobile-v2')}&scenario=defeat`
  },
  {
    name: 'mobile-reference-v2-fixed-workbench-victory',
    viewport: { width: 390, height: 844 },
    mode: 'fixed-workbench-victory',
    url: `${fixedWorkbenchProfileUrl('reference-mobile-v2')}&scenario=victory`
  },
  {
    name: 'mobile-reference-v2-fixed-workbench-restart',
    viewport: { width: 390, height: 844 },
    mode: 'fixed-workbench-restart',
    url: `${fixedWorkbenchProfileUrl('reference-mobile-v2')}&scenario=defeat`
  },
  {
    name: 'mobile-reference-v2-fixed-workbench-diagnostics',
    viewport: { width: 390, height: 844 },
    mode: 'fixed-workbench-diagnostics',
    url: `${fixedWorkbenchProfileUrl('reference-mobile-v2')}&scenario=diagnostics`
  },
  {
    name: 'desktop-ready',
    viewport: { width: 1280, height: 900 },
    mode: 'ready'
  },
  {
    name: 'desktop-workbench',
    viewport: { width: 1280, height: 900 },
    mode: 'workbench',
    url: workbenchUrl
  },
  {
    name: 'desktop-fixed-workbench',
    viewport: { width: 1280, height: 900 },
    mode: 'fixed-workbench',
    url: fixedWorkbenchUrl,
    expectedFixedProfile: 'desktop-wide'
  }
];

await fs.mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const results = [];

try {
  for (const scenario of scenarios) {
    const context = await browser.newContext({
      deviceScaleFactor: 1,
      viewport: scenario.viewport
    });
    const page = await context.newPage();
    const result = await runScenario(page, scenario);
    results.push(result);
    await context.close();
  }
} finally {
  await browser.close();
}

const summary = {
  entryUrl,
  workbenchUrl,
  fixedWorkbenchUrl,
  outDir,
  generatedAt: new Date().toISOString(),
  results,
  ok: results.every((result) => result.failures.length === 0)
};

await fs.writeFile(
  path.join(outDir, 'report.json'),
  `${JSON.stringify(summary, null, 2)}\n`,
  'utf8'
);

await fs.writeFile(
  path.join(outDir, 'report.html'),
  buildHtmlReport(summary),
  'utf8'
);

const reportLines = results.flatMap((result) => {
  const status = result.failures.length === 0 ? 'PASS' : 'FAIL';
  const header = `${status} ${result.name} -> ${path.relative(process.cwd(), result.screenshotPath)}`;
  return result.failures.length === 0
    ? [header]
    : [header, ...result.failures.map((failure) => `  - ${failure}`)];
});

console.log(`Visual inspection output: ${path.relative(process.cwd(), outDir)}`);
console.log(reportLines.join('\n'));

if (!summary.ok) {
  process.exitCode = 1;
}

function buildHtmlReport(summary) {
  const cards = summary.results.map((result) => {
    const passed = result.failures.length === 0;
    const image = path.basename(result.screenshotPath);
    const metrics = result.metrics;
    const chips = [
      metrics.fixedProfile ? `profile ${metrics.fixedProfile}` : null,
      metrics.fixedProfileRole ? `role ${metrics.fixedProfileRole}` : null,
      metrics.ui ? `ui ${metrics.ui}` : null,
      metrics.workbench ? `bench ${metrics.workbench}` : null,
      metrics.statusText ? `status ${metrics.statusText}` : null,
      Number.isFinite(metrics.mapPlayer?.x) && Number.isFinite(metrics.mapPlayer?.y)
        ? `player ${metrics.mapPlayer.x},${metrics.mapPlayer.y}`
        : null,
      metrics.logOpen ? 'log open' : null,
      metrics.inventoryOpen ? 'inventory open' : null,
      metrics.inCombat ? 'combat' : 'explore',
      metrics.screenshot ? `mean ${metrics.screenshot.mean.toFixed(3)}` : null,
      metrics.screenshot ? `contrast ${metrics.screenshot.standardDeviation.toFixed(3)}` : null,
      metrics.overflowsX || metrics.overflowsY ? 'overflow' : 'no overflow'
    ].filter(Boolean);

    return `
      <article class="card ${passed ? 'pass' : 'fail'}">
        <header>
          <span class="badge">${passed ? 'PASS' : 'FAIL'}</span>
          <div>
            <h2>${escapeHtml(result.name)}</h2>
            <p>${escapeHtml(result.mode)} / ${result.viewport.width}x${result.viewport.height}</p>
          </div>
        </header>
        <a href="${escapeHtml(image)}"><img src="${escapeHtml(image)}" alt="${escapeHtml(result.name)} screenshot"></a>
        <div class="chips">${chips.map((chip) => `<span>${escapeHtml(chip)}</span>`).join('')}</div>
        ${passed ? '' : `<ul>${result.failures.map((failure) => `<li>${escapeHtml(failure)}</li>`).join('')}</ul>`}
      </article>
    `;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>RogueLLM Visual Inspection</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #070a0a;
      color: #edf7ef;
    }
    body {
      margin: 0;
      padding: 24px;
      background:
        linear-gradient(90deg, rgba(108, 255, 91, 0.05), transparent 28%),
        radial-gradient(circle at 80% 0%, rgba(255, 156, 33, 0.09), transparent 30%),
        #070a0a;
    }
    h1 {
      margin: 0;
      font-size: 24px;
      letter-spacing: 0;
    }
    .summary {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
      margin: 8px 0 22px;
      color: #a8b7b4;
      font-size: 13px;
    }
    .summary span {
      padding: 5px 8px;
      border: 1px solid #263938;
      background: #0c1313;
    }
    main {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 18px;
    }
    .card {
      min-width: 0;
      border: 1px solid #253737;
      background: #0b1111;
      box-shadow: 0 14px 32px rgba(0, 0, 0, 0.28);
    }
    .card header {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 10px;
      align-items: center;
      padding: 10px;
      border-bottom: 1px solid #1d2a2a;
    }
    .badge {
      padding: 4px 7px;
      color: #071007;
      font-size: 11px;
      font-weight: 900;
      background: #73ff63;
    }
    .fail .badge {
      background: #ff6679;
    }
    h2 {
      overflow: hidden;
      margin: 0 0 2px;
      font-size: 13px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    p {
      margin: 0;
      color: #8d9b99;
      font-size: 12px;
    }
    img {
      display: block;
      width: 100%;
      height: auto;
      background: #040707;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      padding: 10px;
    }
    .chips span {
      padding: 3px 6px;
      border: 1px solid #203332;
      color: #bfffc0;
      font-size: 11px;
      background: #07100e;
    }
    ul {
      margin: 0;
      padding: 0 14px 14px 28px;
      color: #ffc3cb;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <h1>RogueLLM Visual Inspection</h1>
  <div class="summary">
    <span>${summary.ok ? 'All scenarios passed' : 'Failures detected'}</span>
    <span>${summary.results.length} scenarios</span>
    <span>${escapeHtml(summary.generatedAt)}</span>
  </div>
  <main>${cards}</main>
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

async function runScenario(page, scenario) {
  const failures = [];

  await page.goto(scenario.url ?? entryUrl, { waitUntil: 'domcontentloaded' });
  if (scenario.mode.startsWith('fixed-workbench')) {
    await waitForFixedWorkbenchReady(page);
  } else if (scenario.mode.startsWith('fixed-runtime')) {
    await waitForFixedRuntimeReady(page);
  } else if (scenario.mode.startsWith('workbench')) {
    await waitForWorkbenchReady(page);
  } else {
    await waitForGameReady(page);
  }

  if (scenario.mode === 'combat') {
    await page.getByRole('button', { name: 'E', exact: true }).click();
    await waitForCombatReady(page);
  }

  if (
    scenario.mode === 'log' ||
    scenario.mode === 'workbench-log' ||
    scenario.mode === 'fixed-workbench-log' ||
    scenario.mode === 'fixed-runtime-log'
  ) {
    await page.getByRole('button', { name: 'Log', exact: true }).click();
    await waitForLogOpen(page);
  }

  if (scenario.mode === 'fixed-runtime-combat') {
    await enterFixedRuntimeCombat(page);
  }

  if (scenario.mode === 'fixed-workbench-movement') {
    await page.getByRole('button', { name: 'E', exact: true }).click();
    await waitForFixedMovement(page);
  }

  if (scenario.mode === 'fixed-workbench-attack') {
    await page.getByRole('button', { name: 'Attack', exact: true }).click();
    await waitForFixedAttack(page);
  }

  if (scenario.mode === 'fixed-workbench-run') {
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await waitForFixedRun(page);
  }

  if (scenario.mode === 'fixed-workbench-diagnostics') {
    await waitForFixedDiagnostics(page);
  }

  if (scenario.mode === 'fixed-workbench-status') {
    await waitForFixedStatus(page);
  }

  if (scenario.mode === 'fixed-workbench-inventory' || scenario.mode === 'fixed-workbench-inventory-use') {
    await page.getByRole('button', { name: 'Inventory', exact: true }).click();
    await waitForFixedInventory(page);
  }

  if (scenario.mode === 'fixed-workbench-inventory-use') {
    await page.getByRole('button', { name: 'Use', exact: true }).click();
    await waitForFixedInventoryUse(page);
  }

  if (scenario.mode === 'fixed-workbench-drawer-switch') {
    await page.getByRole('button', { name: 'Inventory', exact: true }).click();
    await waitForFixedInventory(page);
    await page.getByRole('button', { name: 'Log', exact: true }).click();
    await waitForFixedDrawerSwitch(page);
  }

  if (
    scenario.mode === 'fixed-workbench-defeat' ||
    scenario.mode === 'fixed-workbench-victory' ||
    scenario.mode === 'fixed-workbench-restart'
  ) {
    await waitForFixedEndState(page, scenario.mode.endsWith('victory') ? 'victory' : 'defeat');
  }

  if (scenario.mode === 'fixed-workbench-restart') {
    await page.getByRole('button', { name: 'Restart', exact: true }).click();
    await waitForFixedRestarted(page);
  }

  await page.waitForTimeout(300);

  const screenshotPath = path.join(outDir, `${scenario.name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });

  const screenshotMetrics = collectScreenshotMetrics(screenshotPath);
  const metrics = {
    ...await collectMetrics(page),
    screenshot: screenshotMetrics
  };
  failures.push(...validateMetrics(scenario, metrics));

  return {
    name: scenario.name,
    viewport: scenario.viewport,
    mode: scenario.mode,
    screenshotPath,
    metrics,
    failures
  };
}

function collectScreenshotMetrics(screenshotPath) {
  const output = execFileSync(
    'magick',
    [
      screenshotPath,
      '-format',
      '%[fx:mean]\n%[fx:standard_deviation]',
      'info:'
    ],
    { encoding: 'utf8' }
  );
  const [mean, standardDeviation] = output.trim().split(/\s+/).map(Number);

  return {
    mean,
    standardDeviation
  };
}

async function waitForGameReady(page) {
  await page.waitForFunction(() => {
    const status = document.getElementById('connection-status')?.textContent?.trim();
    const latest = document.getElementById('latest-message')?.textContent?.trim();
    return status === 'ready' && latest && latest !== 'Connecting...';
  }, null, { timeout: 20_000 });
}

async function waitForCombatReady(page) {
  await page.waitForFunction(() => {
    const status = document.getElementById('connection-status')?.textContent?.trim();
    const inCombat = document.body.classList.contains('in-combat');
    const attack = document.getElementById('attack');
    const run = document.getElementById('run');
    return status === 'ready' &&
      inCombat &&
      attack instanceof HTMLButtonElement &&
      run instanceof HTMLButtonElement &&
      !attack.disabled &&
      !run.disabled;
  }, null, { timeout: 20_000 });
}

async function waitForLogOpen(page) {
  await page.waitForFunction(() => {
    const status = document.getElementById('connection-status')?.textContent?.trim();
    return !!status && document.body.classList.contains('log-open');
  }, null, { timeout: 20_000 });
}

async function waitForWorkbenchReady(page) {
  await page.waitForFunction(() => {
    const status = document.getElementById('connection-status')?.textContent?.trim();
    const latest = document.getElementById('latest-message')?.textContent?.trim();
    return document.body.dataset.workbench === 'skin' &&
      document.body.classList.contains('workbench-mode') &&
      status === 'bench' &&
      latest &&
      latest !== 'Connecting...';
  }, null, { timeout: 20_000 });
}

async function waitForFixedWorkbenchReady(page) {
  await page.waitForFunction(() => {
    const status = document.getElementById('connection-status')?.textContent?.trim();
    const latest = document.getElementById('latest-message')?.textContent?.trim();
    return document.body.dataset.workbench === 'fixed-skin' &&
      document.body.classList.contains('fixed-workbench-mode') &&
      status &&
      latest &&
      latest !== 'Connecting...';
  }, null, { timeout: 20_000 });
}

async function waitForFixedRuntimeReady(page) {
  await page.waitForFunction(() => {
    const status = document.getElementById('connection-status')?.textContent?.trim();
    const latest = document.getElementById('latest-message')?.textContent?.trim();
    return document.body.dataset.ui === 'fixed-skin' &&
      document.body.classList.contains('fixed-runtime-mode') &&
      status === 'READY' &&
      latest &&
      latest !== 'Connecting...';
  }, null, { timeout: 20_000 });
}

async function waitForFixedRuntimeCombat(page) {
  await waitForFixedRuntimeCombatReady(page, 20_000);
}

async function enterFixedRuntimeCombat(page) {
  if (await isFixedRuntimeCombatReady(page)) {
    return;
  }

  for (const direction of ['E', 'S', 'N', 'W', 'E', 'S', 'W', 'N']) {
    const button = page.getByRole('button', { name: direction, exact: true });
    const enabled = await button.isEnabled().catch(() => false);
    if (!enabled) {
      continue;
    }

    await button.click();
    try {
      await waitForFixedRuntimeCombatReady(page, 7_000);
      return;
    } catch {
      await waitForFixedRuntimeReady(page);
      if (await isFixedRuntimeCombatReady(page)) {
        return;
      }
    }
  }

  await waitForFixedRuntimeCombatReady(page, 10_000);
}

async function waitForFixedRuntimeCombatReady(page, timeout) {
  await page.waitForFunction(() => {
    const status = document.getElementById('connection-status')?.textContent?.trim();
    const attack = document.getElementById('attack');
    const run = document.getElementById('run');
    return document.body.dataset.ui === 'fixed-skin' &&
      document.body.classList.contains('fixed-runtime-mode') &&
      document.body.classList.contains('in-combat') &&
      status === 'READY' &&
      attack instanceof HTMLButtonElement &&
      run instanceof HTMLButtonElement &&
      !attack.disabled &&
      !run.disabled;
  }, null, { timeout });
}

async function isFixedRuntimeCombatReady(page) {
  return page.evaluate(() => {
    const status = document.getElementById('connection-status')?.textContent?.trim();
    const attack = document.getElementById('attack');
    const run = document.getElementById('run');
    return document.body.dataset.ui === 'fixed-skin' &&
      document.body.classList.contains('fixed-runtime-mode') &&
      document.body.classList.contains('in-combat') &&
      status === 'READY' &&
      attack instanceof HTMLButtonElement &&
      run instanceof HTMLButtonElement &&
      !attack.disabled &&
      !run.disabled;
  });
}

async function waitForFixedMovement(page) {
  await page.waitForFunction(() => {
    const latest = document.getElementById('latest-message')?.textContent?.trim();
    const map = document.getElementById('game-canvas');
    return document.body.dataset.fixedScenario === 'movement' &&
      !document.body.classList.contains('in-combat') &&
      latest?.includes('moved E') &&
      map?.dataset.playerX === '6' &&
      map?.dataset.playerY === '3';
  }, null, { timeout: 20_000 });
}

async function waitForFixedAttack(page) {
  await page.waitForFunction(() => {
    const latest = document.getElementById('latest-message')?.textContent?.trim();
    return document.body.dataset.fixedScenario === 'combat' &&
      document.body.classList.contains('in-combat') &&
      latest?.includes('ATTACK clicked') &&
      document.getElementById('enemy-hp')?.textContent?.trim() === '37/82';
  }, null, { timeout: 20_000 });
}

async function waitForFixedRun(page) {
  await page.waitForFunction(() => {
    const latest = document.getElementById('latest-message')?.textContent?.trim();
    const map = document.getElementById('game-canvas');
    return document.body.dataset.fixedScenario === 'combat' &&
      !document.body.classList.contains('in-combat') &&
      latest?.includes('RUN clicked') &&
      map?.dataset.playerX === '5' &&
      map?.dataset.playerY === '3' &&
      document.getElementById('combat-mode-label')?.textContent?.trim() === 'Explore' &&
      document.getElementById('enemy-name')?.textContent?.trim() === 'No hostile';
  }, null, { timeout: 20_000 });
}

async function waitForFixedDiagnostics(page) {
  await page.waitForFunction(() => {
    return document.body.dataset.fixedScenario === 'diagnostics' &&
      document.querySelectorAll('.fixed-diagnostics-board img').length >= 30;
  }, null, { timeout: 20_000 });
}

async function waitForFixedStatus(page) {
  await page.waitForFunction(() => {
    return document.body.dataset.fixedScenario === 'status' &&
      document.getElementById('connection-status')?.textContent?.trim() === 'WAIT' &&
      document.getElementById('attack')?.disabled &&
      document.getElementById('run')?.disabled;
  }, null, { timeout: 20_000 });
}

async function waitForFixedInventory(page) {
  await page.waitForFunction(() => {
    return document.body.classList.contains('fixed-inventory-open') &&
      document.querySelectorAll('#inventory-list .fixed-inventory-item').length >= 3 &&
      Array.from(document.querySelectorAll('#inventory-list button')).some((button) => button.textContent?.trim() === 'Use');
  }, null, { timeout: 20_000 });
}

async function waitForFixedInventoryUse(page) {
  await page.waitForFunction(() => {
    return document.body.classList.contains('fixed-inventory-open') &&
      document.getElementById('player-hp')?.textContent?.trim() === '55/100';
  }, null, { timeout: 20_000 });
}

async function waitForFixedDrawerSwitch(page) {
  await page.waitForFunction(() => {
    return document.body.classList.contains('fixed-log-open') &&
      document.body.classList.contains('log-open') &&
      !document.body.classList.contains('fixed-inventory-open') &&
      document.querySelector('#game-log p.latest');
  }, null, { timeout: 20_000 });
}

async function waitForFixedEndState(page, expected) {
  await page.waitForFunction((expectedState) => {
    const overlay = document.getElementById('end-state-overlay');
    const restart = document.getElementById('restart');
    const stage = document.querySelector('.fixed-skin-stage');
    return document.body.dataset.fixedScenario === expectedState &&
      document.body.classList.contains('game-ended') &&
      overlay instanceof HTMLElement &&
      !overlay.hidden &&
      restart instanceof HTMLButtonElement &&
      !restart.hidden &&
      !restart.disabled &&
      stage?.classList.contains(expectedState === 'victory' ? 'fixed-victory-state' : 'fixed-defeat-state');
  }, expected, { timeout: 20_000 });
}

async function waitForFixedRestarted(page) {
  await page.waitForFunction(() => {
    const overlay = document.getElementById('end-state-overlay');
    const restart = document.getElementById('restart');
    return document.body.dataset.fixedScenario === 'defeat' &&
      !document.body.classList.contains('game-ended') &&
      document.body.classList.contains('in-combat') &&
      overlay instanceof HTMLElement &&
      overlay.hidden &&
      restart instanceof HTMLButtonElement &&
      restart.hidden &&
      restart.disabled;
  }, null, { timeout: 20_000 });
}

async function collectMetrics(page) {
  return page.evaluate(() => {
    const selectorMap = {
      shell: '.shell',
      map: '#game-canvas',
      hud: '.hud',
      latestPanel: '.latest-message-panel',
      latestMessage: '#latest-message',
      playerPanel: '.player-panel',
      statAttack: '.fixed-stat-row span:nth-child(1)',
      statDefense: '.fixed-stat-row span:nth-child(2)',
      statXp: '.fixed-stat-row span:nth-child(3)',
      tileStatValue: '.fixed-stat-row span:nth-child(4) strong',
      combatPanel: '#combat-panel',
      controlsPanel: '.controls-panel',
      logPanel: '#log-panel',
      firstLogEntry: '#game-log p.latest',
      inventoryPanel: '.inventory-panel',
      firstInventoryItem: '#inventory-list .inventory-item',
      firstInventoryAction: '#inventory-list button',
      statusPill: '#connection-status',
      attackButton: '#attack',
      runButton: '#run',
      logToggleButton: '#fixed-log-toggle',
      inventoryToggleButton: '#fixed-inventory-toggle',
      moveNorthButton: '#move-n',
      moveSouthButton: '#move-s',
      moveEastButton: '#move-e',
      moveWestButton: '#move-w',
      restartButton: '#restart',
      endStateOverlay: '#end-state-overlay',
      endStatePanel: '.fixed-end-state-panel',
      diagnosticsBoard: '.fixed-diagnostics-board'
    };

    const rectFor = (selector) => {
      const element = document.querySelector(selector);
      if (!element) {
        return null;
      }

      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        top: Math.round(box.top),
        right: Math.round(box.right),
        bottom: Math.round(box.bottom),
        left: Math.round(box.left),
        width: Math.round(box.width),
        height: Math.round(box.height),
        visibleHeight: Math.round(Math.max(0, Math.min(box.bottom, innerHeight) - Math.max(box.top, 0))),
        visibleWidth: Math.round(Math.max(0, Math.min(box.right, innerWidth) - Math.max(box.left, 0))),
        clientWidth: element.clientWidth,
        clientHeight: element.clientHeight,
        scrollWidth: element.scrollWidth,
        scrollHeight: element.scrollHeight,
        display: style.display,
        opacity: style.opacity,
        backgroundImage: style.backgroundImage,
        backgroundRepeat: style.backgroundRepeat,
        backgroundSize: style.backgroundSize,
        borderImageSource: style.borderImageSource,
        borderImageRepeat: style.borderImageRepeat,
        borderImageSlice: style.borderImageSlice,
        visualState: element instanceof HTMLElement ? element.dataset.visualState ?? null : null
      };
    };

    const rects = Object.fromEntries(
      Object.entries(selectorMap).map(([name, selector]) => [name, rectFor(selector)])
    );

    const collectMapIconStacks = () => {
      const groups = new Map();
      for (const icon of document.querySelectorAll('.map-icon-overlay i[data-map-role]')) {
        const box = icon.getBoundingClientRect();
        const tile = `${icon.dataset.mapX},${icon.dataset.mapY}`;
        const entry = {
          role: icon.dataset.mapRole,
          centerX: Math.round(box.left + box.width / 2),
          centerY: Math.round(box.top + box.height / 2)
        };
        groups.set(tile, [...(groups.get(tile) ?? []), entry]);
      }

      return Array.from(groups.entries())
        .filter(([, icons]) => icons.length > 1)
        .map(([tile, icons]) => ({ tile, icons }));
    };

    return {
      viewport: { width: innerWidth, height: innerHeight },
      documentHeight: document.documentElement.scrollHeight,
      documentWidth: document.documentElement.scrollWidth,
      overflowsY: document.documentElement.scrollHeight > innerHeight,
      overflowsX: document.documentElement.scrollWidth > innerWidth,
      skin: document.body.dataset.skin ?? null,
      workbench: document.body.dataset.workbench ?? null,
      ui: document.body.dataset.ui ?? null,
      fixedProfile: document.body.dataset.fixedProfile ?? null,
      fixedProfileRole: document.querySelector('.fixed-skin-stage')?.dataset.profileRole ?? null,
      fixedScenario: document.body.dataset.fixedScenario ?? null,
      inCombat: document.body.classList.contains('in-combat'),
      gameEnded: document.body.classList.contains('game-ended'),
      logOpen: document.body.classList.contains('log-open'),
      inventoryOpen: document.body.classList.contains('fixed-inventory-open'),
      statusText: document.getElementById('connection-status')?.textContent?.trim() ?? '',
      titleText: document.getElementById('fixed-title')?.textContent?.trim() ?? '',
      titleIconClass: document.querySelector('#fixed-title i')?.className ?? '',
      latestText: document.getElementById('latest-message')?.textContent?.trim() ?? '',
      latestTextLength: document.getElementById('latest-message')?.textContent?.trim().length ?? 0,
      playerHpText: document.getElementById('player-hp')?.textContent?.trim() ?? '',
      mapPlayer: {
        x: Number(document.getElementById('game-canvas')?.dataset.playerX ?? NaN),
        y: Number(document.getElementById('game-canvas')?.dataset.playerY ?? NaN),
        width: Number(document.getElementById('game-canvas')?.dataset.mapWidth ?? NaN),
        height: Number(document.getElementById('game-canvas')?.dataset.mapHeight ?? NaN),
        inCombat: document.getElementById('game-canvas')?.dataset.inCombat ?? null
      },
      tileStatText: document.querySelector('.fixed-stat-row span:nth-child(4) strong')?.textContent?.trim() ?? '',
      combatTitleText: document.getElementById('combat-mode-label')?.textContent?.trim() ?? '',
      enemyNameText: document.getElementById('enemy-name')?.textContent?.trim() ?? '',
      enemyHpText: document.getElementById('enemy-hp')?.textContent?.trim() ?? '',
      unsafeMarkupCount: document.querySelectorAll('#fixed-title img, #fixed-title script, #fixed-player-stats b, #game-log script, #enemy-name script').length,
      diagnosticAssetCount: document.querySelectorAll('.fixed-diagnostics-board img').length,
      endStateText: document.getElementById('end-state-message')?.textContent?.trim() ?? '',
      mapIconStacks: collectMapIconStacks(),
      controlStates: {
        attackDisabled: document.getElementById('attack')?.disabled ?? null,
        runDisabled: document.getElementById('run')?.disabled ?? null,
        moveNDisabled: document.getElementById('move-n')?.disabled ?? null,
        moveSDisabled: document.getElementById('move-s')?.disabled ?? null,
        moveEDisabled: document.getElementById('move-e')?.disabled ?? null,
        moveWDisabled: document.getElementById('move-w')?.disabled ?? null,
        restartDisabled: document.getElementById('restart')?.disabled ?? null,
        restartHidden: document.getElementById('restart')?.hidden ?? null
      },
      rects
    };
  });
}

function validateMetrics(scenario, metrics) {
  const failures = [];
  const isMobile = scenario.viewport.width <= 860;
  const isFixedWorkbench = scenario.mode.startsWith('fixed-workbench');
  const isFixedUi = isFixedWorkbench || scenario.mode.startsWith('fixed-runtime');

  if (metrics.skin !== 'neo-tokyo-console') {
    failures.push(`expected neo-tokyo-console skin, got ${metrics.skin ?? 'none'}`);
  }

  if (metrics.overflowsY) {
    failures.push(`document overflows vertically: ${metrics.documentHeight}px > ${metrics.viewport.height}px`);
  }

  if (metrics.overflowsX) {
    failures.push(`document overflows horizontally: ${metrics.documentWidth}px > ${metrics.viewport.width}px`);
  }

  const controls = metrics.rects.controlsPanel;
  const player = metrics.rects.playerPanel;
  if (controls && player && controls.top < player.bottom && controls.visibleHeight > 0 && player.visibleHeight > 0) {
    failures.push('controls overlap player panel');
  }

  if (controls && controls.bottom > metrics.viewport.height + 1) {
    failures.push(`controls extend below viewport: bottom=${controls.bottom}`);
  }

  if (isMobile) {
    const latest = metrics.rects.latestMessage;
    if (isFixedUi && (metrics.logOpen || metrics.inventoryOpen)) {
      // Fixed skins swap the latest LCD for the full log module when opened.
    } else if (!latest || latest.display === 'none') {
      failures.push('mobile latest message is not visible');
    } else if (latest.visibleHeight < (isCompactFixedProfile(metrics.fixedProfile) ? 40 : 56)) {
      failures.push(`mobile latest message is too short: ${latest.visibleHeight}px visible`);
    }

    if (!isFixedUi) {
      const log = metrics.rects.logPanel;
      if (!log || log.display === 'none') {
        failures.push('mobile log drawer is missing from DOM');
      } else if (!metrics.logOpen && (Number(log.opacity) > 0.01 || log.visibleHeight > 2)) {
        failures.push(`mobile log drawer leaks while closed: opacity=${log.opacity}, visibleHeight=${log.visibleHeight}px`);
      }
    }

    if (scenario.mode === 'log') {
      const log = metrics.rects.logPanel;
      if (!metrics.logOpen) {
        failures.push('mobile log scenario did not open the log drawer');
      }
      if (!log || log.visibleHeight < 260) {
        failures.push(`mobile open log is too small: ${log?.visibleHeight ?? 0}px visible`);
      }
      const firstEntry = metrics.rects.firstLogEntry;
      if (!firstEntry || firstEntry.visibleHeight < 48) {
        failures.push(`mobile open log first entry is clipped: ${firstEntry?.visibleHeight ?? 0}px visible`);
      }
    }
  } else {
    const latestPanel = metrics.rects.latestPanel;
    if (!isFixedWorkbench && latestPanel && latestPanel.display !== 'none') {
      failures.push('desktop should hide mobile latest panel');
    }

    const log = metrics.rects.logPanel;
    if (!isFixedWorkbench && (!log || log.visibleHeight < 160)) {
      failures.push(`desktop log is too small: ${log?.visibleHeight ?? 0}px visible`);
    }

    if (scenario.mode === 'desktop-fixed-workbench') {
      validateFixedStatLabels(metrics, failures);
    }
  }

  if (scenario.mode === 'combat') {
    validateCombatScenario(metrics, failures);
  }

  if (scenario.mode.startsWith('workbench')) {
    validateWorkbenchScenario(scenario, metrics, failures);
  }

  if (scenario.mode.startsWith('fixed-workbench')) {
    validateFixedWorkbenchScenario(scenario, metrics, failures);
  }

  if (scenario.mode.startsWith('fixed-runtime')) {
    validateFixedRuntimeScenario(scenario, metrics, failures);
  }

  if (isFixedUi) {
    validateFixedScreenshotQuality(metrics, failures);
  }

  failures.push(...validateAssetUsage(metrics));
  failures.push(...validateMapIconStacking(metrics));
  return failures;
}

function validateMapIconStacking(metrics) {
  const failures = [];

  for (const stack of metrics.mapIconStacks ?? []) {
    const cell = stack.icons.find((icon) => icon.role === 'cell');
    if (!cell) {
      continue;
    }

    for (const icon of stack.icons) {
      if (icon.role === 'cell') {
        continue;
      }

      const delta = Math.hypot(icon.centerX - cell.centerX, icon.centerY - cell.centerY);
      if (delta < 4) {
        failures.push(`map ${icon.role} icon overlaps cell icon center at ${stack.tile}: delta=${delta.toFixed(1)}px`);
      }
    }
  }

  return failures;
}

function validateFixedScreenshotQuality(metrics, failures) {
  const screenshot = metrics.screenshot;
  if (!screenshot || !Number.isFinite(screenshot.mean) || !Number.isFinite(screenshot.standardDeviation)) {
    failures.push('fixed skin screenshot metrics are missing');
    return;
  }

  if (screenshot.mean < 0.045) {
    failures.push(`fixed skin screenshot is too dark: mean=${screenshot.mean.toFixed(4)}`);
  }

  if (screenshot.standardDeviation < 0.09) {
    failures.push(`fixed skin screenshot is too flat: contrast=${screenshot.standardDeviation.toFixed(4)}`);
  }
}

function validateFixedRuntimeScenario(scenario, metrics, failures) {
  if (metrics.ui !== 'fixed-skin') {
    failures.push(`expected fixed-skin runtime ui, got ${metrics.ui ?? 'none'}`);
  }

  if (metrics.workbench) {
    failures.push(`fixed runtime should not be in workbench mode: ${metrics.workbench}`);
  }

  const expectedProfile = scenario.expectedFixedProfile ?? defaultFixedProfile;
  if (metrics.fixedProfile !== expectedProfile) {
    failures.push(`expected ${expectedProfile} runtime profile, got ${metrics.fixedProfile ?? 'none'}`);
  }

  if (metrics.statusText !== 'READY') {
    failures.push(`expected fixed runtime READY status, got ${metrics.statusText}`);
  }

  if (metrics.latestTextLength < 30) {
    failures.push('fixed runtime latest message is too short to inspect');
  }

  if (scenario.mode === 'fixed-runtime-combat' && !metrics.inCombat) {
    failures.push('fixed runtime combat scenario did not enter combat');
  }

  if (metrics.inCombat && metrics.combatTitleText !== 'Combat') {
    failures.push(`fixed runtime combat panel should say Combat, got ${metrics.combatTitleText || 'empty'}`);
  }

  if (metrics.inCombat && (!metrics.enemyNameText || metrics.enemyNameText === 'No hostile' || metrics.enemyNameText === 'No enemy')) {
    failures.push(`fixed runtime combat enemy row is not populated: ${metrics.enemyNameText || 'empty'}`);
  }

  if (metrics.inCombat && (metrics.controlStates.attackDisabled || metrics.controlStates.runDisabled)) {
    failures.push('fixed runtime combat controls are unexpectedly disabled');
  }

  if (!metrics.inCombat && metrics.combatTitleText !== 'Explore') {
    failures.push(`fixed runtime non-combat panel should say Explore, got ${metrics.combatTitleText || 'empty'}`);
  }

  if (!metrics.inCombat && metrics.enemyNameText !== 'No hostile') {
    failures.push(`fixed runtime non-combat enemy row should say No hostile, got ${metrics.enemyNameText || 'empty'}`);
  }

  const map = metrics.rects.map;
  if (!map || map.visibleWidth < 300 || map.visibleHeight < 250) {
    failures.push(`fixed runtime map is too small: ${map?.visibleWidth ?? 0}x${map?.visibleHeight ?? 0}`);
  }

  validateCompactMobileLayout(metrics, failures);
}

function validateCombatScenario(metrics, failures) {
  if (!metrics.inCombat) {
    failures.push('combat scenario did not enter combat');
  }

  const combat = metrics.rects.combatPanel;
  if (!combat || combat.visibleHeight < 56) {
    failures.push(`combat panel is too small: ${combat?.visibleHeight ?? 0}px visible`);
  }
}

function validateWorkbenchScenario(scenario, metrics, failures) {
  const isMobile = scenario.viewport.width <= 860;

  if (metrics.workbench !== 'skin') {
    failures.push(`expected skin workbench mode, got ${metrics.workbench ?? 'none'}`);
  }

  if (metrics.statusText !== 'bench') {
    failures.push(`expected bench status text, got ${metrics.statusText}`);
  }

  validateCombatScenario(metrics, failures);

  if (!metrics.latestTextLength || metrics.latestTextLength < 40) {
    failures.push('workbench latest message is too short to inspect text treatment');
  }

  if (scenario.mode === 'workbench-log') {
    const log = metrics.rects.logPanel;
    const firstEntry = metrics.rects.firstLogEntry;
    if (!metrics.logOpen) {
      failures.push('workbench log scenario did not open the log drawer');
    }
    if (!log || log.visibleHeight < 260) {
      failures.push(`workbench open log is too small: ${log?.visibleHeight ?? 0}px visible`);
    }
    if (!firstEntry || firstEntry.visibleHeight < 48) {
      failures.push(`workbench open log first entry is clipped: ${firstEntry?.visibleHeight ?? 0}px visible`);
    }
  }

  if (!isMobile) {
    const inventory = metrics.rects.inventoryPanel;
    const item = metrics.rects.firstInventoryItem;
    if (!inventory || inventory.visibleHeight < 72) {
      failures.push(`desktop workbench inventory is too small: ${inventory?.visibleHeight ?? 0}px visible`);
    }
    if (!item || item.visibleHeight < 40) {
      failures.push(`desktop workbench inventory item is clipped: ${item?.visibleHeight ?? 0}px visible`);
    }
  }
}

function validateFixedWorkbenchScenario(scenario, metrics, failures) {
  const isCompactProfile = isCompactFixedProfile(metrics.fixedProfile);
  const isProductionMobileProfile = isProductionFixedProfile(metrics.fixedProfileRole);
  const isMovementScenario = scenario.mode === 'fixed-workbench-movement';
  const isAttackScenario = scenario.mode === 'fixed-workbench-attack';
  const isRunScenario = scenario.mode === 'fixed-workbench-run';
  const isDiagnosticsScenario = scenario.mode === 'fixed-workbench-diagnostics';
  const isEscapedCopyScenario = scenario.mode === 'fixed-workbench-escaped-copy';
  const isStatusScenario = scenario.mode === 'fixed-workbench-status';
  const isInventoryScenario = scenario.mode === 'fixed-workbench-inventory' || scenario.mode === 'fixed-workbench-inventory-use';
  const isDrawerSwitchScenario = scenario.mode === 'fixed-workbench-drawer-switch';
  const isLogScenario = scenario.mode === 'fixed-workbench-log' || isDrawerSwitchScenario;
  const isEndStateScenario = scenario.mode === 'fixed-workbench-defeat' || scenario.mode === 'fixed-workbench-victory';
  const isRestartScenario = scenario.mode === 'fixed-workbench-restart';

  if (metrics.workbench !== 'fixed-skin') {
    failures.push(`expected fixed skin workbench mode, got ${metrics.workbench ?? 'none'}`);
  }

  if (!metrics.fixedProfile) {
    failures.push('fixed workbench did not select a fixed profile');
  }

  if (scenario.expectedFixedProfile && metrics.fixedProfile !== scenario.expectedFixedProfile) {
    failures.push(
      `expected ${scenario.expectedFixedProfile} workbench profile, got ${metrics.fixedProfile ?? 'none'}`
    );
  }

  if (!isMovementScenario && !isRunScenario && !isEndStateScenario && !isRestartScenario && !metrics.inCombat) {
    failures.push('fixed workbench did not render the combat state');
  }

  if (isMovementScenario) {
    if (metrics.fixedScenario !== 'movement') {
      failures.push(`expected movement scenario, got ${metrics.fixedScenario ?? 'none'}`);
    }
    if (metrics.inCombat) {
      failures.push('movement scenario is still in combat');
    }
    if (!metrics.latestText.includes('moved E')) {
      failures.push('movement scenario did not move east');
    }
    if (metrics.mapPlayer?.x !== 6 || metrics.mapPlayer?.y !== 3) {
      failures.push(`movement scenario player marker did not reach 6,3: ${metrics.mapPlayer?.x},${metrics.mapPlayer?.y}`);
    }
    if (metrics.combatTitleText !== 'Explore' || metrics.enemyNameText !== 'No hostile') {
      failures.push(`movement scenario should show exploration panel, got ${metrics.combatTitleText}/${metrics.enemyNameText}`);
    }
  }

  if (isAttackScenario) {
    if (metrics.fixedScenario !== 'combat') {
      failures.push(`expected combat scenario for attack, got ${metrics.fixedScenario ?? 'none'}`);
    }
    if (!metrics.latestText.includes('ATTACK clicked')) {
      failures.push('attack scenario did not report the attack action');
    }
    if (metrics.enemyHpText !== '37/82') {
      failures.push(`attack scenario did not reduce enemy HP to 37/82, got ${metrics.enemyHpText || 'empty'}`);
    }
    if (!metrics.inCombat) {
      failures.push('attack scenario left combat unexpectedly');
    }
  }

  if (isRunScenario) {
    if (metrics.fixedScenario !== 'combat') {
      failures.push(`expected combat scenario for run, got ${metrics.fixedScenario ?? 'none'}`);
    }
    if (!metrics.latestText.includes('RUN clicked')) {
      failures.push('run scenario did not report the run action');
    }
    if (metrics.inCombat) {
      failures.push('run scenario stayed in combat');
    }
    if (metrics.mapPlayer?.x !== 5 || metrics.mapPlayer?.y !== 3) {
      failures.push(`run scenario player marker did not reach 5,3: ${metrics.mapPlayer?.x},${metrics.mapPlayer?.y}`);
    }
    if (metrics.combatTitleText !== 'Explore' || metrics.enemyNameText !== 'No hostile') {
      failures.push(`run scenario should show exploration panel, got ${metrics.combatTitleText}/${metrics.enemyNameText}`);
    }
    if (!metrics.controlStates.attackDisabled || !metrics.controlStates.runDisabled) {
      failures.push('run scenario leaves combat buttons enabled');
    }
  }

  if (isDiagnosticsScenario) {
    if (metrics.fixedScenario !== 'diagnostics') {
      failures.push(`expected diagnostics scenario, got ${metrics.fixedScenario ?? 'none'}`);
    }
    if (metrics.diagnosticAssetCount < 30) {
      failures.push(`diagnostics board is missing assets: ${metrics.diagnosticAssetCount}`);
    }
    const diagnostics = metrics.rects.diagnosticsBoard;
    if (!diagnostics || diagnostics.visibleHeight < 240 || diagnostics.visibleWidth < 300) {
      failures.push(`diagnostics board is too small: ${diagnostics?.visibleWidth ?? 0}x${diagnostics?.visibleHeight ?? 0}`);
    }
  }

  if (isEscapedCopyScenario) {
    if (metrics.fixedScenario !== 'escaped-copy') {
      failures.push(`expected escaped-copy scenario, got ${metrics.fixedScenario ?? 'none'}`);
    }
    if (!metrics.titleText.includes('<img>')) {
      failures.push(`escaped title markup was not preserved as text: ${metrics.titleText || 'empty'}`);
    }
    if (!metrics.titleIconClass.includes('fa-user-secret')) {
      failures.push(`malformed title icon did not fall back to a visible Font Awesome icon: ${metrics.titleIconClass || 'empty'}`);
    }
    if (metrics.tileStatText !== 'Glass <Hotel>') {
      failures.push(`escaped tile markup was not preserved as text: ${metrics.tileStatText || 'empty'}`);
    }
    if (metrics.enemyNameText !== 'Chrome <Oni>') {
      failures.push(`escaped enemy markup was not preserved as text: ${metrics.enemyNameText || 'empty'}`);
    }
    if (!metrics.latestText.includes('<script>')) {
      failures.push(`escaped log markup was not preserved as text: ${metrics.latestText || 'empty'}`);
    }
    if (metrics.unsafeMarkupCount !== 0) {
      failures.push(`escaped copy created unsafe markup nodes: ${metrics.unsafeMarkupCount}`);
    }
  }

  if (isStatusScenario) {
    if (metrics.fixedScenario !== 'status') {
      failures.push(`expected status scenario, got ${metrics.fixedScenario ?? 'none'}`);
    }
    if (metrics.statusText !== 'WAIT') {
      failures.push(`expected compact WAIT status text, got ${metrics.statusText}`);
    }
    if (!metrics.controlStates.attackDisabled || !metrics.controlStates.runDisabled) {
      failures.push('status scenario did not disable pending combat controls');
    }
  }

  if (isInventoryScenario) {
    if (!metrics.inventoryOpen) {
      failures.push('fixed inventory scenario did not open the inventory drawer');
    }
    const inventory = metrics.rects.inventoryPanel;
    const item = metrics.rects.firstInventoryItem;
    const action = metrics.rects.firstInventoryAction;
    const logToggle = metrics.rects.logToggleButton;
    const inventoryToggle = metrics.rects.inventoryToggleButton;
    if (!inventory || inventory.visibleHeight < 180 || inventory.visibleWidth < 300) {
      failures.push(`fixed inventory drawer is too small: ${inventory?.visibleWidth ?? 0}x${inventory?.visibleHeight ?? 0}`);
    }
    if (!item || item.visibleHeight < 36) {
      failures.push(`fixed inventory first item is clipped: ${item?.visibleHeight ?? 0}px visible`);
    }
    if (!action || action.visibleHeight < 24 || action.visibleWidth < 42) {
      failures.push(`fixed inventory action is clipped: ${action?.visibleWidth ?? 0}x${action?.visibleHeight ?? 0}`);
    }
    if (action && logToggle && action.right > logToggle.left - 4) {
      failures.push(`fixed inventory first action overlaps drawer toggles: action right=${action.right}, toggle left=${logToggle.left}`);
    }
    if (!inventoryToggle || inventoryToggle.visibleHeight < 24 || inventoryToggle.visibleWidth < 38) {
      failures.push(`fixed inventory toggle is clipped while drawer is open: ${inventoryToggle?.visibleWidth ?? 0}x${inventoryToggle?.visibleHeight ?? 0}`);
    }
    if (inventoryToggle?.visualState !== 'pressed') {
      failures.push(`fixed inventory toggle should use pressed state while open, got ${inventoryToggle?.visualState ?? 'none'}`);
    }
    if (scenario.mode === 'fixed-workbench-inventory-use' && !metrics.playerHpText?.startsWith('55/100')) {
      failures.push(`fixed inventory use did not update HP, got ${metrics.playerHpText || 'empty'}`);
    }
  }

  if (isDrawerSwitchScenario && metrics.inventoryOpen) {
    failures.push('fixed drawer switch left the inventory drawer open after opening log');
  }
  if (isDrawerSwitchScenario && metrics.rects.logToggleButton?.visualState !== 'pressed') {
    failures.push(`fixed log toggle should use pressed state after drawer switch, got ${metrics.rects.logToggleButton?.visualState ?? 'none'}`);
  }

  if (isEndStateScenario) {
    validateFixedEndStateScenario(scenario, metrics, failures);
  }

  if (isRestartScenario) {
    validateFixedRestartScenario(metrics, failures);
  }

  const combat = metrics.rects.combatPanel;
  if (!combat || combat.visibleHeight < (isCompactProfile ? 32 : 40)) {
    failures.push(`fixed workbench combat panel is too small: ${combat?.visibleHeight ?? 0}px visible`);
  }

  const map = metrics.rects.map;
  if (!map || map.visibleHeight < 250 || map.visibleWidth < 300) {
    failures.push(`fixed workbench map is too small: ${map?.visibleWidth ?? 0}x${map?.visibleHeight ?? 0}`);
  }

  if (isProductionMobileProfile) {
    validateCompactMobileLayout(metrics, failures);
  }

  const attack = metrics.rects.attackButton;
  const run = metrics.rects.runButton;
  if (!attack || attack.visibleHeight < 40 || !run || run.visibleHeight < 40) {
    failures.push(`fixed workbench action buttons are clipped: attack=${attack?.visibleHeight ?? 0}, run=${run?.visibleHeight ?? 0}`);
  }

  if (isLogScenario) {
    const log = metrics.rects.logPanel;
    const firstEntry = metrics.rects.firstLogEntry;
    if (!metrics.logOpen) {
      failures.push('fixed workbench log scenario did not open the log drawer');
    }
    if (!log || log.visibleHeight < (isCompactProfile ? 52 : 160)) {
      failures.push(`fixed workbench open log is too small: ${log?.visibleHeight ?? 0}px visible`);
    }
    if (!firstEntry || firstEntry.visibleHeight < (isCompactProfile ? 36 : 40)) {
      failures.push(`fixed workbench open log first entry is clipped: ${firstEntry?.visibleHeight ?? 0}px visible`);
    }
  }
}

function validateFixedRestartScenario(metrics, failures) {
  if (metrics.gameEnded) {
    failures.push('restart scenario still has game-ended state after clicking restart');
  }

  if (!metrics.inCombat) {
    failures.push('restart scenario did not return to the default combat bench');
  }

  const overlay = metrics.rects.endStateOverlay;
  if (overlay && overlay.display !== 'none' && overlay.visibleHeight > 0) {
    failures.push(`restart scenario still shows end-state overlay: ${overlay.visibleWidth}x${overlay.visibleHeight}`);
  }

  if (!metrics.controlStates.restartDisabled || !metrics.controlStates.restartHidden) {
    failures.push('restart button remains enabled or visible after restart');
  }
}

function validateFixedEndStateScenario(scenario, metrics, failures) {
  const expectedScenario = scenario.mode === 'fixed-workbench-victory' ? 'victory' : 'defeat';
  if (metrics.fixedScenario !== expectedScenario) {
    failures.push(`expected ${expectedScenario} scenario, got ${metrics.fixedScenario ?? 'none'}`);
  }

  if (!metrics.gameEnded) {
    failures.push('fixed terminal scenario did not set game-ended state');
  }

  const overlay = metrics.rects.endStateOverlay;
  const panel = metrics.rects.endStatePanel;
  if (!overlay || overlay.visibleHeight < 250 || overlay.visibleWidth < 280) {
    failures.push(`fixed end-state overlay is too small: ${overlay?.visibleWidth ?? 0}x${overlay?.visibleHeight ?? 0}`);
  }
  if (!panel || panel.visibleHeight < 250 || panel.visibleWidth < 280) {
    failures.push(`fixed end-state panel is too small: ${panel?.visibleWidth ?? 0}x${panel?.visibleHeight ?? 0}`);
  }

  if (!metrics.endStateText || metrics.endStateText.length < 24) {
    failures.push('fixed end-state message is missing or too short');
  }

  const restart = metrics.rects.restartButton;
  if (!restart || restart.visibleWidth < 180 || restart.visibleHeight < 52) {
    failures.push(`fixed restart button is clipped: ${restart?.visibleWidth ?? 0}x${restart?.visibleHeight ?? 0}`);
  }

  if (metrics.controlStates.restartDisabled || metrics.controlStates.restartHidden) {
    failures.push('fixed restart button is not enabled and visible in terminal state');
  }

  for (const key of ['attackDisabled', 'runDisabled', 'moveNDisabled', 'moveSDisabled', 'moveEDisabled', 'moveWDisabled']) {
    if (!metrics.controlStates[key]) {
      failures.push(`terminal state leaves ${key.replace('Disabled', '')} enabled`);
    }
  }
}

function validateCompactMobileLayout(metrics, failures) {
  const map = metrics.rects.map;
  const latest = metrics.rects.latestPanel;
  const player = metrics.rects.playerPanel;
  const tileStatValue = metrics.rects.tileStatValue;
  const combat = metrics.rects.combatPanel;
  const log = metrics.rects.logPanel;
  const status = metrics.rects.statusPill;
  const buttons = [
    ['move-n', metrics.rects.moveNorthButton],
    ['move-s', metrics.rects.moveSouthButton],
    ['move-e', metrics.rects.moveEastButton],
    ['move-w', metrics.rects.moveWestButton],
    ['attack', metrics.rects.attackButton],
    ['run', metrics.rects.runButton]
  ];

  if (map && map.height > 315) {
    failures.push(`compact mobile map is too dominant: ${map.height}px high`);
  }

  if (!metrics.logOpen && !metrics.inventoryOpen && (!latest || latest.visibleHeight < 78)) {
    failures.push(`compact mobile latest area is too small: ${latest?.visibleHeight ?? 0}px visible`);
  }

  if (!player || player.visibleHeight < 50) {
    failures.push(`compact mobile player panel is too small: ${player?.visibleHeight ?? 0}px visible`);
  }

  validateFixedStatLabels(metrics, failures);

  if (!metrics.logOpen && !metrics.inventoryOpen && (!tileStatValue || tileStatValue.visibleWidth < 110)) {
    failures.push(`compact mobile tile stat has too little room: ${tileStatValue?.visibleWidth ?? 0}px visible`);
  }

  if (!combat || combat.visibleHeight < 56) {
    failures.push(`compact mobile combat panel is too small: ${combat?.visibleHeight ?? 0}px visible`);
  }

  if (metrics.logOpen && (!log || log.visibleHeight < 180)) {
    failures.push(`compact mobile open log is too small: ${log?.visibleHeight ?? 0}px visible`);
  }

  if (!status || status.visibleWidth < 52 || status.visibleHeight < 22) {
    failures.push(`compact mobile status indicator is clipped: ${status?.visibleWidth ?? 0}x${status?.visibleHeight ?? 0}`);
  } else if (status.scrollWidth > status.clientWidth || status.scrollHeight > status.clientHeight) {
    failures.push(`compact mobile status text overflows: ${status.scrollWidth}x${status.scrollHeight} > ${status.clientWidth}x${status.clientHeight}`);
  }

  for (const [name, rect] of buttons) {
    if (!rect || rect.visibleHeight < 52 || rect.visibleWidth < 52) {
      failures.push(`compact mobile ${name} hitbox is too small: ${rect?.visibleWidth ?? 0}x${rect?.visibleHeight ?? 0}`);
    }
  }
}

function validateFixedStatLabels(metrics, failures) {
  for (const [label, rect] of [
    ['attack', metrics.rects.statAttack],
    ['defense', metrics.rects.statDefense],
    ['xp', metrics.rects.statXp]
  ]) {
    if (!rect) {
      failures.push(`fixed ${label} stat label is missing`);
    } else if (rect.scrollWidth > rect.clientWidth + 1) {
      failures.push(`fixed ${label} stat label is clipped: ${rect.scrollWidth}px > ${rect.clientWidth}px`);
    }
  }
}

function isCompactFixedProfile(fixedProfile) {
  return fixedProfile === 'reference-mobile' || fixedProfile === 'reference-mobile-v2';
}

function isProductionFixedProfile(profileRole) {
  return profileRole === 'default' || profileRole === 'variant';
}

function validateAssetUsage(metrics) {
  const failures = [];

  for (const [name, rect] of Object.entries(metrics.rects)) {
    if (!rect) {
      continue;
    }

    const usesRuntimeAsset = rect.backgroundImage.includes('/assets/') || rect.borderImageSource.includes('/assets/');
    const usesRawReference = rect.backgroundImage.includes('/raw/') || rect.borderImageSource.includes('/raw/');
    if (usesRawReference) {
      failures.push(`${name} uses raw reference art at runtime`);
    }

    if (rect.backgroundImage.includes('/assets/') && rect.backgroundSize.includes('cover')) {
      failures.push(`${name} stretches a generated asset with background-size: cover`);
    }

    if (rect.backgroundImage.includes('/assets/') && !rect.backgroundRepeat.includes('repeat')) {
      failures.push(`${name} uses a generated background asset without repeat semantics`);
    }

    if (rect.borderImageSource.includes('/assets/') && !rect.borderImageRepeat.includes('repeat')) {
      failures.push(`${name} uses a generated border image without repeat-safe edges`);
    }

  }

  return failures;
}
