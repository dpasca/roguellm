import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const fixedRootDir = path.resolve('src/skins/neo-tokyo-console/fixed');

const skinRegions = {
  map: { x: 22, y: 48, width: 346, height: 281 },
  title: { x: 32, y: 454, width: 258, height: 34 },
  latest: { x: 24, y: 344, width: 284, height: 86 },
  log: { x: 24, y: 342, width: 342, height: 284 },
  inventory: { x: 24, y: 342, width: 342, height: 284 },
  player: { x: 24, y: 488, width: 342, height: 54 },
  combat: { x: 24, y: 562, width: 342, height: 64 },
  controls: { x: 18, y: 646, width: 354, height: 187 },
  endState: { x: 38, y: 360, width: 314, height: 292 }
};

const skinAssets = {
  chassis: { path: 'chassis.png', width: 390, height: 844 },
  buttons: {
    attack: { prefix: 'attack', width: 152, height: 66, alpha: true },
    run: { prefix: 'run', width: 152, height: 66, alpha: true },
    restart: { prefix: 'restart', width: 226, height: 66, alpha: true },
    log: { prefix: 'log', width: 46, height: 32, alpha: true },
    inventory: { prefix: 'inventory', width: 46, height: 32, alpha: true },
    moveN: { prefix: 'dpad-n', width: 58, height: 58, alpha: true },
    moveS: { prefix: 'dpad-s', width: 58, height: 58, alpha: true },
    moveE: { prefix: 'dpad-e', width: 58, height: 58, alpha: true },
    moveW: { prefix: 'dpad-w', width: 58, height: 58, alpha: true }
  },
  indicators: {
    status: { prefix: 'status', states: ['ready', 'thinking', 'error', 'offline'], width: 60, height: 26, alpha: true },
    combatLed: { files: ['led-on.png', 'led-off.png'], width: 18, height: 18, alpha: true }
  }
};

const skinLayout = {
  buttons: {
    attack: { x: 205, y: 666, width: 152, height: 66 },
    run: { x: 205, y: 746, width: 152, height: 66 },
    restart: { x: 82, y: 578, width: 226, height: 66 },
    log: { x: 315, y: 348, width: 46, height: 32 },
    inventory: { x: 315, y: 392, width: 46, height: 32 },
    moveN: { x: 73, y: 672, width: 58, height: 58 },
    moveS: { x: 73, y: 768, width: 58, height: 58 },
    moveE: { x: 121, y: 720, width: 58, height: 58 },
    moveW: { x: 25, y: 720, width: 58, height: 58 }
  },
  indicators: {
    status: { x: 301, y: 454, width: 60, height: 26 },
    combatLed: { x: 349, y: 563, width: 18, height: 18 }
  },
  fills: {
    playerHp: { x: 84, y: 505, width: 196, height: 8 },
    enemyHp: { x: 168, y: 604, width: 150, height: 8 },
    playerStats: { x: 34, y: 523, width: 316, height: 18 }
  }
};

