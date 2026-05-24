import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildStateSheetLayout } from './skin-state-sheet-layout.mjs';

const rootDir = path.resolve(new URL('..', import.meta.url).pathname);
const contractPath = path.join(rootDir, 'src/skins/SKIN_LAYOUT_CONTRACT_V1.json');
const contract = JSON.parse(await fs.readFile(contractPath, 'utf8'));
const parsedArgs = parseArgs(process.argv.slice(2));
const skinId = parsedArgs.positionals[0];
const profileName = parsedArgs.positionals[1] ?? 'mobileCompact';
const profile = contract.profiles?.[profileName];

if (parsedArgs.options.help || !skinId) {
  printUsage();
  process.exit(parsedArgs.options.help ? 0 : 1);
}

if (!profile) {
  console.error(`Unknown profile "${profileName}". Expected one of: ${Object.keys(contract.profiles ?? {}).join(', ')}`);
  process.exit(1);
}

const outDir = path.resolve(rootDir, parsedArgs.options.out ?? `../_artifacts/skin-kits/${skinId}`);
const theme = themeFor(parsedArgs.options.theme ?? 'obsidian-rain');

await fs.mkdir(outDir, { recursive: true });
await writePng(path.join(outDir, 'source-chassis.png'), chassisSvg(profile, theme, { widgets: false }));
await writePng(path.join(outDir, 'source-widgets.png'), chassisSvg(profile, theme, { widgets: true }));
await writePng(path.join(outDir, 'source-state-sheet.png'), stateSheetSvg(profile, theme));
await writePng(path.join(outDir, 'source-materials.png'), materialSheetSvg(theme));
await fs.writeFile(path.join(outDir, 'SOURCE_NOTES.md'), sourceNotes(skinId, profileName, theme), 'utf8');

console.error(`Wrote source prototype artboards to ${path.relative(process.cwd(), outDir)}`);

function chassisSvg(selectedProfile, theme, options) {
  const { width, height } = selectedProfile.size;
  const compact = height <= 700;
  const hasBottomConsoleRoom = selectedProfile.regions.controls.y + selectedProfile.regions.controls.height <= height - 62;
  const panels = [
    frame(selectedProfile.regions.map, 'MAP', theme, 'map'),
    frame(selectedProfile.regions.latest, 'MSG', theme, 'latest'),
    frame(selectedProfile.regions.player, 'VITALS', theme, 'thin'),
    frame(selectedProfile.regions.combat, 'MODE', theme, 'thin'),
    frame(selectedProfile.regions.controls, 'CONTROL', theme, 'controls')
  ].join('\n');

  const widgets = options.widgets ? widgetLayer(selectedProfile, theme) : '';
  const rails = Array.from({ length: compact ? 9 : 12 }, (_, index) => {
    const y = 68 + index * (compact ? 49 : 60);
    const color = index % 3 === 1 ? theme.warning : index % 2 === 0 ? theme.accent : theme.combat;
    return `
      <rect x="16" y="${y}" width="5" height="${Math.min(22, height - y - 12)}" rx="2.5" fill="${color}" opacity="${0.45 + (index % 3) * 0.12}"/>
      <rect x="${width - 22}" y="${y + 4}" width="5" height="${Math.min(16, height - y - 12)}" rx="2.5" fill="${color}" opacity="${0.24 + (index % 3) * 0.08}"/>
    `;
  }).join('\n');

  return svg(width, height, `
    <defs>${defs(theme)}</defs>
    <rect width="${width}" height="${height}" fill="#010204"/>
    <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="16" fill="#030508" stroke="${theme.outerStroke}" stroke-width="2"/>
    <rect x="5" y="5" width="${width - 10}" height="${height - 10}" rx="13" fill="url(#shell)" stroke="#090c10" stroke-width="2"/>
    <rect x="10" y="10" width="${width - 20}" height="${height - 20}" rx="10" fill="url(#brushed)" opacity="0.84"/>
    <rect x="10" y="10" width="${width - 20}" height="${height - 20}" rx="10" fill="url(#caseBloom)" opacity="0.95"/>
    ${surfaceTexture(width, height, theme)}
    <rect x="14" y="14" width="${width - 28}" height="${height - 28}" rx="8" fill="none" stroke="#bceeff" stroke-opacity="0.12"/>
    ${topGrooves(width, theme)}
    <rect x="18" y="18" width="${width - 36}" height="22" rx="6" fill="#10161b" stroke="${theme.panelStroke}" stroke-width="1.2"/>
    <rect x="20" y="20" width="${width - 40}" height="5" rx="2.5" fill="#ffffff" opacity="0.055"/>
    <rect x="24" y="24" width="28" height="10" rx="5" fill="#07090d" stroke="${theme.panelStroke}"/>
    <rect x="27" y="27" width="20" height="4" rx="2" fill="${theme.combat}" filter="url(#softGlow)"/>
    <text x="61" y="32" font-family="Arial Black, Arial, sans-serif" font-size="8" fill="${theme.textDim}">ROGUELLM</text>
    <text x="${Math.floor(width * 0.4)}" y="31" font-family="Arial Black, Arial, sans-serif" font-size="7" fill="${theme.textFaint}">${theme.headerLabel}</text>
    <g transform="translate(${width - 70} 18)">
      <rect x="0" y="17" width="4" height="3" fill="${theme.accent}"/>
      <rect x="8" y="13" width="4" height="7" fill="${theme.accent}"/>
      <rect x="16" y="8" width="4" height="12" fill="${theme.accent}"/>
      <rect x="24" y="4" width="4" height="16" fill="${theme.accent}"/>
      <rect x="36" y="6" width="18" height="11" rx="2" fill="${theme.accentDark}" stroke="${theme.accent}"/>
    </g>
    ${screw(24, 26, theme)}
    ${screw(width - 25, 26, theme)}
    ${screw(25, height - 26, theme)}
    ${screw(width - 25, height - 26, theme)}
    <rect x="15" y="45" width="7" height="${height - 172}" rx="3.5" fill="url(#sideRail)" filter="url(#softGlow)" opacity="0.82"/>
    <rect x="${width - 23}" y="45" width="6" height="${height - 172}" rx="3" fill="url(#sideRail)" opacity="0.38"/>
    ${rails}
    ${panels}
    ${controlsWell(selectedProfile, theme)}
    ${widgets}
    ${hasBottomConsoleRoom ? bottomConsole(width, height, theme) : ''}
    ${hasBottomConsoleRoom ? `<rect x="18" y="${height - 30}" width="${width - 36}" height="17" rx="7" fill="#030609" stroke="#1c2730"/>` : ''}
    ${hasBottomConsoleRoom ? `<g opacity="0.85">
      ${Array.from({ length: 9 }, (_, index) => `<rect x="${width / 2 - 40 + index * 10}" y="${height - 24}" width="6" height="5" rx="2" fill="${index % 3 === 0 ? theme.combat : index % 2 === 0 ? theme.accent : theme.warning}" opacity="${0.25 + index * 0.055}"/>`).join('')}
    </g>` : ''}
  `);
}

