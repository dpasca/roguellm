import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_URL = 'http://127.0.0.1:8127/game2?game_id=159e473b&fixture=1';
const DEFAULT_WORKBENCH_URL = 'http://127.0.0.1:5273/game2/workbench?workbench=skin';
const DEFAULT_FIXED_WORKBENCH_URL = 'http://127.0.0.1:5273/game2/workbench?workbench=fixed-skin';
const entryUrl = process.argv[2] ?? process.env.GAME2_VISUAL_URL ?? DEFAULT_URL;
const workbenchUrl = process.env.GAME2_WORKBENCH_URL ?? DEFAULT_WORKBENCH_URL;
const fixedWorkbenchUrl = process.env.GAME2_FIXED_WORKBENCH_URL ?? DEFAULT_FIXED_WORKBENCH_URL;
const withQueryParams = (url, params) => {
  const search = new URLSearchParams(params).toString();
  return `${url}${url.includes('?') ? '&' : '?'}${search}`;
};
const fixedWorkbenchProfileUrl = (profile) =>
  `${fixedWorkbenchUrl}${fixedWorkbenchUrl.includes('?') ? '&' : '?'}profile=${encodeURIComponent(profile)}`;
const fixedRuntimeUrl = withQueryParams(entryUrl, { ui: 'fixed-skin', profile: 'gold-mobile' });
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
    url: entryUrl
  },
  {
    name: 'mobile-fixed-runtime-ready',
    viewport: { width: 390, height: 844 },
    mode: 'fixed-runtime-ready',
    url: fixedRuntimeUrl
  },
  {
    name: 'mobile-fixed-runtime-log',
    viewport: { width: 390, height: 844 },
    mode: 'fixed-runtime-log',
    url: fixedRuntimeUrl
  },
  {
    name: 'mobile-fixed-runtime-combat',
    viewport: { width: 390, height: 844 },
    mode: 'fixed-runtime-combat',
    url: fixedRuntimeUrl
  },
  {
    name: 'mobile-gold-fixed-workbench-movement',
    viewport: { width: 390, height: 844 },
    mode: 'fixed-workbench-movement',
    url: `${fixedWorkbenchProfileUrl('gold-mobile')}&scenario=movement`
  },
  {
    name: 'mobile-gold-fixed-workbench-diagnostics',
    viewport: { width: 390, height: 844 },
    mode: 'fixed-workbench-diagnostics',
    url: `${fixedWorkbenchProfileUrl('gold-mobile')}&scenario=diagnostics`
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
    url: fixedWorkbenchUrl
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

  const metrics = await collectMetrics(page);
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
    return document.body.dataset.fixedScenario === 'movement' &&
      !document.body.classList.contains('in-combat') &&
      latest?.includes('moved E');
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
      fixedScenario: document.body.dataset.fixedScenario ?? null,
      inCombat: document.body.classList.contains('in-combat'),
      gameEnded: document.body.classList.contains('game-ended'),
      logOpen: document.body.classList.contains('log-open'),
      inventoryOpen: document.body.classList.contains('fixed-inventory-open'),
      statusText: document.getElementById('connection-status')?.textContent?.trim() ?? '',
      latestText: document.getElementById('latest-message')?.textContent?.trim() ?? '',
      latestTextLength: document.getElementById('latest-message')?.textContent?.trim().length ?? 0,
      playerHpText: document.getElementById('player-hp')?.textContent?.trim() ?? '',
      combatTitleText: document.getElementById('combat-mode-label')?.textContent?.trim() ?? '',
      enemyNameText: document.getElementById('enemy-name')?.textContent?.trim() ?? '',
      diagnosticAssetCount: document.querySelectorAll('.fixed-diagnostics-board img').length,
      endStateText: document.getElementById('end-state-message')?.textContent?.trim() ?? '',
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

  failures.push(...validateAssetUsage(metrics));
  return failures;
}

function validateFixedRuntimeScenario(scenario, metrics, failures) {
  if (metrics.ui !== 'fixed-skin') {
    failures.push(`expected fixed-skin runtime ui, got ${metrics.ui ?? 'none'}`);
  }

  if (metrics.workbench) {
    failures.push(`fixed runtime should not be in workbench mode: ${metrics.workbench}`);
  }

  if (metrics.fixedProfile !== 'gold-mobile') {
    failures.push(`expected gold-mobile runtime profile, got ${metrics.fixedProfile ?? 'none'}`);
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

  validateGoldMobileLayout(metrics, failures);
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
  const isGoldProfile = metrics.fixedProfile === 'gold-mobile';
  const isMovementScenario = scenario.mode === 'fixed-workbench-movement';
  const isDiagnosticsScenario = scenario.mode === 'fixed-workbench-diagnostics';
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

  if (!isMovementScenario && !isEndStateScenario && !isRestartScenario && !metrics.inCombat) {
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
    if (metrics.combatTitleText !== 'Explore' || metrics.enemyNameText !== 'No hostile') {
      failures.push(`movement scenario should show exploration panel, got ${metrics.combatTitleText}/${metrics.enemyNameText}`);
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

  if (isGoldProfile) {
    validateGoldMobileLayout(metrics, failures);
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

function validateGoldMobileLayout(metrics, failures) {
  const map = metrics.rects.map;
  const latest = metrics.rects.latestPanel;
  const player = metrics.rects.playerPanel;
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
    failures.push(`gold mobile map is too dominant: ${map.height}px high`);
  }

  if (!metrics.logOpen && !metrics.inventoryOpen && (!latest || latest.visibleHeight < 78)) {
    failures.push(`gold mobile latest area is too small: ${latest?.visibleHeight ?? 0}px visible`);
  }

  if (!player || player.visibleHeight < 50) {
    failures.push(`gold mobile player panel is too small: ${player?.visibleHeight ?? 0}px visible`);
  }

  if (!combat || combat.visibleHeight < 56) {
    failures.push(`gold mobile combat panel is too small: ${combat?.visibleHeight ?? 0}px visible`);
  }

  if (metrics.logOpen && (!log || log.visibleHeight < 180)) {
    failures.push(`gold mobile open log is too small: ${log?.visibleHeight ?? 0}px visible`);
  }

  if (!status || status.visibleWidth < 52 || status.visibleHeight < 22) {
    failures.push(`gold mobile status indicator is clipped: ${status?.visibleWidth ?? 0}x${status?.visibleHeight ?? 0}`);
  } else if (status.scrollWidth > status.clientWidth || status.scrollHeight > status.clientHeight) {
    failures.push(`gold mobile status text overflows: ${status.scrollWidth}x${status.scrollHeight} > ${status.clientWidth}x${status.clientHeight}`);
  }

  for (const [name, rect] of buttons) {
    if (!rect || rect.visibleHeight < 52 || rect.visibleWidth < 52) {
      failures.push(`gold mobile ${name} hitbox is too small: ${rect?.visibleWidth ?? 0}x${rect?.visibleHeight ?? 0}`);
    }
  }
}

function isCompactFixedProfile(fixedProfile) {
  return fixedProfile === 'reference-mobile' || fixedProfile === 'reference-mobile-v2';
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