const variants = [
  {
    id: 'gold-mobile',
    displayLabel: 'Gold Mobile Cyberdeck',
    label: 'GOLD MOBILE CYBERDECK',
    role: 'variant',
    defaultPriority: 70,
    tags: ['cyberpunk', 'city', 'neon', 'technology', 'crime', 'modern'],
    mood: ['dense', 'electric', 'tactical', 'premium'],
    palette: ['green', 'gold', 'graphite'],
    footer: 'MOBILE PROFILE',
    version: 'v0.3',
    accent: '#79ff69',
    accentSoft: '#8aff75',
    accentDim: '#1e6a42',
    accentLine: '#143f2e',
    secondary: '#ff9c21',
    textMuted: '#8ea09d',
    textDim: '#586865',
    shellTop: '#203334',
    shellMid: '#0a1717',
    shellStroke: '#284241',
    panelStroke: '#35504e',
    panelInset: '#0f2420',
    noise: '#243232',
    action: {
      attack: { main: '#ff4e32', dark: '#5a120d', light: '#ffb08a', text: '#ffd5bd' },
      run: { main: '#50e33e', dark: '#0f4318', light: '#c9ff9d', text: '#d8ffd0' },
      restart: { main: '#79f85d', dark: '#123f1c', light: '#efffc5', text: '#f2ffe0' }
    },
    status: {
      ready: ['#77ff55', '#103a19'],
      thinking: ['#ffc64d', '#49350b'],
      error: ['#ff5f76', '#4a1018'],
      offline: ['#7a8588', '#101617']
    }
  },
  {
    id: 'amber-mobile',
    displayLabel: 'Amber Relay Cyberdeck',
    label: 'AMBER RELAY CYBERDECK',
    role: 'variant',
    defaultPriority: 60,
    tags: ['industrial', 'relay', 'retro', 'technology', 'underground'],
    mood: ['warm', 'mechanical', 'tactical', 'nocturnal'],
    palette: ['amber', 'cyan', 'charcoal'],
    footer: 'AMBER PROFILE',
    version: 'v0.1',
    accent: '#ffb84a',
    accentSoft: '#ffd477',
    accentDim: '#8a5215',
    accentLine: '#58340b',
    secondary: '#38e6d5',
    textMuted: '#c9ad82',
    textDim: '#7c6545',
    shellTop: '#352816',
    shellMid: '#15110c',
    shellStroke: '#5e4725',
    panelStroke: '#6a4a23',
    panelInset: '#251a0d',
    noise: '#3a2b18',
    action: {
      attack: { main: '#ff8428', dark: '#561904', light: '#ffd08a', text: '#ffe2b7' },
      run: { main: '#23cfc1', dark: '#07383d', light: '#b9fff8', text: '#e1fffb' },
      restart: { main: '#ffc34d', dark: '#573506', light: '#fff0a8', text: '#fff5d0' }
    },
    status: {
      ready: ['#ffbd54', '#4a2d08'],
      thinking: ['#42e8d9', '#073a3d'],
      error: ['#ff5f76', '#4a1018'],
      offline: ['#8a8175', '#171411']
    }
  },
  {
    id: 'reference-mobile-v3',
    displayLabel: 'Reference Compact V3',
    label: 'REFERENCE COMPACT V3',
    role: 'default',
    defaultPriority: 100,
    tags: ['cyberpunk', 'neon', 'urban', 'technology', 'crime', 'modern'],
    mood: ['dense', 'electric', 'premium', 'tactical'],
    palette: ['green', 'orange', 'graphite'],
    footer: 'CYBERDECK V3',
    version: 'v0.1',
    premium: true,
    accent: '#82ff6b',
    accentSoft: '#c8ff9c',
    accentDim: '#2f7047',
    accentLine: '#329356',
    secondary: '#ff8d24',
    textMuted: '#b9c9c3',
    textDim: '#7c8c87',
    shellTop: '#48514f',
    shellMid: '#151c1a',
    shellStroke: '#77817d',
    panelStroke: '#687a73',
    panelInset: '#101f1a',
    noise: '#2c3835',
    action: {
      attack: { main: '#cf3927', dark: '#280706', light: '#ffb18a', text: '#ffe7cb' },
      run: { main: '#39d32f', dark: '#082b12', light: '#baff8a', text: '#e6ffdc' },
      restart: { main: '#d54632', dark: '#2c0807', light: '#ffb07d', text: '#fff2d7' }
    },
    status: {
      ready: ['#91ff64', '#0c2d12'],
      thinking: ['#ffb942', '#432c08'],
      error: ['#ff6679', '#451018'],
      offline: ['#7d8a85', '#111616']
    }
  },
  {
    id: 'signal-noir-mobile',
    displayLabel: 'Signal Noir Cyberdeck',
    label: 'SIGNAL NOIR CYBERDECK',
    role: 'variant',
    defaultPriority: 80,
    tags: ['noir', 'signal', 'rain', 'city', 'technology', 'modern'],
    mood: ['sleek', 'nocturnal', 'precise', 'premium'],
    palette: ['cyan', 'coral', 'graphite'],
    footer: 'SIGNAL PROFILE',
    version: 'v0.1',
    premium: true,
    accent: '#37f4df',
    accentSoft: '#c4fff7',
    accentDim: '#1e6e68',
    accentLine: '#2daea4',
    secondary: '#ff5f47',
    textMuted: '#b6cbc8',
    textDim: '#768c89',
    shellTop: '#4c5555',
    shellMid: '#11191a',
    shellStroke: '#7b8785',
    panelStroke: '#637d7a',
    panelInset: '#0d2021',
    noise: '#293938',
    action: {
      attack: { main: '#ff4f38', dark: '#3b0907', light: '#ffb299', text: '#ffe3d8' },
      run: { main: '#2bd8ca', dark: '#063a3d', light: '#b5fff5', text: '#e3fffb' },
      restart: { main: '#ff7d3f', dark: '#3e1207', light: '#ffd19a', text: '#fff0dc' }
    },
    status: {
      ready: ['#36f0dc', '#073a3a'],
      thinking: ['#ffbd54', '#432c08'],
      error: ['#ff6b72', '#461015'],
      offline: ['#87918f', '#111718']
    }
  }
];

const buttonStates = {
  idle: { y: 0, glow: 0.62, shade: 0, alpha: 1 },
  hover: { y: -1, glow: 0.9, shade: 8, alpha: 1 },
  pressed: { y: 2, glow: 0.44, shade: -10, alpha: 1 },
  disabled: { y: 0, glow: 0.12, shade: -48, alpha: 0.62 }
};

for (const variant of variants) {
  generateVariant(variant);
}

