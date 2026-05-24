import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildStateSheetLayout } from './skin-state-sheet-layout.mjs';

const rootDir = path.resolve(new URL('..', import.meta.url).pathname);
const contractPath = path.join(rootDir, 'src/skins/SKIN_LAYOUT_CONTRACT_V1.json');
const contract = JSON.parse(await fs.readFile(contractPath, 'utf8'));
const parsedArgs = parseArgs(process.argv.slice(2));
const profileName = parsedArgs.positionals[0] ?? 'mobileCompact';
const profile = contract.profiles?.[profileName];

if (parsedArgs.options.help) {
  printUsage();
  process.exit(0);
}

if (!profile) {
  console.error(`Unknown profile "${profileName}". Expected one of: ${Object.keys(contract.profiles ?? {}).join(', ')}`);
  process.exit(1);
}

const layout = buildStateSheetLayout(profile);
const outputPath = parsedArgs.options.out
  ? path.resolve(rootDir, parsedArgs.options.out)
  : path.resolve(rootDir, `../_artifacts/skin-guides/${profileName}-state-sheet-guide.svg`);
const svg = buildSvg(profileName, layout);

await fs.mkdir(path.dirname(outputPath), { recursive: true });

if (outputPath.endsWith('.png')) {
  await writePng(svg, outputPath);
} else if (outputPath.endsWith('.svg')) {
  await fs.writeFile(outputPath, svg, 'utf8');
} else {
  console.error('State-sheet guide output must end with .svg or .png');
  process.exit(1);
}

console.error(`Wrote ${path.relative(process.cwd(), outputPath)}`);

function buildSvg(name, selectedLayout) {
  const { width, height } = selectedLayout.size;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    '<defs>',
    '<pattern id="fineGrid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M 10 0 L 0 0 0 10" fill="none" stroke="#172326" stroke-width="0.5"/></pattern>',
    '<filter id="labelShadow"><feDropShadow dx="0" dy="1" stdDeviation="1" flood-color="#000" flood-opacity="0.85"/></filter>',
    '</defs>',
    `<rect width="${width}" height="${height}" fill="#050708"/>`,
    `<rect x="0" y="0" width="${width}" height="36" fill="#111719"/>`,
    `<text x="14" y="23" font-family="Arial, sans-serif" font-size="14" font-weight="700" fill="#eafff7">RogueLLM ${escapeXml(name)} fixed widget state sheet</text>`,
    `<text x="${width - 14}" y="23" text-anchor="end" font-family="Arial, sans-serif" font-size="10" fill="#9fb8b3">${escapeXml(selectedLayout.source)} ${width}x${height}</text>`,
    `<rect x="0" y="36" width="${width}" height="${height - 36}" fill="url(#fineGrid)" opacity="0.92"/>`,
    selectedLayout.sections.map(sectionSvg).join('\n'),
    '</svg>'
  ].join('\n');
}

function sectionSvg(section) {
  const headerY = section.y;
  const columnStart = 16 + section.labelWidth;
  const headerText = `
    <rect x="16" y="${headerY}" width="${section.width - 32}" height="20" rx="4" fill="#0d1416" stroke="#284246"/>
    <text x="26" y="${headerY + 14}" font-family="Arial, sans-serif" font-size="11" font-weight="700" fill="#8fffd2">${escapeXml(section.title)}</text>
  `;
  const columnLabels = Array.from({ length: maxStateCount(section) }, (_, index) => {
    const state = firstStateAt(section, index);
    const x = columnStart + index * (section.columnWidth + 10) + section.columnWidth / 2;
    return `<text x="${x}" y="${section.y + 35}" text-anchor="middle" font-family="Arial, sans-serif" font-size="9" font-weight="700" fill="#b9c9c7">${escapeXml(state ?? '')}</text>`;
  }).join('\n');
  const rowMarkup = section.rows.map((row) => rowSvg(section, row)).join('\n');

  return `
    <g data-section="${escapeXml(section.id)}">
      ${headerText}
      ${columnLabels}
      ${rowMarkup}
    </g>
  `;
}

function rowSvg(section, row) {
  const labelY = row.y + section.rowHeight / 2 + 4;
  const slots = row.states.map((state) => {
    const slot = row.slots[state];
    const path = row.assetPathForState(state);
    return `
      <g data-widget="${escapeXml(row.id)}" data-state="${escapeXml(state)}">
        <rect x="${slot.x}" y="${slot.y}" width="${slot.width}" height="${slot.height}" rx="4" fill="${fillFor(row.id, state)}" stroke="${strokeFor(row.id, state)}" stroke-width="1.4"/>
        <rect x="${slot.x + 3}" y="${slot.y + 3}" width="${Math.max(1, slot.width - 6)}" height="${Math.max(1, slot.height - 6)}" rx="3" fill="none" stroke="#ffffff" stroke-opacity="0.12"/>
        <text x="${slot.x + slot.width / 2}" y="${slot.y + slot.height / 2 + 3}" text-anchor="middle" font-family="Arial, sans-serif" font-size="8" font-weight="700" fill="#f5fff8" filter="url(#labelShadow)">${escapeXml(state)}</text>
        <text x="${slot.x}" y="${slot.y + slot.height + 10}" font-family="Arial, sans-serif" font-size="7" fill="#748986">${escapeXml(path)}</text>
      </g>
    `;
  }).join('\n');

  return `
    <g>
      <text x="26" y="${labelY}" font-family="Arial, sans-serif" font-size="10" font-weight="700" fill="#dcebe7">${escapeXml(row.label)}</text>
      <text x="100" y="${labelY}" text-anchor="end" font-family="Arial, sans-serif" font-size="8" fill="#8fa29f">${row.rect.width}x${row.rect.height}</text>
      ${slots}
    </g>
  `;
}

function maxStateCount(section) {
  return Math.max(...section.rows.map((row) => row.states.length));
}

function firstStateAt(section, index) {
  return section.rows.find((row) => row.states[index])?.states[index];
}

function fillFor(id, state) {
  if (state === 'disabled' || state === 'offline') {
    return '#20262a';
  }
  if (state === 'pressed') {
    return '#33161e';
  }
  if (state === 'active' || state === 'on' || state === 'ready') {
    return '#12311f';
  }
  if (state === 'error') {
    return '#3a151d';
  }
  if (state === 'thinking') {
    return '#102d37';
  }
  if (id === 'run') {
    return '#0a2b25';
  }
  if (id === 'attack') {
    return '#30131c';
  }
  return '#111a1e';
}

function strokeFor(id, state) {
  if (state === 'disabled' || state === 'offline') {
    return '#606b70';
  }
  if (state === 'pressed' || state === 'error') {
    return '#ff6074';
  }
  if (state === 'active' || state === 'on' || state === 'ready') {
    return '#80ff74';
  }
  if (state === 'thinking') {
    return '#5fdcff';
  }
  if (id === 'run') {
    return '#4ee7d1';
  }
  if (id === 'attack') {
    return '#ff6280';
  }
  return '#7ebdc4';
}

async function writePng(svg, outputPath) {
  await new Promise((resolve, reject) => {
    const child = spawn('magick', ['svg:-', `PNG32:${outputPath}`], { stdio: ['pipe', 'inherit', 'inherit'] });
    child.stdin.write(svg);
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

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
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
    'Usage: pnpm -C frontend skin:state-guide [mobilePortrait|mobileCompact] [options]',
    '',
    'Options:',
    '  --out <path>  Write .svg or .png guide. Defaults to ../_artifacts/skin-guides/<profile>-state-sheet-guide.svg.'
  ].join('\n'));
}