function surfaceTexture(width, height, theme) {
  const horizontal = Array.from({ length: Math.floor(height / 12) }, (_, index) => {
    const y = 44 + index * 12;
    if (y > height - 42) {
      return '';
    }
    const alpha = index % 5 === 0 ? 0.12 : 0.045;
    return `<path d="M18 ${y}H${width - 18}" stroke="#ffffff" stroke-opacity="${alpha}" stroke-width="${index % 5 === 0 ? 0.8 : 0.5}"/>`;
  }).join('\n');
  const chips = Array.from({ length: 18 }, (_, index) => {
    const x = 32 + ((index * 47) % Math.max(1, width - 72));
    const y = 58 + ((index * 83) % Math.max(1, height - 142));
    const color = index % 4 === 0 ? theme.combat : index % 3 === 0 ? theme.warning : theme.accent;
    return `<rect x="${x}" y="${y}" width="${index % 2 === 0 ? 10 : 6}" height="2" rx="1" fill="${color}" opacity="${0.08 + (index % 3) * 0.035}"/>`;
  }).join('\n');

  return `
    <g opacity="0.95">
      ${horizontal}
      ${chips}
    </g>
  `;
}

function topGrooves(width, theme) {
  return `
    <g opacity="0.92">
      <path d="M20 43H${width - 20}" stroke="#010204" stroke-width="2"/>
      <path d="M22 44H${width - 22}" stroke="${theme.accent}" stroke-opacity="0.2"/>
      <path d="M22 49H${width - 22}" stroke="#ffffff" stroke-opacity="0.07"/>
      <path d="M${width - 128} 17L${width - 112} 8H${width - 38}L${width - 50} 39H${width - 148}Z" fill="#05090d" stroke="${theme.panelStroke}" stroke-opacity="0.8"/>
      <path d="M${width - 121} 20H${width - 60}" stroke="${theme.accent}" stroke-opacity="0.24"/>
    </g>
  `;
}