function generateVariant(variant) {
  const outDir = path.join(fixedRootDir, variant.id);
  fs.mkdirSync(outDir, { recursive: true });

  writeText(outDir, 'skin-kit.json', `${JSON.stringify({
    id: variant.id,
    meta: skinMeta(variant),
    kind: 'mobilePortrait',
    size: { width: 390, height: 844 },
    regions: skinRegions,
    assets: skinAssets,
    layout: skinLayout
  }, null, 2)}\n`);

  writePng(outDir, 'chassis.png', variant.premium ? premiumChassisSvg(variant) : chassisSvg(variant));

  for (const state of Object.keys(buttonStates)) {
    writePng(outDir, `attack-${state}.png`, variant.premium
      ? premiumActionButtonSvg('ATTACK', 152, 66, state, variant.action.attack)
      : actionButtonSvg('ATTACK', 152, 66, state, variant.action.attack));
    writePng(outDir, `run-${state}.png`, variant.premium
      ? premiumActionButtonSvg('RUN', 152, 66, state, variant.action.run)
      : actionButtonSvg('RUN', 152, 66, state, variant.action.run));
    writePng(outDir, `restart-${state}.png`, variant.premium
      ? premiumActionButtonSvg('RESTART', 226, 66, state, variant.action.restart)
      : actionButtonSvg('RESTART', 226, 66, state, variant.action.restart));
    writePng(outDir, `log-${state}.png`, variant.premium ? premiumToggleSvg('LOG', state, variant) : smallToggleSvg('LOG', state, variant));
    writePng(outDir, `inventory-${state}.png`, variant.premium ? premiumToggleSvg('BAG', state, variant) : smallToggleSvg('BAG', state, variant));
    writePng(outDir, `dpad-n-${state}.png`, variant.premium ? premiumDpadButtonSvg('n', state, variant) : dpadButtonSvg('n', state, variant));
    writePng(outDir, `dpad-s-${state}.png`, variant.premium ? premiumDpadButtonSvg('s', state, variant) : dpadButtonSvg('s', state, variant));
    writePng(outDir, `dpad-e-${state}.png`, variant.premium ? premiumDpadButtonSvg('e', state, variant) : dpadButtonSvg('e', state, variant));
    writePng(outDir, `dpad-w-${state}.png`, variant.premium ? premiumDpadButtonSvg('w', state, variant) : dpadButtonSvg('w', state, variant));
  }

  writePng(outDir, 'status-ready.png', variant.premium ? premiumStatusSvg(...variant.status.ready) : statusSvg(...variant.status.ready));
  writePng(outDir, 'status-thinking.png', variant.premium ? premiumStatusSvg(...variant.status.thinking) : statusSvg(...variant.status.thinking));
  writePng(outDir, 'status-error.png', variant.premium ? premiumStatusSvg(...variant.status.error) : statusSvg(...variant.status.error));
  writePng(outDir, 'status-offline.png', variant.premium ? premiumStatusSvg(...variant.status.offline) : statusSvg(...variant.status.offline));
  writePng(outDir, 'led-on.png', variant.premium ? premiumLedSvg(true, variant) : ledSvg(true, variant));
  writePng(outDir, 'led-off.png', variant.premium ? premiumLedSvg(false, variant) : ledSvg(false, variant));
}

function skinMeta(variant) {
  return {
    label: variant.displayLabel,
    family: 'Neo Tokyo Console',
    role: variant.role,
    tags: variant.tags,
    mood: variant.mood,
    palette: variant.palette,
    defaultPriority: variant.defaultPriority,
    generation: variant.premium ? 'deterministic-svg-premium' : 'deterministic-svg'
  };
}

function writeText(outDir, filename, content) {
  fs.writeFileSync(path.join(outDir, filename), content, 'utf8');
}

function writePng(outDir, filename, svgSource) {
  const output = path.join(outDir, filename);
  execFileSync('magick', ['-background', 'none', 'svg:-', '-strip', `PNG32:${output}`], { input: svgSource });
}

function chassisSvg(variant) {
  const panels = [
    frame(18, 44, 354, 289, 'MAP', variant),
    frame(20, 340, 292, 94, 'LATEST', variant),
    frame(20, 484, 350, 62, 'PLAYER', variant),
    frame(20, 558, 350, 72, 'COMBAT', variant),
    frame(14, 642, 362, 195, 'CONTROL', variant)
  ].join('\n');

  return svg(390, 844, `
    <defs>
      ${defs(variant)}
    </defs>
    <rect width="390" height="844" fill="#010404"/>
    <rect x="3" y="2" width="384" height="840" rx="13" fill="#020505" stroke="${variant.shellStroke}" stroke-width="2"/>
    <rect x="6" y="5" width="378" height="834" rx="11" fill="url(#shell)" stroke="#0b1111" stroke-width="2"/>
    <rect x="10" y="10" width="370" height="824" rx="9" fill="#071111" stroke="${variant.panelInset}"/>
    <rect x="13" y="13" width="364" height="818" rx="7" fill="url(#fineNoise)" opacity="0.58"/>
    <g opacity="0.24">
      <rect x="15" y="48" width="4" height="580" fill="${variant.accentDim}"/>
      <rect x="371" y="48" width="4" height="580" fill="#0a1714"/>
      <rect x="15" y="640" width="360" height="7" fill="#111d1c"/>
      ${Array.from({ length: 18 }, (_, index) => `<line x1="18" y1="${660 + index * 9}" x2="372" y2="${660 + index * 9}" stroke="${variant.noise}"/>`).join('')}
    </g>

    <g opacity="0.8">
      <line x1="10" y1="8" x2="380" y2="8" stroke="${variant.panelStroke}"/>
      <line x1="10" y1="836" x2="380" y2="836" stroke="#111a1a"/>
      <line x1="8" y1="16" x2="8" y2="828" stroke="${variant.shellStroke}"/>
      <line x1="382" y1="16" x2="382" y2="828" stroke="#0c1212"/>
    </g>

    <rect x="17" y="18" width="356" height="22" rx="6" fill="#101a1b" stroke="${variant.panelStroke}"/>
    <rect x="19" y="20" width="352" height="18" rx="5" fill="#071010" stroke="${variant.panelInset}"/>
    <rect x="23" y="25" width="26" height="8" rx="4" fill="${variant.secondary}"/>
    <text x="58" y="32" font-family="Arial Black, Arial, sans-serif" font-size="8" fill="${variant.textMuted}">ROGUELLM</text>
    <text x="151" y="31" font-family="Arial Black, Arial, sans-serif" font-size="7" fill="${variant.textDim}">${variant.label}</text>
    <g transform="translate(323 20)">
      <rect x="0" y="11" width="5" height="9" fill="${variant.accent}"/>
      <rect x="8" y="7" width="5" height="13" fill="${variant.accent}"/>
      <rect x="16" y="3" width="5" height="17" fill="${variant.accent}"/>
      <rect x="24" y="0" width="5" height="20" fill="${variant.accent}"/>
    </g>
    ${screw(24, 26, variant)}
    ${screw(365, 26, variant)}
    ${screw(25, 817, variant)}
    ${screw(365, 817, variant)}

    ${panels}

    <rect x="16" y="646" width="358" height="1" fill="${variant.panelStroke}"/>
    <rect x="70" y="668" width="65" height="161" rx="8" fill="#101d1f" stroke="${variant.panelStroke}" stroke-width="2"/>
    <rect x="81" y="707" width="43" height="84" rx="6" fill="#081213" stroke="${variant.shellStroke}"/>
    <rect x="88" y="721" width="29" height="48" rx="5" fill="#020606" stroke="${variant.textDim}"/>
    <rect x="198" y="660" width="166" height="78" rx="10" fill="#0c1716" stroke="${variant.panelStroke}" stroke-width="2"/>
    <rect x="202" y="664" width="158" height="70" rx="8" fill="none" stroke="${variant.panelInset}"/>
    <rect x="198" y="740" width="166" height="78" rx="10" fill="#0c1716" stroke="${variant.panelStroke}" stroke-width="2"/>
    <rect x="202" y="744" width="158" height="70" rx="8" fill="none" stroke="${variant.panelInset}"/>
    <g opacity="0.58">
      <line x1="206" y1="733" x2="356" y2="733" stroke="${variant.noise}"/>
      <line x1="206" y1="813" x2="356" y2="813" stroke="${variant.noise}"/>
      <line x1="20" y1="690" x2="188" y2="690" stroke="${variant.panelInset}"/>
      <line x1="20" y1="810" x2="188" y2="810" stroke="${variant.panelInset}"/>
    </g>
    <text x="27" y="825" font-family="Arial Black, Arial, sans-serif" font-size="7" fill="${variant.textDim}">${variant.footer}</text>
    <text x="330" y="825" font-family="Arial Black, Arial, sans-serif" font-size="7" fill="${variant.textDim}">${variant.version}</text>
  `);
}

