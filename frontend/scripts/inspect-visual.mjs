import { chromium } from 'playwright';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

const rootDir = path.resolve(new URL('..', import.meta.url).pathname);
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
const compactFixedProfile = 'reference-mobile-compact';
const desktopFixedProfile = 'desktop-wide';
const fixedRuntimeUrl = withQueryParams(entryUrl, { ui: 'fixed-skin', profile: defaultFixedProfile });
const desktopFixedRuntimeUrl = withQueryParams(entryUrl, { ui: 'fixed-skin' });
const classicRuntimeUrl = withQueryParams(entryUrl, { ui: 'classic' });
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = process.env.VISUAL_OUT_DIR
  ? path.resolve(process.env.VISUAL_OUT_DIR)
  : path.resolve('visual-inspections', timestamp);
const scenarioFilters = (process.env.VISUAL_SCENARIOS ?? process.env.VISUAL_SCENARIO ?? '')
  .split(',')
  .map((filter) => filter.trim())
  .filter(Boolean);
const fixedSkinDir = path.join(rootDir, 'src/skins/neo-tokyo-console/fixed');
const productionMobileProfiles = await loadProductionMobileProfiles(fixedSkinDir);

const baseScenarios = [
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
    name: 'mobile-fixed-runtime-inventory',
    viewport: { width: 390, height: 844 },
    mode: 'fixed-runtime-inventory',
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
    name: 'mobile-short-fixed-runtime-ready',
    viewport: { width: 390, height: 667 },
    mode: 'fixed-runtime-ready',
    url: fixedRuntimeUrl,
    expectedFixedProfile: defaultFixedProfile
  },
  {
    name: 'mobile-short-default-fixed-workbench',
    viewport: { width: 390, height: 667 },
    mode: 'fixed-workbench',
    url: fixedWorkbenchUrl,
    expectedFixedProfile: compactFixedProfile
  },
  {
    name: 'mobile-short-themed-amber-fixed-workbench',
    viewport: { width: 390, height: 667 },
    mode: 'fixed-workbench',
    url: withQueryParams(fixedWorkbenchUrl, {
      skin_tags: 'industrial,relay',
      skin_mood: 'nocturnal',
      skin_palette: 'amber'
    }),
    expectedFixedProfile: 'amber-mobile-compact'
  },
  {
    name: 'mobile-short-themed-signal-fixed-workbench',
    viewport: { width: 390, height: 667 },
    mode: 'fixed-workbench',
    url: withQueryParams(fixedWorkbenchUrl, {
      skin_tags: 'noir,signal',
      skin_mood: 'sleek',
      skin_palette: 'cyan'
    }),
    expectedFixedProfile: 'signal-noir-mobile-compact'
  },
  {
    name: 'mobile-short-themed-gold-fixed-workbench',
    viewport: { width: 390, height: 667 },
    mode: 'fixed-workbench',
    url: withQueryParams(fixedWorkbenchUrl, {
      skin_tags: 'city,technology',
      skin_mood: 'tactical',
      skin_palette: 'gold'
    }),
    expectedFixedProfile: 'gold-mobile-compact'
  },
  {
    name: 'mobile-compact-profile-cycle-fixed-workbench',
    viewport: { width: 390, height: 667 },
    mode: 'fixed-workbench-profile-cycle',
    url: fixedWorkbenchProfileUrl(compactFixedProfile),
    expectedFixedProfile: 'signal-noir-mobile-compact'
  },
  {
    name: 'mobile-short-fixed-runtime-log',
    viewport: { width: 390, height: 667 },
    mode: 'fixed-runtime-log',
    url: fixedRuntimeUrl,
    expectedFixedProfile: defaultFixedProfile
  },
  {
    name: 'mobile-short-fixed-runtime-inventory',
    viewport: { width: 390, height: 667 },
    mode: 'fixed-runtime-inventory',
    url: fixedRuntimeUrl,
    expectedFixedProfile: defaultFixedProfile
  },
  {
    name: 'mobile-short-fixed-runtime-combat',
    viewport: { width: 390, height: 667 },
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
    name: 'mobile-reference-v3-fixed-workbench-movement-reduced-motion',
    viewport: { width: 390, height: 844 },
    mode: 'fixed-workbench-movement-reduced-motion',
    reducedMotion: 'reduce',
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
    name: 'mobile-reference-v3-fixed-workbench-drawer-escape',
    viewport: { width: 390, height: 844 },
    mode: 'fixed-workbench-drawer-escape',
    url: fixedWorkbenchProfileUrl('reference-mobile-v3')
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
    name: 'desktop-fixed-runtime-ready',
    viewport: { width: 1280, height: 900 },
    mode: 'fixed-runtime-ready',
    url: desktopFixedRuntimeUrl,
    expectedFixedProfile: desktopFixedProfile
  },
  {
    name: 'desktop-fixed-runtime-log',
    viewport: { width: 1280, height: 900 },
    mode: 'fixed-runtime-log',
    url: desktopFixedRuntimeUrl,
    expectedFixedProfile: desktopFixedProfile
  },
  {
    name: 'desktop-fixed-runtime-inventory',
    viewport: { width: 1280, height: 900 },
    mode: 'fixed-runtime-inventory',
    url: desktopFixedRuntimeUrl,
    expectedFixedProfile: desktopFixedProfile
  },
  {
    name: 'desktop-fixed-runtime-combat',
    viewport: { width: 1280, height: 900 },
    mode: 'fixed-runtime-combat',
    url: desktopFixedRuntimeUrl,
    expectedFixedProfile: desktopFixedProfile
  },
  {
    name: 'desktop-fixed-workbench',
    viewport: { width: 1280, height: 900 },
    mode: 'fixed-workbench',
    url: fixedWorkbenchUrl,
    expectedFixedProfile: desktopFixedProfile
  },
  {
    name: 'desktop-fixed-workbench-defeat',
    viewport: { width: 1280, height: 900 },
    mode: 'fixed-workbench-defeat',
    url: `${fixedWorkbenchUrl}${fixedWorkbenchUrl.includes('?') ? '&' : '?'}scenario=defeat`,
    expectedFixedProfile: desktopFixedProfile
  },
  {
    name: 'desktop-fixed-workbench-restart',
    viewport: { width: 1280, height: 900 },
    mode: 'fixed-workbench-restart',
    url: `${fixedWorkbenchUrl}${fixedWorkbenchUrl.includes('?') ? '&' : '?'}scenario=defeat`,
    expectedFixedProfile: desktopFixedProfile
  }
];
const scenarios = withProductionProfileCoverage(baseScenarios, productionMobileProfiles);
const selectedScenarios = scenarioFilters.length > 0
  ? scenarios.filter((scenario) =>
    scenarioFilters.some((filter) =>
      scenario.name === filter ||
      scenario.mode === filter ||
      scenario.name.includes(filter)
    )
  )
  : scenarios;

if (selectedScenarios.length === 0) {
  console.error(`No visual scenarios matched VISUAL_SCENARIOS=${scenarioFilters.join(',')}`);
  process.exit(1);
}

await fs.mkdir(outDir, { recursive: true });

const managedViteServer = await ensureViteServer(selectedScenarios);
let browser = null;
const results = [];

try {
  browser = await chromium.launch();
  for (const scenario of selectedScenarios) {
    const context = await browser.newContext({
      deviceScaleFactor: 1,
      viewport: scenario.viewport,
      ...(scenario.reducedMotion ? { reducedMotion: scenario.reducedMotion } : {})
    });
    const page = await context.newPage();
    const result = await runScenario(page, scenario);
    results.push(result);
    await context.close();
  }
} finally {
  if (browser) {
    await browser.close();
  }
  stopManagedServer(managedViteServer);
}