function bottomConsole(width, height, theme) {
  const y = height - 55;
  const segments = [
    { x: 22, width: 82, label: 'CYBERDECK' },
    { x: 110, width: 72, label: 'SCAN' },
    { x: width - 182, width: 72, label: 'SYNC' },
    { x: width - 104, width: 82, label: 'PWR' }
  ];
  const moduleMarkup = segments.map((segment, index) => `
    <rect x="${segment.x}" y="${y}" width="${segment.width}" height="24" rx="4" fill="#05070a" stroke="${theme.panelStroke}" stroke-opacity="0.45"/>
    <text x="${segment.x + 9}" y="${y + 16}" font-family="Arial Black, Arial, sans-serif" font-size="7" fill="${index === 3 ? theme.warning : theme.textFaint}">${segment.label}</text>
  `).join('\n');
  const bars = Array.from({ length: 9 }, (_, index) => `
    <rect x="${width / 2 - 42 + index * 10}" y="${y + 9}" width="6" height="${4 + (index % 3) * 3}" rx="2" fill="${index % 3 === 0 ? theme.combat : index % 2 === 0 ? theme.accent : theme.warning}" opacity="${0.34 + index * 0.035}"/>
  `).join('\n');

  return `
    <g opacity="0.94">
      ${moduleMarkup}
      <rect x="${width / 2 - 48}" y="${y}" width="96" height="24" rx="4" fill="#05070a" stroke="${theme.panelStroke}" stroke-opacity="0.45"/>
      ${bars}
    </g>
  `;
}

function widgetLayer(selectedProfile, theme) {
  const buttonMarkup = Object.entries(selectedProfile.layout.buttons)
    .map(([buttonId, rect]) => button(rect, buttonId, theme))
    .join('\n');
  const status = selectedProfile.layout.indicators.status;
  const led = selectedProfile.layout.indicators.combatLed;

  return `
    <g id="fixed-widget-crops">
      ${buttonMarkup}
      ${statusIndicator(status, theme)}
      ${combatLed(led, theme)}
    </g>
  `;
}

function controlsWell(selectedProfile, theme) {
  const controls = selectedProfile.regions.controls;
  const buttons = selectedProfile.layout.buttons;
  const moveRects = [buttons.moveN, buttons.moveS, buttons.moveE, buttons.moveW];
  const dpad = unionRects(moveRects);
  const action = unionRects([buttons.attack, buttons.run]);

  return `
    <g opacity="0.92">
      <rect x="${controls.x + 6}" y="${controls.y + 6}" width="${controls.width - 12}" height="${controls.height - 12}" rx="12" fill="#03070b" stroke="${theme.panelStroke}" stroke-opacity="0.52"/>
      ${dpad ? `<rect x="${dpad.x - 15}" y="${dpad.y - 15}" width="${dpad.width + 30}" height="${dpad.height + 30}" rx="13" fill="#050b0f" stroke="${theme.accent}" stroke-opacity="0.32"/>
      <path d="M${dpad.x + dpad.width / 2} ${dpad.y - 7}V${dpad.y + dpad.height + 7}M${dpad.x - 7} ${dpad.y + dpad.height / 2}H${dpad.x + dpad.width + 7}" stroke="${theme.accent}" stroke-opacity="0.18" stroke-width="2"/>
      <rect x="${dpad.x + dpad.width / 2 - 18}" y="${dpad.y + dpad.height / 2 - 18}" width="36" height="36" rx="6" fill="url(#knurl)" stroke="${theme.panelStroke}"/>` : ''}
      ${action ? `<rect x="${action.x - 11}" y="${action.y - 9}" width="${action.width + 22}" height="${action.height + 18}" rx="12" fill="#05070b" stroke="${theme.combat}" stroke-opacity="0.36"/>
      <line x1="${action.x - 4}" y1="${action.y + action.height / 2}" x2="${action.x + action.width + 4}" y2="${action.y + action.height / 2}" stroke="${theme.panelStroke}" stroke-opacity="0.38"/>` : ''}
    </g>
  `;
}