function premiumChassisSvg(variant) {
  const panels = [
    premiumFrame(18, 44, 354, 289, 'MAP', variant, 'large'),
    premiumFrame(20, 340, 292, 94, 'MSG-01', variant, 'drawer'),
    premiumFrame(20, 484, 350, 62, 'PLAYER', variant, 'thin'),
    premiumFrame(20, 558, 350, 72, 'COMBAT', variant, 'thin'),
    premiumFrame(14, 642, 362, 195, 'CONTROL', variant, 'deck')
  ].join('\n');

  return svg(390, 844, `
    <defs>
      ${defs(variant)}
      <linearGradient id="premiumShell" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${variant.shellTop}"/>
        <stop offset="0.16" stop-color="#252c2a"/>
        <stop offset="0.54" stop-color="#0b1110"/>
        <stop offset="1" stop-color="#303836"/>
      </linearGradient>
      <linearGradient id="edgeHot" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#ff4b18"/>
        <stop offset="0.32" stop-color="#ffb320"/>
        <stop offset="0.66" stop-color="#3bcbff"/>
        <stop offset="1" stop-color="#5cff5a"/>
      </linearGradient>
      <linearGradient id="glass" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#123625"/>
        <stop offset="0.42" stop-color="#05110d"/>
        <stop offset="1" stop-color="#010403"/>
      </linearGradient>
      <linearGradient id="sideRail" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${variant.secondary}" stop-opacity="0.9"/>
        <stop offset="0.42" stop-color="${variant.accent}" stop-opacity="0.36"/>
        <stop offset="0.8" stop-color="#1a2421" stop-opacity="0.5"/>
        <stop offset="1" stop-color="${variant.secondary}" stop-opacity="0.78"/>
      </linearGradient>
      <radialGradient id="consoleBloom" cx="0.5" cy="0.18" r="0.82">
        <stop offset="0" stop-color="${variant.accent}" stop-opacity="0.13"/>
        <stop offset="0.42" stop-color="${variant.secondary}" stop-opacity="0.05"/>
        <stop offset="1" stop-color="#000000" stop-opacity="0"/>
      </radialGradient>
      <pattern id="brushed" width="8" height="8" patternUnits="userSpaceOnUse">
        <path d="M0 1H8M0 4H8M0 7H8" stroke="#77837d" stroke-opacity="0.16"/>
        <path d="M2 0V8M6 0V8" stroke="#030606" stroke-opacity="0.42"/>
      </pattern>
      <pattern id="speaker" width="8" height="8" patternUnits="userSpaceOnUse">
        <circle cx="2" cy="2" r="1" fill="#0a100f"/>
        <circle cx="6" cy="6" r="1" fill="#0a100f"/>
      </pattern>
      <filter id="premiumGlow" x="-35%" y="-35%" width="170%" height="170%">
        <feGaussianBlur stdDeviation="2.2" result="blur"/>
        <feMerge>
          <feMergeNode in="blur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
    </defs>
    <rect width="390" height="844" fill="#010303"/>
    <rect x="1" y="1" width="388" height="842" rx="14" fill="#050707" stroke="#33403d" stroke-width="2"/>
    <rect x="5" y="5" width="380" height="834" rx="12" fill="url(#premiumShell)" stroke="#0b0f0f" stroke-width="2"/>
    <rect x="10" y="10" width="370" height="824" rx="10" fill="url(#brushed)" opacity="0.72"/>
    <rect x="10" y="10" width="370" height="824" rx="10" fill="url(#consoleBloom)" opacity="0.92"/>
    <rect x="13" y="14" width="364" height="816" rx="8" fill="none" stroke="#59635f" stroke-opacity="0.24"/>
    <rect x="16" y="44" width="7" height="584" rx="3" fill="url(#sideRail)" opacity="0.88" filter="url(#premiumGlow)"/>
    <rect x="367" y="44" width="6" height="584" rx="3" fill="url(#sideRail)" opacity="0.36"/>
    <rect x="18" y="44" width="4" height="584" fill="url(#scan)" opacity="0.24"/>
    ${Array.from({ length: 18 }, (_, index) => `<rect x="${21 + index * 19}" y="826" width="10" height="4" rx="2" fill="${index % 3 === 0 ? variant.secondary : index % 3 === 1 ? variant.accent : '#293331'}" opacity="${index % 4 === 0 ? 0.9 : 0.42}"/>`).join('')}

    <rect x="17" y="18" width="356" height="22" rx="5" fill="#151a1a" stroke="#38433f"/>
    <rect x="18" y="19" width="354" height="5" rx="2" fill="#ffffff" opacity="0.06"/>
    <rect x="22" y="22" width="27" height="12" rx="6" fill="#090d0c" stroke="#5b6763"/>
    <rect x="25" y="25" width="18" height="6" rx="3" fill="${variant.secondary}" filter="url(#premiumGlow)"/>
    <text x="58" y="32" font-family="Arial Black, Arial, sans-serif" font-size="8" fill="#d4dfda">ROGUELLM</text>
    <text x="151" y="31" font-family="Arial Black, Arial, sans-serif" font-size="7" fill="#94a09c">${variant.label}</text>
    <g transform="translate(322 18)">
      <rect x="0" y="17" width="5" height="3" fill="${variant.accent}"/>
      <rect x="8" y="12" width="5" height="8" fill="${variant.accent}"/>
      <rect x="16" y="7" width="5" height="13" fill="${variant.accent}"/>
      <rect x="24" y="3" width="5" height="17" fill="${variant.accent}"/>
      <rect x="36" y="6" width="18" height="11" rx="2" fill="#24411f" stroke="#6aff48"/>
    </g>
    ${screw(24, 26, variant)}
    ${screw(365, 26, variant)}
    ${screw(25, 817, variant)}
    ${screw(365, 817, variant)}

    ${panels}

    <g opacity="0.72">
      <rect x="21" y="650" width="42" height="164" rx="5" fill="url(#speaker)" stroke="#27322f"/>
      <rect x="327" y="650" width="40" height="164" rx="5" fill="url(#speaker)" stroke="#27322f"/>
      <rect x="167" y="814" width="64" height="11" rx="5" fill="#080b0b" stroke="#2d3936"/>
      <rect x="176" y="818" width="10" height="3" rx="1.5" fill="${variant.secondary}"/>
      <rect x="191" y="818" width="10" height="3" rx="1.5" fill="${variant.secondary}" opacity="0.55"/>
      <rect x="206" y="818" width="10" height="3" rx="1.5" fill="${variant.accent}" opacity="0.65"/>
    </g>
    <rect x="66" y="665" width="74" height="166" rx="10" fill="#151f1e" stroke="${variant.panelStroke}" stroke-width="2"/>
    <rect x="69" y="668" width="68" height="24" rx="8" fill="#ffffff" opacity="0.035"/>
    <rect x="78" y="704" width="50" height="88" rx="7" fill="#08100f" stroke="#3c4b45"/>
    <rect x="86" y="716" width="34" height="56" rx="5" fill="#020504" stroke="#1b2823"/>
    <rect x="196" y="660" width="168" height="78" rx="9" fill="#0b1211" stroke="${variant.panelStroke}" stroke-width="2"/>
    <rect x="200" y="664" width="160" height="70" rx="8" fill="none" stroke="#1c2b25"/>
    <rect x="204" y="668" width="152" height="12" rx="5" fill="#ffffff" opacity="0.035"/>
    <rect x="196" y="740" width="168" height="78" rx="9" fill="#0b1211" stroke="${variant.panelStroke}" stroke-width="2"/>
    <rect x="200" y="744" width="160" height="70" rx="8" fill="none" stroke="#1c2b25"/>
    <rect x="204" y="748" width="152" height="12" rx="5" fill="#ffffff" opacity="0.035"/>
    <text x="27" y="825" font-family="Arial Black, Arial, sans-serif" font-size="7" fill="#8c9995">${variant.footer}</text>
    <text x="330" y="825" font-family="Arial Black, Arial, sans-serif" font-size="7" fill="#8c9995">${variant.version}</text>
  `);
}

