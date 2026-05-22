import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const outDir = path.resolve('src/skins/neo-tokyo-console/fixed/gold-mobile');

const buttonStates = {
  idle: { y: 0, glow: 0.62, shade: 0, alpha: 1 },
  hover: { y: -1, glow: 0.9, shade: 8, alpha: 1 },
  pressed: { y: 2, glow: 0.44, shade: -10, alpha: 1 },
  disabled: { y: 0, glow: 0.12, shade: -48, alpha: 0.62 }
};

fs.mkdirSync(outDir, { recursive: true });

writePng('chassis.png', chassisSvg());

for (const state of Object.keys(buttonStates)) {
  writePng(`attack-${state}.png`, actionButtonSvg('ATTACK', 152, 66, state, {
    main: '#ff4e32',
    dark: '#5a120d',
    light: '#ffb08a',
    text: '#ffd5bd'
  }));
  writePng(`run-${state}.png`, actionButtonSvg('RUN', 152, 66, state, {
    main: '#50e33e',
    dark: '#0f4318',
    light: '#c9ff9d',
    text: '#d8ffd0'
  }));
  writePng(`restart-${state}.png`, actionButtonSvg('RESTART', 226, 66, state, {
    main: '#79f85d',
    dark: '#123f1c',
    light: '#efffc5',
    text: '#f2ffe0'
  }));
  writePng(`log-${state}.png`, smallToggleSvg('LOG', state));
  writePng(`inventory-${state}.png`, smallToggleSvg('BAG', state));
  writePng(`dpad-n-${state}.png`, dpadButtonSvg('n', state));
  writePng(`dpad-s-${state}.png`, dpadButtonSvg('s', state));
  writePng(`dpad-e-${state}.png`, dpadButtonSvg('e', state));
  writePng(`dpad-w-${state}.png`, dpadButtonSvg('w', state));
}

writePng('status-ready.png', statusSvg('#77ff55', '#103a19'));
writePng('status-thinking.png', statusSvg('#ffc64d', '#49350b'));
writePng('status-error.png', statusSvg('#ff5f76', '#4a1018'));
writePng('status-offline.png', statusSvg('#7a8588', '#101617'));
writePng('led-on.png', ledSvg(true));
writePng('led-off.png', ledSvg(false));

function writePng(filename, svg) {
  const output = path.join(outDir, filename);
  execFileSync('magick', ['-background', 'none', 'svg:-', `PNG32:${output}`], { input: svg });
}