function frame(rect, label, theme, mode) {
  const isThin = mode === 'thin';
  const labelMarkup = isThin ? '' : `<text x="${rect.x + 9}" y="${rect.y + 15}" font-family="Arial Black, Arial, sans-serif" font-size="7" fill="${theme.accentSoft}" opacity="0.8">${label}</text>`;
  const notch = mode === 'map' || mode === 'controls'
    ? `<path d="M${rect.x + 12} ${rect.y - 2}H${rect.x + 54}M${rect.x + rect.width - 54} ${rect.y + rect.height + 2}H${rect.x + rect.width - 12}" stroke="${theme.warning}" stroke-opacity="0.58" stroke-width="1.2"/>`
    : '';

  return `
    <g>
      <rect x="${rect.x - 5}" y="${rect.y - 5}" width="${rect.width + 10}" height="${rect.height + 10}" rx="8" fill="#010305" stroke="#10161a"/>
      <rect x="${rect.x - 2}" y="${rect.y - 2}" width="${rect.width + 4}" height="${rect.height + 4}" rx="7" fill="#101820" stroke="${theme.panelStroke}" stroke-width="1.2"/>
      <rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" rx="4" fill="url(#glass)" stroke="${theme.accent}" stroke-width="1.2"/>
      <rect x="${rect.x + 2}" y="${rect.y + 2}" width="${rect.width - 4}" height="${rect.height - 4}" rx="4" fill="none" stroke="#ffffff" stroke-opacity="0.06"/>
      <rect x="${rect.x + 7}" y="${rect.y + 7}" width="${rect.width - 14}" height="${rect.height - 14}" rx="3" fill="none" stroke="${theme.panelStroke}" stroke-opacity="0.25"/>
      <rect x="${rect.x + 3}" y="${rect.y + 3}" width="${rect.width - 6}" height="${rect.height - 6}" rx="3" fill="url(#scan)" opacity="${mode === 'map' ? 0.11 : 0.2}"/>
      <rect x="${rect.x + 5}" y="${rect.y + 5}" width="${rect.width - 10}" height="${Math.max(6, Math.floor(rect.height * 0.16))}" rx="3" fill="#ffffff" opacity="0.045"/>
      <rect x="${rect.x + 4}" y="${rect.y + rect.height - 8}" width="${rect.width - 8}" height="1" fill="${theme.accentLine}" opacity="0.58"/>
      ${labelMarkup}
      ${notch}
      <circle cx="${rect.x + rect.width - 12}" cy="${rect.y + 12}" r="3.5" fill="${mode === 'map' ? theme.warning : theme.accent}" opacity="0.62" filter="url(#softGlow)"/>
      <circle cx="${rect.x + 10}" cy="${rect.y + 10}" r="2" fill="#010204" stroke="${theme.panelStroke}" stroke-opacity="0.65"/>
      <circle cx="${rect.x + rect.width - 10}" cy="${rect.y + rect.height - 10}" r="2" fill="#010204" stroke="${theme.panelStroke}" stroke-opacity="0.48"/>
    </g>
  `;
}

function button(rect, buttonId, theme) {
  const move = buttonId.startsWith('move');
  const attack = buttonId === 'attack';
  const run = buttonId === 'run';
  const toggle = buttonId === 'log' || buttonId === 'inventory';
  const accent = attack ? theme.combat : run ? theme.accent : move ? theme.accentSoft : theme.warning;
  const fill = attack ? 'url(#redButton)' : run ? 'url(#greenButton)' : move ? 'url(#moveButton)' : 'url(#toggleButton)';
  const radius = toggle ? 6 : move ? 10 : 12;

  return `
    <g>
      <rect x="${rect.x}" y="${rect.y + 4}" width="${rect.width}" height="${rect.height - 4}" rx="${radius}" fill="#010204" opacity="0.9"/>
      <rect x="${rect.x + 2}" y="${rect.y + 1}" width="${rect.width - 4}" height="${rect.height - 7}" rx="${radius}" fill="${fill}" stroke="${accent}" stroke-width="1.4"/>
      <rect x="${rect.x + 8}" y="${rect.y + 8}" width="${rect.width - 16}" height="${Math.max(5, Math.floor(rect.height * 0.18))}" rx="4" fill="#ffffff" opacity="0.08"/>
      <rect x="${rect.x + 9}" y="${rect.y + 14}" width="${rect.width - 18}" height="${Math.max(5, Math.floor(rect.height * 0.5))}" rx="${Math.max(3, radius - 4)}" fill="url(#buttonGrain)" opacity="${attack || run ? 0.38 : 0.22}"/>
      <rect x="${rect.x + 8}" y="${rect.y + rect.height - 16}" width="${rect.width - 16}" height="3" rx="1.5" fill="#010204" opacity="0.5"/>
      <rect x="${rect.x + 5}" y="${rect.y + 5}" width="${rect.width - 10}" height="${rect.height - 14}" rx="${Math.max(3, radius - 3)}" fill="none" stroke="${accent}" stroke-opacity="0.42"/>
      ${(attack || run) ? `<path d="M${rect.x + 16} ${rect.y + rect.height - 15}H${rect.x + rect.width - 18}" stroke="${accent}" stroke-opacity="0.5" stroke-width="1.2"/>` : ''}
      ${move ? directionGlyph(rect, buttonId, accent) : ''}
      ${toggle ? `<line x1="${rect.x + 9}" y1="${rect.y + rect.height - 8}" x2="${rect.x + rect.width - 9}" y2="${rect.y + rect.height - 8}" stroke="${accent}" stroke-opacity="0.7"/>` : ''}
      ${(attack || run) ? `<circle cx="${rect.x + rect.width - 10}" cy="${rect.y + 8}" r="4" fill="${accent}" filter="url(#softGlow)"/>` : ''}
    </g>
  `;
}