function premiumFrame(x, y, w, h, label, variant, mode) {
  const led = mode === 'large' ? variant.secondary : variant.accent;
  const labelOpacity = mode === 'thin' ? 0.34 : 0.84;
  const frameOpacity = mode === 'large' ? 0.32 : 0.22;
  return `
    <g>
      <rect x="${x - 5}" y="${y - 5}" width="${w + 10}" height="${h + 10}" rx="7" fill="#020303" stroke="#101716"/>
      <rect x="${x - 2}" y="${y - 2}" width="${w + 4}" height="${h + 4}" rx="6" fill="#111817" stroke="${variant.shellStroke}" stroke-width="1.4"/>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="url(#glass)" stroke="${variant.accent}" stroke-width="1.4"/>
      <rect x="${x + 1}" y="${y + 1}" width="${w - 2}" height="${h - 2}" rx="4" fill="none" stroke="${variant.accentSoft}" stroke-width="0.8" opacity="${frameOpacity}"/>
      <rect x="${x + 4}" y="${y + 4}" width="${w - 8}" height="${h - 8}" rx="3" fill="url(#scan)" opacity="0.15"/>
      <rect x="${x + 6}" y="${y + 6}" width="${w - 12}" height="${Math.max(8, Math.floor(h * 0.18))}" rx="3" fill="#ffffff" opacity="0.045"/>
      <line x1="${x + 3}" y1="${y + h - 9}" x2="${x + w - 3}" y2="${y + h - 9}" stroke="${variant.accentLine}" stroke-width="1.2"/>
      <text x="${x + 10}" y="${y + 16}" font-family="Arial Black, Arial, sans-serif" font-size="7" fill="${variant.accentSoft}" opacity="${labelOpacity}">${label}</text>
      <circle cx="${x + w - 12}" cy="${y + 12}" r="4" fill="${led}" opacity="0.9" filter="url(#premiumGlow)"/>
    </g>
  `;
}