const summary = {
  entryUrl,
  workbenchUrl,
  fixedWorkbenchUrl,
  scenarioFilters,
  productionMobileProfiles,
  managedViteServer: Boolean(managedViteServer),
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
      metrics.fixedProfileKind ? `kind ${metrics.fixedProfileKind}` : null,
      Number.isFinite(metrics.fixedStageScale) ? `scale ${metrics.fixedStageScale.toFixed(3)}` : null,
      metrics.ui ? `ui ${metrics.ui}` : null,
      metrics.workbench ? `bench ${metrics.workbench}` : null,
      metrics.statusText ? `status ${metrics.statusText}` : null,
      metrics.prefersReducedMotion ? 'reduced motion' : null,
      Number.isFinite(metrics.mapPlayer?.x) && Number.isFinite(metrics.mapPlayer?.y)
        ? `player ${metrics.mapPlayer.x},${metrics.mapPlayer.y}`
        : null,
      metrics.logOpen ? 'log open' : null,
      metrics.inventoryOpen ? 'inventory open' : null,
      metrics.inCombat ? 'combat' : 'explore',
      metrics.fontAwesome ? `fa ${metrics.fontAwesome.rendered}/${metrics.fontAwesome.visible}` : null,
      metrics.screenshot ? `mean ${metrics.screenshot.mean.toFixed(3)}` : null,
      metrics.screenshot ? `contrast ${metrics.screenshot.standardDeviation.toFixed(3)}` : null,
      metrics.screenshot ? `sat ${metrics.screenshot.saturationMean.toFixed(3)}` : null,
      metrics.screenshot ? `colors ${metrics.screenshot.sampledUniqueColors}` : null,
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
    <span>${summary.productionMobileProfiles.length} production mobile profiles</span>
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

async function loadProductionMobileProfiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const profiles = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const kitPath = path.join(dir, entry.name, 'skin-kit.json');
    let kit;
    try {
      kit = JSON.parse(await fs.readFile(kitPath, 'utf8'));
    } catch {
      continue;
    }

    if (
      (kit.kind !== 'mobilePortrait' && kit.kind !== 'mobileCompact') ||
      (kit.meta?.role !== 'default' && kit.meta?.role !== 'variant')
    ) {
      continue;
    }

    profiles.push({
      id: kit.id ?? entry.name,
      kind: kit.kind,
      role: kit.meta.role,
      defaultPriority: kit.meta.defaultPriority ?? 0,
      size: kit.size
    });
  }

  return profiles.sort((left, right) =>
    right.defaultPriority - left.defaultPriority ||
    left.id.localeCompare(right.id)
  );
}

function withProductionProfileCoverage(base, profiles) {
  const scenarios = [...base];
  const existingCoverage = new Set(
    base.map((scenario) => scenarioKey(scenario))
  );

  for (const profile of profiles) {
    for (const scenario of productionProfileScenarios(profile)) {
      const key = scenarioKey(scenario);
      if (existingCoverage.has(key)) {
        continue;
      }

      existingCoverage.add(key);
      scenarios.push(scenario);
    }
  }

  return scenarios;
}

function productionProfileScenarios(profile) {
  const url = fixedWorkbenchProfileUrl(profile.id);
  const viewport = profile.kind === 'mobileCompact'
    ? { width: profile.size?.width ?? 390, height: profile.size?.height ?? 667 }
    : { width: 390, height: 844 };
  const shortViewport = { width: 390, height: 667 };
  return [
    {
      name: `mobile-${profile.id}-production-movement`,
      viewport,
      mode: 'fixed-workbench-movement',
      url: `${url}&scenario=movement`,
      expectedFixedProfile: profile.id
    },
    {
      name: `mobile-${profile.id}-production-log`,
      viewport,
      mode: 'fixed-workbench-log',
      url,
      expectedFixedProfile: profile.id
    },
    {
      name: `mobile-${profile.id}-production-short-log`,
      viewport: shortViewport,
      mode: 'fixed-workbench-log',
      url,
      expectedFixedProfile: profile.id
    },
    {
      name: `mobile-${profile.id}-production-inventory`,
      viewport,
      mode: 'fixed-workbench-inventory',
      url,
      expectedFixedProfile: profile.id
    },
    {
      name: `mobile-${profile.id}-production-short-inventory`,
      viewport: shortViewport,
      mode: 'fixed-workbench-inventory',
      url,
      expectedFixedProfile: profile.id
    },
    {
      name: `mobile-${profile.id}-production-defeat`,
      viewport,
      mode: 'fixed-workbench-defeat',
      url: `${url}&scenario=defeat`,
      expectedFixedProfile: profile.id
    },
    {
      name: `mobile-${profile.id}-production-victory`,
      viewport,
      mode: 'fixed-workbench-victory',
      url: `${url}&scenario=victory`,
      expectedFixedProfile: profile.id
    },
    {
      name: `mobile-${profile.id}-production-restart`,
      viewport,
      mode: 'fixed-workbench-restart',
      url: `${url}&scenario=defeat`,
      expectedFixedProfile: profile.id
    },
    {
      name: `mobile-${profile.id}-production-diagnostics`,
      viewport,
      mode: 'fixed-workbench-diagnostics',
      url: `${url}&scenario=diagnostics`,
      expectedFixedProfile: profile.id
    }
  ];
}

function scenarioKey(scenario) {
  return [
    scenario.mode,
    scenario.url ?? entryUrl,
    scenario.expectedFixedProfile ?? '',
    scenario.viewport.width,
    scenario.viewport.height
  ].join('\n');
}

async function ensureViteServer(selected) {
  if (process.env.VISUAL_NO_DEV_SERVER === '1' || !selected.some((scenario) => usesDefaultViteServer(scenario.url ?? entryUrl))) {
    return null;
  }

  if (await canConnect(5273)) {
    return null;
  }

  const server = spawn('npx', ['-y', 'pnpm@10.23.0', '-C', rootDir, 'dev'], {
    cwd: rootDir,
    stdio: 'ignore'
  });

  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await canConnect(5273)) {
      return server;
    }
    await delay(250);
  }

  stopManagedServer(server);
  throw new Error('Timed out waiting for Vite dev server on 127.0.0.1:5273');
}

