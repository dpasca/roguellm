import { chromium } from 'playwright';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

const rootDir = path.resolve(new URL('..', import.meta.url).pathname);
const artBlueprintPath = path.join(rootDir, 'src/skins/SKIN_ART_BLUEPRINT_V1.json');
const artBlueprint = JSON.parse(await fs.readFile(artBlueprintPath, 'utf8'));
const DEFAULT_URL = 'http://127.0.0.1:8127/game2?game_id=159e473b&fixture=1';
const DEFAULT_VITE_GAME_ID_URL = 'http://127.0.0.1:5273/game2?game_id=159e473b&fixture=1';
const DEFAULT_WORKBENCH_URL = 'http://127.0.0.1:5273/game2/workbench?workbench=skin';
const DEFAULT_FIXED_WORKBENCH_URL = 'http://127.0.0.1:5273/game2/workbench?workbench=fixed-skin';
const entryUrl = process.argv[2] ?? process.env.GAME2_VISUAL_URL ?? DEFAULT_URL;
const viteGameIdUrl = process.env.GAME2_VITE_GAME_ID_URL ?? DEFAULT_VITE_GAME_ID_URL;
const workbenchUrl = process.env.GAME2_WORKBENCH_URL ?? DEFAULT_WORKBENCH_URL;
const fixedWorkbenchBaseUrl = process.env.GAME2_FIXED_WORKBENCH_URL ?? DEFAULT_FIXED_WORKBENCH_URL;
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
const fixedWorkbenchUrl = fixedWorkbenchBaseUrl;
const defaultFixedWorkbenchProfileUrl = (profile) =>
  `${fixedWorkbenchBaseUrl}${fixedWorkbenchBaseUrl.includes('?') ? '&' : '?'}profile=${encodeURIComponent(profile)}`;
const fixedWorkbenchProfileUrl = (profile) =>
  `${fixedWorkbenchUrl}${fixedWorkbenchUrl.includes('?') ? '&' : '?'}profile=${encodeURIComponent(profile)}`;
const phaserFixedWorkbenchProfileUrl = (profile, extraParams = {}) =>
  withQueryParams(defaultFixedWorkbenchProfileUrl(profile), extraParams);
const defaultFixedProfile = 'reference-mobile-v3';
const compactFixedProfile = 'neon-shrine-mobile-compact';
const desktopFixedProfile = 'desktop-wide';
const sourceMaterialPhaserProfiles = new Set([
  'terminal-green-mobile-compact',
  'neon-shrine-mobile-compact',
  'ai-cyberdeck-reference-v1',
  'obsidian-rain-proto'
]);
const actionLabelPhaserProfiles = new Set([
  'neon-shrine-mobile-compact',
  'ai-cyberdeck-reference-v1',
  'obsidian-rain-proto'
]);
const defaultPhaserMapDetailFloor = 520;
const phaserMapDetailFloors = new Map([
  ['obsidian-rain-proto', 700]
]);
const fixedRuntimeUrl = withQueryParams(entryUrl, { ui: 'fixed-skin', profile: defaultFixedProfile });
const phaserFixedRuntimeUrl = withQueryParams(entryUrl, { ui: 'fixed-skin', profile: compactFixedProfile });
const desktopFixedRuntimeUrl = withQueryParams(entryUrl, { ui: 'fixed-skin' });
const classicRuntimeUrl = entryUrl;
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = process.env.VISUAL_OUT_DIR
  ? path.resolve(process.env.VISUAL_OUT_DIR)
  : path.resolve('visual-inspections', timestamp);
const scenarioFilters = (process.env.VISUAL_SCENARIOS ?? process.env.VISUAL_SCENARIO ?? '')
  .split(',')
  .map((filter) => filter.trim())
  .filter(Boolean);