function chassisSvg() {
  const panels = [
    frame(18, 44, 354, 289, 'MAP'),
    frame(20, 340, 292, 94, 'LATEST'),
    frame(20, 484, 350, 62, 'PLAYER'),
    frame(20, 558, 350, 72, 'COMBAT'),
    frame(14, 642, 362, 195, 'CONTROL')
  ].join('\n');

  return svg(390, 844, `
    <defs>
      ${defs()}
    </defs>
    <rect width="390" height="844" fill="#010404"/>
    <rect x="3" y="2" width="384" height="840" rx="13" fill="#020505" stroke="#284241" stroke-width="2"/>
    <rect x="6" y="5" width="378" height="834" rx="11" fill="url(#shell)" stroke="#0b1111" stroke-width="2"/>
    <rect x="10" y="10" width="370" height="824" rx="9" fill="#071111" stroke="#1f3130"/>
    <rect x="13" y="13" width="364" height="818" rx="7" fill="url(#fineNoise)" opacity="0.58"/>
    <g opacity="0.24">
      <rect x="15" y="48" width="4" height="580" fill="#1f3a30"/>
      <rect x="371" y="48" width="4" height="580" fill="#0a1714"/>
      <rect x="15" y="640" width="360" height="7" fill="#111d1c"/>
      ${Array.from({ length: 18 }, (_, index) => `<line x1="18" y1="${660 + index * 9}" x2="372" y2="${660 + index * 9}" stroke="#1e3130"/>`).join('')}
    </g>

    <g opacity="0.8">
      <line x1="10" y1="8" x2="380" y2="8" stroke="#263736"/>
      <line x1="10" y1="836" x2="380" y2="836" stroke="#111a1a"/>
      <line x1="8" y1="16" x2="8" y2="828" stroke="#1c2a2a"/>
      <line x1="382" y1="16" x2="382" y2="828" stroke="#0c1212"/>
    </g>

    <rect x="17" y="18" width="356" height="22" rx="6" fill="#101a1b" stroke="#35504e"/>
    <rect x="19" y="20" width="352" height="18" rx="5" fill="#071010" stroke="#122120"/>
    <rect x="23" y="25" width="26" height="8" rx="4" fill="#ff9c21"/>
    <text x="58" y="32" font-family="Arial Black, Arial, sans-serif" font-size="8" fill="#8ea09d">ROGUELLM</text>
    <text x="151" y="31" font-family="Arial Black, Arial, sans-serif" font-size="7" fill="#586865">GOLD MOBILE CYBERDECK</text>
    <g transform="translate(323 20)">
      <rect x="0" y="11" width="5" height="9" fill="#6bff56"/>
      <rect x="8" y="7" width="5" height="13" fill="#6bff56"/>
      <rect x="16" y="3" width="5" height="17" fill="#6bff56"/>
      <rect x="24" y="0" width="5" height="20" fill="#6bff56"/>
    </g>
    ${screw(24, 26)}
    ${screw(365, 26)}
    ${screw(25, 817)}
    ${screw(365, 817)}

    ${panels}

    <rect x="16" y="646" width="358" height="1" fill="#273838"/>
    <rect x="70" y="668" width="65" height="161" rx="8" fill="#101d1f" stroke="#365b60" stroke-width="2"/>
    <rect x="81" y="707" width="43" height="84" rx="6" fill="#081213" stroke="#284248"/>
    <rect x="88" y="721" width="29" height="48" rx="5" fill="#020606" stroke="#51767d"/>
    <rect x="198" y="660" width="166" height="78" rx="10" fill="#0c1716" stroke="#294341" stroke-width="2"/>
    <rect x="202" y="664" width="158" height="70" rx="8" fill="none" stroke="#0f2420"/>
    <rect x="198" y="740" width="166" height="78" rx="10" fill="#0c1716" stroke="#294341" stroke-width="2"/>
    <rect x="202" y="744" width="158" height="70" rx="8" fill="none" stroke="#0f2420"/>
    <g opacity="0.58">
      <line x1="206" y1="733" x2="356" y2="733" stroke="#263634"/>
      <line x1="206" y1="813" x2="356" y2="813" stroke="#263634"/>
      <line x1="20" y1="690" x2="188" y2="690" stroke="#12201f"/>
      <line x1="20" y1="810" x2="188" y2="810" stroke="#12201f"/>
    </g>
    <text x="27" y="825" font-family="Arial Black, Arial, sans-serif" font-size="7" fill="#61706e">MOBILE PROFILE</text>
    <text x="330" y="825" font-family="Arial Black, Arial, sans-serif" font-size="7" fill="#61706e">v0.3</text>
  `);
}

function frame(x, y, w, h, label) {
  const showLabel = label === 'MAP' || label === 'CONTROL';
  return `
    <g>
      <rect x="${x - 3}" y="${y - 3}" width="${w + 6}" height="${h + 6}" rx="6" fill="#020505" stroke="#192a2a"/>
      <rect x="${x - 1}" y="${y - 1}" width="${w + 2}" height="${h + 2}" rx="5" fill="none" stroke="#1e6a42" stroke-width="2" opacity="0.62"/>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="url(#lcd)" stroke="#79ff69" stroke-width="1.4"/>
      <rect x="${x + 3}" y="${y + 3}" width="${w - 6}" height="${h - 6}" rx="3" fill="url(#scan)" opacity="0.24"/>
      <rect x="${x + 5}" y="${y + 5}" width="${w - 10}" height="${h - 10}" rx="3" fill="none" stroke="#b8ffc2" stroke-width="0.7" opacity="0.26"/>
      <rect x="${x + 1}" y="${y + h - 8}" width="${w - 2}" height="1" fill="#143f2e" opacity="0.9"/>
      ${showLabel ? `<text x="${x + 10}" y="${y + 17}" font-family="Arial Black, Arial, sans-serif" font-size="8" fill="#8aff75" opacity="0.72">${label}</text>` : ''}
      <rect x="${x + w - 14}" y="${y + 10}" width="8" height="8" rx="4" fill="#ff9b25" opacity="0.72"/>
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
    <defs>${defs(main, dark, light)}</defs>
    <g transform="translate(0 ${style.y})" opacity="${alpha}">
      <rect x="1" y="6" width="${width - 2}" height="${height - 9}" rx="8" fill="#020505" opacity="0.9"/>
      <rect x="3" y="2" width="${width - 6}" height="${height - 9}" rx="8" fill="url(#buttonBody)" stroke="${light}" stroke-width="2"/>
      <rect x="9" y="8" width="${width - 18}" height="16" rx="6" fill="none" stroke="${light}" stroke-width="2" opacity="${style.glow}"/>
      <rect x="9" y="${height - 21}" width="${width - 18}" height="4" rx="2" fill="${dark}" opacity="0.62"/>
      <text x="${width / 2}" y="${height / 2 + 9}" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-size="${width > 180 ? 19 : 22}" fill="${text}" stroke="${dark}" stroke-width="1.2">${label}</text>
    </g>
  `);
}