function frame(x, y, w, h, label, variant) {
  const showLabel = label === 'MAP' || label === 'CONTROL';
  return `
    <g>
      <rect x="${x - 3}" y="${y - 3}" width="${w + 6}" height="${h + 6}" rx="6" fill="#020505" stroke="#192a2a"/>
      <rect x="${x - 1}" y="${y - 1}" width="${w + 2}" height="${h + 2}" rx="5" fill="none" stroke="${variant.accentDim}" stroke-width="2" opacity="0.62"/>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="url(#lcd)" stroke="${variant.accent}" stroke-width="1.4"/>
      <rect x="${x + 3}" y="${y + 3}" width="${w - 6}" height="${h - 6}" rx="3" fill="url(#scan)" opacity="0.24"/>
      <rect x="${x + 5}" y="${y + 5}" width="${w - 10}" height="${h - 10}" rx="3" fill="none" stroke="${variant.accentSoft}" stroke-width="0.7" opacity="0.26"/>
      <rect x="${x + 1}" y="${y + h - 8}" width="${w - 2}" height="1" fill="${variant.accentLine}" opacity="0.9"/>
      ${showLabel ? `<text x="${x + 10}" y="${y + 17}" font-family="Arial Black, Arial, sans-serif" font-size="8" fill="${variant.accentSoft}" opacity="0.72">${label}</text>` : ''}
      <rect x="${x + w - 14}" y="${y + 10}" width="8" height="8" rx="4" fill="${variant.secondary}" opacity="0.72"/>
    </g>
  `;
}

function actionButtonSvg(label, width, height, state, palette) {
  const style = buttonStates[state];
  const alpha = state === 'disabled' ? 0.62 : 1;
  const main = shift(palette.main, style.shade);
  const dark = shift(palette.dark, style.shade);
  const light = shift(palette.light, style.shade);
  const text = state === 'disabled' ? '#5b6768' : palette.text;

  return svg(width, height, `
    <defs>${defs(null, main, dark, light)}</defs>
    <g transform="translate(0 ${style.y})" opacity="${alpha}">
      <rect x="1" y="6" width="${width - 2}" height="${height - 9}" rx="8" fill="#020505" opacity="0.9"/>
      <rect x="3" y="2" width="${width - 6}" height="${height - 9}" rx="8" fill="url(#buttonBody)" stroke="${light}" stroke-width="2"/>
      <rect x="9" y="8" width="${width - 18}" height="16" rx="6" fill="none" stroke="${light}" stroke-width="2" opacity="${style.glow}"/>
      <rect x="9" y="${height - 21}" width="${width - 18}" height="4" rx="2" fill="${dark}" opacity="0.62"/>
      <text x="${width / 2}" y="${height / 2 + 9}" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-size="${width > 180 ? 19 : 22}" fill="${text}" stroke="${dark}" stroke-width="1.2">${label}</text>
    </g>
  `);
}

function premiumActionButtonSvg(label, width, height, state, palette) {
  const style = buttonStates[state];
  const alpha = state === 'disabled' ? 0.72 : 1;
  const main = shift(palette.main, style.shade);
  const dark = shift(palette.dark, style.shade);
  const light = shift(palette.light, style.shade);
  const text = state === 'disabled' ? '#87948f' : palette.text;
  const led = label === 'RUN' ? '#74ff55' : '#ff542f';
  const fontSize = width > 180 ? 20 : 22;

  return svg(width, height, `
    <defs>
      <linearGradient id="premiumButton" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#2f3836"/>
        <stop offset="0.12" stop-color="${light}"/>
        <stop offset="0.22" stop-color="${main}"/>
        <stop offset="0.72" stop-color="${dark}"/>
        <stop offset="1" stop-color="#060707"/>
      </linearGradient>
      <pattern id="buttonScan" width="4" height="4" patternUnits="userSpaceOnUse">
        <path d="M0 1H4" stroke="#ffffff" stroke-opacity="0.08"/>
      </pattern>
      <filter id="buttonGlow" x="-35%" y="-60%" width="170%" height="220%">
        <feGaussianBlur stdDeviation="2.2" result="blur"/>
        <feMerge>
          <feMergeNode in="blur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
    </defs>
    <g transform="translate(0 ${style.y})" opacity="${alpha}">
      <rect x="3" y="9" width="${width - 6}" height="${height - 12}" rx="8" fill="#010202" opacity="0.94"/>
      <rect x="6" y="3" width="${width - 12}" height="${height - 13}" rx="8" fill="#151d1b" stroke="#62706b" stroke-width="2"/>
      <rect x="11" y="9" width="${width - 22}" height="${height - 24}" rx="6" fill="url(#premiumButton)" stroke="${light}" stroke-width="1.4"/>
      <rect x="15" y="13" width="${width - 30}" height="${height - 32}" rx="5" fill="url(#buttonScan)" opacity="${state === 'disabled' ? 0.10 : 0.45}"/>
      <rect x="18" y="15" width="${width - 36}" height="8" rx="4" fill="none" stroke="${light}" stroke-width="1.3" opacity="${style.glow}"/>
      <line x1="22" y1="${height - 20}" x2="${width - 22}" y2="${height - 20}" stroke="${main}" stroke-width="4" opacity="${style.glow * 0.5}"/>
      <circle cx="${width - 12}" cy="10" r="4" fill="${state === 'disabled' ? '#38413f' : led}" stroke="#160302" stroke-width="2" filter="url(#buttonGlow)"/>
      <text x="${width / 2}" y="${height / 2 + 8}" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-size="${fontSize}" letter-spacing="1" fill="${text}" stroke="${dark}" stroke-width="1.2" filter="url(#buttonGlow)">${label}</text>
    </g>
  `);
}