function directionGlyph(rect, buttonId, color) {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const size = 14;
  const points = {
    moveN: `${cx},${cy - size} ${cx - size},${cy + size * 0.7} ${cx + size},${cy + size * 0.7}`,
    moveS: `${cx},${cy + size} ${cx - size},${cy - size * 0.7} ${cx + size},${cy - size * 0.7}`,
    moveE: `${cx + size},${cy} ${cx - size * 0.7},${cy - size} ${cx - size * 0.7},${cy + size}`,
    moveW: `${cx - size},${cy} ${cx + size * 0.7},${cy - size} ${cx + size * 0.7},${cy + size}`
  }[buttonId];
  return `<polygon points="${points}" fill="${color}" opacity="0.72"/>`;
}

function statusIndicator(rect, theme) {
  return `
    <g>
      <rect x="${rect.x}" y="${rect.y + 2}" width="${rect.width}" height="${rect.height - 2}" rx="7" fill="#010204"/>
      <rect x="${rect.x + 2}" y="${rect.y}" width="${rect.width - 4}" height="${rect.height - 5}" rx="7" fill="url(#statusReady)" stroke="${theme.accent}" stroke-width="1.2"/>
      <rect x="${rect.x + 8}" y="${rect.y + 6}" width="${rect.width - 16}" height="3" rx="1.5" fill="#ffffff" opacity="0.1"/>
      <circle cx="${rect.x + rect.width - 9}" cy="${rect.y + 8}" r="3" fill="${theme.accent}" filter="url(#softGlow)"/>
    </g>
  `;
}

function combatLed(rect, theme) {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  return `
    <g>
      <circle cx="${cx}" cy="${cy}" r="${Math.min(rect.width, rect.height) / 2}" fill="#010204"/>
      <circle cx="${cx}" cy="${cy}" r="${Math.min(rect.width, rect.height) / 2 - 2}" fill="#15191c" stroke="${theme.combat}" stroke-opacity="0.52"/>
      <circle cx="${cx - 2}" cy="${cy - 2}" r="2" fill="#ffffff" opacity="0.08"/>
    </g>
  `;
}

function stateSheetSvg(selectedProfile, theme) {
  const layout = buildStateSheetLayout(selectedProfile);
  return svg(layout.size.width, layout.size.height, `
    <defs>${defs(theme)}</defs>
    <rect width="${layout.size.width}" height="${layout.size.height}" fill="#020406"/>
    <rect x="0" y="0" width="${layout.size.width}" height="36" fill="#11181d"/>
    <text x="14" y="23" font-family="Arial Black, Arial, sans-serif" font-size="12" fill="${theme.accentSoft}">ROGUELLM SOURCE STATE SHEET</text>
    <text x="${layout.size.width - 14}" y="23" text-anchor="end" font-family="Arial, sans-serif" font-size="9" fill="${theme.textDim}">${layout.source} ${layout.size.width}x${layout.size.height}</text>
    ${layout.sections.map((section) => stateSheetSection(section, theme)).join('\n')}
  `);
}

function stateSheetSection(section, theme) {
  const labels = Array.from({ length: Math.max(...section.rows.map((row) => row.states.length)) }, (_, index) => {
    const state = section.rows.find((row) => row.states[index])?.states[index] ?? '';
    const x = 16 + section.labelWidth + index * (section.columnWidth + 10) + section.columnWidth / 2;
    return `<text x="${x}" y="${section.y + 35}" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-size="8" fill="${theme.textFaint}">${state.toUpperCase()}</text>`;
  }).join('\n');

  return `
    <g>
      <rect x="16" y="${section.y}" width="${section.width - 32}" height="20" rx="5" fill="#071016" stroke="${theme.panelStroke}" stroke-opacity="0.6"/>
      <text x="26" y="${section.y + 14}" font-family="Arial Black, Arial, sans-serif" font-size="9" fill="${theme.accentSoft}">${section.title.toUpperCase()}</text>
      ${labels}
      ${section.rows.map((row) => stateSheetRow(section, row, theme)).join('\n')}
    </g>
  `;
}

function stateSheetRow(section, row, theme) {
  const labelY = row.y + section.rowHeight / 2 + 4;
  return `
    <g>
      <text x="26" y="${labelY}" font-family="Arial Black, Arial, sans-serif" font-size="8" fill="${theme.textDim}">${row.label.toUpperCase()}</text>
      ${row.states.map((state) => stateSheetWidget(row, state, theme)).join('\n')}
    </g>
  `;
}