function usesDefaultViteServer(url) {
  try {
    const parsed = new URL(url);
    return parsed.port === '5273' &&
      (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost');
  } catch {
    return false;
  }
}

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let settled = false;

    const finish = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(500, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stopManagedServer(server) {
  if (!server || server.killed) {
    return;
  }

  server.kill('SIGTERM');
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

  if (scenario.mode === 'fixed-runtime-inventory') {
    await page.getByRole('button', { name: 'Inventory', exact: true }).click();
    await waitForFixedRuntimeInventory(page);
  }

  if (scenario.mode === 'fixed-runtime-combat') {
    await enterFixedRuntimeCombat(page);
  }

  if (scenario.mode === 'fixed-workbench-movement' || scenario.mode === 'fixed-workbench-movement-reduced-motion') {
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

  if (scenario.mode === 'fixed-workbench-drawer-escape') {
    await page.getByRole('button', { name: 'Log', exact: true }).click();
    await waitForLogOpen(page);
    await page.keyboard.press('Escape');
    await waitForFixedDrawerClosed(page);
  }

  if (scenario.mode === 'fixed-workbench-profile-cycle') {
    await Promise.all([
      page.waitForURL(
        (url) => url.searchParams.get('profile') === scenario.expectedFixedProfile,
        { timeout: 5000 }
      ),
      page.keyboard.press(']')
    ]);
    await waitForFixedWorkbenchReady(page);
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

  await waitForFontAwesome(page);
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
  const luminanceOutput = execFileSync(
    'magick',
    [
      screenshotPath,
      '-format',
      '%[fx:mean]\n%[fx:standard_deviation]',
      'info:'
    ],
    { encoding: 'utf8' }
  );
  const [mean, standardDeviation] = luminanceOutput.trim().split(/\s+/).map(Number);
  const saturationOutput = execFileSync(
    'magick',
    [
      screenshotPath,
      '-colorspace',
      'HSL',
      '-channel',
      'G',
      '-separate',
      '-format',
      '%[fx:mean]\n%[fx:standard_deviation]',
      'info:'
    ],
    { encoding: 'utf8' }
  );
  const [saturationMean, saturationStandardDeviation] = saturationOutput.trim().split(/\s+/).map(Number);
  const sampledUniqueColors = Number(execFileSync(
    'magick',
    [
      screenshotPath,
      '-resize',
      '64x64!',
      '-format',
      '%k',
      'info:'
    ],
    { encoding: 'utf8' }
  ).trim());

  return {
    mean,
    standardDeviation,
    saturationMean,
    saturationStandardDeviation,
    sampledUniqueColors
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

async function waitForFontAwesome(page) {
  await page.waitForFunction(() => {
    return Array.from(document.querySelectorAll('i[class*="fa-"]')).some((icon) => {
      const box = icon.getBoundingClientRect();
      const style = getComputedStyle(icon);
      const before = getComputedStyle(icon, '::before');
      const content = before.content;
      return box.width > 0 &&
        box.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity) > 0 &&
        content &&
        content !== 'none' &&
        content !== 'normal' &&
        content !== '""' &&
        before.fontFamily.toLowerCase().includes('font awesome');
    });
  }, null, { timeout: 20_000 });
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

async function waitForFixedRuntimeInventory(page) {
  await page.waitForFunction(() => {
    return document.body.dataset.ui === 'fixed-skin' &&
      document.body.classList.contains('fixed-runtime-mode') &&
      document.body.classList.contains('fixed-inventory-open') &&
      (
        document.querySelector('#inventory-list .fixed-inventory-empty') ||
        document.querySelector('#inventory-list .fixed-inventory-item')
      );
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

async function waitForFixedDrawerClosed(page) {
  await page.waitForFunction(() => {
    const logToggle = document.getElementById('fixed-log-toggle');
    return !document.body.classList.contains('fixed-log-open') &&
      !document.body.classList.contains('log-open') &&
      !document.body.classList.contains('fixed-inventory-open') &&
      logToggle instanceof HTMLButtonElement &&
      logToggle.dataset.visualState === 'idle' &&
      logToggle.getAttribute('aria-expanded') === 'false' &&
      logToggle.getAttribute('aria-pressed') === 'false';
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
      statAttack: '.fixed-stat-cell[data-stat="atk"]',
      statAttackValue: '.fixed-stat-cell[data-stat="atk"] strong',
      statDefense: '.fixed-stat-cell[data-stat="def"]',
      statDefenseValue: '.fixed-stat-cell[data-stat="def"] strong',
      statXp: '.fixed-stat-cell[data-stat="xp"]',
      statXpValue: '.fixed-stat-cell[data-stat="xp"] strong',
      tileStatValue: '.fixed-stat-cell[data-stat="tile"] strong',
      combatPanel: '#combat-panel',
      enemyBadge: '#enemy-icon-badge',
      enemyIcon: '#enemy-icon',
      controlsPanel: '.controls-panel',
      logPanel: '#log-panel',
      firstLogEntry: '#game-log p.latest',
      firstLogTag: '#game-log p.latest .fixed-log-entry-tag',
      inventoryPanel: '.inventory-panel',
      firstInventoryItem: '#inventory-list .inventory-item',
      firstInventoryBadge: '#inventory-list .fixed-inventory-type-badge',
      firstInventoryAction: '#inventory-list button',
      inventoryEmpty: '#inventory-list .fixed-inventory-empty',
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
      endStateMessage: '#end-state-message',
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
        ariaExpanded: element instanceof HTMLElement ? element.getAttribute('aria-expanded') : null,
        ariaPressed: element instanceof HTMLElement ? element.getAttribute('aria-pressed') : null,
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
          crowded: icon.dataset.mapCrowded === '1',
          centerX: Math.round(box.left + box.width / 2),
          centerY: Math.round(box.top + box.height / 2)
        };
        groups.set(tile, [...(groups.get(tile) ?? []), entry]);
      }

      return Array.from(groups.entries())
        .filter(([, icons]) => icons.length > 1)
        .map(([tile, icons]) => ({ tile, icons }));
    };

    const collectFontAwesomeMetrics = () => {
      const visibleIcons = Array.from(document.querySelectorAll('i[class*="fa-"]'))
        .filter((icon) => {
          const box = icon.getBoundingClientRect();
          const style = getComputedStyle(icon);
          return box.width > 0 &&
            box.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            Number(style.opacity) > 0;
        });
      const renderedIcons = visibleIcons.filter((icon) => {
        const before = getComputedStyle(icon, '::before');
        const content = before.content;
        return content &&
          content !== 'none' &&
          content !== 'normal' &&
          content !== '""' &&
          before.fontFamily.toLowerCase().includes('font awesome');
      });

      return {
        visible: visibleIcons.length,
        rendered: renderedIcons.length,
        missing: visibleIcons.length - renderedIcons.length
      };
    };

    const collectMapIconMetrics = () => {
      const icons = Array.from(document.querySelectorAll('.map-icon-overlay i[data-map-role]'));
      const hasBadgeTreatment = (icon) => {
        const style = getComputedStyle(icon);
        return style.backgroundImage !== 'none' &&
          style.borderTopColor !== 'rgba(0, 0, 0, 0)' &&
          style.boxShadow !== 'none';
      };
      return {
        total: icons.length,
        terrain: icons.filter((icon) => icon.dataset.mapRole === 'cell').length,
        crowdedTerrain: icons.filter((icon) => icon.dataset.mapRole === 'cell' && icon.dataset.mapCrowded === '1').length,
        item: icons.filter((icon) => icon.dataset.mapRole === 'item').length,
        enemy: icons.filter((icon) => icon.dataset.mapRole === 'enemy').length,
        itemBadges: icons.filter((icon) => icon.dataset.mapRole === 'item' && hasBadgeTreatment(icon)).length,
        enemyBadges: icons.filter((icon) => icon.dataset.mapRole === 'enemy' && hasBadgeTreatment(icon)).length
      };
    };

    const collectInventoryMetrics = () => {
      const items = Array.from(document.querySelectorAll('#inventory-list .fixed-inventory-item'));
      const badges = Array.from(document.querySelectorAll('#inventory-list .fixed-inventory-type-badge'));
      const visibleBadges = badges.filter((badge) => {
        const box = badge.getBoundingClientRect();
        const style = getComputedStyle(badge);
        return box.width > 0 &&
          box.height > 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity) > 0;
      });
      const styledBadges = visibleBadges.filter((badge) => {
        const style = getComputedStyle(badge);
        return style.backgroundImage !== 'none' &&
          style.borderTopColor !== 'rgba(0, 0, 0, 0)' &&
          style.boxShadow !== 'none';
      });

      return {
        items: items.length,
        typeBadges: badges.length,
        visibleTypeBadges: visibleBadges.length,
        styledTypeBadges: styledBadges.length,
        typeIcons: badges.filter((badge) => badge.querySelector('i[class*="fa-"]')).length,
        typeLabels: badges
          .map((badge) => badge.querySelector('.fixed-inventory-type-label')?.textContent?.trim() ?? '')
          .filter(Boolean),
        itemTypes: items
          .map((item) => item.dataset.itemType ?? '')
          .filter(Boolean)
      };
    };

    const collectLogMetrics = () => {
      const entries = Array.from(document.querySelectorAll('#game-log p'));
      const tags = Array.from(document.querySelectorAll('#game-log .fixed-log-entry-tag'));
      const visibleTags = tags.filter((tag) => {
        const box = tag.getBoundingClientRect();
        const style = getComputedStyle(tag);
        return box.width > 0 &&
          box.height > 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity) > 0;
      });
      const styledTags = visibleTags.filter((tag) => {
        const style = getComputedStyle(tag);
        return style.backgroundImage !== 'none' &&
          style.borderTopColor !== 'rgba(0, 0, 0, 0)' &&
          style.boxShadow !== 'none';
      });
      const styledEntries = entries.filter((entry) => {
        const style = getComputedStyle(entry);
        return style.backgroundImage !== 'none' &&
          style.borderTopColor !== 'rgba(0, 0, 0, 0)' &&
          style.boxShadow !== 'none';
      });

      return {
        entries: entries.length,
        entryTags: tags.length,
        visibleEntryTags: visibleTags.length,
        styledEntryTags: styledTags.length,
        styledEntries: styledEntries.length,
        latestTagText: document.querySelector('#game-log p.latest .fixed-log-entry-tag')?.textContent?.trim() ?? '',
        latestCopyText: document.querySelector('#game-log p.latest .fixed-log-entry-copy')?.textContent?.trim() ?? ''
      };
    };

    const collectCombatMetrics = () => {
      const badge = document.getElementById('enemy-icon-badge');
      if (!badge) {
        return {
          enemyBadgeStyled: false,
          enemyIconClass: ''
        };
      }

      const style = getComputedStyle(badge);
      return {
        enemyBadgeStyled: style.backgroundImage !== 'none' &&
          style.borderTopColor !== 'rgba(0, 0, 0, 0)' &&
          style.boxShadow !== 'none',
        enemyIconClass: document.getElementById('enemy-icon')?.className ?? ''
      };
    };

    const collectStatMetrics = () => {
      const cells = Array.from(document.querySelectorAll('.fixed-stat-cell'));
      const styledCells = cells.filter((cell) => {
        const style = getComputedStyle(cell);
        return style.backgroundImage !== 'none' &&
          style.borderTopColor !== 'rgba(0, 0, 0, 0)' &&
          style.boxShadow !== 'none';
      });
      return {
        cells: cells.length,
        styledCells: styledCells.length,
        labels: cells
          .map((cell) => cell.querySelector('.fixed-stat-label')?.textContent?.trim() ?? '')
          .filter(Boolean),
        values: cells
          .map((cell) => cell.querySelector('.fixed-stat-value')?.textContent?.trim() ?? '')
          .filter(Boolean)
      };
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
      fixedProfileKind: document.querySelector('.fixed-skin-stage')?.dataset.profileKind ?? null,
      fixedStageScale: Number(document.querySelector('.fixed-skin-stage')?.dataset.scale ?? NaN),
      fixedScenario: document.body.dataset.fixedScenario ?? null,
      prefersReducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
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
      mapMarker: {
        animated: document.getElementById('game-canvas')?.dataset.markerAnimated ?? null,
        visualX: Number(document.getElementById('game-canvas')?.dataset.markerVisualX ?? NaN),
        visualY: Number(document.getElementById('game-canvas')?.dataset.markerVisualY ?? NaN),
        targetX: Number(document.getElementById('game-canvas')?.dataset.markerTargetX ?? NaN),
        targetY: Number(document.getElementById('game-canvas')?.dataset.markerTargetY ?? NaN)
      },
      tileStatText: document.querySelector('.fixed-stat-cell[data-stat="tile"] strong')?.textContent?.trim() ?? '',
      combatTitleText: document.getElementById('combat-mode-label')?.textContent?.trim() ?? '',
      enemyNameText: document.getElementById('enemy-name')?.textContent?.trim() ?? '',
      enemyHpText: document.getElementById('enemy-hp')?.textContent?.trim() ?? '',
      unsafeMarkupCount: document.querySelectorAll('#fixed-title img, #fixed-title script, #fixed-player-stats b, #game-log script, #enemy-name script').length,
      diagnosticAssetCount: document.querySelectorAll('.fixed-diagnostics-board img').length,
      endStateText: document.getElementById('end-state-message')?.textContent?.trim() ?? '',
      mapIconStacks: collectMapIconStacks(),
      mapIcons: collectMapIconMetrics(),
      inventory: collectInventoryMetrics(),
      log: collectLogMetrics(),
      combat: collectCombatMetrics(),
      stats: collectStatMetrics(),
      fontAwesome: collectFontAwesomeMetrics(),
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

  if (scenario.reducedMotion === 'reduce' && !metrics.prefersReducedMotion) {
    failures.push('scenario requested reduced motion but browser media query did not match');
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
    if (isFixedUi && (metrics.logOpen || metrics.inventoryOpen)) {
      // Fixed skins swap the latest LCD for the full log module when opened.
    } else if (isFixedUi) {
      const latestPanel = metrics.rects.latestPanel;
      const latestMessage = metrics.rects.latestMessage;
      const minLatestHeight = metrics.fixedProfileKind === 'mobileCompact'
        ? 70
        : isCompactFixedProfile(metrics.fixedProfile) ? 50 : 78;
      if (!latestPanel || latestPanel.display === 'none' || !latestMessage || latestMessage.display === 'none') {
        failures.push('mobile fixed latest message is not visible');
      } else if (latestPanel.visibleHeight < scaledFixedThreshold(metrics, minLatestHeight)) {
        failures.push(`mobile fixed latest panel is too short: ${latestPanel.visibleHeight}px visible`);
      }
    } else {
      const latest = metrics.rects.latestMessage;
      if (!latest || latest.display === 'none') {
        failures.push('mobile latest message is not visible');
      } else if (latest.visibleHeight < 56) {
        failures.push(`mobile latest message is too short: ${latest.visibleHeight}px visible`);
      }
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
    if (!isFixedUi && latestPanel && latestPanel.display !== 'none') {
      failures.push('desktop should hide mobile latest panel');
    }

    const log = metrics.rects.logPanel;
    if (!isFixedUi && (!log || log.visibleHeight < 160)) {
      failures.push(`desktop log is too small: ${log?.visibleHeight ?? 0}px visible`);
    }

    if (scenario.name === 'desktop-fixed-workbench') {
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
    if (!Number.isFinite(metrics.fixedStageScale)) {
      failures.push('fixed skin stage scale metric is missing');
    } else if (metrics.fixedStageScale > 1.001) {
      failures.push(`fixed skin stage is being upscaled: scale=${metrics.fixedStageScale}`);
    }
    validateFixedDrawerVisibility(metrics, failures);
    validateFixedScreenshotQuality(metrics, failures);
  }

  validateFontAwesome(metrics, failures);
  validateMapIconMetrics(metrics, failures);
  failures.push(...validateAssetUsage(metrics));
  failures.push(...validateMapIconStacking(metrics));
  return failures;
}

function validateFontAwesome(metrics, failures) {
  const fontAwesome = metrics.fontAwesome;
  if (!fontAwesome || fontAwesome.visible === 0) {
    failures.push('no visible Font Awesome icons were available to inspect');
    return;
  }

  if (fontAwesome.missing > 0) {
    failures.push(`Font Awesome icons failed to render: ${fontAwesome.missing}/${fontAwesome.visible} missing`);
  }
}

function validateMapIconStacking(metrics) {
  const failures = [];

  for (const stack of metrics.mapIconStacks ?? []) {
    const cell = stack.icons.find((icon) => icon.role === 'cell');
    if (!cell) {
      continue;
    }

    if (!cell.crowded) {
      failures.push(`map terrain icon on crowded tile ${stack.tile} is not using crowded treatment`);
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

function validateMapIconMetrics(metrics, failures) {
  if (!metrics.mapIcons || metrics.mapIcons.total === 0) {
    failures.push('no map icons were available to inspect');
    return;
  }

  if (metrics.mapIcons.crowdedTerrain < 1) {
    failures.push('map has no crowded terrain icons protecting the player/content tile');
  }

  if (metrics.mapIcons.item > 0 && metrics.mapIcons.itemBadges < metrics.mapIcons.item) {
    failures.push(`map item icons lost badge treatment: ${metrics.mapIcons.itemBadges}/${metrics.mapIcons.item}`);
  }

  if (metrics.mapIcons.enemy > 0 && metrics.mapIcons.enemyBadges < metrics.mapIcons.enemy) {
    failures.push(`map enemy icons lost badge treatment: ${metrics.mapIcons.enemyBadges}/${metrics.mapIcons.enemy}`);
  }
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

  const contrastFloor = metrics.fixedStageScale < 0.85 ? 0.075 : 0.09;
  if (screenshot.standardDeviation < contrastFloor) {
    failures.push(`fixed skin screenshot is too flat: contrast=${screenshot.standardDeviation.toFixed(4)}`);
  }

  if (!Number.isFinite(screenshot.saturationMean) || screenshot.saturationMean < 0.16) {
    failures.push(`fixed skin screenshot is too monochrome: saturation=${screenshot.saturationMean?.toFixed(4) ?? 'none'}`);
  }

  if (!Number.isFinite(screenshot.sampledUniqueColors) || screenshot.sampledUniqueColors < 2200) {
    failures.push(`fixed skin screenshot has too little material variety: sampled colors=${screenshot.sampledUniqueColors ?? 'none'}`);
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

  validateFixedEnemyBadge(metrics, failures, 'fixed runtime');

  if (!metrics.inCombat && metrics.combatTitleText !== 'Explore') {
    failures.push(`fixed runtime non-combat panel should say Explore, got ${metrics.combatTitleText || 'empty'}`);
  }

  if (!metrics.inCombat && metrics.enemyNameText !== 'No hostile') {
    failures.push(`fixed runtime non-combat enemy row should say No hostile, got ${metrics.enemyNameText || 'empty'}`);
  }

  if (scenario.mode === 'fixed-runtime-inventory') {
    validateFixedRuntimeInventory(metrics, failures);
  }

  if (isDesktopFixedProfile(metrics.fixedProfile)) {
    validateDesktopFixedLayout(metrics, failures);
  } else {
    validateCompactMobileLayout(metrics, failures);
  }
}

function validateFixedEnemyBadge(metrics, failures, context) {
  if (!metrics.inCombat || metrics.enemyHpText === '--') {
    return;
  }

  const badge = metrics.rects.enemyBadge;
  const icon = metrics.rects.enemyIcon;
  const minSize = scaledFixedThreshold(metrics, 22);

  if (!badge || badge.visibleWidth < minSize || badge.visibleHeight < minSize) {
    failures.push(`${context} enemy badge is clipped: ${badge?.visibleWidth ?? 0}x${badge?.visibleHeight ?? 0}`);
  }

  if (!icon || icon.visibleWidth < scaledFixedThreshold(metrics, 10) || icon.visibleHeight < scaledFixedThreshold(metrics, 10)) {
    failures.push(`${context} enemy badge icon is clipped: ${icon?.visibleWidth ?? 0}x${icon?.visibleHeight ?? 0}`);
  }

  if (!metrics.combat.enemyBadgeStyled) {
    failures.push(`${context} enemy badge lacks physical styling`);
  }

  if (!metrics.combat.enemyIconClass.includes('fa-')) {
    failures.push(`${context} enemy badge is missing a Font Awesome icon class`);
  }
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
  const isReducedMotionMovementScenario = scenario.mode === 'fixed-workbench-movement-reduced-motion';
  const isMovementScenario = scenario.mode === 'fixed-workbench-movement' || isReducedMotionMovementScenario;
  const isAttackScenario = scenario.mode === 'fixed-workbench-attack';
  const isRunScenario = scenario.mode === 'fixed-workbench-run';
  const isDiagnosticsScenario = scenario.mode === 'fixed-workbench-diagnostics';
  const isEscapedCopyScenario = scenario.mode === 'fixed-workbench-escaped-copy';
  const isStatusScenario = scenario.mode === 'fixed-workbench-status';
  const isInventoryScenario = scenario.mode === 'fixed-workbench-inventory' || scenario.mode === 'fixed-workbench-inventory-use';
  const isDrawerSwitchScenario = scenario.mode === 'fixed-workbench-drawer-switch';
  const isDrawerEscapeScenario = scenario.mode === 'fixed-workbench-drawer-escape';
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

  validateFixedEnemyBadge(metrics, failures, 'fixed workbench');

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
    const expectedAnimatedState = isReducedMotionMovementScenario ? '0' : '1';
    if (metrics.mapMarker?.animated !== expectedAnimatedState) {
      failures.push(
        `movement scenario marker animated state should be ${expectedAnimatedState}, got ${metrics.mapMarker?.animated ?? 'none'}`
      );
    }
    if (
      Number.isFinite(metrics.mapMarker?.visualX) &&
      Number.isFinite(metrics.mapMarker?.targetX) &&
      Math.abs(metrics.mapMarker.visualX - metrics.mapMarker.targetX) > 1
    ) {
      failures.push(`movement scenario marker animation did not settle on target x: ${metrics.mapMarker.visualX} !== ${metrics.mapMarker.targetX}`);
    }
    if (
      Number.isFinite(metrics.mapMarker?.visualY) &&
      Number.isFinite(metrics.mapMarker?.targetY) &&
      Math.abs(metrics.mapMarker.visualY - metrics.mapMarker.targetY) > 1
    ) {
      failures.push(`movement scenario marker animation did not settle on target y: ${metrics.mapMarker.visualY} !== ${metrics.mapMarker.targetY}`);
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
    const minDiagnosticsHeight = metrics.fixedProfileKind === 'mobileCompact' ? 220 : 240;
    if (!diagnostics || diagnostics.visibleHeight < minDiagnosticsHeight || diagnostics.visibleWidth < 300) {
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
  } else if (metrics.statusText !== 'READY') {
    failures.push(`fixed workbench steady state should show READY status, got ${metrics.statusText || 'empty'}`);
  }

  if (isInventoryScenario) {
    if (!metrics.inventoryOpen) {
      failures.push('fixed inventory scenario did not open the inventory drawer');
    }
    const inventory = metrics.rects.inventoryPanel;
    const item = metrics.rects.firstInventoryItem;
    const badge = metrics.rects.firstInventoryBadge;
    const action = metrics.rects.firstInventoryAction;
    const logToggle = metrics.rects.logToggleButton;
    const inventoryToggle = metrics.rects.inventoryToggleButton;
    const minInventoryWidth = isProductionMobileProfile ? scaledFixedThreshold(metrics, 300) : 300;
    const minInventoryHeight = isProductionMobileProfile ? scaledFixedThreshold(metrics, 180) : 180;
    const minInventoryItemHeight = isProductionMobileProfile ? scaledFixedThreshold(metrics, 36) : 36;
    const minInventoryBadgeSize = isProductionMobileProfile ? scaledFixedThreshold(metrics, 26) : 26;
    const minInventoryActionWidth = isProductionMobileProfile ? scaledFixedThreshold(metrics, 42) : 42;
    const minInventoryActionHeight = isProductionMobileProfile ? scaledFixedThreshold(metrics, 24) : 24;
    const minInventoryToggleWidth = isProductionMobileProfile ? scaledFixedThreshold(metrics, 38) : 38;
    const minInventoryToggleHeight = isProductionMobileProfile ? scaledFixedThreshold(metrics, 24) : 24;
    if (!inventory || inventory.visibleHeight < minInventoryHeight || inventory.visibleWidth < minInventoryWidth) {
      failures.push(`fixed inventory drawer is too small: ${inventory?.visibleWidth ?? 0}x${inventory?.visibleHeight ?? 0}`);
    }
    if (!item || item.visibleHeight < minInventoryItemHeight) {
      failures.push(`fixed inventory first item is clipped: ${item?.visibleHeight ?? 0}px visible`);
    }
    if (metrics.inventory.items > 0) {
      if (metrics.inventory.typeBadges < metrics.inventory.items) {
        failures.push(`fixed inventory is missing type badges: ${metrics.inventory.typeBadges}/${metrics.inventory.items}`);
      }
      if (metrics.inventory.visibleTypeBadges < metrics.inventory.items) {
        failures.push(`fixed inventory type badges are not all visible: ${metrics.inventory.visibleTypeBadges}/${metrics.inventory.items}`);
      }
      if (metrics.inventory.styledTypeBadges < metrics.inventory.items) {
        failures.push(`fixed inventory type badges lack physical styling: ${metrics.inventory.styledTypeBadges}/${metrics.inventory.items}`);
      }
      if (metrics.inventory.typeIcons < metrics.inventory.items) {
        failures.push(`fixed inventory type badges are missing Font Awesome icons: ${metrics.inventory.typeIcons}/${metrics.inventory.items}`);
      }
      for (const expectedLabel of ['WPN', 'ARM', 'USE']) {
        if (!metrics.inventory.typeLabels.includes(expectedLabel)) {
          failures.push(`fixed inventory is missing ${expectedLabel} type label`);
        }
      }
      if (!badge || badge.visibleWidth < minInventoryBadgeSize || badge.visibleHeight < minInventoryBadgeSize) {
        failures.push(`fixed inventory first type badge is clipped: ${badge?.visibleWidth ?? 0}x${badge?.visibleHeight ?? 0}`);
      }
    }
    if (!action || action.visibleHeight < minInventoryActionHeight || action.visibleWidth < minInventoryActionWidth) {
      failures.push(`fixed inventory action is clipped: ${action?.visibleWidth ?? 0}x${action?.visibleHeight ?? 0}`);
    }
    if (action && logToggle && action.right > logToggle.left - 4) {
      failures.push(`fixed inventory first action overlaps drawer toggles: action right=${action.right}, toggle left=${logToggle.left}`);
    }
    if (!inventoryToggle || inventoryToggle.visibleHeight < minInventoryToggleHeight || inventoryToggle.visibleWidth < minInventoryToggleWidth) {
      failures.push(`fixed inventory toggle is clipped while drawer is open: ${inventoryToggle?.visibleWidth ?? 0}x${inventoryToggle?.visibleHeight ?? 0}`);
    }
    if (inventoryToggle?.visualState !== 'pressed') {
      failures.push(`fixed inventory toggle should use pressed state while open, got ${inventoryToggle?.visualState ?? 'none'}`);
    }
    if (inventoryToggle?.ariaPressed !== 'true' || inventoryToggle?.ariaExpanded !== 'true') {
      failures.push('fixed inventory toggle does not expose pressed/expanded state while open');
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
  if (isDrawerSwitchScenario) {
    const logToggle = metrics.rects.logToggleButton;
    if (logToggle?.ariaPressed !== 'true' || logToggle?.ariaExpanded !== 'true') {
      failures.push('fixed log toggle does not expose pressed/expanded state while open');
    }
  }

  if (isDrawerEscapeScenario) {
    if (metrics.logOpen || metrics.inventoryOpen) {
      failures.push('fixed Escape shortcut left a drawer open');
    }
    const logToggle = metrics.rects.logToggleButton;
    if (logToggle?.visualState !== 'idle') {
      failures.push(`fixed Escape shortcut should return log toggle to idle, got ${logToggle?.visualState ?? 'none'}`);
    }
    if (logToggle?.ariaPressed !== 'false' || logToggle?.ariaExpanded !== 'false') {
      failures.push('fixed Escape shortcut does not reset log toggle pressed/expanded state');
    }
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
  const minMapWidth = isProductionMobileProfile ? scaledFixedThreshold(metrics, 300) : 300;
  const minMapHeight = isProductionMobileProfile
    ? scaledFixedThreshold(metrics, metrics.fixedProfileKind === 'mobileCompact' ? 220 : 250)
    : 250;
  if (!map || map.visibleHeight < minMapHeight || map.visibleWidth < minMapWidth) {
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
    const firstTag = metrics.rects.firstLogTag;
    // The original screenshot-derived profile is intentionally kept as a visual warning, not a readable layout gate.
    const shouldRequireReadableFirstEntry = metrics.fixedProfile !== 'reference-mobile';
    const minLogHeight = isProductionMobileProfile ? scaledFixedThreshold(metrics, 160) : isCompactProfile ? 52 : 160;
    const minFirstEntryHeight = isProductionMobileProfile ? scaledFixedThreshold(metrics, 40) : isCompactProfile ? 36 : 40;
    const minFirstTagSize = isProductionMobileProfile ? scaledFixedThreshold(metrics, 20) : 20;
    if (!metrics.logOpen) {
      failures.push('fixed workbench log scenario did not open the log drawer');
    }
    if (!log || log.visibleHeight < minLogHeight) {
      failures.push(`fixed workbench open log is too small: ${log?.visibleHeight ?? 0}px visible`);
    }
    if (shouldRequireReadableFirstEntry && (!firstEntry || firstEntry.visibleHeight < minFirstEntryHeight)) {
      failures.push(`fixed workbench open log first entry is clipped: ${firstEntry?.visibleHeight ?? 0}px visible`);
    }
    if (shouldRequireReadableFirstEntry) {
      if (metrics.log.entryTags < metrics.log.entries) {
        failures.push(`fixed workbench log entries are missing tags: ${metrics.log.entryTags}/${metrics.log.entries}`);
      }
      if (metrics.log.visibleEntryTags < metrics.log.entries) {
        failures.push(`fixed workbench log tags are not all visible: ${metrics.log.visibleEntryTags}/${metrics.log.entries}`);
      }
      if (metrics.log.styledEntryTags < metrics.log.entries || metrics.log.styledEntries < metrics.log.entries) {
        failures.push(
          `fixed workbench log hardware styling is incomplete: tags ${metrics.log.styledEntryTags}/${metrics.log.entries}, entries ${metrics.log.styledEntries}/${metrics.log.entries}`
        );
      }
      if (metrics.log.latestTagText !== 'NEW') {
        failures.push(`fixed workbench latest log tag should say NEW, got ${metrics.log.latestTagText || 'empty'}`);
      }
      if (!firstTag || firstTag.visibleWidth < minFirstTagSize || firstTag.visibleHeight < minFirstTagSize) {
        failures.push(`fixed workbench latest log tag is clipped: ${firstTag?.visibleWidth ?? 0}x${firstTag?.visibleHeight ?? 0}`);
      }
    }
  }
}

function validateFixedDrawerVisibility(metrics, failures) {
  const log = metrics.rects.logPanel;
  const inventory = metrics.rects.inventoryPanel;

  if (!metrics.logOpen && log && log.visibleHeight > 0) {
    failures.push(`fixed closed log drawer still occupies visible space: ${log.visibleWidth}x${log.visibleHeight}`);
  }

  if (!metrics.inventoryOpen && inventory && inventory.visibleHeight > 0) {
    failures.push(
      `fixed closed inventory drawer still occupies visible space: ${inventory.visibleWidth}x${inventory.visibleHeight}`
    );
  }
}

function validateDesktopFixedLayout(metrics, failures) {
  const shell = metrics.rects.shell;
  const map = metrics.rects.map;
  const latest = metrics.rects.latestPanel;
  const log = metrics.rects.logPanel;
  const player = metrics.rects.playerPanel;
  const combat = metrics.rects.combatPanel;
  const status = metrics.rects.statusPill;
  const attack = metrics.rects.attackButton;
  const run = metrics.rects.runButton;
  const movementButtons = [
    ['move-n', metrics.rects.moveNorthButton],
    ['move-s', metrics.rects.moveSouthButton],
    ['move-e', metrics.rects.moveEastButton],
    ['move-w', metrics.rects.moveWestButton]
  ];

  if (!shell || shell.visibleWidth < 1100 || shell.visibleHeight < 760) {
    failures.push(`desktop fixed shell is too small: ${shell?.visibleWidth ?? 0}x${shell?.visibleHeight ?? 0}`);
  }

  if (!map || map.visibleWidth < 760 || map.visibleHeight < 700) {
    failures.push(`desktop fixed map is too small: ${map?.visibleWidth ?? 0}x${map?.visibleHeight ?? 0}`);
  }

  if (!metrics.logOpen && !metrics.inventoryOpen && (!latest || latest.visibleWidth < 300 || latest.visibleHeight < 70)) {
    failures.push(`desktop fixed latest panel is too small: ${latest?.visibleWidth ?? 0}x${latest?.visibleHeight ?? 0}`);
  }

  if (metrics.logOpen && (!log || log.visibleWidth < 300 || log.visibleHeight < 100)) {
    failures.push(`desktop fixed open log is too small: ${log?.visibleWidth ?? 0}x${log?.visibleHeight ?? 0}`);
  }

  if (!player || player.visibleWidth < 320 || player.visibleHeight < 76) {
    failures.push(`desktop fixed player panel is too small: ${player?.visibleWidth ?? 0}x${player?.visibleHeight ?? 0}`);
  }

  if (!combat || combat.visibleWidth < 320 || combat.visibleHeight < 44) {
    failures.push(`desktop fixed combat panel is too small: ${combat?.visibleWidth ?? 0}x${combat?.visibleHeight ?? 0}`);
  }

  if (!status || status.visibleWidth < 80 || status.visibleHeight < 30) {
    failures.push(`desktop fixed status indicator is clipped: ${status?.visibleWidth ?? 0}x${status?.visibleHeight ?? 0}`);
  }

  if (!attack || attack.visibleWidth < 220 || attack.visibleHeight < 52) {
    failures.push(`desktop fixed attack button is clipped: ${attack?.visibleWidth ?? 0}x${attack?.visibleHeight ?? 0}`);
  }

  if (!run || run.visibleWidth < 220 || run.visibleHeight < 52) {
    failures.push(`desktop fixed run button is clipped: ${run?.visibleWidth ?? 0}x${run?.visibleHeight ?? 0}`);
  }

  for (const [name, rect] of movementButtons) {
    if (!rect || rect.visibleWidth < 40 || rect.visibleHeight < 40) {
      failures.push(`desktop fixed ${name} hitbox is too small: ${rect?.visibleWidth ?? 0}x${rect?.visibleHeight ?? 0}`);
    }
  }
}

function validateFixedRuntimeInventory(metrics, failures) {
  const inventory = metrics.rects.inventoryPanel;
  const item = metrics.rects.firstInventoryItem;
  const badge = metrics.rects.firstInventoryBadge;
  const action = metrics.rects.firstInventoryAction;
  const empty = metrics.rects.inventoryEmpty;
  const inventoryToggle = metrics.rects.inventoryToggleButton;
  const desktop = isDesktopFixedProfile(metrics.fixedProfile);
  const minWidth = desktop ? 300 : scaledFixedThreshold(metrics, 300);
  const minHeight = desktop
    ? 100
    : scaledFixedThreshold(metrics, metrics.fixedProfileKind === 'mobileCompact' ? 230 : 260);
  const minToggleHeight = desktop ? 24 : scaledFixedThreshold(metrics, 24);
  const minToggleWidth = desktop ? 38 : scaledFixedThreshold(metrics, 38);

  if (!metrics.inventoryOpen) {
    failures.push('fixed runtime inventory scenario did not open the inventory drawer');
  }

  if (metrics.logOpen) {
    failures.push('fixed runtime inventory scenario left the log drawer open');
  }

  if (!inventory || inventory.visibleWidth < minWidth || inventory.visibleHeight < minHeight) {
    failures.push(`fixed runtime inventory drawer is too small: ${inventory?.visibleWidth ?? 0}x${inventory?.visibleHeight ?? 0}`);
  }

  if (!item && (!empty || empty.visibleHeight < 20)) {
    failures.push(`fixed runtime inventory drawer has no visible item or empty state: empty=${empty?.visibleHeight ?? 0}px`);
  }

  if (item && item.visibleHeight < scaledFixedThreshold(metrics, 36)) {
    failures.push(`fixed runtime inventory first item is clipped: ${item.visibleHeight}px visible`);
  }

  if (item) {
    if (metrics.inventory.typeBadges < metrics.inventory.items) {
      failures.push(`fixed runtime inventory is missing type badges: ${metrics.inventory.typeBadges}/${metrics.inventory.items}`);
    }
    if (metrics.inventory.visibleTypeBadges < metrics.inventory.items) {
      failures.push(`fixed runtime inventory type badges are not all visible: ${metrics.inventory.visibleTypeBadges}/${metrics.inventory.items}`);
    }
    if (metrics.inventory.styledTypeBadges < metrics.inventory.items) {
      failures.push(`fixed runtime inventory type badges lack physical styling: ${metrics.inventory.styledTypeBadges}/${metrics.inventory.items}`);
    }
    if (!badge || badge.visibleWidth < scaledFixedThreshold(metrics, 26) || badge.visibleHeight < scaledFixedThreshold(metrics, 26)) {
      failures.push(`fixed runtime inventory first type badge is clipped: ${badge?.visibleWidth ?? 0}x${badge?.visibleHeight ?? 0}`);
    }
  }

  if (item && (!action || action.visibleHeight < scaledFixedThreshold(metrics, 24) || action.visibleWidth < scaledFixedThreshold(metrics, 42))) {
    failures.push(`fixed runtime inventory action is clipped: ${action?.visibleWidth ?? 0}x${action?.visibleHeight ?? 0}`);
  }

  if (!inventoryToggle || inventoryToggle.visibleHeight < minToggleHeight || inventoryToggle.visibleWidth < minToggleWidth) {
    failures.push(`fixed runtime inventory toggle is clipped while open: ${inventoryToggle?.visibleWidth ?? 0}x${inventoryToggle?.visibleHeight ?? 0}`);
  }

  if (inventoryToggle?.visualState !== 'pressed') {
    failures.push(`fixed runtime inventory toggle should use pressed state while open, got ${inventoryToggle?.visualState ?? 'none'}`);
  }

  if (inventoryToggle?.ariaPressed !== 'true' || inventoryToggle?.ariaExpanded !== 'true') {
    failures.push('fixed runtime inventory toggle does not expose pressed/expanded state while open');
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
  const minTerminalHeight = metrics.fixedProfileKind === 'mobileCompact' ? 230 : 250;
  if (!overlay || overlay.visibleHeight < minTerminalHeight || overlay.visibleWidth < 280) {
    failures.push(`fixed end-state overlay is too small: ${overlay?.visibleWidth ?? 0}x${overlay?.visibleHeight ?? 0}`);
  }
  if (!panel || panel.visibleHeight < minTerminalHeight || panel.visibleWidth < 280) {
    failures.push(`fixed end-state panel is too small: ${panel?.visibleWidth ?? 0}x${panel?.visibleHeight ?? 0}`);
  }

  if (!metrics.endStateText || metrics.endStateText.length < 24) {
    failures.push('fixed end-state message is missing or too short');
  }

  const message = metrics.rects.endStateMessage;
  if (!message || message.scrollHeight > message.clientHeight + 1) {
    failures.push(
      `fixed end-state message is clipped: ${message?.scrollHeight ?? 0}px > ${message?.clientHeight ?? 0}px`
    );
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
  const shell = metrics.rects.shell;
  const map = metrics.rects.map;
  const latest = metrics.rects.latestPanel;
  const player = metrics.rects.playerPanel;
  const tileStatValue = metrics.rects.tileStatValue;
  const combat = metrics.rects.combatPanel;
  const log = metrics.rects.logPanel;
  const inventory = metrics.rects.inventoryPanel;
  const status = metrics.rects.statusPill;
  const buttons = [
    ['move-n', metrics.rects.moveNorthButton],
    ['move-s', metrics.rects.moveSouthButton],
    ['move-e', metrics.rects.moveEastButton],
    ['move-w', metrics.rects.moveWestButton],
    ['attack', metrics.rects.attackButton],
    ['run', metrics.rects.runButton]
  ];

  if (shell && shell.scrollHeight > shell.clientHeight + 1) {
    failures.push(`compact mobile fixed shell scrolls vertically: ${shell.scrollHeight}px > ${shell.clientHeight}px`);
  }

  if (map && map.height > 315) {
    failures.push(`compact mobile map is too dominant: ${map.height}px high`);
  }

  const compactMobileProfile = metrics.fixedProfileKind === 'mobileCompact';
  const minLatestHeight = compactMobileProfile ? 70 : 78;
  const minPlayerHeight = compactMobileProfile ? 46 : 50;
  const minCombatHeight = compactMobileProfile ? 48 : 56;
  const minDrawerHeight = compactMobileProfile ? 230 : 260;

  if (!metrics.logOpen && !metrics.inventoryOpen && (!latest || latest.visibleHeight < scaledFixedThreshold(metrics, minLatestHeight))) {
    failures.push(`compact mobile latest area is too small: ${latest?.visibleHeight ?? 0}px visible`);
  }

  if (!player || player.visibleHeight < scaledFixedThreshold(metrics, minPlayerHeight)) {
    failures.push(`compact mobile player panel is too small: ${player?.visibleHeight ?? 0}px visible`);
  }

  validateFixedStatLabels(metrics, failures);

  if (!metrics.logOpen && !metrics.inventoryOpen && (!tileStatValue || tileStatValue.visibleWidth < scaledFixedThreshold(metrics, 110))) {
    failures.push(`compact mobile tile stat has too little room: ${tileStatValue?.visibleWidth ?? 0}px visible`);
  }

  if (!combat || combat.visibleHeight < scaledFixedThreshold(metrics, minCombatHeight)) {
    failures.push(`compact mobile combat panel is too small: ${combat?.visibleHeight ?? 0}px visible`);
  }

  if (metrics.logOpen && (!log || log.visibleHeight < scaledFixedThreshold(metrics, minDrawerHeight))) {
    failures.push(`compact mobile open log is too small: ${log?.visibleHeight ?? 0}px visible`);
  }

  if (metrics.inventoryOpen && (!inventory || inventory.visibleHeight < scaledFixedThreshold(metrics, minDrawerHeight))) {
    failures.push(`compact mobile open inventory is too small: ${inventory?.visibleHeight ?? 0}px visible`);
  }

  if (isProductionFixedProfile(metrics.fixedProfileRole)) {
    validateFixedMessageTextFit(metrics, failures);
  }

  if (!status || status.visibleWidth < scaledFixedThreshold(metrics, 52) || status.visibleHeight < scaledFixedThreshold(metrics, 22)) {
    failures.push(`compact mobile status indicator is clipped: ${status?.visibleWidth ?? 0}x${status?.visibleHeight ?? 0}`);
  } else if (status.scrollWidth > status.clientWidth || status.scrollHeight > status.clientHeight) {
    failures.push(`compact mobile status text overflows: ${status.scrollWidth}x${status.scrollHeight} > ${status.clientWidth}x${status.clientHeight}`);
  }

  for (const [name, rect] of buttons) {
    if (!rect || rect.visibleHeight < scaledFixedThreshold(metrics, 52) || rect.visibleWidth < scaledFixedThreshold(metrics, 52)) {
      failures.push(`compact mobile ${name} hitbox is too small: ${rect?.visibleWidth ?? 0}x${rect?.visibleHeight ?? 0}`);
    }
  }
}

function scaledFixedThreshold(metrics, profilePixels) {
  const scale = Number.isFinite(metrics.fixedStageScale) ? metrics.fixedStageScale : 1;
  return Math.max(1, Math.floor(profilePixels * scale) - 1);
}

function validateFixedMessageTextFit(metrics, failures) {
  const latestPanel = metrics.rects.latestPanel;
  const latestMessage = metrics.rects.latestMessage;
  const firstLogEntry = metrics.rects.firstLogEntry;

  if (!metrics.logOpen && !metrics.inventoryOpen) {
    if (latestPanel && latestPanel.scrollHeight > latestPanel.clientHeight + 1) {
      failures.push(
        `fixed latest panel content overflows: ${latestPanel.scrollHeight}px > ${latestPanel.clientHeight}px`
      );
    }

    if (latestMessage && latestMessage.scrollHeight > latestMessage.clientHeight + 1) {
      failures.push(
        `fixed latest message text is clipped: ${latestMessage.scrollHeight}px > ${latestMessage.clientHeight}px`
      );
    }
  }

  if (metrics.logOpen && firstLogEntry && firstLogEntry.scrollHeight > firstLogEntry.clientHeight + 1) {
    failures.push(
      `fixed first log entry text is clipped: ${firstLogEntry.scrollHeight}px > ${firstLogEntry.clientHeight}px`
    );
  }
}

function validateFixedStatLabels(metrics, failures) {
  if (metrics.stats.cells < 4) {
    failures.push(`fixed stat cells are missing: ${metrics.stats.cells}/4`);
  }

  if (metrics.stats.styledCells < metrics.stats.cells) {
    failures.push(`fixed stat cells lack physical styling: ${metrics.stats.styledCells}/${metrics.stats.cells}`);
  }

  for (const expectedLabel of ['ATK', 'DEF', 'XP', 'TILE']) {
    if (!metrics.stats.labels.includes(expectedLabel)) {
      failures.push(`fixed stat cells are missing ${expectedLabel} label`);
    }
  }

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

  for (const [label, rect] of [
    ['attack value', metrics.rects.statAttackValue],
    ['defense value', metrics.rects.statDefenseValue],
    ['xp value', metrics.rects.statXpValue],
    ['tile value', metrics.rects.tileStatValue]
  ]) {
    if (!rect) {
      failures.push(`fixed ${label} is missing`);
    } else if (rect.scrollWidth > rect.clientWidth + 1) {
      failures.push(`fixed ${label} is clipped: ${rect.scrollWidth}px > ${rect.clientWidth}px`);
    }
  }
}

function isCompactFixedProfile(fixedProfile) {
  return fixedProfile === 'reference-mobile' || fixedProfile === 'reference-mobile-v2';
}

function isProductionFixedProfile(profileRole) {
  return profileRole === 'default' || profileRole === 'variant';
}

function isDesktopFixedProfile(fixedProfile) {
  return fixedProfile === desktopFixedProfile;
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