function smallToggleSvg(label, state, variant) {
  const style = buttonStates[state];
  const active = state === 'pressed';
  const stroke = state === 'disabled' ? '#536060' : active ? '#fff1c7' : variant.accentSoft;
  const fill = state === 'disabled' ? '#111819' : active ? shift(variant.accentDim, -28) : '#06130b';
  const text = state === 'disabled' ? '#5c6868' : variant.accentSoft;

  return svg(46, 32, `
    <g transform="translate(0 ${style.y})" opacity="${style.alpha}">
      <rect x="1" y="4" width="44" height="26" rx="5" fill="#020505" opacity="0.8"/>
      <rect x="3" y="1" width="40" height="26" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="2"/>
      <rect x="8" y="6" width="30" height="6" rx="3" fill="none" stroke="${stroke}" opacity="${style.glow}"/>
      <text x="23" y="20" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-size="10" fill="${text}">${label}</text>
    </g>
  `);
}

function premiumToggleSvg(label, state, variant) {
  const style = buttonStates[state];
  const active = state === 'pressed';
  const stroke = state === 'disabled' ? '#46524f' : active ? '#d8ffd0' : variant.accentSoft;
  const fill = state === 'disabled' ? '#111716' : active ? '#145d2a' : '#050908';
  const text = state === 'disabled' ? '#72807b' : variant.accentSoft;

  return svg(46, 32, `
    <defs>
      <filter id="toggleGlow" x="-40%" y="-50%" width="180%" height="200%">
        <feGaussianBlur stdDeviation="1.4" result="blur"/>
        <feMerge>
          <feMergeNode in="blur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
    </defs>
    <g transform="translate(0 ${style.y})" opacity="${style.alpha}">
      <rect x="1" y="5" width="44" height="25" rx="4" fill="#010202" opacity="0.88"/>
      <rect x="3" y="2" width="40" height="24" rx="3" fill="#111716" stroke="#485551" stroke-width="1.2"/>
      <rect x="6" y="5" width="34" height="18" rx="3" fill="${fill}" stroke="${stroke}" stroke-width="1.1"/>
      <line x1="9" y1="20" x2="37" y2="20" stroke="${stroke}" stroke-width="1.2" opacity="${style.glow * 0.7}"/>
      <text x="23" y="18" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-size="8" fill="${text}" filter="url(#toggleGlow)">${label}</text>
    </g>
  `);
}

function dpadButtonSvg(direction, state, variant) {
  const style = buttonStates[state];
  const arrow = arrowPoints(direction);
  const stroke = state === 'disabled' ? '#506061' : variant.accent;
  const fill = state === 'disabled' ? '#111819' : state === 'pressed' ? '#0d231f' : '#14282b';
  const arrowFill = state === 'disabled' ? '#5d6768' : variant.accentSoft;

  return svg(58, 58, `
    <g transform="translate(0 ${style.y})" opacity="${style.alpha}">
      <rect x="2" y="8" width="54" height="46" rx="7" fill="#020505" opacity="0.78"/>
      <rect x="4" y="3" width="50" height="50" rx="7" fill="${fill}" stroke="${variant.panelStroke}" stroke-width="2"/>
      <rect x="8" y="7" width="42" height="12" rx="5" fill="none" stroke="${stroke}" opacity="${style.glow}"/>
      <polygon points="${arrow}" fill="${arrowFill}" opacity="${state === 'disabled' ? 0.42 : 0.92}"/>
    </g>
  `);
}

function premiumDpadButtonSvg(direction, state, variant) {
  const style = buttonStates[state];
  const arrow = arrowPoints(direction);
  const disabled = state === 'disabled';
  const stroke = disabled ? '#4e5c57' : variant.accentSoft;
  const fill = disabled ? '#17201e' : state === 'pressed' ? '#07100e' : '#1f2c29';
  const arrowFill = disabled ? '#74817c' : variant.accentSoft;

  return svg(58, 58, `
    <defs>
      <linearGradient id="dpadFace" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#313b39"/>
        <stop offset="0.55" stop-color="${fill}"/>
        <stop offset="1" stop-color="#050707"/>
      </linearGradient>
      <filter id="dpadGlow" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="1.8" result="blur"/>
        <feMerge>
          <feMergeNode in="blur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
    </defs>
    <g transform="translate(0 ${style.y})" opacity="${disabled ? 0.78 : style.alpha}">
      <rect x="1" y="8" width="56" height="48" rx="8" fill="#010202" opacity="0.9"/>
      <rect x="4" y="3" width="50" height="50" rx="8" fill="url(#dpadFace)" stroke="#66736f" stroke-width="2"/>
      <rect x="7" y="6" width="44" height="44" rx="6" fill="none" stroke="${stroke}" stroke-width="1.4" opacity="${disabled ? 0.44 : 0.74}"/>
      <rect x="10" y="9" width="38" height="13" rx="5" fill="none" stroke="${stroke}" stroke-width="1.2" opacity="${style.glow}"/>
      <polygon points="${arrow}" fill="${arrowFill}" opacity="${disabled ? 0.58 : 0.96}" filter="url(#dpadGlow)"/>
    </g>
  `);
}