function stateSheetWidget(row, state, theme) {
  const rect = row.slots[state];
  if (row.id === 'status') {
    return stateSheetStatus(rect, state, theme);
  }
  if (row.id === 'combatLed') {
    return stateSheetLed(rect, state, theme);
  }

  const stateTheme = themeForButtonState(theme, row.id, state);
  const base = button(rect, row.id, stateTheme);
  const overlay = state === 'disabled'
    ? `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" rx="${row.id.startsWith('move') ? 10 : 8}" fill="#111820" opacity="0.58"/>`
    : state === 'pressed'
      ? `<rect x="${rect.x + 5}" y="${rect.y + 5}" width="${rect.width - 10}" height="${rect.height - 10}" rx="7" fill="#010204" opacity="0.22"/>`
      : state === 'active'
        ? `<rect x="${rect.x + 4}" y="${rect.y + 4}" width="${rect.width - 8}" height="${rect.height - 8}" rx="6" fill="none" stroke="${theme.accent}" stroke-width="2" filter="url(#softGlow)"/>`
        : '';
  return `<g>${base}${overlay}</g>`;
}

function stateSheetStatus(rect, state, theme) {
  const stateTheme = {
    ...theme,
    accent: state === 'error' ? theme.combat : state === 'thinking' ? theme.warning : state === 'offline' ? '#778083' : theme.accent
  };
  const base = statusIndicator(rect, stateTheme);
  const overlay = state === 'offline'
    ? `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" rx="7" fill="#10161a" opacity="0.58"/>`
    : '';
  return `<g>${base}${overlay}</g>`;
}

function stateSheetLed(rect, state, theme) {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const lit = state === 'on';
  return `
    <g>
      ${combatLed(rect, theme)}
      <circle cx="${cx}" cy="${cy}" r="${Math.min(rect.width, rect.height) / 2 - 4}" fill="${lit ? theme.accent : '#1b2226'}" opacity="${lit ? 0.96 : 0.55}" ${lit ? 'filter="url(#softGlow)"' : ''}/>
    </g>
  `;
}

function themeForButtonState(theme, id, state) {
  const color = state === 'disabled'
    ? '#7a8589'
    : state === 'pressed'
      ? theme.combatHigh
      : state === 'active'
        ? theme.accent
        : undefined;

  if (!color) {
    return theme;
  }

  return {
    ...theme,
    accent: id === 'run' || id.startsWith('move') || state === 'active' ? color : theme.accent,
    accentSoft: state === 'disabled' ? '#aab2b5' : theme.accentSoft,
    combat: id === 'attack' || state === 'pressed' ? color : theme.combat,
    warning: id === 'log' || id === 'inventory' ? color : theme.warning
  };
}

function materialSheetSvg(theme) {
  return svg(160, 304, `
    <defs>${defs(theme)}</defs>
    ${materialRow(0, 'panel', theme.panelStroke, theme.panelFill)}
    ${materialRow(104, 'lcd', theme.accent, theme.lcdFill)}
    ${materialRow(208, 'button', theme.combat, theme.buttonFill)}
  `);
}

function materialRow(y, label, stroke, fill) {
  return `
    <g transform="translate(0 ${y})">
      <rect x="0" y="0" width="96" height="96" fill="${fill}"/>
      <rect x="0" y="0" width="96" height="96" fill="url(#tileGrid)" opacity="0.64"/>
      <rect x="0" y="0" width="96" height="96" fill="url(#diagonalTrace)" opacity="0.55"/>
      <path d="M10 74H44V68H84" fill="none" stroke="${stroke}" stroke-opacity="0.26" stroke-width="1.2"/>
      <circle cx="14" cy="14" r="2" fill="${stroke}" opacity="0.24"/>
      <circle cx="82" cy="80" r="2" fill="${stroke}" opacity="0.18"/>
      <rect x="104" y="0" width="48" height="48" fill="none"/>
      <rect x="106" y="2" width="44" height="44" rx="7" fill="none" stroke="#010204" stroke-width="3"/>
      <rect x="109" y="5" width="38" height="38" rx="6" fill="none" stroke="${stroke}" stroke-width="1.6" opacity="0.9"/>
      <rect x="114" y="10" width="28" height="28" rx="4" fill="none" stroke="${stroke}" stroke-width="0.9" opacity="0.36"/>
      <path d="M112 20V8H124M136 8H148V20M148 32V44H136M124 44H112V32" fill="none" stroke="#ffffff" stroke-opacity="0.2" stroke-width="1"/>
      <text x="0" y="112" font-family="Arial, sans-serif" font-size="9" fill="${stroke}">${label}</text>
    </g>
  `;
}

