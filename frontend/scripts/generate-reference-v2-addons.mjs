import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const outDir = path.resolve('src/skins/neo-tokyo-console/fixed/reference-mobile-v2');

const states = {
  idle: { y: 0, glow: 0.78, shade: 0, alpha: 1 },
  hover: { y: -1, glow: 1, shade: 12, alpha: 1 },
  pressed: { y: 2, glow: 0.52, shade: -18, alpha: 1 },
  disabled: { y: 0, glow: 0.14, shade: -60, alpha: 0.62 }
};
const coreStateNames = ['idle', 'hover', 'pressed', 'disabled'];
const toggleStateNames = coreStateNames;

fs.mkdirSync(outDir, { recursive: true });

for (const state of toggleStateNames) {
  writePng(`inventory-${state}.png`, toggleSvg('BAG', state));
}
for (const state of coreStateNames) {
  writePng(`restart-${state}.png`, restartSvg(state));
}

function writePng(filename, svgSource) {
  const output = path.join(outDir, filename);
  execFileSync('magick', ['-background', 'none', 'svg:-', '-strip', `PNG32:${output}`], { input: svgSource });
}

function toggleSvg(label, state) {
  const style = states[state];
  const isDisabled = state === 'disabled';
  const isActive = state === 'active';
  const accent = isDisabled ? '#4e5957' : shift('#8dff6f', style.shade);
  const glow = isDisabled ? '#1d2624' : shift('#2bee3a', style.shade);
  const text = isDisabled ? '#59625f' : isActive ? '#f4ffe8' : '#dfffd2';

  return svg(43, 31, `
    <defs>
      <linearGradient id="body" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stop-color="#17201f"/>
        <stop offset="0.45" stop-color="#060a09"/>
        <stop offset="1" stop-color="#020404"/>
      </linearGradient>
      <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="1.2" result="blur"/>
        <feMerge>
          <feMergeNode in="blur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
    </defs>
    <g transform="translate(0 ${style.y})" opacity="${style.alpha}">
      <rect x="1" y="6" width="41" height="21" rx="3" fill="#010302" opacity="0.88"/>
      <rect x="3" y="3" width="37" height="21" rx="3" fill="url(#body)" stroke="${accent}" stroke-width="1"/>
      <rect x="6" y="6" width="31" height="4" rx="2" fill="${glow}" opacity="${style.glow * 0.36}"/>
      <line x1="7" y1="22" x2="36" y2="22" stroke="${glow}" stroke-width="1" opacity="${style.glow * 0.5}"/>
      ${isActive ? `<circle cx="35" cy="8" r="3" fill="#ffbf55" stroke="#06100a" stroke-width="1"/>` : ''}
      <text x="21.5" y="18" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-size="8" fill="${text}" filter="url(#glow)">${label}</text>
    </g>
  `);
}

function restartSvg(state) {
  const style = states[state];
  const isDisabled = state === 'disabled';
  const main = isDisabled ? '#1a1e1d' : shift('#a73424', style.shade);
  const dark = isDisabled ? '#090b0a' : shift('#260a08', style.shade);
  const light = isDisabled ? '#46524f' : shift('#ff8a67', style.shade);
  const text = isDisabled ? '#68736f' : '#ffe4c8';

  return svg(226, 66, `
    <defs>
      <linearGradient id="plate" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stop-color="${light}"/>
        <stop offset="0.13" stop-color="${main}"/>
        <stop offset="0.58" stop-color="${dark}"/>
        <stop offset="1" stop-color="#050706"/>
      </linearGradient>
      <pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse">
        <path d="M 0 0 H 4" stroke="#ffffff" stroke-opacity="0.08"/>
      </pattern>
      <filter id="softGlow" x="-40%" y="-60%" width="180%" height="220%">
        <feGaussianBlur stdDeviation="2.4" result="blur"/>
        <feMerge>
          <feMergeNode in="blur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
    </defs>
    <g transform="translate(0 ${style.y})" opacity="${style.alpha}">
      <rect x="4" y="9" width="218" height="50" rx="7" fill="#020303" opacity="0.92"/>
      <rect x="7" y="4" width="212" height="50" rx="7" fill="#101817" stroke="#53635e" stroke-width="2"/>
      <rect x="13" y="10" width="200" height="38" rx="5" fill="url(#plate)" stroke="${light}" stroke-width="1.5"/>
      <rect x="17" y="13" width="192" height="32" rx="4" fill="url(#scan)" opacity="${isDisabled ? 0.12 : 0.42}"/>
      <line x1="22" y1="40" x2="204" y2="40" stroke="${light}" stroke-width="3" opacity="${style.glow * 0.44}"/>
      <circle cx="210" cy="9" r="4" fill="${isDisabled ? '#38413f' : '#ff5a33'}" stroke="#160302" stroke-width="2" filter="url(#softGlow)"/>
      <text x="113" y="36" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-size="20" letter-spacing="1" fill="${text}" stroke="${dark}" stroke-width="1.1" filter="url(#softGlow)">RESTART</text>
    </g>
  `);
}

function svg(width, height, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
}

function shift(hex, amount) {
  const numeric = Number.parseInt(hex.slice(1), 16);
  const channels = [
    (numeric >> 16) & 255,
    (numeric >> 8) & 255,
    numeric & 255
  ].map((channel) => Math.max(0, Math.min(255, channel + amount)));

  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}