function statusSvg(accent, base) {
  return svg(60, 26, `
    <rect x="1" y="4" width="58" height="20" rx="4" fill="#020505" opacity="0.88"/>
    <rect x="2" y="1" width="56" height="21" rx="4" fill="${base}" stroke="${accent}" stroke-width="1.5"/>
    <rect x="7" y="6" width="25" height="4" rx="2" fill="${accent}" opacity="0.58"/>
    <circle cx="49" cy="11.5" r="4" fill="${accent}" opacity="0.86"/>
  `);
}

function premiumStatusSvg(accent, base) {
  return svg(60, 26, `
    <defs>
      <filter id="statusGlow" x="-40%" y="-50%" width="180%" height="200%">
        <feGaussianBlur stdDeviation="1.4" result="blur"/>
        <feMerge>
          <feMergeNode in="blur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
    </defs>
    <rect x="1" y="4" width="58" height="20" rx="4" fill="#010202" opacity="0.9"/>
    <rect x="2" y="1" width="56" height="21" rx="4" fill="#101716" stroke="#46524f" stroke-width="1"/>
    <rect x="6" y="5" width="45" height="13" rx="3" fill="${base}" stroke="${accent}" stroke-width="1"/>
    <rect x="9" y="8" width="24" height="3" rx="1.5" fill="${accent}" opacity="0.58" filter="url(#statusGlow)"/>
    <circle cx="48" cy="11.5" r="4" fill="${accent}" opacity="0.92" filter="url(#statusGlow)"/>
  `);
}

function ledSvg(on, variant) {
  return svg(18, 18, `
    <circle cx="9" cy="9" r="8" fill="#020505" opacity="0.9"/>
    <circle cx="9" cy="9" r="6" fill="${on ? variant.accent : '#13201b'}" stroke="${on ? variant.accentSoft : '#31413c'}"/>
    <circle cx="7" cy="6" r="2" fill="#ffffff" opacity="${on ? 0.72 : 0.16}"/>
  `);
}

function premiumLedSvg(on, variant) {
  return svg(18, 18, `
    <defs>
      <filter id="ledGlow" x="-80%" y="-80%" width="260%" height="260%">
        <feGaussianBlur stdDeviation="2" result="blur"/>
        <feMerge>
          <feMergeNode in="blur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
    </defs>
    <circle cx="9" cy="9" r="8" fill="#010202" stroke="#46524f"/>
    <circle cx="9" cy="9" r="5.5" fill="${on ? variant.accent : '#14211a'}" stroke="${on ? variant.accentSoft : '#33413c'}" filter="${on ? 'url(#ledGlow)' : 'none'}"/>
    <circle cx="7" cy="6" r="1.8" fill="#ffffff" opacity="${on ? 0.78 : 0.16}"/>
  `);
}

function screw(x, y, variant) {
  return `
    <circle cx="${x}" cy="${y}" r="7" fill="#030606" stroke="${variant.panelStroke}"/>
    <circle cx="${x}" cy="${y}" r="3" fill="#172222"/>
    <line x1="${x - 4}" y1="${y}" x2="${x + 4}" y2="${y}" stroke="${variant.textMuted}" opacity="0.5"/>
  `;
}

function arrowPoints(direction) {
  switch (direction) {
    case 'n':
      return '29,13 42,38 16,38';
    case 's':
      return '16,20 42,20 29,45';
    case 'e':
      return '20,16 45,29 20,42';
    case 'w':
      return '38,16 13,29 38,42';
    default:
      return '29,13 42,38 16,38';
  }
}

function svg(width, height, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
}

function defs(variant = variants[0], main = '#5aff4e', dark = '#0a1a10', light = '#cfffaa') {
  const shellTop = variant?.shellTop ?? '#203334';
  const shellMid = variant?.shellMid ?? '#0a1717';
  const noise = variant?.noise ?? '#243232';
  const scan = variant?.accentSoft ?? '#84ff70';
  return `
    <linearGradient id="shell" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${shellTop}"/>
      <stop offset="0.45" stop-color="${shellMid}"/>
      <stop offset="1" stop-color="#020505"/>
    </linearGradient>
    <linearGradient id="lcd" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#082014"/>
      <stop offset="1" stop-color="#020807"/>
    </linearGradient>
    <linearGradient id="buttonBody" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${light}" stop-opacity="0.72"/>
      <stop offset="0.24" stop-color="${main}"/>
      <stop offset="1" stop-color="${dark}"/>
    </linearGradient>
    <pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse">
      <rect width="4" height="1" fill="${scan}"/>
    </pattern>
    <pattern id="fineNoise" width="6" height="6" patternUnits="userSpaceOnUse">
      <path d="M0 0H6M0 3H6" stroke="${noise}" stroke-width="0.5"/>
      <path d="M1 0V6M5 0V6" stroke="#050b0b" stroke-width="0.5"/>
    </pattern>
  `;
}

function shift(hex, amount) {
  const value = hex.replace('#', '');
  const parts = [0, 2, 4].map((index) => {
    const channel = parseInt(value.slice(index, index + 2), 16);
    return Math.max(0, Math.min(255, channel + amount));
  });
  return `#${parts.map((part) => part.toString(16).padStart(2, '0')).join('')}`;
}