function defs(theme) {
  return `
    <linearGradient id="shell" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${theme.shellHigh}"/>
      <stop offset="0.24" stop-color="${theme.shellMid}"/>
      <stop offset="0.58" stop-color="${theme.shellLow}"/>
      <stop offset="1" stop-color="${theme.shellEdge}"/>
    </linearGradient>
    <linearGradient id="glass" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${theme.glassHigh}"/>
      <stop offset="0.44" stop-color="${theme.glassMid}"/>
      <stop offset="1" stop-color="${theme.glassLow}"/>
    </linearGradient>
    <linearGradient id="redButton" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${theme.combatHigh}"/>
      <stop offset="0.5" stop-color="${theme.combat}"/>
      <stop offset="1" stop-color="${theme.combatDark}"/>
    </linearGradient>
    <linearGradient id="greenButton" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${theme.accentSoft}"/>
      <stop offset="0.5" stop-color="${theme.accent}"/>
      <stop offset="1" stop-color="${theme.accentDark}"/>
    </linearGradient>
    <linearGradient id="moveButton" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#263338"/>
      <stop offset="1" stop-color="#05090d"/>
    </linearGradient>
    <linearGradient id="toggleButton" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#202a32"/>
      <stop offset="1" stop-color="#05080d"/>
    </linearGradient>
    <linearGradient id="statusReady" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${theme.accentDark}"/>
      <stop offset="1" stop-color="#05090d"/>
    </linearGradient>
    <linearGradient id="sideRail" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${theme.combat}" stop-opacity="0.9"/>
      <stop offset="0.48" stop-color="${theme.accent}" stop-opacity="0.5"/>
      <stop offset="1" stop-color="${theme.warning}" stop-opacity="0.7"/>
    </linearGradient>
    <radialGradient id="caseBloom" cx="0.5" cy="0.18" r="0.92">
      <stop offset="0" stop-color="${theme.accent}" stop-opacity="0.16"/>
      <stop offset="0.45" stop-color="${theme.combat}" stop-opacity="0.055"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
    <pattern id="brushed" width="9" height="9" patternUnits="userSpaceOnUse">
      <path d="M0 1H9M0 4H9M0 7H9" stroke="#ffffff" stroke-opacity="0.055"/>
      <path d="M2 0V9M7 0V9" stroke="#000000" stroke-opacity="0.32"/>
    </pattern>
    <pattern id="scan" width="6" height="6" patternUnits="userSpaceOnUse">
      <path d="M0 1H6M0 4H6" stroke="${theme.accent}" stroke-opacity="0.16"/>
    </pattern>
    <pattern id="knurl" width="8" height="8" patternUnits="userSpaceOnUse">
      <rect width="8" height="8" fill="#030609"/>
      <path d="M-4 8L8 -4M0 12L12 0M6 14L14 6" stroke="${theme.accent}" stroke-opacity="0.18"/>
      <path d="M-4 0L8 12M0 -4L12 8" stroke="${theme.combat}" stroke-opacity="0.1"/>
    </pattern>
    <pattern id="tileGrid" width="12" height="12" patternUnits="userSpaceOnUse">
      <path d="M12 0H0V12" fill="none" stroke="${theme.accent}" stroke-opacity="0.19"/>
      <path d="M0 4H12M0 8H12" stroke="#ffffff" stroke-opacity="0.045"/>
    </pattern>
    <pattern id="diagonalTrace" width="18" height="18" patternUnits="userSpaceOnUse">
      <path d="M-4 18L18 -4M4 22L22 4" stroke="${theme.combat}" stroke-opacity="0.15" stroke-width="1"/>
    </pattern>
    <pattern id="buttonGrain" width="10" height="10" patternUnits="userSpaceOnUse">
      <path d="M0 1H10M0 5H10M0 9H10" stroke="#ffffff" stroke-opacity="0.16"/>
      <path d="M-2 10L10 -2M3 12L12 3" stroke="#000000" stroke-opacity="0.34"/>
    </pattern>
    <filter id="softGlow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="1.6" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  `;
}

function screw(x, y, theme) {
  return `
    <g>
      <circle cx="${x}" cy="${y}" r="6" fill="#010204"/>
      <circle cx="${x}" cy="${y}" r="4" fill="#1d2830" stroke="${theme.panelStroke}"/>
      <line x1="${x - 3}" y1="${y - 1}" x2="${x + 3}" y2="${y + 1}" stroke="#ffffff" stroke-opacity="0.28"/>
      <line x1="${x - 3}" y1="${y + 1}" x2="${x + 3}" y2="${y - 1}" stroke="#000000" stroke-opacity="0.6"/>
    </g>
  `;
}

function unionRects(rects) {
  const valid = rects.filter(Boolean);
  if (valid.length === 0) {
    return null;
  }

  const left = Math.min(...valid.map((rect) => rect.x));
  const top = Math.min(...valid.map((rect) => rect.y));
  const right = Math.max(...valid.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...valid.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function svg(width, height, content) {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    content,
    '</svg>'
  ].join('\n');
}

async function writePng(outputPath, svgSource) {
  await new Promise((resolve, reject) => {
    const child = spawn('magick', ['-background', 'none', 'svg:-', '-strip', `PNG32:${outputPath}`], {
      stdio: ['pipe', 'inherit', 'inherit']
    });
    child.stdin.write(svgSource);
    child.stdin.end();
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`magick exited with ${code}`));
      }
    });
  });
}

