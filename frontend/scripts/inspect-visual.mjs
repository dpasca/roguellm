import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_URL = 'http://127.0.0.1:8127/game2?game_id=159e473b&fixture=1';
const entryUrl = process.argv[2] ?? process.env.GAME2_VISUAL_URL ?? DEFAULT_URL;
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = process.env.VISUAL_OUT_DIR
  ? path.resolve(process.env.VISUAL_OUT_DIR)
  : path.resolve('visual-inspections', timestamp);

const scenarios = [
  {
    name: 'mobile-ready',
    viewport: { width: 390, height: 844 },
    mode: 'ready'
  },
  {
    name: 'mobile-combat',
    viewport: { width: 390, height: 844 },
    mode: 'combat'
  },
  {
    name: 'mobile-log-open',
    viewport: { width: 390, height: 844 },
    mode: 'log'
  },
  {
    name: 'mobile-short-ready',
    viewport: { width: 390, height: 667 },
    mode: 'ready'
  },
  {
    name: 'desktop-ready',
    viewport: { width: 1280, height: 900 },
    mode: 'ready'
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

  await page.goto(entryUrl, { waitUntil: 'domcontentloaded' });
  await waitForGameReady(page);

  if (scenario.mode === 'combat') {
    await page.getByRole('button', { name: 'E', exact: true }).click();
    await waitForCombatReady(page);
  }

  if (scenario.mode === 'log') {
    await page.getByRole('button', { name: 'Log', exact: true }).click();
    await waitForLogOpen(page);
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
    return status === 'ready' && document.body.classList.contains('log-open');
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
      firstLogEntry: '#game-log p.latest'
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
        display: style.display,
        opacity: style.opacity,
        backgroundImage: style.backgroundImage,
        backgroundRepeat: style.backgroundRepeat,
        backgroundSize: style.backgroundSize,
        borderImageSource: style.borderImageSource,
        borderImageRepeat: style.borderImageRepeat,
        borderImageSlice: style.borderImageSlice
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
      inCombat: document.body.classList.contains('in-combat'),
      logOpen: document.body.classList.contains('log-open'),
      latestTextLength: document.getElementById('latest-message')?.textContent?.trim().length ?? 0,
      rects
    };
  });
}

function validateMetrics(scenario, metrics) {
  const failures = [];
  const isMobile = scenario.viewport.width <= 860;

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
    if (!latest || latest.display === 'none') {
      failures.push('mobile latest message is not visible');
    } else if (latest.visibleHeight < 56) {
      failures.push(`mobile latest message is too short: ${latest.visibleHeight}px visible`);
    }

    const log = metrics.rects.logPanel;
    if (!log || log.display === 'none') {
      failures.push('mobile log drawer is missing from DOM');
    } else if (!metrics.logOpen && (Number(log.opacity) > 0.01 || log.visibleHeight > 2)) {
      failures.push(`mobile log drawer leaks while closed: opacity=${log.opacity}, visibleHeight=${log.visibleHeight}px`);
    }

    if (scenario.mode === 'log') {
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
    if (latestPanel && latestPanel.display !== 'none') {
      failures.push('desktop should hide mobile latest panel');
    }

    const log = metrics.rects.logPanel;
    if (!log || log.visibleHeight < 160) {
      failures.push(`desktop log is too small: ${log?.visibleHeight ?? 0}px visible`);
    }
  }

  if (scenario.mode === 'combat') {
    if (!metrics.inCombat) {
      failures.push('combat scenario did not enter combat');
    }

    const combat = metrics.rects.combatPanel;
    if (!combat || combat.visibleHeight < 56) {
      failures.push(`combat panel is too small: ${combat?.visibleHeight ?? 0}px visible`);
    }
  }

  failures.push(...validateAssetUsage(metrics));
  return failures;
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