function smallToggleSvg(label, state) {
  const style = buttonStates[state];
  const active = state === 'pressed';
  const stroke = state === 'disabled' ? '#536060' : active ? '#d7ffc9' : '#8aff75';
  const fill = state === 'disabled' ? '#111819' : active ? '#155a1e' : '#06130b';
  const text = state === 'disabled' ? '#5c6868' : '#ccffc2';

  return svg(46, 32, `
    <g transform="translate(0 ${style.y})" opacity="${style.alpha}">
      <rect x="1" y="4" width="44" height="26" rx="5" fill="#020505" opacity="0.8"/>
      <rect x="3" y="1" width="40" height="26" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="2"/>
      <rect x="8" y="6" width="30" height="6" rx="3" fill="none" stroke="${stroke}" opacity="${style.glow}"/>
      <text x="23" y="20" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-size="10" fill="${text}">${label}</text>
    </g>
  `);
}

function dpadButtonSvg(direction, state) {
  const style = buttonStates[state];
  const arrow = arrowPoints(direction);
  const stroke = state === 'disabled' ? '#506061' : '#7dff75';
  const fill = state === 'disabled' ? '#111819' : state === 'pressed' ? '#0d231f' : '#14282b';
  const arrowFill = state === 'disabled' ? '#5d6768' : '#a6ff8d';

  return svg(58, 58, `
    <g transform="translate(0 ${style.y})" opacity="${style.alpha}">
      <rect x="2" y="8" width="54" height="46" rx="7" fill="#020505" opacity="0.78"/>
      <rect x="4" y="3" width="50" height="50" rx="7" fill="${fill}" stroke="#35545a" stroke-width="2"/>
      <rect x="8" y="7" width="42" height="12" rx="5" fill="none" stroke="${stroke}" opacity="${style.glow}"/>
      <polygon points="${arrow}" fill="${arrowFill}" opacity="${state === 'disabled' ? 0.42 : 0.92}"/>
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

function ledSvg(on) {
  return svg(18, 18, `
    <circle cx="9" cy="9" r="8" fill="#020505" opacity="0.9"/>
    <circle cx="9" cy="9" r="6" fill="${on ? '#71ff55' : '#13201b'}" stroke="${on ? '#d4ffc0' : '#31413c'}"/>
    <circle cx="7" cy="6" r="2" fill="#ffffff" opacity="${on ? 0.72 : 0.16}"/>
  `);
}

function screw(x, y) {
  return `
    <circle cx="${x}" cy="${y}" r="7" fill="#030606" stroke="#314244"/>
    <circle cx="${x}" cy="${y}" r="3" fill="#172222"/>
    <line x1="${x - 4}" y1="${y}" x2="${x + 4}" y2="${y}" stroke="#5d6d6e" opacity="0.5"/>
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

function defs(main = '#5aff4e', dark = '#0a1a10', light = '#cfffaa') {
  return `
    <linearGradient id="shell" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#203334"/>
      <stop offset="0.45" stop-color="#0a1717"/>
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
      <rect width="4" height="1" fill="#84ff70"/>
    </pattern>
    <pattern id="fineNoise" width="6" height="6" patternUnits="userSpaceOnUse">
      <path d="M0 0H6M0 3H6" stroke="#243232" stroke-width="0.5"/>
      <path d="M1 0V6M5 0V6" stroke="#050b0b" stroke-width="0.5"/>
    </pattern>
  `;
}

function shift(hex, amount) {
  const value = hex.replace('#', '');
  const parts = [0, 2, 4].map((index) => Math.max(0, Math.min(255, parseInt(value.slice(index, index + 2), 16) + amount)));
  return `#${parts.map((part) => part.toString(16).padStart(2, '0')).join('')}`;
}