function themeFor(name) {
  const themes = {
    'obsidian-rain': {
      name: 'obsidian-rain',
      headerLabel: 'OBSIDIAN RAIN DECK',
      accent: '#42f6ff',
      accentSoft: '#b8fbff',
      accentDark: '#0a4f5a',
      accentLine: '#3ce4ff',
      combat: '#ff4f8b',
      combatHigh: '#ff9ab9',
      combatDark: '#4b071f',
      warning: '#ffd35c',
      panelStroke: '#5c7480',
      outerStroke: '#2d3a42',
      shellHigh: '#313b45',
      shellMid: '#121922',
      shellLow: '#05080d',
      shellEdge: '#24313a',
      glassHigh: '#10252d',
      glassMid: '#061118',
      glassLow: '#010304',
      panelFill: '#071016',
      lcdFill: '#04141b',
      buttonFill: '#170710',
      textDim: '#c6d4d8',
      textFaint: '#78868b'
    },
    'amber-foundry': {
      name: 'amber-foundry',
      headerLabel: 'AMBER FOUNDRY DECK',
      accent: '#ffbe4a',
      accentSoft: '#ffe39a',
      accentDark: '#6f3a09',
      accentLine: '#ffcf68',
      combat: '#ff6a48',
      combatHigh: '#ffc094',
      combatDark: '#501306',
      warning: '#4df4e8',
      panelStroke: '#7d6242',
      outerStroke: '#3e3326',
      shellHigh: '#443829',
      shellMid: '#1f1811',
      shellLow: '#070504',
      shellEdge: '#342515',
      glassHigh: '#2b1c0d',
      glassMid: '#120c06',
      glassLow: '#030201',
      panelFill: '#1f1409',
      lcdFill: '#241506',
      buttonFill: '#261106',
      textDim: '#ead8bd',
      textFaint: '#9d8464'
    }
  };

  return themes[name] ?? themes['obsidian-rain'];
}

function sourceNotes(skinId, profileName, theme) {
  return [
    `# ${skinId} Source Prototype`,
    '',
    `Profile: ${profileName}`,
    `Theme: ${theme.name}`,
    '',
    'Generated files:',
    '',
    '- `source-chassis.png`: clean full-size chassis artboard.',
    '- `source-widgets.png`: full-size widget source with fixed button and indicator crops.',
    '- `source-state-sheet.png`: fixed widget states with separate authored slots.',
    '- `source-materials.png`: material sheet for panel, LCD, and button fill/frame crops.',
    '',
    'Suggested next commands:',
    '',
    '```bash',
    `pnpm -C frontend skin:scaffold ${skinId} ${profileName} \\`,
    `  --label "${labelFromId(skinId)}" \\`,
    '  --tags cyberpunk,prototype,source-generated \\',
    '  --mood premium,nocturnal,tactile \\',
    '  --palette cyan,magenta,graphite \\',
    '  --source source-widgets.png \\',
    '  --chassis-source source-chassis.png \\',
    '  --state-source source-state-sheet.png \\',
    '  --materials-source source-materials.png \\',
    '  --material-render-mode source \\',
    `  --out ../_artifacts/skin-kits/${skinId}`,
    `pnpm -C frontend build:skin-kit ../_artifacts/skin-kits/${skinId}`,
    `pnpm -C frontend skin:guide ${profileName} --view all --source ../_artifacts/skin-kits/${skinId}/source-chassis.png --out ../_artifacts/skin-guides/${skinId}-overlay.png`,
    '```',
    ''
  ].join('\n');
}

function labelFromId(id) {
  return id
    .split('-')
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function parseArgs(values) {
  const options = {};
  const positionals = [];

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith('--')) {
      positionals.push(value);
      continue;
    }

    const key = value.slice(2);
    const next = values[index + 1];
    if (next && !next.startsWith('--')) {
      options[key] = next;
      index += 1;
    } else {
      options[key] = 'true';
    }
  }

  return { options, positionals };
}

function printUsage() {
  console.error([
    'Usage: pnpm -C frontend skin:source-prototype <skin-id> [mobilePortrait|mobileCompact] [options]',
    '',
    'Options:',
    '  --theme <obsidian-rain|amber-foundry>  Visual theme preset. Defaults to obsidian-rain.',
    '  --out <path>                           Output directory. Defaults to ../_artifacts/skin-kits/<skin-id>.'
  ].join('\n'));
}