const fixedSkinDir = path.join(rootDir, 'src/skins/neo-tokyo-console/fixed');
const fixedProfileKitCache = new Map();
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
    mode: 'phaser-fixed-runtime-ready',
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
    name: 'mobile-short-phaser-fixed-runtime-ready',
    viewport: { width: 390, height: 667 },
    mode: 'phaser-fixed-runtime-ready',
    url: phaserFixedRuntimeUrl,
    expectedFixedProfile: compactFixedProfile
  },
  {
    name: 'mobile-short-phaser-fixed-runtime-log',
    viewport: { width: 390, height: 667 },
    mode: 'phaser-fixed-runtime-log',
    url: phaserFixedRuntimeUrl,
    expectedFixedProfile: compactFixedProfile
  },
  {
    name: 'mobile-short-phaser-fixed-runtime-inventory',
    viewport: { width: 390, height: 667 },
    mode: 'phaser-fixed-runtime-inventory',
    url: phaserFixedRuntimeUrl,
    expectedFixedProfile: compactFixedProfile
  },
  {
    name: 'mobile-short-phaser-fixed-runtime-combat',
    viewport: { width: 390, height: 667 },
    mode: 'phaser-fixed-runtime-combat',
    url: phaserFixedRuntimeUrl,
    expectedFixedProfile: compactFixedProfile
  },
  {
    name: 'mobile-short-default-fixed-workbench',
    viewport: { width: 390, height: 667 },
    mode: 'phaser-fixed-workbench',
    url: fixedWorkbenchUrl,
    expectedFixedProfile: compactFixedProfile
  },
  {
    name: 'mobile-short-phaser-fixed-workbench',
    viewport: { width: 390, height: 667 },
    mode: 'phaser-fixed-workbench',
    url: phaserFixedWorkbenchProfileUrl(compactFixedProfile),
    expectedFixedProfile: compactFixedProfile
  },
  {
    name: 'mobile-short-phaser-fixed-workbench-log',
    viewport: { width: 390, height: 667 },
    mode: 'phaser-fixed-workbench-log',
    url: phaserFixedWorkbenchProfileUrl(compactFixedProfile),
    expectedFixedProfile: compactFixedProfile
  },
  {
    name: 'mobile-short-phaser-fixed-workbench-inventory',
    viewport: { width: 390, height: 667 },
    mode: 'phaser-fixed-workbench-inventory',
    url: phaserFixedWorkbenchProfileUrl(compactFixedProfile),
    expectedFixedProfile: compactFixedProfile
  },
  {
    name: 'mobile-short-phaser-fixed-workbench-inventory-use',
    viewport: { width: 390, height: 667 },
    mode: 'phaser-fixed-workbench-inventory-use',
    url: phaserFixedWorkbenchProfileUrl(compactFixedProfile),
    expectedFixedProfile: compactFixedProfile
  },
  {
    name: 'mobile-short-phaser-fixed-workbench-defeat',
    viewport: { width: 390, height: 667 },
    mode: 'phaser-fixed-workbench-defeat',
    url: phaserFixedWorkbenchProfileUrl(compactFixedProfile, { scenario: 'defeat' }),
    expectedFixedProfile: compactFixedProfile
  },
  {
    name: 'mobile-short-phaser-fixed-workbench-victory',
    viewport: { width: 390, height: 667 },
    mode: 'phaser-fixed-workbench-victory',
    url: phaserFixedWorkbenchProfileUrl(compactFixedProfile, { scenario: 'victory' }),
    expectedFixedProfile: compactFixedProfile
  },
  {
    name: 'mobile-short-phaser-fixed-workbench-restart',
    viewport: { width: 390, height: 667 },
    mode: 'phaser-fixed-workbench-restart',
    url: phaserFixedWorkbenchProfileUrl(compactFixedProfile, { scenario: 'defeat' }),
    expectedFixedProfile: compactFixedProfile
  },
  {
    name: 'mobile-short-phaser-signal-fixed-workbench',
    viewport: { width: 390, height: 667 },
    mode: 'phaser-fixed-workbench',
    url: phaserFixedWorkbenchProfileUrl('signal-noir-mobile-compact'),
    expectedFixedProfile: 'signal-noir-mobile-compact'
  },
  {
    name: 'mobile-short-phaser-gold-fixed-workbench',
    viewport: { width: 390, height: 667 },
    mode: 'phaser-fixed-workbench',
    url: phaserFixedWorkbenchProfileUrl('gold-mobile-compact'),
    expectedFixedProfile: 'gold-mobile-compact'
  },
  {
    name: 'mobile-short-phaser-amber-fixed-workbench',
    viewport: { width: 390, height: 667 },
    mode: 'phaser-fixed-workbench',
    url: phaserFixedWorkbenchProfileUrl('amber-mobile-compact'),
    expectedFixedProfile: 'amber-mobile-compact'
  },
  {
    name: 'mobile-short-phaser-terminal-fixed-workbench',
    viewport: { width: 390, height: 667 },
    mode: 'phaser-fixed-workbench',
    url: phaserFixedWorkbenchProfileUrl('terminal-green-mobile-compact'),
    expectedFixedProfile: 'terminal-green-mobile-compact'
  },
  {
    name: 'mobile-short-phaser-terminal-fixed-workbench-log',
    viewport: { width: 390, height: 667 },
    mode: 'phaser-fixed-workbench-log',
    url: phaserFixedWorkbenchProfileUrl('terminal-green-mobile-compact'),
    expectedFixedProfile: 'terminal-green-mobile-compact'
  },
  {
    name: 'mobile-short-phaser-terminal-fixed-workbench-inventory',
    viewport: { width: 390, height: 667 },
    mode: 'phaser-fixed-workbench-inventory',
    url: phaserFixedWorkbenchProfileUrl('terminal-green-mobile-compact'),
    expectedFixedProfile: 'terminal-green-mobile-compact'
  },
  {
    name: 'mobile-short-phaser-terminal-fixed-workbench-click-log',
    viewport: { width: 390, height: 667 },
    mode: 'phaser-fixed-workbench-click-log',
    url: phaserFixedWorkbenchProfileUrl('terminal-green-mobile-compact'),
    expectedFixedProfile: 'terminal-green-mobile-compact'
  },
  {
    name: 'mobile-short-phaser-terminal-fixed-workbench-click-inventory',
    viewport: { width: 390, height: 667 },
    mode: 'phaser-fixed-workbench-click-inventory',
    url: phaserFixedWorkbenchProfileUrl('terminal-green-mobile-compact'),
    expectedFixedProfile: 'terminal-green-mobile-compact'
  },
  {
    name: 'mobile-short-phaser-terminal-fixed-workbench-click-move',
    viewport: { width: 390, height: 667 },
    mode: 'phaser-fixed-workbench-click-move',
    url: phaserFixedWorkbenchProfileUrl('terminal-green-mobile-compact', { scenario: 'movement' }),
    expectedFixedProfile: 'terminal-green-mobile-compact'
  },
  {
    name: 'mobile-short-phaser-terminal-fixed-workbench-hover-run',
    viewport: { width: 390, height: 667 },
    mode: 'phaser-fixed-workbench-hover-run',
    url: phaserFixedWorkbenchProfileUrl('terminal-green-mobile-compact'),
    expectedFixedProfile: 'terminal-green-mobile-compact'
  },
  {
    name: 'mobile-short-phaser-terminal-fixed-workbench-press-run',
    viewport: { width: 390, height: 667 },
    mode: 'phaser-fixed-workbench-press-run',
    url: phaserFixedWorkbenchProfileUrl('terminal-green-mobile-compact'),
    expectedFixedProfile: 'terminal-green-mobile-compact'
  },
  {
    name: 'mobile-short-phaser-obsidian-fixed-workbench',
    viewport: { width: 390, height: 667 },
    mode: 'phaser-fixed-workbench',
    url: phaserFixedWorkbenchProfileUrl('obsidian-rain-proto'),
    expectedFixedProfile: 'obsidian-rain-proto'
  },
  {
    name: 'mobile-short-phaser-obsidian-fixed-workbench-log',
    viewport: { width: 390, height: 667 },
    mode: 'phaser-fixed-workbench-log',
    url: phaserFixedWorkbenchProfileUrl('obsidian-rain-proto'),
    expectedFixedProfile: 'obsidian-rain-proto'
  },
  {
    name: 'mobile-short-phaser-obsidian-fixed-workbench-inventory',
    viewport: { width: 390, height: 667 },
    mode: 'phaser-fixed-workbench-inventory',
    url: phaserFixedWorkbenchProfileUrl('obsidian-rain-proto'),
    expectedFixedProfile: 'obsidian-rain-proto'
  },
  {
    name: 'mobile-short-phaser-ai-reference-fixed-workbench',
    viewport: { width: 390, height: 667 },
    mode: 'phaser-fixed-workbench',
    url: phaserFixedWorkbenchProfileUrl('ai-cyberdeck-reference-v1'),
    expectedFixedProfile: 'ai-cyberdeck-reference-v1'
  },
  {
    name: 'mobile-short-phaser-ai-reference-fixed-workbench-log',
    viewport: { width: 390, height: 667 },
    mode: 'phaser-fixed-workbench-log',
    url: phaserFixedWorkbenchProfileUrl('ai-cyberdeck-reference-v1'),
    expectedFixedProfile: 'ai-cyberdeck-reference-v1'
  },
  {
    name: 'mobile-short-phaser-ai-reference-fixed-workbench-inventory',
    viewport: { width: 390, height: 667 },
    mode: 'phaser-fixed-workbench-inventory',
    url: phaserFixedWorkbenchProfileUrl('ai-cyberdeck-reference-v1'),
    expectedFixedProfile: 'ai-cyberdeck-reference-v1'
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
    expectedFixedProfile: 'reference-mobile-compact'
  },
  {
    name: 'mobile-short-phaser-profile-cycle-fixed-workbench',
    viewport: { width: 390, height: 667 },
    mode: 'phaser-fixed-workbench-profile-cycle',
    url: phaserFixedWorkbenchProfileUrl(compactFixedProfile),
    expectedFixedProfile: 'reference-mobile-compact'
  },
  {
    name: 'mobile-rain-city-derived-compact-fixed-workbench',
    viewport: { width: 390, height: 667 },
    mode: 'fixed-workbench',
    url: fixedWorkbenchProfileUrl('rain-city-derived-compact'),
    expectedFixedProfile: 'rain-city-derived-compact'
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
      ['renderer', 'dom'],
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
    mode: 'ready',
    url: classicRuntimeUrl
  },
  {
    name: 'desktop-workbench',
    viewport: { width: 1280, height: 900 },
    mode: 'workbench',
    url: workbenchUrl
  },
  {
    name: 'desktop-default-fixed-runtime-ready',
    viewport: { width: 1280, height: 900 },
    mode: 'phaser-fixed-runtime-ready',
    url: entryUrl,
    expectedFixedProfile: desktopFixedProfile
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
const scenarios = withProductionProfileCoverage(baseScenarios, productionMobileProfiles)
  .filter(isSupportedScenario);
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

const profileSummaries = buildProfileSummaries(results);
const profileSimilarities = buildProfileSimilarities(profileSummaries);
const skinAssetSummaries = await buildSkinAssetSummaries(productionMobileProfiles, outDir);
const skinAssetSimilarities = buildSkinAssetSimilarities(skinAssetSummaries);
const skinAssetFailures = buildSkinAssetFailures(skinAssetSimilarities);
annotateProfileSimilarityFlags(profileSummaries, profileSimilarities, skinAssetSimilarities);
annotateProfileAssetSimilarityFlags(profileSummaries, skinAssetSimilarities);
const summary = {
  entryUrl,
  workbenchUrl,
  fixedWorkbenchUrl,
  scenarioFilters,
  productionProfileRenderer: 'phaser',
  productionMobileProfiles,
  profileSummaries,
  profileSimilarities,
  skinAssetSummaries,
  skinAssetSimilarities,
  skinAssetFailures,
  artBlueprint: visualArtBlueprintSummary(artBlueprint, productionMobileProfiles),
  managedViteServer: Boolean(managedViteServer),
  outDir,
  generatedAt: new Date().toISOString(),
  results,
  ok: results.every((result) => result.failures.length === 0) && skinAssetFailures.length === 0
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
const skinAssetReportLines = skinAssetFailures.length === 0
  ? []
  : ['FAIL skin asset uniqueness gate', ...skinAssetFailures.map((failure) => `  - ${failure}`)];

console.log(`Visual inspection output: ${path.relative(process.cwd(), outDir)}`);
console.log([...reportLines, ...skinAssetReportLines].join('\n'));

if (!summary.ok) {
  process.exitCode = 1;
}

function buildHtmlReport(summary) {
  const blueprintReview = buildBlueprintReview(summary);
  const profileBench = buildProfileBench(summary);
  const skinAssetWatch = buildSkinAssetWatch(summary);
  const similarityWatch = buildSimilarityWatch(summary);
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
      metrics.rects.statusPill?.visualState ? `status state ${metrics.rects.statusPill.visualState}` : null,
      metrics.mapGlass?.glassStyled ? 'map glass' : null,
      metrics.controls?.panelStyled ? 'control bay' : null,
      metrics.drawerToggles?.spriteToggles === metrics.drawerToggles?.visibleToggles ? 'drawer toggles' : null,
      metrics.title?.iconStyled ? 'title badge' : null,
      metrics.latest?.messageStyled && !metrics.logOpen && !metrics.inventoryOpen ? 'latest hardware' : null,
      metrics.hp?.labelStyled && metrics.hp?.valueStyled ? 'hp hardware' : null,
      metrics.combat?.modeStyled ? `mode ${metrics.combat.modeState || 'set'}` : null,
      metrics.gameEnded && metrics.endState?.outcome ? `terminal ${metrics.endState.outcome}` : null,
      metrics.stats?.cells ? `stats ${metrics.stats.styledCells}/${metrics.stats.cells}` : null,
      metrics.logOpen && metrics.log?.entries ? `log tags ${metrics.log.visibleEntryTags}/${metrics.log.entries}` : null,
      metrics.logOpen && metrics.log?.scrollable ? 'log scroll cue' : null,
      metrics.inventoryOpen && metrics.inventory?.items ? `inv badges ${metrics.inventory.visibleTypeBadges}/${metrics.inventory.items}` : null,
      metrics.inventoryOpen && metrics.inventory?.equippedItems ? `inv on ${metrics.inventory.styledEquippedActions}/${metrics.inventory.equippedItems}` : null,
      Number.isFinite(metrics.phaserMapTileDetails) ? `tile detail ${metrics.phaserMapTileDetails}` : null,
      Number.isFinite(metrics.phaserFogTileDetails) ? `fog detail ${metrics.phaserFogTileDetails}` : null,
      Number.isFinite(metrics.phaserMapScannerDetails) ? `scanner detail ${metrics.phaserMapScannerDetails}` : null,
      Number.isFinite(metrics.phaserControlDetails) ? `control detail ${metrics.phaserControlDetails}` : null,
      Number.isFinite(metrics.phaserHudDetails) ? `hud detail ${metrics.phaserHudDetails}` : null,
      Number.isFinite(metrics.phaserTextSlots) ? `text slots ${metrics.phaserTextSlots}` : null,
      Number.isFinite(metrics.phaserTextOverflows) ? `text overflow ${metrics.phaserTextOverflows}` : null,
      Number.isFinite(metrics.phaserShellDetails) ? `shell detail ${metrics.phaserShellDetails}` : null,
      Number.isFinite(metrics.phaserSourceMaterialPanels) ? `source materials ${metrics.phaserSourceMaterialPanels}` : null,
      metrics.phaserSourceMaterialKinds ? `source kinds ${metrics.phaserSourceMaterialKinds}` : null,
      metrics.phaserButtonStates ? `buttons ${metrics.phaserButtonStates}` : null,
      metrics.phaserPointerButtonState ? `pointer ${metrics.phaserPointerButtonState}` : null,
      Number.isFinite(metrics.phaserLogRows) ? `log rows ${metrics.phaserLogRows}` : null,
      Number.isFinite(metrics.phaserInventoryRows) ? `inventory rows ${metrics.phaserInventoryRows}` : null,
      Number.isFinite(metrics.phaserInventoryActionChips) ? `inventory chips ${metrics.phaserInventoryActionChips}` : null,
      Number.isFinite(metrics.phaserInventoryTextBackplates) ? `inventory text plates ${metrics.phaserInventoryTextBackplates}` : null,
      Number.isFinite(metrics.phaserDrawerToggleIcons) ? `drawer icons ${metrics.phaserDrawerToggleIcons}` : null,
      Number.isFinite(metrics.phaserMovementLockBadges) ? `movement lock ${metrics.phaserMovementLockBadges}` : null,
      metrics.skinClasses?.length ? `skin classes ${metrics.skinClasses.join(',')}` : null,
      metrics.mapIcons?.item || metrics.mapIcons?.enemy
        ? `map badges ${metrics.mapIcons.itemBadges + metrics.mapIcons.enemyBadges}/${metrics.mapIcons.item + metrics.mapIcons.enemy}`
        : null,
      metrics.inCombat && metrics.combat?.enemyBadgeStyled ? 'enemy badge' : null,
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
    .profile-bench {
      margin: 0 0 26px;
    }
    .blueprint-review {
      margin: 0 0 26px;
      padding: 14px;
      border: 1px solid #315057;
      background: linear-gradient(180deg, #101819, #080d0d);
      box-shadow: 0 16px 42px rgba(0, 0, 0, 0.28);
    }
    .blueprint-summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 10px;
      margin: 12px 0;
    }
    .blueprint-summary div {
      padding: 10px;
      border: 1px solid #243b3e;
      background: #071011;
    }
    .blueprint-summary span {
      display: block;
      color: #8aa2a0;
      font-size: 10px;
      font-weight: 900;
      text-transform: uppercase;
    }
    .blueprint-summary strong {
      display: block;
      margin-top: 4px;
      color: #eafff1;
      font-size: 13px;
    }
    .blueprint-review h3 {
      margin: 16px 0 8px;
      color: #8de7ff;
      font-size: 12px;
      text-transform: uppercase;
    }
    .blueprint-review ul {
      margin: 0;
      padding: 0 0 0 20px;
      color: #d7e5e0;
    }
    .blueprint-review li {
      margin: 5px 0;
    }
    .blueprint-intent {
      color: #d3fff1;
    }
    .blueprint-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .blueprint-chips span {
      padding: 4px 7px;
      border: 1px solid #2b4d4f;
      color: #d6fff0;
      font-size: 11px;
      background: #07100e;
    }
    .blueprint-chips.muted span {
      color: #c0d2ce;
    }
    .section-heading {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 14px;
      align-items: baseline;
      justify-content: space-between;
      margin: 0 0 12px;
    }
    .section-heading h2 {
      margin: 0;
      color: #d9ffd5;
      font-size: 18px;
    }
    .section-heading p {
      max-width: 760px;
      color: #9caaa6;
    }
    .profile-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 16px;
    }
    .profile-card {
      min-width: 0;
      border: 1px solid #28413d;
      background: linear-gradient(180deg, #0d1514, #070b0b);
      box-shadow: 0 16px 42px rgba(0, 0, 0, 0.32);
    }
    .profile-card header {
      display: flex;
      gap: 10px;
      align-items: center;
      justify-content: space-between;
      padding: 10px;
      border-bottom: 1px solid #203332;
    }
    .profile-thumbs {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(92px, 1fr));
      gap: 8px;
      padding: 10px 10px 0;
    }
    .profile-thumbs a {
      position: relative;
      overflow: hidden;
      min-height: 120px;
      border: 1px solid #1f3431;
      color: #d7ffd0;
      text-decoration: none;
      background: #030606;
    }
    .profile-thumbs img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: top center;
    }
    .profile-thumbs span {
      position: absolute;
      right: 4px;
      bottom: 4px;
      padding: 3px 5px;
      color: #061006;
      font-size: 10px;
      font-weight: 900;
      text-transform: uppercase;
      background: #8dff77;
    }
    .review-flags {
      display: grid;
      gap: 4px;
      margin: 0;
      padding: 0 10px 12px 26px;
      color: #d3ddd9;
      font-size: 12px;
    }
    .similarity-watch {
      margin: 0 0 26px;
    }
    .similarity-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 14px;
    }
    .similarity-card {
      border: 1px solid #34423a;
      background: #0a0f0e;
    }
    .similarity-card header {
      display: flex;
      gap: 10px;
      align-items: center;
      justify-content: space-between;
      padding: 10px;
      border-bottom: 1px solid #1f2d2b;
    }
    .similarity-card h3 {
      margin: 0;
      font-size: 13px;
    }
    .similarity-card p {
      margin-top: 2px;
    }
    .similarity-score {
      padding: 4px 7px;
      color: #071007;
      font-size: 11px;
      font-weight: 900;
      background: #ffd460;
    }
    .similarity-thumbs {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      padding: 10px;
    }
    .similarity-thumbs img {
      width: 100%;
      height: 160px;
      object-fit: cover;
      object-position: top center;
      border: 1px solid #1f3431;
    }
    .asset-thumbs img {
      height: 260px;
      object-fit: contain;
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
    <span>${summary.productionProfileRenderer ?? 'mixed'} production renderer</span>
    <span>${summary.skinAssetFailures?.length ? `${summary.skinAssetFailures.length} skin asset failures` : 'skin asset gate OK'}</span>
    <span>${escapeHtml(summary.generatedAt)}</span>
  </div>
  ${blueprintReview}
  ${profileBench}
  ${skinAssetWatch}
  ${similarityWatch}
  <main>${cards}</main>
</body>
</html>
`;
}

function buildProfileSummaries(results) {
  const groups = new Map();
  for (const result of results) {
    const metrics = result.metrics ?? {};
    const profileId = metrics.fixedProfile ?? result.expectedFixedProfile;
    if (!profileId) {
      continue;
    }

    const profileMeta = productionMobileProfiles.find((profile) => profile.id === profileId);
    const group = groups.get(profileId) ?? {
      id: profileId,
      role: metrics.fixedProfileRole ?? profileMeta?.role ?? null,
      kind: metrics.fixedProfileKind ?? profileMeta?.kind ?? null,
      defaultPriority: profileMeta?.defaultPriority ?? null,
      scenarios: 0,
      failures: 0,
      modes: new Set(),
      thumbnails: {},
      means: [],
      contrasts: [],
      saturations: [],
      colors: [],
      shellDetails: [],
      controlDetails: [],
      textOverflows: [],
      signatures: [],
      diagnosticSignatures: []
    };

    group.scenarios += 1;
    group.failures += result.failures.length;
    group.modes.add(result.mode);
    group.role ??= metrics.fixedProfileRole ?? profileMeta?.role ?? null;
    group.kind ??= metrics.fixedProfileKind ?? profileMeta?.kind ?? null;
    addFinite(group.means, metrics.screenshot?.mean);
    addFinite(group.contrasts, metrics.screenshot?.standardDeviation);
    addFinite(group.saturations, metrics.screenshot?.saturationMean);
    addFinite(group.colors, metrics.screenshot?.sampledUniqueColors);
    addFinite(group.shellDetails, metrics.phaserShellDetails);
    addFinite(group.controlDetails, metrics.phaserControlDetails);
    addFinite(group.textOverflows, metrics.phaserTextOverflows);
    addSignature(group.signatures, metrics.screenshot?.signature);
    if (isDiagnosticScenario(result)) {
      addSignature(group.diagnosticSignatures, metrics.screenshot?.signature);
    }
    recordProfileThumbnail(group.thumbnails, result);
    groups.set(profileId, group);
  }

  return [...groups.values()]
    .map((group) => {
      const summary = {
        id: group.id,
        role: group.role,
        kind: group.kind,
        defaultPriority: group.defaultPriority,
        scenarios: group.scenarios,
        modes: [...group.modes].sort(),
        failures: group.failures,
        thumbnails: group.thumbnails,
        metrics: {
          mean: average(group.means),
          contrast: average(group.contrasts),
          saturation: average(group.saturations),
          sampledUniqueColors: average(group.colors),
          minShellDetails: minimum(group.shellDetails),
          minControlDetails: minimum(group.controlDetails),
          maxTextOverflows: maximum(group.textOverflows),
          visualSignature: averageSignature(
            group.diagnosticSignatures.length > 0 ? group.diagnosticSignatures : group.signatures
          )
        }
      };
      return {
        ...summary,
        reviewFlags: profileReviewFlags(summary)
      };
    })
    .sort((left, right) =>
      kindSort(left.kind) - kindSort(right.kind) ||
      roleSort(left.role) - roleSort(right.role) ||
      left.id.localeCompare(right.id)
    );
}

function buildProfileSimilarities(profiles) {
  const pairs = [];
  for (let leftIndex = 0; leftIndex < profiles.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < profiles.length; rightIndex += 1) {
      const left = profiles[leftIndex];
      const right = profiles[rightIndex];
      if (left.kind !== right.kind) {
        continue;
      }

      const distance = signatureDistance(left.metrics?.visualSignature, right.metrics?.visualSignature);
      if (!Number.isFinite(distance)) {
        continue;
      }

      pairs.push({
        left: left.id,
        right: right.id,
        kind: left.kind,
        distance,
        severity: distance < 0.055 ? 'near-duplicate' : distance < 0.09 ? 'similar' : 'distinct',
        leftThumbnail: left.thumbnails?.diagnostics ?? Object.values(left.thumbnails ?? {})[0] ?? null,
        rightThumbnail: right.thumbnails?.diagnostics ?? Object.values(right.thumbnails ?? {})[0] ?? null
      });
    }
  }

  return pairs.sort((left, right) => left.distance - right.distance);
}

async function buildSkinAssetSummaries(profiles, reportOutDir) {
  const summaries = [];
  for (const profile of profiles) {
    const kit = await loadFixedProfileKit(profile.id);
    const chassisAssetPath = kit.assets?.chassis?.path ?? 'chassis.png';
    const chassisPath = path.resolve(fixedSkinDir, profile.id, chassisAssetPath);
    const rgbSignature = collectImageSignature(chassisPath, { size: 32, alphaOff: true });
    const materialSignature = collectImageSignature(chassisPath, {
      size: 32,
      alphaOff: true,
      transforms: ['-colorspace', 'HSL', '-channel', 'G', '-separate', '-auto-level']
    });
    const metrics = collectSkinAssetMetrics(chassisPath);

    summaries.push({
      id: profile.id,
      kind: profile.kind,
      role: profile.role,
      defaultPriority: profile.defaultPriority,
      chassis: path.relative(reportOutDir, chassisPath),
      metrics: {
        ...metrics,
        rgbSignature,
        materialSignature
      }
    });
  }

  return summaries.sort((left, right) =>
    kindSort(left.kind) - kindSort(right.kind) ||
    roleSort(left.role) - roleSort(right.role) ||
    left.id.localeCompare(right.id)
  );
}

function buildSkinAssetSimilarities(summaries) {
  const pairs = [];
  for (let leftIndex = 0; leftIndex < summaries.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < summaries.length; rightIndex += 1) {
      const left = summaries[leftIndex];
      const right = summaries[rightIndex];
      if (left.kind !== right.kind) {
        continue;
      }

      const materialDistance = signatureDistance(left.metrics?.materialSignature, right.metrics?.materialSignature);
      const rgbDistance = signatureDistance(left.metrics?.rgbSignature, right.metrics?.rgbSignature);
      if (!Number.isFinite(materialDistance)) {
        continue;
      }

      pairs.push({
        left: left.id,
        right: right.id,
        kind: left.kind,
        distance: materialDistance,
        rgbDistance,
        severity: materialDistance < 0.045 ? 'near-duplicate' : materialDistance < 0.09 ? 'similar' : 'distinct',
        leftAsset: left.chassis,
        rightAsset: right.chassis
      });
    }
  }

  return pairs.sort((left, right) => left.distance - right.distance);
}

function buildSkinAssetFailures(pairs) {
  if (!enforcesProductionSkinAssets()) {
    return [];
  }

  return pairs
    .filter((pair) => pair.severity === 'near-duplicate')
    .map((pair) =>
      `${pair.left} and ${pair.right} are near-duplicate ${pair.kind} chassis assets ` +
      `(material distance ${pair.distance.toFixed(4)})`
    );
}

function visualArtBlueprintSummary(blueprint, profiles) {
  return {
    version: blueprint.version,
    name: blueprint.name,
    targetProfile: blueprint.targetProfile,
    targetProfileCount: profiles.filter((profile) => profile.kind === blueprint.targetProfile).length,
    manualReviewRequired: true,
    intent: blueprint.intent,
    visualTarget: blueprint.visualTarget,
    qualityGates: blueprint.qualityGates ?? [],
    forbiddenDynamicContent: blueprint.forbiddenDynamicContent ?? [],
    reviewScenarios: blueprint.reviewScenarios ?? []
  };
}

function enforcesProductionSkinAssets() {
  return process.env.VISUAL_ENFORCE_SKIN_ASSETS === '1' ||
    scenarioFilters.includes('production') ||
    scenarioFilters.some((filter) => filter.includes('-production-'));
}

function annotateProfileSimilarityFlags(profiles, pairs, assetPairs = []) {
  const watchPairs = pairs.filter((pair) => pair.severity !== 'distinct');
  for (const pair of watchPairs) {
    const assetPair = findSimilarityPair(assetPairs, pair.left, pair.right, pair.kind);
    if (assetPair?.severity === 'distinct') {
      continue;
    }

    for (const [profileId, otherId] of [[pair.left, pair.right], [pair.right, pair.left]]) {
      const profile = profiles.find((entry) => entry.id === profileId);
      if (!profile) {
        continue;
      }
      const label = pair.severity === 'near-duplicate' ? 'Near-duplicate' : 'Similar';
      addProfileReviewFlag(
        profile,
        `${label} visual signature versus ${otherId}; inspect whether this is more than a recolor.`
      );
    }
  }
}

function findSimilarityPair(pairs, leftId, rightId, kind) {
  return pairs.find((pair) =>
    pair.kind === kind &&
    ((pair.left === leftId && pair.right === rightId) ||
      (pair.left === rightId && pair.right === leftId))
  );
}

function annotateProfileAssetSimilarityFlags(profiles, pairs) {
  const watchPairs = pairs.filter((pair) => pair.severity !== 'distinct');
  for (const pair of watchPairs) {
    for (const [profileId, otherId] of [[pair.left, pair.right], [pair.right, pair.left]]) {
      const profile = profiles.find((entry) => entry.id === profileId);
      if (!profile) {
        continue;
      }
      const label = pair.severity === 'near-duplicate' ? 'Near-duplicate' : 'Similar';
      addProfileReviewFlag(
        profile,
        `${label} chassis material signature versus ${otherId}; source art likely needs stronger theme-specific hardware.`
      );
    }
  }
}

function buildSkinAssetWatch(summary) {
  const watchPairs = (summary.skinAssetSimilarities ?? [])
    .filter((pair) => pair.severity !== 'distinct')
    .slice(0, 12);
  if (watchPairs.length === 0) {
    return `
      <section class="similarity-watch">
        <div class="section-heading">
          <h2>Skin Asset Watch</h2>
          <p>No near-duplicate skin-owned chassis assets were detected by the material signature check.</p>
        </div>
      </section>
    `;
  }

  const cards = watchPairs.map((pair) => `
    <article class="similarity-card">
      <header>
        <div>
          <h3>${escapeHtml(pair.left)} / ${escapeHtml(pair.right)}</h3>
          <p>${escapeHtml(pair.kind)} / ${escapeHtml(pair.severity)} / chassis art</p>
        </div>
        <span class="similarity-score">${pair.distance.toFixed(3)}</span>
      </header>
      <div class="chips">
        <span>${escapeHtml(`material distance ${pair.distance.toFixed(3)}`)}</span>
        ${Number.isFinite(pair.rgbDistance) ? `<span>${escapeHtml(`rgb distance ${pair.rgbDistance.toFixed(3)}`)}</span>` : ''}
      </div>
      <div class="similarity-thumbs asset-thumbs">
        ${pair.leftAsset ? `<a href="${escapeHtml(pair.leftAsset)}"><img src="${escapeHtml(pair.leftAsset)}" alt="${escapeHtml(pair.left)} chassis art"></a>` : ''}
        ${pair.rightAsset ? `<a href="${escapeHtml(pair.rightAsset)}"><img src="${escapeHtml(pair.rightAsset)}" alt="${escapeHtml(pair.right)} chassis art"></a>` : ''}
      </div>
    </article>
  `).join('\n');

  return `
    <section class="similarity-watch">
      <div class="section-heading">
        <h2>Skin Asset Watch</h2>
        <p>Closest same-format pairs by skin-owned chassis material signature. This separates actual skin art from shared runtime gameplay content.</p>
      </div>
      <div class="similarity-grid">${cards}</div>
    </section>
  `;
}

function buildSimilarityWatch(summary) {
  const watchPairs = (summary.profileSimilarities ?? [])
    .filter((pair) => pair.severity !== 'distinct')
    .slice(0, 12);
  if (watchPairs.length === 0) {
    return `
      <section class="similarity-watch">
        <div class="section-heading">
          <h2>Similarity Watch</h2>
          <p>No near-duplicate profile pairs were detected by the screenshot signature check.</p>
        </div>
      </section>
    `;
  }

  const cards = watchPairs.map((pair) => `
    <article class="similarity-card">
      <header>
        <div>
          <h3>${escapeHtml(pair.left)} / ${escapeHtml(pair.right)}</h3>
          <p>${escapeHtml(pair.kind)} / ${escapeHtml(pair.severity)}</p>
        </div>
        <span class="similarity-score">${pair.distance.toFixed(3)}</span>
      </header>
      <div class="similarity-thumbs">
        ${pair.leftThumbnail ? `<a href="${escapeHtml(pair.leftThumbnail)}"><img src="${escapeHtml(pair.leftThumbnail)}" alt="${escapeHtml(pair.left)} diagnostic screenshot"></a>` : ''}
        ${pair.rightThumbnail ? `<a href="${escapeHtml(pair.rightThumbnail)}"><img src="${escapeHtml(pair.rightThumbnail)}" alt="${escapeHtml(pair.right)} diagnostic screenshot"></a>` : ''}
      </div>
    </article>
  `).join('\n');

  return `
    <section class="similarity-watch">
      <div class="section-heading">
        <h2>Similarity Watch</h2>
        <p>Closest same-format profile pairs by downsampled screenshot signature. Treat this as a review prompt, not a pass/fail gate.</p>
      </div>
      <div class="similarity-grid">${cards}</div>
    </section>
  `;
}

function buildBlueprintReview(summary) {
  const blueprint = summary.artBlueprint;
  if (!blueprint) {
    return '';
  }

  const scenarioList = (blueprint.reviewScenarios ?? [])
    .map((scenario) => `<span>${escapeHtml(scenario)}</span>`)
    .join('');
  const gateList = (blueprint.qualityGates ?? [])
    .map((gate) => `<li>${escapeHtml(gate)}</li>`)
    .join('');
  const forbiddenList = (blueprint.forbiddenDynamicContent ?? [])
    .map((item) => `<span>${escapeHtml(item)}</span>`)
    .join('');

  return `
    <section class="blueprint-review">
      <div class="section-heading">
        <h2>Premium Blueprint Review</h2>
        <p>${escapeHtml(blueprint.name)} ${escapeHtml(blueprint.version)}. This visual report is still a human review surface: green screenshots must also look like one coherent premium handheld skin.</p>
      </div>
      <div class="blueprint-summary">
        <div>
          <span>Target</span>
          <strong>${escapeHtml(blueprint.targetProfile)}</strong>
        </div>
        <div>
          <span>Matching Profiles</span>
          <strong>${blueprint.targetProfileCount}/${summary.productionMobileProfiles.length}</strong>
        </div>
        <div>
          <span>Manual Review</span>
          <strong>${blueprint.manualReviewRequired ? 'required' : 'optional'}</strong>
        </div>
      </div>
      <p class="blueprint-intent">${escapeHtml(blueprint.visualTarget)}</p>
      <h3>Manual Quality Gates</h3>
      <ul>${gateList}</ul>
      <h3>Required Review Scenarios</h3>
      <div class="blueprint-chips">${scenarioList}</div>
      <h3>Forbidden Dynamic Content</h3>
      <div class="blueprint-chips muted">${forbiddenList}</div>
    </section>
  `;
}

function buildProfileBench(summary) {
  const profiles = summary.profileSummaries ?? [];
  if (profiles.length === 0) {
    return '';
  }

  const cards = profiles.map((profile) => {
    const metrics = profile.metrics ?? {};
    const chips = [
      profile.kind,
      profile.role,
      Number.isFinite(profile.defaultPriority) ? `priority ${profile.defaultPriority}` : null,
      `${profile.scenarios} states`,
      profile.failures ? `${profile.failures} failures` : 'passing',
      Number.isFinite(metrics.contrast) ? `contrast ${metrics.contrast.toFixed(3)}` : null,
      Number.isFinite(metrics.saturation) ? `sat ${metrics.saturation.toFixed(3)}` : null,
      Number.isFinite(metrics.sampledUniqueColors) ? `colors ${Math.round(metrics.sampledUniqueColors)}` : null,
      Number.isFinite(metrics.minShellDetails) ? `shell ${metrics.minShellDetails}` : null,
      Number.isFinite(metrics.minControlDetails) ? `controls ${metrics.minControlDetails}` : null,
      Number.isFinite(metrics.maxTextOverflows) ? `text overflow ${metrics.maxTextOverflows}` : null
    ].filter(Boolean);
    const thumbs = ['diagnostics', 'log', 'inventory', 'terminal', 'movement']
      .map((slot) => profile.thumbnails?.[slot] ? { slot, image: profile.thumbnails[slot] } : null)
      .filter(Boolean);

    return `
      <article class="profile-card ${profile.failures ? 'fail' : 'pass'}">
        <header>
          <div>
            <h2>${escapeHtml(profile.id)}</h2>
            <p>${escapeHtml([profile.kind, profile.role].filter(Boolean).join(' / '))}</p>
          </div>
          <span class="badge">${profile.failures ? 'CHECK' : 'PASS'}</span>
        </header>
        <div class="profile-thumbs">
          ${thumbs.map((thumb) => `
            <a href="${escapeHtml(thumb.image)}">
              <img src="${escapeHtml(thumb.image)}" alt="${escapeHtml(`${profile.id} ${thumb.slot}`)} screenshot">
              <span>${escapeHtml(thumb.slot)}</span>
            </a>
          `).join('')}
        </div>
        <div class="chips">${chips.map((chip) => `<span>${escapeHtml(chip)}</span>`).join('')}</div>
        <ul class="review-flags">${profile.reviewFlags.map((flag) => `<li>${escapeHtml(flag)}</li>`).join('')}</ul>
      </article>
    `;
  }).join('\n');

  return `
    <section class="profile-bench">
      <div class="section-heading">
        <h2>Skin Bench</h2>
        <p>Profile-level comparison for visual review. These cards are review aids; scenario failures remain the hard gate.</p>
      </div>
      <div class="profile-grid">${cards}</div>
    </section>
  `;
}

function recordProfileThumbnail(thumbnails, result) {
  const image = path.basename(result.screenshotPath);
  const name = result.name;
  if (name.endsWith('-production-diagnostics') || result.mode === 'fixed-workbench-diagnostics') {
    thumbnails.diagnostics ??= image;
  } else if (name.includes('-production-log')) {
    thumbnails.log ??= image;
  } else if (name.includes('-production-inventory')) {
    thumbnails.inventory ??= image;
  } else if (name.includes('-production-defeat') || name.includes('-production-victory')) {
    thumbnails.terminal ??= image;
  } else if (name.includes('-production-movement')) {
    thumbnails.movement ??= image;
  }
}

function isDiagnosticScenario(result) {
  return result.name.endsWith('-production-diagnostics') ||
    result.mode === 'fixed-workbench-diagnostics' ||
    (result.mode === 'phaser-fixed-workbench' && result.name.includes('-production-diagnostics'));
}

function profileReviewFlags(profile) {
  const metrics = profile.metrics ?? {};
  const flags = [];
  if (profile.failures > 0) {
    flags.push('Has failing scenarios.');
  }
  if (Number.isFinite(metrics.maxTextOverflows) && metrics.maxTextOverflows > 0) {
    flags.push('Text overflow needs layout work.');
  }
  if (Number.isFinite(metrics.contrast) && metrics.contrast < 0.13) {
    flags.push('Low average contrast; check readability and material depth.');
  }
  if (Number.isFinite(metrics.saturation) && metrics.saturation < 0.28) {
    flags.push('Muted average saturation; check whether the skin reads as a distinct theme.');
  }
  if (Number.isFinite(metrics.sampledUniqueColors) && metrics.sampledUniqueColors < 3200) {
    flags.push('Low sampled color variety; inspect for flat or one-note surfaces.');
  }
  if (Number.isFinite(metrics.minShellDetails) && metrics.minShellDetails < 130) {
    flags.push('Shell detail is close to the production floor.');
  }
  if (Number.isFinite(metrics.minControlDetails) && metrics.minControlDetails < 80) {
    flags.push('Control hardware detail is close to the production floor.');
  }
  return flags.length > 0 ? flags : ['Ready for human visual review.'];
}

function addProfileReviewFlag(profile, flag) {
  const current = profile.reviewFlags ?? [];
  profile.reviewFlags = current.filter((entry) => entry !== 'Ready for human visual review.');
  if (!profile.reviewFlags.includes(flag)) {
    profile.reviewFlags.push(flag);
  }
}

function addFinite(values, value) {
  if (Number.isFinite(value)) {
    values.push(value);
  }
}

function addSignature(values, value) {
  if (Array.isArray(value) && value.length > 0 && value.every(Number.isFinite)) {
    values.push(value);
  }
}

function averageSignature(signatures) {
  if (signatures.length === 0) {
    return null;
  }

  const length = Math.min(...signatures.map((signature) => signature.length));
  return Array.from({ length }, (_, index) =>
    signatures.reduce((total, signature) => total + signature[index], 0) / signatures.length
  );
}

function signatureDistance(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length === 0 || right.length === 0) {
    return null;
  }

  const length = Math.min(left.length, right.length);
  const meanSquare = Array.from({ length }, (_, index) => {
    const delta = left[index] - right[index];
    return delta * delta;
  }).reduce((total, value) => total + value, 0) / length;
  return Math.sqrt(meanSquare);
}

function average(values) {
  return values.length > 0
    ? values.reduce((total, value) => total + value, 0) / values.length
    : null;
}

function minimum(values) {
  return values.length > 0 ? Math.min(...values) : null;
}

function maximum(values) {
  return values.length > 0 ? Math.max(...values) : null;
}

function kindSort(kind) {
  if (kind === 'mobileCompact') {
    return 0;
  }
  if (kind === 'mobilePortrait') {
    return 1;
  }
  return 2;
}

function roleSort(role) {
  if (role === 'default') {
    return 0;
  }
  if (role === 'variant') {
    return 1;
  }
  return 2;
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
  for (const profile of profiles) {
    for (const scenario of productionProfileScenarios(profile)) {
      scenarios.push(scenario);
    }
  }

  return scenarios;
}

function isSupportedScenario(scenario) {
  return scenario.mode.startsWith('phaser-fixed');
}

function productionProfileScenarios(profile) {
  const url = phaserFixedWorkbenchProfileUrl(profile.id);
  const viewport = profile.kind === 'mobileCompact'
    ? { width: profile.size?.width ?? 390, height: profile.size?.height ?? 667 }
    : { width: 390, height: 844 };
  const shortViewport = { width: 390, height: 667 };

  return [
    {
      name: `mobile-${profile.id}-production-movement`,
      viewport,
      mode: 'phaser-fixed-workbench-click-move',
      url: `${url}&scenario=movement`,
      expectedFixedProfile: profile.id
    },
    {
      name: `mobile-${profile.id}-production-log`,
      viewport,
      mode: 'phaser-fixed-workbench-log',
      url,
      expectedFixedProfile: profile.id
    },
    ...(profile.kind === 'mobileCompact' ? [{
      name: `mobile-${profile.id}-production-short-log`,
      viewport: shortViewport,
      mode: 'phaser-fixed-workbench-log',
      url,
      expectedFixedProfile: profile.id
    }] : []),
    {
      name: `mobile-${profile.id}-production-inventory`,
      viewport,
      mode: 'phaser-fixed-workbench-inventory',
      url,
      expectedFixedProfile: profile.id
    },
    ...(profile.kind === 'mobileCompact' ? [{
      name: `mobile-${profile.id}-production-short-inventory`,
      viewport: shortViewport,
      mode: 'phaser-fixed-workbench-inventory',
      url,
      expectedFixedProfile: profile.id
    }] : []),
    {
      name: `mobile-${profile.id}-production-defeat`,
      viewport,
      mode: 'phaser-fixed-workbench-defeat',
      url: `${url}&scenario=defeat`,
      expectedFixedProfile: profile.id
    },
    {
      name: `mobile-${profile.id}-production-victory`,
      viewport,
      mode: 'phaser-fixed-workbench-victory',
      url: `${url}&scenario=victory`,
      expectedFixedProfile: profile.id
    },
    {
      name: `mobile-${profile.id}-production-restart`,
      viewport,
      mode: 'phaser-fixed-workbench-restart',
      url: `${url}&scenario=defeat`,
      expectedFixedProfile: profile.id
    },
    ...(profile.kind === 'mobileCompact' ? [
      {
        name: `mobile-${profile.id}-production-click-log`,
        viewport: shortViewport,
        mode: 'phaser-fixed-workbench-click-log',
        url,
        expectedFixedProfile: profile.id
      },
      {
        name: `mobile-${profile.id}-production-click-inventory`,
        viewport: shortViewport,
        mode: 'phaser-fixed-workbench-click-inventory',
        url,
        expectedFixedProfile: profile.id
      },
      {
        name: `mobile-${profile.id}-production-hover-run`,
        viewport: shortViewport,
        mode: 'phaser-fixed-workbench-hover-run',
        url,
        expectedFixedProfile: profile.id
      },
      {
        name: `mobile-${profile.id}-production-press-run`,
        viewport: shortViewport,
        mode: 'phaser-fixed-workbench-press-run',
        url,
        expectedFixedProfile: profile.id
      }
    ] : []),
    {
      name: `mobile-${profile.id}-production-diagnostics`,
      viewport,
      mode: 'phaser-fixed-workbench',
      url: `${url}&scenario=diagnostics`,
      expectedFixedProfile: profile.id
    }
  ];
}

async function ensureViteServer(selected) {
  if (process.env.VISUAL_NO_DEV_SERVER === '1' || !selected.some((scenario) => needsDefaultViteServer(scenario.url ?? entryUrl))) {
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

function needsDefaultViteServer(url) {
  if (usesDefaultViteServer(url)) {
    return true;
  }

  try {
    const parsed = new URL(url);
    return parsed.port === '8127' &&
      (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') &&
      parsed.pathname.startsWith('/game2');
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
  if (scenario.mode.startsWith('phaser-fixed-workbench')) {
    await waitForPhaserFixedWorkbenchReady(page);
  } else if (scenario.mode.startsWith('phaser-fixed-runtime')) {
    await waitForPhaserFixedRuntimeReady(page);
  } else if (scenario.mode.startsWith('fixed-workbench')) {
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
    scenario.mode === 'phaser-fixed-workbench-log' ||
    scenario.mode === 'phaser-fixed-runtime-log' ||
    scenario.mode === 'fixed-runtime-log'
  ) {
    if (scenario.mode === 'phaser-fixed-workbench-log' || scenario.mode === 'phaser-fixed-runtime-log') {
      await page.keyboard.press('l');
      await waitForPhaserFixedWorkbenchDrawer(page, 'log');
    } else {
      await page.getByRole('button', { name: 'Log', exact: true }).click();
      await waitForLogOpen(page);
    }
  }

  if (scenario.mode === 'phaser-fixed-runtime-inventory') {
    await page.keyboard.press('i');
    await waitForPhaserFixedRuntimeDrawer(page, 'inventory');
  }

  if (scenario.mode === 'phaser-fixed-runtime-combat') {
    await enterPhaserFixedRuntimeCombat(page);
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

  if (scenario.mode === 'phaser-fixed-workbench-inventory' || scenario.mode === 'phaser-fixed-workbench-inventory-use') {
    await page.keyboard.press('i');
    await waitForPhaserFixedWorkbenchDrawer(page, 'inventory');
    await waitForPhaserFixedInventory(page);
  }

  if (scenario.mode === 'phaser-fixed-workbench-inventory-use') {
    await page.keyboard.press('3');
    await waitForPhaserFixedInventoryUse(page);
  }

  if (scenario.mode === 'phaser-fixed-workbench-click-log') {
    await clickPhaserFixedButton(page, scenario, 'log');
    await waitForPhaserFixedWorkbenchDrawer(page, 'log');
  }

  if (scenario.mode === 'phaser-fixed-workbench-click-inventory') {
    await clickPhaserFixedButton(page, scenario, 'inventory');
    await waitForPhaserFixedWorkbenchDrawer(page, 'inventory');
    await waitForPhaserFixedInventory(page);
  }

  if (scenario.mode === 'phaser-fixed-workbench-click-move') {
    await clickPhaserFixedButton(page, scenario, 'moveE');
    await waitForPhaserFixedWorkbenchPlayer(page, 2, 1);
  }

  if (scenario.mode === 'phaser-fixed-workbench-hover-run') {
    await hoverPhaserFixedButton(page, scenario, 'run');
    await waitForPhaserPointerButtonState(page, 'run:hover');
  }

  if (scenario.mode === 'phaser-fixed-workbench-press-run') {
    await pressPhaserFixedButton(page, scenario, 'run');
    await waitForPhaserPointerButtonState(page, 'run:pressed');
  }

  if (scenario.mode === 'phaser-fixed-workbench-defeat') {
    await waitForPhaserTerminalState(page, 'defeat');
  }

  if (scenario.mode === 'phaser-fixed-workbench-victory') {
    await waitForPhaserTerminalState(page, 'victory');
  }

  if (scenario.mode === 'phaser-fixed-workbench-restart') {
    await waitForPhaserTerminalState(page, 'defeat');
    await page.keyboard.press('r');
    await waitForPhaserTerminalState(page, 'active');
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

  if (scenario.mode === 'fixed-workbench-profile-cycle' || scenario.mode === 'phaser-fixed-workbench-profile-cycle') {
    await Promise.all([
      page.waitForURL(
        (url) => url.searchParams.get('profile') === scenario.expectedFixedProfile,
        { timeout: 5000 }
      ),
      page.keyboard.press(']')
    ]);
    if (scenario.mode === 'phaser-fixed-workbench-profile-cycle') {
      await waitForPhaserFixedWorkbenchReady(page);
    } else {
      await waitForFixedWorkbenchReady(page);
    }
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

  if (!scenario.mode.startsWith('phaser-fixed')) {
    await waitForFontAwesome(page);
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
  if (scenario.mode === 'phaser-fixed-workbench-press-run') {
    await page.mouse.up().catch(() => {});
  }

  return {
    name: scenario.name,
    viewport: scenario.viewport,
    mode: scenario.mode,
    screenshotPath,
    metrics,
    failures
  };
}

async function clickPhaserFixedButton(page, scenario, buttonId) {
  const point = await phaserFixedButtonPoint(page, scenario, buttonId);
  await page.mouse.click(point.x, point.y);
}

async function hoverPhaserFixedButton(page, scenario, buttonId) {
  const point = await phaserFixedButtonPoint(page, scenario, buttonId);
  await page.mouse.move(point.x, point.y);
}

async function pressPhaserFixedButton(page, scenario, buttonId) {
  const point = await phaserFixedButtonPoint(page, scenario, buttonId);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
}

async function phaserFixedButtonPoint(page, scenario, buttonId) {
  const profileId = scenario.expectedFixedProfile ?? compactFixedProfile;
  const kit = await loadFixedProfileKit(profileId);
  const rect = kit.layout?.buttons?.[buttonId];
  if (!isVisualRect(rect)) {
    throw new Error(`${profileId} does not define layout.buttons.${buttonId}`);
  }

  return await page.evaluate((buttonRect) => {
    const canvas = document.querySelector('#phaser-fixed-skin-workbench canvas');
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new Error('Missing Phaser fixed-skin canvas');
    }

    const bounds = canvas.getBoundingClientRect();
    return {
      x: bounds.left + ((buttonRect.x + buttonRect.width / 2) / canvas.width) * bounds.width,
      y: bounds.top + ((buttonRect.y + buttonRect.height / 2) / canvas.height) * bounds.height
    };
  }, rect);
}

async function loadFixedProfileKit(profileId) {
  const cached = fixedProfileKitCache.get(profileId);
  if (cached) {
    return cached;
  }

  const kitPath = path.join(fixedSkinDir, profileId, 'skin-kit.json');
  const kit = JSON.parse(await fs.readFile(kitPath, 'utf8'));
  fixedProfileKitCache.set(profileId, kit);
  return kit;
}

function isVisualRect(value) {
  return value &&
    typeof value === 'object' &&
    ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(value[key]));
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
    sampledUniqueColors,
    signature: collectImageSignature(screenshotPath)
  };
}

function collectSkinAssetMetrics(imagePath) {
  const saturationOutput = execFileSync(
    'magick',
    [
      imagePath,
      '-alpha',
      'off',
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
      imagePath,
      '-alpha',
      'off',
      '-resize',
      '96x96!',
      '-format',
      '%k',
      'info:'
    ],
    { encoding: 'utf8' }
  ).trim());

  return {
    saturationMean,
    saturationStandardDeviation,
    sampledUniqueColors
  };
}

function collectImageSignature(imagePath, options = {}) {
  const size = options.size ?? 8;
  const transforms = options.transforms ?? [];
  const output = execFileSync(
    'magick',
    [
      imagePath,
      ...(options.alphaOff ? ['-alpha', 'off'] : []),
      ...transforms,
      '-resize',
      `${size}x${size}!`,
      '-colorspace',
      'sRGB',
      '-depth',
      '8',
      'txt:-'
    ],
    { encoding: 'utf8' }
  );
  return output
    .split('\n')
    .flatMap((line) => {
      const match = line.match(/\((\d+(?:\.\d+)?),(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)(?:,\d+(?:\.\d+)?)?\)/);
      if (!match) {
        return [];
      }
      return [
        Number(match[1]) / 255,
        Number(match[2]) / 255,
        Number(match[3]) / 255
      ];
    });
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

async function waitForPhaserFixedWorkbenchReady(page) {
  await page.waitForFunction(() => {
    const host = document.getElementById('phaser-fixed-skin-workbench');
    const canvas = host?.querySelector('canvas');
    const box = canvas?.getBoundingClientRect();
    return document.body.dataset.workbench === 'phaser-fixed-skin' &&
      document.body.dataset.fixedRenderer === 'phaser' &&
      document.body.dataset.fixedProfile &&
      Number(document.body.dataset.phaserCanvasIconMarks ?? 0) > 0 &&
      canvas instanceof HTMLCanvasElement &&
      !!box &&
      box.width > 100 &&
      box.height > 100;
  }, null, { timeout: 20_000 });
}

async function waitForPhaserFixedWorkbenchDrawer(page, expected) {
  await page.waitForFunction((drawer) => {
    return document.body.dataset.fixedRenderer === 'phaser' &&
      document.body.dataset.phaserDrawer === drawer;
  }, expected, { timeout: 20_000 });
}

async function waitForPhaserFixedRuntimeDrawer(page, expected) {
  await page.waitForFunction((drawer) => {
    return document.body.dataset.ui === 'phaser-fixed-skin' &&
      document.body.dataset.fixedRenderer === 'phaser' &&
      document.body.dataset.phaserRuntimeState === 'live' &&
      document.body.dataset.phaserStatus === 'ready' &&
      document.body.dataset.phaserDrawer === drawer;
  }, expected, { timeout: 20_000 });
}

async function waitForPhaserFixedInventory(page) {
  await page.waitForFunction(() => {
    return document.body.dataset.fixedRenderer === 'phaser' &&
      document.body.dataset.phaserDrawer === 'inventory' &&
      Number(document.body.dataset.phaserInventoryCount ?? 0) >= 3 &&
      Number(document.body.dataset.phaserInventoryActions ?? 0) >= 3 &&
      (document.body.dataset.phaserInventoryActionLabels ?? '').includes('USE');
  }, null, { timeout: 20_000 });
}

async function waitForPhaserFixedInventoryUse(page) {
  await page.waitForFunction(() => {
    return document.body.dataset.fixedRenderer === 'phaser' &&
      document.body.dataset.phaserDrawer === 'inventory' &&
      document.body.dataset.phaserPlayerHp === '55';
  }, null, { timeout: 20_000 });
}

async function waitForPhaserFixedWorkbenchPlayer(page, x, y) {
  await page.waitForFunction((expected) => {
    return document.body.dataset.fixedRenderer === 'phaser' &&
      document.body.dataset.phaserInCombat === '0' &&
      document.body.dataset.phaserPlayerX === String(expected.x) &&
      document.body.dataset.phaserPlayerY === String(expected.y);
  }, { x, y }, { timeout: 20_000 });
}

async function waitForPhaserPointerButtonState(page, expected) {
  await page.waitForFunction((state) => {
    return document.body.dataset.fixedRenderer === 'phaser' &&
      document.body.dataset.phaserPointerButtonState === state;
  }, expected, { timeout: 20_000 });
}

async function waitForPhaserTerminalState(page, expected) {
  await page.waitForFunction((terminalState) => {
    return document.body.dataset.fixedRenderer === 'phaser' &&
      document.body.dataset.phaserTerminalState === terminalState;
  }, expected, { timeout: 20_000 });
}

async function waitForPhaserFixedRuntimeReady(page) {
  await page.waitForFunction(() => {
    const host = document.getElementById('phaser-fixed-skin-workbench');
    const canvas = host?.querySelector('canvas');
    const box = canvas?.getBoundingClientRect();
    return document.body.dataset.ui === 'phaser-fixed-skin' &&
      document.body.dataset.fixedRenderer === 'phaser' &&
      document.body.dataset.phaserRuntimeState === 'live' &&
      document.body.dataset.phaserStatus === 'ready' &&
      Number(document.body.dataset.phaserCanvasIconMarks ?? 0) > 0 &&
      canvas instanceof HTMLCanvasElement &&
      !!box &&
      box.width > 100 &&
      box.height > 100;
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

async function enterPhaserFixedRuntimeCombat(page) {
  if (await isPhaserFixedRuntimeCombatReady(page)) {
    return;
  }

  await page.keyboard.press('ArrowRight');
  await waitForPhaserFixedRuntimeCombatReady(page, 20_000);
}

async function waitForPhaserFixedRuntimeCombatReady(page, timeout) {
  await page.waitForFunction(() => {
    return document.body.dataset.ui === 'phaser-fixed-skin' &&
      document.body.dataset.fixedRenderer === 'phaser' &&
      document.body.dataset.phaserRuntimeState === 'live' &&
      document.body.dataset.phaserStatus === 'ready' &&
      document.body.dataset.phaserInCombat === '1' &&
      document.body.dataset.phaserTerminalState === 'active';
  }, null, { timeout });
}

async function isPhaserFixedRuntimeCombatReady(page) {
  return page.evaluate(() => {
    return document.body.dataset.ui === 'phaser-fixed-skin' &&
      document.body.dataset.fixedRenderer === 'phaser' &&
      document.body.dataset.phaserRuntimeState === 'live' &&
      document.body.dataset.phaserStatus === 'ready' &&
      document.body.dataset.phaserInCombat === '1' &&
      document.body.dataset.phaserTerminalState === 'active';
  });
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
      phaserHost: '#phaser-fixed-skin-workbench',
      phaserCanvas: '#phaser-fixed-skin-workbench canvas',
      map: '#game-canvas',
      hud: '.hud',
      latestPanel: '.latest-message-panel',
      latestMessage: '#latest-message',
      titleIcon: '#fixed-title .fixed-title-icon',
      titleTextNode: '#fixed-title .fixed-title-text',
      playerPanel: '.player-panel',
      hpLabel: '.fixed-hp-label',
      playerHpValue: '#player-hp',
      playerHpFill: '#fixed-player-hp-fill',
      statAttack: '.fixed-stat-cell[data-stat="atk"]',
      statAttackValue: '.fixed-stat-cell[data-stat="atk"] strong',
      statDefense: '.fixed-stat-cell[data-stat="def"]',
      statDefenseValue: '.fixed-stat-cell[data-stat="def"] strong',
      statXp: '.fixed-stat-cell[data-stat="xp"]',
      statXpValue: '.fixed-stat-cell[data-stat="xp"] strong',
      tileStatValue: '.fixed-stat-cell[data-stat="tile"] strong',
      combatPanel: '#combat-panel',
      combatModeLabel: '#combat-mode-label',
      enemyBadge: '#enemy-icon-badge',
      enemyIcon: '#enemy-icon',
      controlsPanel: '#fixed-controls-panel, .controls-panel',
      logPanel: '#log-panel',
      firstLogEntry: '#game-log p.latest',
      firstLogTag: '#game-log p.latest .fixed-log-entry-tag',
      logScrollCue: '#fixed-log-scroll-cue',
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
      endStateBadge: '#end-state-badge',
      endStateIcon: '#end-state-icon',
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
        pointerEvents: style.pointerEvents,
        zIndex: style.zIndex,
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

    const collectMapGlassMetrics = () => {
      const map = document.getElementById('game-canvas');
      const canvas = map?.querySelector('canvas');
      const overlay = map?.querySelector('.map-icon-overlay');
      const before = map ? getComputedStyle(map, '::before') : null;
      const after = map ? getComputedStyle(map, '::after') : null;
      const zIndexValue = (value) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
      };
      const beforeZ = zIndexValue(before?.zIndex);
      const afterZ = zIndexValue(after?.zIndex);
      const canvasZ = zIndexValue(canvas ? getComputedStyle(canvas).zIndex : undefined);
      const overlayZ = zIndexValue(overlay ? getComputedStyle(overlay).zIndex : undefined);

      return {
        glassStyled: !!before && !!after &&
          before.backgroundImage !== 'none' &&
          after.backgroundImage !== 'none' &&
          after.borderTopColor !== 'rgba(0, 0, 0, 0)' &&
          after.boxShadow !== 'none',
        pointerSafe: before?.pointerEvents === 'none' && after?.pointerEvents === 'none',
        canvasBelowGlass: canvasZ < beforeZ && beforeZ <= afterZ,
        iconsAboveGlass: !overlay || overlayZ > afterZ,
        beforeZ,
        afterZ,
        canvasZ,
        overlayZ
      };
    };

    const collectInventoryMetrics = () => {
      const items = Array.from(document.querySelectorAll('#inventory-list .fixed-inventory-item'));
      const badges = Array.from(document.querySelectorAll('#inventory-list .fixed-inventory-type-badge'));
      const equippedItems = items.filter((item) => item.dataset.equipped === '1');
      const equippedActions = Array.from(document.querySelectorAll('#inventory-list .fixed-inventory-action[data-inventory-action-state="equipped"]'));
      const visibleBadges = badges.filter((badge) => {
        const box = badge.getBoundingClientRect();
        const style = getComputedStyle(badge);
        return box.width > 0 &&
          box.height > 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity) > 0;
      });
      const visibleEquippedActions = equippedActions.filter((action) => {
        const box = action.getBoundingClientRect();
        const style = getComputedStyle(action);
        return box.width > 0 &&
          box.height > 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity) > 0.9;
      });
      const styledBadges = visibleBadges.filter((badge) => {
        const style = getComputedStyle(badge);
        return style.backgroundImage !== 'none' &&
          style.borderTopColor !== 'rgba(0, 0, 0, 0)' &&
          style.boxShadow !== 'none';
      });
      const styledEquippedActions = visibleEquippedActions.filter((action) => {
        const style = getComputedStyle(action);
        return style.backgroundImage !== 'none' &&
          style.borderTopColor !== 'rgba(0, 0, 0, 0)' &&
          style.boxShadow !== 'none';
      });

      return {
        items: items.length,
        equippedItems: equippedItems.length,
        equippedActions: equippedActions.length,
        visibleEquippedActions: visibleEquippedActions.length,
        styledEquippedActions: styledEquippedActions.length,
        equippedActionLabels: equippedActions
          .map((action) => action.textContent?.trim().toUpperCase() ?? '')
          .filter(Boolean),
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
      const log = document.getElementById('game-log');
      const panel = document.getElementById('log-panel');
      const cue = document.getElementById('fixed-log-scroll-cue');
      const cueStyle = cue ? getComputedStyle(cue) : null;
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
      const cueBox = cue?.getBoundingClientRect();
      const cueVisible = !!cueBox &&
        cueBox.width > 0 &&
        cueBox.height > 0 &&
        cueStyle?.display !== 'none' &&
        cueStyle?.visibility !== 'hidden' &&
        Number(cueStyle?.opacity ?? 0) > 0.5;

      return {
        entries: entries.length,
        scrollable: !!log && log.scrollHeight > log.clientHeight + 2,
        scrollOverflowState: panel?.dataset.scrollOverflow ?? '',
        scrollableState: panel?.dataset.scrollable ?? '',
        scrollHeight: log?.scrollHeight ?? 0,
        clientHeight: log?.clientHeight ?? 0,
        entryTags: tags.length,
        visibleEntryTags: visibleTags.length,
        styledEntryTags: styledTags.length,
        styledEntries: styledEntries.length,
        scrollCueVisible: cueVisible,
        scrollCueStyled: cueVisible &&
          cueStyle?.backgroundImage !== 'none' &&
          cueStyle?.borderTopColor !== 'rgba(0, 0, 0, 0)' &&
          cueStyle?.boxShadow !== 'none',
        scrollCueIconClass: cue?.querySelector('i')?.className ?? '',
        latestTagText: document.querySelector('#game-log p.latest .fixed-log-entry-tag')?.textContent?.trim() ?? '',
        latestCopyText: document.querySelector('#game-log p.latest .fixed-log-entry-copy')?.textContent?.trim() ?? ''
      };
    };

    const collectCombatMetrics = () => {
      const badge = document.getElementById('enemy-icon-badge');
      const mode = document.getElementById('combat-mode-label');
      const modeStyle = mode ? getComputedStyle(mode) : null;
      if (!badge) {
        return {
          modeStyled: !!mode && modeStyle.backgroundImage !== 'none' &&
            modeStyle.borderTopColor !== 'rgba(0, 0, 0, 0)' &&
            modeStyle.boxShadow !== 'none',
          modeState: mode?.dataset.mode ?? '',
          enemyBadgeStyled: false,
          enemyIconClass: ''
        };
      }

      const style = getComputedStyle(badge);
      return {
        modeStyled: !!mode && modeStyle.backgroundImage !== 'none' &&
          modeStyle.borderTopColor !== 'rgba(0, 0, 0, 0)' &&
          modeStyle.boxShadow !== 'none',
        modeState: mode?.dataset.mode ?? '',
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

    const collectHpMetrics = () => {
      const label = document.querySelector('.fixed-hp-label');
      const value = document.getElementById('player-hp');
      const hasPhysicalTreatment = (element) => {
        if (!element) {
          return false;
        }
        const style = getComputedStyle(element);
        return style.backgroundImage !== 'none' &&
          style.borderTopColor !== 'rgba(0, 0, 0, 0)' &&
          style.boxShadow !== 'none';
      };

      return {
        labelStyled: hasPhysicalTreatment(label),
        valueStyled: hasPhysicalTreatment(value)
      };
    };

    const collectLatestMetrics = () => {
      const latest = document.getElementById('latest-message');
      if (!latest) {
        return {
          messageStyled: false
        };
      }

      const style = getComputedStyle(latest);
      return {
        messageStyled: style.backgroundImage !== 'none' &&
          style.borderTopColor !== 'rgba(0, 0, 0, 0)' &&
          style.boxShadow !== 'none'
      };
    };

    const collectTitleMetrics = () => {
      const icon = document.querySelector('#fixed-title .fixed-title-icon');
      const text = document.querySelector('#fixed-title .fixed-title-text');
      const style = icon ? getComputedStyle(icon) : null;

      return {
        iconStyled: !!icon && style.backgroundImage !== 'none' &&
          style.borderTopColor !== 'rgba(0, 0, 0, 0)' &&
          style.boxShadow !== 'none',
        iconClass: icon?.className ?? '',
        text: text?.textContent?.trim() ?? ''
      };
    };

    const collectControlsMetrics = () => {
      const panel = document.getElementById('fixed-controls-panel');
      const before = panel ? getComputedStyle(panel, '::before') : null;
      const buttons = ['attack', 'run', 'move-n', 'move-s', 'move-e', 'move-w']
        .map((id) => document.getElementById(id))
        .filter((element) => element instanceof HTMLButtonElement);
      const visibleButtons = buttons.filter((button) => {
        const box = button.getBoundingClientRect();
        const style = getComputedStyle(button);
        return box.width > 0 &&
          box.height > 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity) > 0;
      });
      const spriteButtons = visibleButtons.filter((button) => getComputedStyle(button).backgroundImage !== 'none');

      return {
        panelStyled: !!panel && !!before &&
          before.backgroundImage !== 'none' &&
          before.borderTopColor !== 'rgba(0, 0, 0, 0)' &&
          before.boxShadow !== 'none',
        visibleButtons: visibleButtons.length,
        spriteButtons: spriteButtons.length,
        visualStates: Object.fromEntries(
          buttons.map((button) => [button.id, button.dataset.visualState ?? ''])
        )
      };
    };

    const collectDrawerToggleMetrics = () => {
      const toggles = ['fixed-log-toggle', 'fixed-inventory-toggle']
        .map((id) => document.getElementById(id))
        .filter((element) => element instanceof HTMLButtonElement);
      const visibleToggles = toggles.filter((toggle) => {
        const box = toggle.getBoundingClientRect();
        const style = getComputedStyle(toggle);
        return box.width > 0 &&
          box.height > 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity) > 0;
      });
      const spriteToggles = visibleToggles.filter((toggle) => getComputedStyle(toggle).backgroundImage !== 'none');

      return {
        visibleToggles: visibleToggles.length,
        spriteToggles: spriteToggles.length,
        states: Object.fromEntries(toggles.map((toggle) => [toggle.id, toggle.dataset.visualState ?? ''])),
        pressed: Object.fromEntries(toggles.map((toggle) => [toggle.id, toggle.getAttribute('aria-pressed') ?? ''])),
        expanded: Object.fromEntries(toggles.map((toggle) => [toggle.id, toggle.getAttribute('aria-expanded') ?? '']))
      };
    };

    const collectEndStateMetrics = () => {
      const badge = document.getElementById('end-state-badge');
      if (!badge) {
        return {
          outcome: '',
          badgeStyled: false,
          iconClass: ''
        };
      }

      const style = getComputedStyle(badge);
      return {
        outcome: badge.dataset.outcome ?? '',
        badgeStyled: style.backgroundImage !== 'none' &&
          style.borderTopColor !== 'rgba(0, 0, 0, 0)' &&
          style.boxShadow !== 'none',
        iconClass: document.getElementById('end-state-icon')?.className ?? ''
      };
    };

    const cssResourceNames = performance.getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((name) => {
        try {
          return new URL(name, location.href).pathname.endsWith('.css');
        } catch {
          return name.includes('.css');
        }
      });

    return {
      viewport: { width: innerWidth, height: innerHeight },
      documentHeight: document.documentElement.scrollHeight,
      documentWidth: document.documentElement.scrollWidth,
      overflowsY: document.documentElement.scrollHeight > innerHeight,
      overflowsX: document.documentElement.scrollWidth > innerWidth,
      skin: document.body.dataset.skin ?? null,
      skinClasses: [...document.body.classList].filter((className) => className.startsWith('skin-')),
      workbench: document.body.dataset.workbench ?? null,
      ui: document.body.dataset.ui ?? null,
      fixedProfile: document.body.dataset.fixedProfile ?? null,
      fixedProfileRole: document.querySelector('.fixed-skin-stage')?.dataset.profileRole ?? null,
      fixedProfileKind: document.querySelector('.fixed-skin-stage')?.dataset.profileKind ?? null,
      fixedStageScale: Number(document.querySelector('.fixed-skin-stage')?.dataset.scale ?? NaN),
      fixedRenderer: document.body.dataset.fixedRenderer ?? null,
      fixedScenario: document.body.dataset.fixedScenario ?? null,
      phaserDrawer: document.body.dataset.phaserDrawer ?? null,
      phaserRuntimeState: document.body.dataset.phaserRuntimeState ?? null,
      phaserStatus: document.body.dataset.phaserStatus ?? null,
      phaserInventoryOpen: document.body.dataset.phaserInventoryOpen ?? null,
      phaserInventoryCount: Number(document.body.dataset.phaserInventoryCount ?? NaN),
      phaserInventoryActions: Number(document.body.dataset.phaserInventoryActions ?? NaN),
      phaserInventoryReadyActions: Number(document.body.dataset.phaserInventoryReadyActions ?? NaN),
      phaserEquippedCount: Number(document.body.dataset.phaserEquippedCount ?? NaN),
      phaserInventoryActionLabels: document.body.dataset.phaserInventoryActionLabels ?? '',
      phaserPlayerHp: Number(document.body.dataset.phaserPlayerHp ?? NaN),
      phaserPlayerX: Number(document.body.dataset.phaserPlayerX ?? NaN),
      phaserPlayerY: Number(document.body.dataset.phaserPlayerY ?? NaN),
      phaserInCombat: document.body.dataset.phaserInCombat ?? null,
      phaserTerminalState: document.body.dataset.phaserTerminalState ?? null,
      phaserFontAwesomeReady: document.body.dataset.phaserFontAwesomeReady ?? null,
      phaserFontAwesomeGlyphs: Number(document.body.dataset.phaserFontAwesomeGlyphs ?? NaN),
      phaserCanvasIconMarks: Number(document.body.dataset.phaserCanvasIconMarks ?? NaN),
      phaserMaterialPanels: Number(document.body.dataset.phaserMaterialPanels ?? NaN),
      phaserSourceMaterialPanels: Number(document.body.dataset.phaserSourceMaterialPanels ?? NaN),
      phaserSourceMaterialKinds: document.body.dataset.phaserSourceMaterialKinds ?? '',
      phaserButtonStates: document.body.dataset.phaserButtonStates ?? '',
      phaserPointerButtonState: document.body.dataset.phaserPointerButtonState ?? '',
      phaserLogRows: Number(document.body.dataset.phaserLogRows ?? NaN),
      phaserInventoryRows: Number(document.body.dataset.phaserInventoryRows ?? NaN),
      phaserInventoryActionChips: Number(document.body.dataset.phaserInventoryActionChips ?? NaN),
      phaserInventoryTextBackplates: Number(document.body.dataset.phaserInventoryTextBackplates ?? NaN),
      phaserActionButtonLabels: Number(document.body.dataset.phaserActionButtonLabels ?? NaN),
      phaserDrawerToggleIcons: Number(document.body.dataset.phaserDrawerToggleIcons ?? NaN),
      phaserMovementLockBadges: Number(document.body.dataset.phaserMovementLockBadges ?? NaN),
      phaserChromeDetails: Number(document.body.dataset.phaserChromeDetails ?? NaN),
      phaserShellDetails: Number(document.body.dataset.phaserShellDetails ?? NaN),
      phaserMapTileDetails: Number(document.body.dataset.phaserMapTileDetails ?? NaN),
      phaserFogTileDetails: Number(document.body.dataset.phaserFogTileDetails ?? NaN),
      phaserMapScannerDetails: Number(document.body.dataset.phaserMapScannerDetails ?? NaN),
      phaserControlDetails: Number(document.body.dataset.phaserControlDetails ?? NaN),
      phaserHudDetails: Number(document.body.dataset.phaserHudDetails ?? NaN),
      phaserTextSlots: Number(document.body.dataset.phaserTextSlots ?? NaN),
      phaserTextShrinks: Number(document.body.dataset.phaserTextShrinks ?? NaN),
      phaserTextEllipses: Number(document.body.dataset.phaserTextEllipses ?? NaN),
      phaserTextOverflows: Number(document.body.dataset.phaserTextOverflows ?? NaN),
      phaserCanvas: {
        count: document.querySelectorAll('#phaser-fixed-skin-workbench canvas').length,
        width: document.querySelector('#phaser-fixed-skin-workbench canvas')?.width ?? 0,
        height: document.querySelector('#phaser-fixed-skin-workbench canvas')?.height ?? 0
      },
      renderSurface: document.body.dataset.renderSurface ?? null,
      stylesheetLinkCount: document.querySelectorAll('link[rel="stylesheet"]').length,
      styleElementCount: document.querySelectorAll('style').length,
      adoptedStyleSheetCount: document.adoptedStyleSheets?.length ?? 0,
      styleSheetCount: document.styleSheets.length,
      cssResourceCount: cssResourceNames.length,
      cssResourceNames,
      prefersReducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      inCombat: document.body.dataset.fixedRenderer === 'phaser'
        ? document.body.dataset.phaserInCombat === '1'
        : document.body.classList.contains('in-combat'),
      gameEnded: document.body.dataset.fixedRenderer === 'phaser'
        ? document.body.dataset.phaserTerminalState === 'victory' || document.body.dataset.phaserTerminalState === 'defeat'
        : document.body.classList.contains('game-ended'),
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
      endState: collectEndStateMetrics(),
      mapIconStacks: collectMapIconStacks(),
      mapIcons: collectMapIconMetrics(),
      mapGlass: collectMapGlassMetrics(),
      inventory: collectInventoryMetrics(),
      log: collectLogMetrics(),
      latest: collectLatestMetrics(),
      title: collectTitleMetrics(),
      controls: collectControlsMetrics(),
      drawerToggles: collectDrawerToggleMetrics(),
      combat: collectCombatMetrics(),
      stats: collectStatMetrics(),
      hp: collectHpMetrics(),
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
  const isPhaserFixedWorkbench = scenario.mode.startsWith('phaser-fixed-workbench');
  const isPhaserFixedRuntime = scenario.mode.startsWith('phaser-fixed-runtime');
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

  if (isPhaserFixedWorkbench) {
    validatePhaserFixedWorkbenchScenario(scenario, metrics, failures);
    validatePhaserScreenshotQuality(metrics, failures);
    return failures;
  }

  if (isPhaserFixedRuntime) {
    validatePhaserFixedRuntimeScenario(scenario, metrics, failures);
    validatePhaserScreenshotQuality(metrics, failures);
    return failures;
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

function validatePhaserScreenshotQuality(metrics, failures) {
  const screenshot = metrics.screenshot;
  if (!screenshot || !Number.isFinite(screenshot.mean) || !Number.isFinite(screenshot.standardDeviation)) {
    failures.push('Phaser fixed skin screenshot metrics are missing');
    return;
  }

  if (screenshot.mean < 0.04) {
    failures.push(`Phaser fixed skin screenshot is too dark: mean=${screenshot.mean.toFixed(4)}`);
  }

  if (screenshot.standardDeviation < 0.075) {
    failures.push(`Phaser fixed skin screenshot is too flat: contrast=${screenshot.standardDeviation.toFixed(4)}`);
  }

  if (!Number.isFinite(screenshot.saturationMean) || screenshot.saturationMean < 0.13) {
    failures.push(`Phaser fixed skin screenshot is too monochrome: saturation=${screenshot.saturationMean?.toFixed(4) ?? 'none'}`);
  }

  if (!Number.isFinite(screenshot.sampledUniqueColors) || screenshot.sampledUniqueColors < 1500) {
    failures.push(`Phaser fixed skin screenshot has too little material variety: sampled colors=${screenshot.sampledUniqueColors ?? 'none'}`);
  }
}

function validateNoPhaserDomStyles(metrics, failures, context) {
  if ((metrics.skinClasses ?? []).length > 0) {
    failures.push(`${context} applied CSS skin classes: ${metrics.skinClasses.join(', ')}`);
  }

  const styleSurfaceCount =
    (metrics.stylesheetLinkCount ?? 0) +
    (metrics.styleElementCount ?? 0) +
    (metrics.adoptedStyleSheetCount ?? 0) +
    (metrics.styleSheetCount ?? 0) +
    (metrics.cssResourceCount ?? 0);

  if (styleSurfaceCount <= 0) {
    return;
  }

  const cssResources = (metrics.cssResourceNames ?? [])
    .map((name) => {
      try {
        const url = new URL(name);
        return `${url.pathname}${url.search}`;
      } catch {
        return name;
      }
    })
    .join(', ');

  failures.push(
    `${context} loaded DOM stylesheet surfaces: ` +
    `links=${metrics.stylesheetLinkCount ?? 0}, ` +
    `style=${metrics.styleElementCount ?? 0}, ` +
    `adopted=${metrics.adoptedStyleSheetCount ?? 0}, ` +
    `styleSheets=${metrics.styleSheetCount ?? 0}, ` +
    `cssResources=${metrics.cssResourceCount ?? 0}` +
    (cssResources ? ` (${cssResources})` : '')
  );
}

function validatePhaserSourceMaterials(scenario, metrics, failures, context) {
  if (!sourceMaterialPhaserProfiles.has(scenario.expectedFixedProfile)) {
    return;
  }

  const sourceKinds = new Set(
    String(metrics.phaserSourceMaterialKinds ?? '')
      .split(',')
      .filter(Boolean)
  );
  const requiredKinds = phaserScenarioSkipsButtonMaterial(scenario)
    ? ['lcd', 'panel']
    : ['button', 'lcd', 'panel'];
  const minimumPanelCount = requiredKinds.includes('button') ? 5 : 3;

  if (!Number.isFinite(metrics.phaserSourceMaterialPanels) || metrics.phaserSourceMaterialPanels < minimumPanelCount) {
    failures.push(
      `${context} expected source-authored material panels for ${scenario.expectedFixedProfile}, ` +
      `got ${metrics.phaserSourceMaterialPanels ?? 'none'}`
    );
  }

  for (const requiredKind of requiredKinds) {
    if (!sourceKinds.has(requiredKind)) {
      failures.push(
        `${context} expected source-authored ${requiredKind} material for ${scenario.expectedFixedProfile}, ` +
        `got ${metrics.phaserSourceMaterialKinds || 'none'}`
      );
    }
  }
}

function phaserScenarioSkipsButtonMaterial(scenario) {
  return scenario.mode === 'phaser-fixed-workbench-click-move' ||
    scenario.mode === 'phaser-fixed-workbench-victory' ||
    scenario.name.endsWith('-production-diagnostics');
}

function validatePhaserActionLabels(scenario, metrics, failures, context) {
  if (!actionLabelPhaserProfiles.has(scenario.expectedFixedProfile)) {
    return;
  }

  if (!Number.isFinite(metrics.phaserActionButtonLabels) || metrics.phaserActionButtonLabels < 2) {
    failures.push(
      `${context} expected canvas-rendered action button labels for ${scenario.expectedFixedProfile}, ` +
      `got ${metrics.phaserActionButtonLabels ?? 'none'}`
    );
  }
}

function validatePhaserMapDetails(scenario, metrics, failures, context) {
  const detailFloor = phaserMapDetailFloors.get(scenario.expectedFixedProfile) ?? defaultPhaserMapDetailFloor;
  if (!Number.isFinite(metrics.phaserMapTileDetails) || metrics.phaserMapTileDetails < detailFloor) {
    failures.push(
      `${context} expected detailed Phaser map tiles for ${scenario.expectedFixedProfile ?? 'default profile'}, ` +
      `got ${metrics.phaserMapTileDetails ?? 'none'} below ${detailFloor}`
    );
  }

  if (!Number.isFinite(metrics.phaserFogTileDetails) || metrics.phaserFogTileDetails < 24) {
    failures.push(`${context} expected visible Phaser fog tile hardware, got ${metrics.phaserFogTileDetails ?? 'none'}`);
  }

  if (!Number.isFinite(metrics.phaserMapScannerDetails) || metrics.phaserMapScannerDetails < 12) {
    failures.push(`${context} expected Phaser map scanner overlay details, got ${metrics.phaserMapScannerDetails ?? 'none'}`);
  }
}

function validatePhaserControlAffordances(metrics, failures, context) {
  if (!Number.isFinite(metrics.phaserDrawerToggleIcons) || metrics.phaserDrawerToggleIcons < 2) {
    failures.push(`${context} expected canvas-rendered drawer toggle icons, got ${metrics.phaserDrawerToggleIcons ?? 'none'}`);
  }

  if (
    metrics.phaserInCombat === '1' &&
    metrics.phaserTerminalState === 'active' &&
    (!Number.isFinite(metrics.phaserMovementLockBadges) || metrics.phaserMovementLockBadges < 1)
  ) {
    failures.push(`${context} expected movement lock badge during combat, got ${metrics.phaserMovementLockBadges ?? 'none'}`);
  }
}

function validatePhaserTextSlots(metrics, failures, context) {
  if (!Number.isFinite(metrics.phaserTextSlots) || metrics.phaserTextSlots < 16) {
    failures.push(`${context} expected measured fixed text slots, got ${metrics.phaserTextSlots ?? 'none'}`);
  }

  if (!Number.isFinite(metrics.phaserTextOverflows)) {
    failures.push(`${context} missing Phaser text overflow metric`);
  } else if (metrics.phaserTextOverflows > 0) {
    failures.push(
      `${context} has ${metrics.phaserTextOverflows} Phaser text slot overflow(s) ` +
      `(shrinks=${metrics.phaserTextShrinks ?? 'none'}, ellipses=${metrics.phaserTextEllipses ?? 'none'})`
    );
  }
}

function phaserButtonState(metrics, buttonId) {
  return Object.fromEntries(
    String(metrics.phaserButtonStates ?? '')
      .split(',')
      .filter(Boolean)
      .map((entry) => entry.split(':', 2))
  )[buttonId];
}

function validatePhaserFixedWorkbenchScenario(scenario, metrics, failures) {
  if (metrics.workbench !== 'phaser-fixed-skin') {
    failures.push(`expected phaser-fixed-skin workbench, got ${metrics.workbench ?? 'none'}`);
  }

  if (metrics.fixedRenderer !== 'phaser') {
    failures.push(`expected Phaser fixed renderer, got ${metrics.fixedRenderer ?? 'none'}`);
  }

  if (metrics.renderSurface !== 'phaser-canvas') {
    failures.push(`expected Phaser canvas render surface, got ${metrics.renderSurface ?? 'none'}`);
  }

  validateNoPhaserDomStyles(metrics, failures, 'Phaser workbench');

  const expectedProfile = scenario.expectedFixedProfile ?? compactFixedProfile;
  if (metrics.fixedProfile !== expectedProfile) {
    failures.push(`expected ${expectedProfile} Phaser fixed profile, got ${metrics.fixedProfile ?? 'none'}`);
  }

  if (metrics.phaserCanvas.count !== 1) {
    failures.push(`expected one Phaser fixed canvas, got ${metrics.phaserCanvas.count}`);
  }

  if (!Number.isFinite(metrics.phaserCanvasIconMarks) || metrics.phaserCanvasIconMarks < 8) {
    failures.push(`expected Phaser canvas icon marks, got ${metrics.phaserCanvasIconMarks ?? 'none'}`);
  }

  if (!Number.isFinite(metrics.phaserMaterialPanels) || metrics.phaserMaterialPanels < 5) {
    failures.push(`expected Phaser material panels, got ${metrics.phaserMaterialPanels ?? 'none'}`);
  }

  validatePhaserSourceMaterials(scenario, metrics, failures, 'Phaser workbench');
  validatePhaserActionLabels(scenario, metrics, failures, 'Phaser workbench');
  validatePhaserControlAffordances(metrics, failures, 'Phaser workbench');
  validatePhaserTextSlots(metrics, failures, 'Phaser workbench');

  if (!Number.isFinite(metrics.phaserChromeDetails) || metrics.phaserChromeDetails < 5) {
    failures.push(`expected Phaser chrome details, got ${metrics.phaserChromeDetails ?? 'none'}`);
  }

  if (!Number.isFinite(metrics.phaserShellDetails) || metrics.phaserShellDetails < 80) {
    failures.push(`expected Phaser shell hardware details, got ${metrics.phaserShellDetails ?? 'none'}`);
  }

  validatePhaserMapDetails(scenario, metrics, failures, 'Phaser workbench');

  if (!Number.isFinite(metrics.phaserControlDetails) || metrics.phaserControlDetails < 48) {
    failures.push(`expected detailed Phaser control hardware, got ${metrics.phaserControlDetails ?? 'none'}`);
  }

  if (!Number.isFinite(metrics.phaserHudDetails) || metrics.phaserHudDetails < 42) {
    failures.push(`expected detailed Phaser HUD readouts, got ${metrics.phaserHudDetails ?? 'none'}`);
  }

  const canvas = metrics.rects.phaserCanvas;
  if (!canvas || canvas.visibleWidth < metrics.viewport.width * 0.92 || canvas.visibleHeight < metrics.viewport.height * 0.92) {
    failures.push(`Phaser fixed canvas does not fill the test viewport: ${canvas?.visibleWidth ?? 0}x${canvas?.visibleHeight ?? 0}`);
  }

  const expectedCanvasHeight = scenario.viewport.height <= 700 ? 667 : 844;
  if (metrics.phaserCanvas.width !== 390 || metrics.phaserCanvas.height !== expectedCanvasHeight) {
    failures.push(`Phaser fixed canvas has wrong backing size: ${metrics.phaserCanvas.width}x${metrics.phaserCanvas.height}`);
  }

  if ((scenario.mode === 'phaser-fixed-workbench-log' || scenario.mode === 'phaser-fixed-workbench-click-log') && metrics.phaserDrawer !== 'log') {
    failures.push(`expected Phaser log drawer to be open, got ${metrics.phaserDrawer ?? 'none'}`);
  }

  if ((scenario.mode === 'phaser-fixed-workbench-log' || scenario.mode === 'phaser-fixed-workbench-click-log') &&
    (!Number.isFinite(metrics.phaserLogRows) || metrics.phaserLogRows < 4)) {
    failures.push(`expected at least 4 Phaser log rows, got ${metrics.phaserLogRows ?? 'none'}`);
  }

  if (scenario.mode === 'phaser-fixed-workbench-click-log' && phaserButtonState(metrics, 'log') !== 'active') {
    failures.push(`expected Phaser log button active after pointer click, got ${phaserButtonState(metrics, 'log') ?? 'none'}`);
  }

  if (scenario.mode === 'phaser-fixed-workbench-inventory' ||
    scenario.mode === 'phaser-fixed-workbench-inventory-use' ||
    scenario.mode === 'phaser-fixed-workbench-click-inventory') {
    if (metrics.phaserDrawer !== 'inventory') {
      failures.push(`expected Phaser inventory drawer to be open, got ${metrics.phaserDrawer ?? 'none'}`);
    }
    if (metrics.phaserInventoryOpen !== '1') {
      failures.push(`expected Phaser inventory-open dataset, got ${metrics.phaserInventoryOpen ?? 'none'}`);
    }
    if (!Number.isFinite(metrics.phaserInventoryCount) || metrics.phaserInventoryCount < 3) {
      failures.push(`expected at least 3 Phaser inventory rows, got ${metrics.phaserInventoryCount ?? 'none'}`);
    }
    if (!Number.isFinite(metrics.phaserInventoryActions) || metrics.phaserInventoryActions < 3) {
      failures.push(`expected at least 3 Phaser inventory action chips, got ${metrics.phaserInventoryActions ?? 'none'}`);
    }
    if (!Number.isFinite(metrics.phaserInventoryRows) || metrics.phaserInventoryRows < 3) {
      failures.push(`expected at least 3 drawn Phaser inventory rows, got ${metrics.phaserInventoryRows ?? 'none'}`);
    }
    if (!Number.isFinite(metrics.phaserInventoryActionChips) || metrics.phaserInventoryActionChips < 3) {
      failures.push(`expected at least 3 drawn Phaser inventory action chips, got ${metrics.phaserInventoryActionChips ?? 'none'}`);
    }
    if (!Number.isFinite(metrics.phaserInventoryTextBackplates) || metrics.phaserInventoryTextBackplates < metrics.phaserInventoryRows) {
      failures.push(
        `expected Phaser inventory text backplates for every visible row, ` +
        `got ${metrics.phaserInventoryTextBackplates ?? 'none'} for ${metrics.phaserInventoryRows ?? 'none'} rows`
      );
    }
    if (!Number.isFinite(metrics.phaserEquippedCount) || metrics.phaserEquippedCount < 2) {
      failures.push(`expected equipped Phaser inventory states, got ${metrics.phaserEquippedCount ?? 'none'}`);
    }
    if (!metrics.phaserInventoryActionLabels.includes('ON') || !metrics.phaserInventoryActionLabels.includes('USE')) {
      failures.push(`expected ON and USE Phaser inventory labels, got ${metrics.phaserInventoryActionLabels || 'none'}`);
    }
  }

  if (scenario.mode === 'phaser-fixed-workbench-click-inventory' && phaserButtonState(metrics, 'inventory') !== 'active') {
    failures.push(`expected Phaser inventory button active after pointer click, got ${phaserButtonState(metrics, 'inventory') ?? 'none'}`);
  }

  if (scenario.mode === 'phaser-fixed-workbench-click-move') {
    if (metrics.fixedScenario !== 'movement') {
      failures.push(`expected Phaser movement scenario, got ${metrics.fixedScenario ?? 'none'}`);
    }
    if (metrics.phaserPlayerX !== 2 || metrics.phaserPlayerY !== 1) {
      failures.push(`expected Phaser pointer-click movement to reach 2,1, got ${metrics.phaserPlayerX ?? 'none'},${metrics.phaserPlayerY ?? 'none'}`);
    }
    if (phaserButtonState(metrics, 'moveE') !== 'idle') {
      failures.push(`expected Phaser moveE button to be drawn and idle after pointer click, got ${phaserButtonState(metrics, 'moveE') ?? 'none'}`);
    }
  }

  if (scenario.mode === 'phaser-fixed-workbench-hover-run' && metrics.phaserPointerButtonState !== 'run:hover') {
    failures.push(`expected Phaser run hover pointer state, got ${metrics.phaserPointerButtonState || 'none'}`);
  }

  if (scenario.mode === 'phaser-fixed-workbench-press-run' && metrics.phaserPointerButtonState !== 'run:pressed') {
    failures.push(`expected Phaser run pressed pointer state, got ${metrics.phaserPointerButtonState || 'none'}`);
  }

  if (scenario.mode === 'phaser-fixed-workbench-inventory-use' && metrics.phaserPlayerHp !== 55) {
    failures.push(`expected Phaser inventory use to heal HP to 55, got ${metrics.phaserPlayerHp ?? 'none'}`);
  }

  if (scenario.mode === 'phaser-fixed-workbench-defeat' && metrics.phaserTerminalState !== 'defeat') {
    failures.push(`expected Phaser defeat terminal state, got ${metrics.phaserTerminalState ?? 'none'}`);
  }

  if (scenario.mode === 'phaser-fixed-workbench-victory' && metrics.phaserTerminalState !== 'victory') {
    failures.push(`expected Phaser victory terminal state, got ${metrics.phaserTerminalState ?? 'none'}`);
  }

  if (scenario.mode === 'phaser-fixed-workbench-restart') {
    if (metrics.phaserTerminalState !== 'active') {
      failures.push(`expected Phaser restart to return to active state, got ${metrics.phaserTerminalState ?? 'none'}`);
    }
    if (metrics.phaserInCombat !== '1') {
      failures.push(`expected Phaser restart to restore combat scenario, got inCombat=${metrics.phaserInCombat ?? 'none'}`);
    }
  }
}

function validatePhaserFixedRuntimeScenario(scenario, metrics, failures) {
  if (metrics.ui !== 'phaser-fixed-skin') {
    failures.push(`expected phaser-fixed-skin runtime ui, got ${metrics.ui ?? 'none'}`);
  }

  if (metrics.workbench) {
    failures.push(`Phaser fixed runtime should not be in workbench mode: ${metrics.workbench}`);
  }

  if (metrics.fixedRenderer !== 'phaser') {
    failures.push(`expected Phaser fixed renderer, got ${metrics.fixedRenderer ?? 'none'}`);
  }

  if (metrics.renderSurface !== 'phaser-canvas') {
    failures.push(`expected Phaser runtime canvas render surface, got ${metrics.renderSurface ?? 'none'}`);
  }

  validateNoPhaserDomStyles(metrics, failures, 'Phaser runtime');

  const expectedProfile = scenario.expectedFixedProfile ?? compactFixedProfile;
  const isDesktopProfile = isDesktopFixedProfile(expectedProfile);
  if (metrics.fixedProfile !== expectedProfile) {
    failures.push(`expected ${expectedProfile} Phaser fixed runtime profile, got ${metrics.fixedProfile ?? 'none'}`);
  }

  if (metrics.phaserRuntimeState !== 'live') {
    failures.push(`expected live Phaser runtime state, got ${metrics.phaserRuntimeState ?? 'none'}`);
  }

  if (metrics.phaserStatus !== 'ready') {
    failures.push(`expected ready Phaser runtime status, got ${metrics.phaserStatus ?? 'none'}`);
  }

  if (metrics.phaserCanvas.count !== 1) {
    failures.push(`expected one Phaser fixed runtime canvas, got ${metrics.phaserCanvas.count}`);
  }

  const minRuntimeIconMarks = scenario.mode === 'phaser-fixed-runtime-combat' ? 4 : 1;
  if (!Number.isFinite(metrics.phaserCanvasIconMarks) || metrics.phaserCanvasIconMarks < minRuntimeIconMarks) {
    failures.push(`expected Phaser runtime canvas icon marks, got ${metrics.phaserCanvasIconMarks ?? 'none'}`);
  }

  const minMaterialPanels = isDesktopProfile ? 4 : 5;
  if (!Number.isFinite(metrics.phaserMaterialPanels) || metrics.phaserMaterialPanels < minMaterialPanels) {
    failures.push(`expected Phaser runtime material panels, got ${metrics.phaserMaterialPanels ?? 'none'}`);
  }

  validatePhaserSourceMaterials(scenario, metrics, failures, 'Phaser runtime');
  validatePhaserControlAffordances(metrics, failures, 'Phaser runtime');
  validatePhaserTextSlots(metrics, failures, 'Phaser runtime');

  const minChromeDetails = isDesktopProfile ? 4 : 5;
  if (!Number.isFinite(metrics.phaserChromeDetails) || metrics.phaserChromeDetails < minChromeDetails) {
    failures.push(`expected Phaser runtime chrome details, got ${metrics.phaserChromeDetails ?? 'none'}`);
  }

  if (!Number.isFinite(metrics.phaserShellDetails) || metrics.phaserShellDetails < 80) {
    failures.push(`expected Phaser runtime shell hardware details, got ${metrics.phaserShellDetails ?? 'none'}`);
  }

  validatePhaserMapDetails(scenario, metrics, failures, 'Phaser runtime');

  const minControlDetails = isDesktopProfile ? 44 : 48;
  if (!Number.isFinite(metrics.phaserControlDetails) || metrics.phaserControlDetails < minControlDetails) {
    failures.push(`expected detailed Phaser runtime control hardware, got ${metrics.phaserControlDetails ?? 'none'}`);
  }

  const canvas = metrics.rects.phaserCanvas;
  if (!canvas || canvas.visibleWidth < metrics.viewport.width * 0.92 || canvas.visibleHeight < metrics.viewport.height * 0.92) {
    failures.push(`Phaser fixed runtime canvas does not fill the test viewport: ${canvas?.visibleWidth ?? 0}x${canvas?.visibleHeight ?? 0}`);
  }

  const expectedCanvasWidth = isDesktopProfile ? scenario.viewport.width : 390;
  const expectedCanvasHeight = isDesktopProfile ? scenario.viewport.height : scenario.viewport.height <= 700 ? 667 : 844;
  if (metrics.phaserCanvas.width !== expectedCanvasWidth || metrics.phaserCanvas.height !== expectedCanvasHeight) {
    failures.push(`Phaser fixed runtime canvas has wrong backing size: ${metrics.phaserCanvas.width}x${metrics.phaserCanvas.height}`);
  }

  if (scenario.mode === 'phaser-fixed-runtime-log' && metrics.phaserDrawer !== 'log') {
    failures.push(`expected Phaser runtime log drawer to be open, got ${metrics.phaserDrawer ?? 'none'}`);
  }

  if (scenario.mode === 'phaser-fixed-runtime-inventory') {
    if (metrics.phaserDrawer !== 'inventory') {
      failures.push(`expected Phaser runtime inventory drawer to be open, got ${metrics.phaserDrawer ?? 'none'}`);
    }
    if (metrics.phaserInventoryOpen !== '1') {
      failures.push(`expected Phaser runtime inventory-open dataset, got ${metrics.phaserInventoryOpen ?? 'none'}`);
    }
    if (!Number.isFinite(metrics.phaserInventoryCount)) {
      failures.push(`expected Phaser runtime inventory count, got ${metrics.phaserInventoryCount ?? 'none'}`);
    }
  }

  if (scenario.mode === 'phaser-fixed-runtime-combat') {
    if (metrics.phaserInCombat !== '1') {
      failures.push(`expected Phaser runtime combat state, got inCombat=${metrics.phaserInCombat ?? 'none'}`);
    }
    if (metrics.phaserTerminalState !== 'active') {
      failures.push(`expected active Phaser runtime terminal state in combat, got ${metrics.phaserTerminalState ?? 'none'}`);
    }
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

  validateFixedHpHardware(metrics, failures, 'fixed runtime');
  validateFixedTitleHardware(metrics, failures, 'fixed runtime');
  validateFixedControlHardware(metrics, failures, 'fixed runtime');
  validateFixedMapGlass(metrics, failures, 'fixed runtime');
  validateFixedDrawerToggleHardware(metrics, failures, 'fixed runtime');
  validateFixedCombatModeHardware(metrics, failures, 'fixed runtime');
  validateFixedStatusHardware(metrics, failures, 'fixed runtime', 'ready');

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

function validateFixedHpHardware(metrics, failures, context) {
  const label = metrics.rects.hpLabel;
  const value = metrics.rects.playerHpValue;
  const fill = metrics.rects.playerHpFill;

  if (!label || label.visibleWidth < scaledFixedThreshold(metrics, 32) || label.visibleHeight < scaledFixedThreshold(metrics, 18)) {
    failures.push(`${context} HP label plate is clipped: ${label?.visibleWidth ?? 0}x${label?.visibleHeight ?? 0}`);
  }

  if (!value || value.visibleWidth < scaledFixedThreshold(metrics, 62) || value.visibleHeight < scaledFixedThreshold(metrics, 16)) {
    failures.push(`${context} HP value plate is clipped: ${value?.visibleWidth ?? 0}x${value?.visibleHeight ?? 0}`);
  }

  if (value && value.scrollWidth > value.clientWidth + 1) {
    failures.push(`${context} HP value is clipped: ${value.scrollWidth}px > ${value.clientWidth}px`);
  }

  const hpValue = Number(metrics.playerHpText.split('/')[0]);
  if (!fill || fill.visibleHeight < 4 || (hpValue > 0 && fill.visibleWidth < 1)) {
    failures.push(`${context} HP fill is clipped: ${fill?.visibleWidth ?? 0}x${fill?.visibleHeight ?? 0}`);
  }

  if (!metrics.hp.labelStyled || !metrics.hp.valueStyled) {
    failures.push(`${context} HP hardware lacks physical styling`);
  }
}

function validateFixedTitleHardware(metrics, failures, context) {
  const icon = metrics.rects.titleIcon;
  const text = metrics.rects.titleTextNode;
  const minIconSize = scaledFixedThreshold(metrics, 18);

  if (!icon || icon.visibleWidth < minIconSize || icon.visibleHeight < minIconSize) {
    failures.push(`${context} title badge is clipped: ${icon?.visibleWidth ?? 0}x${icon?.visibleHeight ?? 0}`);
  }

  if (!text || text.visibleWidth < scaledFixedThreshold(metrics, 90) || text.visibleHeight < scaledFixedThreshold(metrics, 12)) {
    failures.push(`${context} title text lane is clipped: ${text?.visibleWidth ?? 0}x${text?.visibleHeight ?? 0}`);
  }

  if (!metrics.title.iconStyled) {
    failures.push(`${context} title badge lacks physical styling`);
  }

  if (!metrics.title.iconClass.includes('fa-')) {
    failures.push(`${context} title badge is missing a Font Awesome icon class`);
  }

  if (!metrics.title.text) {
    failures.push(`${context} title text is empty`);
  }
}

function validateFixedControlHardware(metrics, failures, context) {
  if (!isProductionFixedProfile(metrics.fixedProfileRole)) {
    return;
  }

  const panel = metrics.rects.controlsPanel;
  const minPanelWidth = scaledFixedThreshold(metrics, 340);
  const minPanelHeight = scaledFixedThreshold(metrics, metrics.fixedProfileKind === 'mobileCompact' ? 140 : 180);

  if (!panel || panel.visibleWidth < minPanelWidth || panel.visibleHeight < minPanelHeight) {
    failures.push(`${context} control bay is clipped: ${panel?.visibleWidth ?? 0}x${panel?.visibleHeight ?? 0}`);
    return;
  }

  if (!metrics.controls.panelStyled) {
    failures.push(`${context} control bay lacks physical styling`);
  }

  if (metrics.controls.visibleButtons < 6) {
    failures.push(`${context} control bay is missing visible controls: ${metrics.controls.visibleButtons}/6`);
  }

  if (metrics.controls.spriteButtons < metrics.controls.visibleButtons) {
    failures.push(`${context} controls lost fixed sprite backgrounds: ${metrics.controls.spriteButtons}/${metrics.controls.visibleButtons}`);
  }

  for (const [name, rect] of [
    ['move-n', metrics.rects.moveNorthButton],
    ['move-s', metrics.rects.moveSouthButton],
    ['move-e', metrics.rects.moveEastButton],
    ['move-w', metrics.rects.moveWestButton],
    ['attack', metrics.rects.attackButton],
    ['run', metrics.rects.runButton]
  ]) {
    if (!rect) {
      failures.push(`${context} ${name} control is missing`);
      continue;
    }

    if (
      rect.left < panel.left - 1 ||
      rect.top < panel.top - 1 ||
      rect.right > panel.right + 1 ||
      rect.bottom > panel.bottom + 1
    ) {
      failures.push(`${context} ${name} escapes control bay bounds`);
    }
  }
}

function validateFixedMapGlass(metrics, failures, context) {
  if (!metrics.mapGlass.glassStyled) {
    failures.push(`${context} map glass overlay lacks physical styling`);
  }

  if (!metrics.mapGlass.pointerSafe) {
    failures.push(`${context} map glass overlay may intercept pointer input`);
  }

  if (!metrics.mapGlass.canvasBelowGlass) {
    failures.push(
      `${context} map glass layering is wrong: canvas=${metrics.mapGlass.canvasZ}, before=${metrics.mapGlass.beforeZ}, after=${metrics.mapGlass.afterZ}`
    );
  }

  if (metrics.mapIcons.total > 0 && !metrics.mapGlass.iconsAboveGlass) {
    failures.push(
      `${context} map icons are not above glass overlay: icons=${metrics.mapGlass.overlayZ}, glass=${metrics.mapGlass.afterZ}`
    );
  }
}

function validateFixedDrawerToggleHardware(metrics, failures, context) {
  if (!isProductionFixedProfile(metrics.fixedProfileRole)) {
    return;
  }

  const expectedStates = {
    'fixed-log-toggle': metrics.logOpen ? 'pressed' : 'idle',
    'fixed-inventory-toggle': metrics.inventoryOpen ? 'pressed' : 'idle'
  };
  const expectedExpanded = {
    'fixed-log-toggle': metrics.logOpen ? 'true' : 'false',
    'fixed-inventory-toggle': metrics.inventoryOpen ? 'true' : 'false'
  };

  for (const [id, rect] of [
    ['fixed-log-toggle', metrics.rects.logToggleButton],
    ['fixed-inventory-toggle', metrics.rects.inventoryToggleButton]
  ]) {
    const label = id === 'fixed-log-toggle' ? 'log toggle' : 'inventory toggle';
    if (!rect || rect.visibleWidth < scaledFixedThreshold(metrics, 38) || rect.visibleHeight < scaledFixedThreshold(metrics, 24)) {
      failures.push(`${context} ${label} is clipped: ${rect?.visibleWidth ?? 0}x${rect?.visibleHeight ?? 0}`);
      continue;
    }

    if (rect.backgroundImage === 'none') {
      failures.push(`${context} ${label} lost fixed sprite background`);
    }

    if (rect.visualState !== expectedStates[id]) {
      failures.push(`${context} ${label} visual state should be ${expectedStates[id]}, got ${rect.visualState ?? 'none'}`);
    }

    if (rect.ariaPressed !== expectedExpanded[id] || rect.ariaExpanded !== expectedExpanded[id]) {
      failures.push(`${context} ${label} aria state should be ${expectedExpanded[id]}`);
    }
  }

  if (metrics.drawerToggles.visibleToggles < 2) {
    failures.push(`${context} drawer toggles are missing: ${metrics.drawerToggles.visibleToggles}/2`);
  }

  if (metrics.drawerToggles.spriteToggles < metrics.drawerToggles.visibleToggles) {
    failures.push(
      `${context} drawer toggles lost fixed sprite backgrounds: ${metrics.drawerToggles.spriteToggles}/${metrics.drawerToggles.visibleToggles}`
    );
  }
}

function validateFixedStatusHardware(metrics, failures, context, expectedState) {
  const status = metrics.rects.statusPill;
  if (!status) {
    failures.push(`${context} status indicator is missing`);
    return;
  }

  if (status.visualState !== expectedState) {
    failures.push(`${context} status visual state should be ${expectedState}, got ${status.visualState ?? 'none'}`);
  }

  if (status.backgroundImage === 'none') {
    failures.push(`${context} status indicator has no state sprite`);
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

function validateFixedInventoryLatchedActions(metrics, failures, context) {
  if (!metrics.inventory?.equippedItems) {
    return;
  }

  if (metrics.inventory.equippedActions < metrics.inventory.equippedItems) {
    failures.push(
      `${context} inventory is missing equipped action states: ${metrics.inventory.equippedActions}/${metrics.inventory.equippedItems}`
    );
  }
  if (metrics.inventory.visibleEquippedActions < metrics.inventory.equippedItems) {
    failures.push(
      `${context} inventory equipped actions are not all visible: ${metrics.inventory.visibleEquippedActions}/${metrics.inventory.equippedItems}`
    );
  }
  if (metrics.inventory.styledEquippedActions < metrics.inventory.equippedItems) {
    failures.push(
      `${context} inventory equipped actions lack latched styling: ${metrics.inventory.styledEquippedActions}/${metrics.inventory.equippedItems}`
    );
  }
  if (!metrics.inventory.equippedActionLabels.every((label) => label === 'ON')) {
    failures.push(
      `${context} inventory equipped actions should read ON, got ${metrics.inventory.equippedActionLabels.join(', ') || 'none'}`
    );
  }
}

function validateFixedCombatModeHardware(metrics, failures, context) {
  const mode = metrics.rects.combatModeLabel;
  const expectedState = metrics.inCombat ? 'combat' : 'explore';
  const minWidth = scaledFixedThreshold(metrics, metrics.fixedProfileKind === 'mobileCompact' ? 58 : 64);
  const minHeight = scaledFixedThreshold(metrics, metrics.fixedProfileKind === 'mobileCompact' ? 14 : 16);

  if (!mode || mode.visibleWidth < minWidth || mode.visibleHeight < minHeight) {
    failures.push(`${context} combat mode plate is clipped: ${mode?.visibleWidth ?? 0}x${mode?.visibleHeight ?? 0}`);
    return;
  }

  if (!metrics.combat.modeStyled) {
    failures.push(`${context} combat mode plate lacks physical styling`);
  }

  if (metrics.combat.modeState !== expectedState) {
    failures.push(`${context} combat mode plate state should be ${expectedState}, got ${metrics.combat.modeState || 'empty'}`);
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
  validateFixedMapGlass(metrics, failures, 'fixed workbench');
  validateFixedCombatModeHardware(metrics, failures, 'fixed workbench');

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
    validateFixedStatusHardware(metrics, failures, 'fixed workbench', 'thinking');
    if (!metrics.controlStates.attackDisabled || !metrics.controlStates.runDisabled) {
      failures.push('status scenario did not disable pending combat controls');
    }
  } else if (metrics.statusText !== 'READY') {
    failures.push(`fixed workbench steady state should show READY status, got ${metrics.statusText || 'empty'}`);
  } else {
    validateFixedStatusHardware(metrics, failures, 'fixed workbench', 'ready');
  }

  validateFixedHpHardware(metrics, failures, 'fixed workbench');
  validateFixedTitleHardware(metrics, failures, 'fixed workbench');
  validateFixedControlHardware(metrics, failures, 'fixed workbench');
  validateFixedDrawerToggleHardware(metrics, failures, 'fixed workbench');

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
      validateFixedInventoryLatchedActions(metrics, failures, 'fixed workbench');
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
  const minMapHeight = metrics.fixedProfileKind === 'mobileCompact'
    ? scaledFixedThreshold(metrics, 220)
    : isProductionMobileProfile
      ? scaledFixedThreshold(metrics, 250)
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
      if (metrics.log.scrollable) {
        if (metrics.log.scrollableState !== '1' || metrics.log.scrollOverflowState !== '1') {
          failures.push(
            `fixed workbench log scroll state is not exposed: scrollable=${metrics.log.scrollableState || 'none'}, overflow=${metrics.log.scrollOverflowState || 'none'}`
          );
        }
        if (!metrics.log.scrollCueVisible || !metrics.log.scrollCueStyled) {
          failures.push('fixed workbench log overflow cue is missing or unstyled');
        }
        if (!metrics.log.scrollCueIconClass.includes('fa-chevron-down')) {
          failures.push(`fixed workbench log overflow cue is missing the chevron icon: ${metrics.log.scrollCueIconClass || 'none'}`);
        }
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
    validateFixedInventoryLatchedActions(metrics, failures, 'fixed runtime');
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
  const badge = metrics.rects.endStateBadge;
  const icon = metrics.rects.endStateIcon;
  const minTerminalHeight = metrics.fixedProfileKind === 'mobileCompact' ? 230 : 250;
  if (!overlay || overlay.visibleHeight < minTerminalHeight || overlay.visibleWidth < 280) {
    failures.push(`fixed end-state overlay is too small: ${overlay?.visibleWidth ?? 0}x${overlay?.visibleHeight ?? 0}`);
  }
  if (!panel || panel.visibleHeight < minTerminalHeight || panel.visibleWidth < 280) {
    failures.push(`fixed end-state panel is too small: ${panel?.visibleWidth ?? 0}x${panel?.visibleHeight ?? 0}`);
  }
  if (!badge || badge.visibleWidth < scaledFixedThreshold(metrics, 26) || badge.visibleHeight < scaledFixedThreshold(metrics, 26)) {
    failures.push(`fixed end-state badge is clipped: ${badge?.visibleWidth ?? 0}x${badge?.visibleHeight ?? 0}`);
  }
  if (!icon || icon.visibleWidth < scaledFixedThreshold(metrics, 10) || icon.visibleHeight < scaledFixedThreshold(metrics, 10)) {
    failures.push(`fixed end-state badge icon is clipped: ${icon?.visibleWidth ?? 0}x${icon?.visibleHeight ?? 0}`);
  }
  if (!metrics.endState.badgeStyled) {
    failures.push('fixed end-state badge lacks physical styling');
  }
  if (metrics.endState.outcome !== expectedScenario) {
    failures.push(`fixed end-state badge outcome should be ${expectedScenario}, got ${metrics.endState.outcome || 'empty'}`);
  }
  const expectedIcon = expectedScenario === 'victory' ? 'fa-trophy' : 'fa-skull';
  if (!metrics.endState.iconClass.includes(expectedIcon)) {
    failures.push(`fixed end-state badge icon should include ${expectedIcon}, got ${metrics.endState.iconClass || 'empty'}`);
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
  if (player && player.scrollHeight > player.clientHeight + 1) {
    failures.push(`compact mobile player panel content overflows: ${player.scrollHeight}px > ${player.clientHeight}px`);
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
    if (!metrics.latest.messageStyled) {
      failures.push('fixed latest message lacks physical styling');
    }

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
