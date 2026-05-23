import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const rootDir = path.resolve(new URL('..', import.meta.url).pathname);
const contractPath = path.join(rootDir, 'src/skins/SKIN_LAYOUT_CONTRACT_V1.json');
const contract = JSON.parse(await fs.readFile(contractPath, 'utf8'));
const parsedArgs = parseArgs(process.argv.slice(2));
const profileName = parsedArgs.positionals[0] ?? 'mobilePortrait';
const profile = contract.profiles?.[profileName];
const view = parsedArgs.options.view ?? 'all';

if (parsedArgs.options.help) {
  printUsage();
  process.exit(0);
}

if (!profile) {
  console.error(`Unknown profile "${profileName}". Expected one of: ${Object.keys(contract.profiles ?? {}).join(', ')}`);
  process.exit(1);
}

if (!['all', 'live', 'crops'].includes(view)) {
  console.error('Guide view must be one of: all, live, crops');
  process.exit(1);
}

const outputPath = parsedArgs.options.out
  ? path.resolve(rootDir, parsedArgs.options.out)
  : path.resolve(rootDir, `../_artifacts/skin-guides/${profileName}-${view}-layout-guide.svg`);
const svg = buildGuide(profileName, profile, view);

await fs.mkdir(path.dirname(outputPath), { recursive: true });

if (outputPath.endsWith('.png')) {
  await writePng(svg, outputPath);
} else if (outputPath.endsWith('.svg')) {
  await fs.writeFile(outputPath, svg, 'utf8');
} else {
  console.error('Guide output must end with .svg or .png');
  process.exit(1);
}

console.error(`Wrote ${path.relative(process.cwd(), outputPath)}`);

function buildGuide(name, selectedProfile, selectedView) {
  const { width, height } = selectedProfile.size;
  const titleHeight = 30;
  const legendHeight = 86;
  const viewWidth = width;
  const viewHeight = height + legendHeight;
  const rows = [
    titleRow(name, selectedView, width),
    grid(width, height, titleHeight),
    ...(selectedView === 'all' || selectedView === 'live'
      ? [rectGroup('live', selectedProfile.regions, titleHeight, '#66ff99', 'rgba(102,255,153,0.08)')]
      : []),
    ...(selectedView === 'all' || selectedView === 'crops'
      ? [
          rectGroup('button', selectedProfile.layout.buttons, titleHeight, '#ffbd4a', 'rgba(255,189,74,0.14)'),
          rectGroup('indicator', selectedProfile.layout.indicators, titleHeight, '#68d8ff', 'rgba(104,216,255,0.16)'),
          rectGroup('meter', selectedProfile.layout.fills, titleHeight, '#ff6de8', 'rgba(255,109,232,0.16)', true)
        ]
      : []),
    legend(width, height + titleHeight, selectedView)
  ];

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${viewWidth}" height="${viewHeight}" viewBox="0 0 ${viewWidth} ${viewHeight}">`,
    '<defs>',
    '<pattern id="fineGrid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M 10 0 L 0 0 0 10" fill="none" stroke="#1c2a2b" stroke-width="0.5"/></pattern>',
    '<pattern id="majorGrid" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M 50 0 L 0 0 0 50" fill="none" stroke="#34484a" stroke-width="1"/></pattern>',
    '<filter id="labelShadow"><feDropShadow dx="0" dy="1" stdDeviation="1" flood-color="#000" flood-opacity="0.85"/></filter>',
    '</defs>',
    `<rect width="${viewWidth}" height="${viewHeight}" fill="#050808"/>`,
    `<g transform="translate(0 ${titleHeight})">`,
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#081011" stroke="#6d8584"/>`,
    `<rect x="0" y="0" width="${width}" height="${height}" fill="url(#fineGrid)"/>`,
    `<rect x="0" y="0" width="${width}" height="${height}" fill="url(#majorGrid)"/>`,
    '</g>',
    rows.join('\n'),
    '</svg>'
  ].join('\n');
}

function titleRow(name, selectedView, width) {
  return `
    <g>
      <rect x="0" y="0" width="${width}" height="30" fill="#111718"/>
      <text x="10" y="20" font-family="Arial, sans-serif" font-size="13" font-weight="700" fill="#e6fff0">RogueLLM Skin Layout Contract ${escapeXml(contract.version)} / ${escapeXml(name)} / ${escapeXml(selectedView)}</text>
    </g>
  `;
}

function grid(width, height, offsetY) {
  const labels = [];
  for (let x = 50; x < width; x += 50) {
    labels.push(`<text x="${x + 2}" y="${offsetY + 12}" font-family="Arial, sans-serif" font-size="8" fill="#7f9997">${x}</text>`);
  }
  for (let y = 50; y < height; y += 50) {
    labels.push(`<text x="3" y="${offsetY + y - 3}" font-family="Arial, sans-serif" font-size="8" fill="#7f9997">${y}</text>`);
  }
  return labels.join('\n');
}

function rectGroup(kind, rects, offsetY, stroke, fill, dashed = false) {
  return Object.entries(rects)
    .map(([name, rect], index) => {
      const labelY = offsetY + rect.y + 13 + ((index % 3) * 10);
      const dash = dashed ? ' stroke-dasharray="4 3"' : '';
      return `
        <g data-kind="${kind}" data-name="${escapeXml(name)}">
          <rect x="${rect.x}" y="${offsetY + rect.y}" width="${rect.width}" height="${rect.height}" fill="${fill}" stroke="${stroke}" stroke-width="1.4"${dash}/>
          <text x="${rect.x + 4}" y="${labelY}" font-family="Arial, sans-serif" font-size="8" font-weight="700" fill="${stroke}" filter="url(#labelShadow)">${escapeXml(name)} ${rect.x},${rect.y} ${rect.width}x${rect.height}</text>
        </g>
      `;
    })
    .join('\n');
}

function legend(width, y, selectedView) {
  const rows = {
    all: [
      ['live regions: keep clean for runtime content', '#66ff99'],
      ['button crops: fixed state sprites', '#ffbd4a'],
      ['indicator crops: state sprites', '#68d8ff'],
      ['meter/fill rects: runtime fills only', '#ff6de8']
    ],
    live: [
      ['live regions: keep clean for Phaser runtime content', '#66ff99'],
      ['overlap is intentional for drawers and terminal states', '#a6b7b4']
    ],
    crops: [
      ['button crops: fixed idle/hover/pressed/disabled sprites', '#ffbd4a'],
      ['indicator crops: state sprites', '#68d8ff'],
      ['meter/fill rects: runtime fills only', '#ff6de8']
    ]
  }[selectedView] ?? [
    ['live regions: keep clean for runtime content', '#66ff99'],
    ['button crops: fixed state sprites', '#ffbd4a']
  ];

  return `
    <g transform="translate(0 ${y})">
      <rect x="0" y="0" width="${width}" height="86" fill="#0d1213" stroke="#283637"/>
      ${rows.map(([label, color], index) => `
        <rect x="12" y="${14 + index * 17}" width="10" height="10" fill="${color}" opacity="0.9"/>
        <text x="28" y="${23 + index * 17}" font-family="Arial, sans-serif" font-size="10" fill="#d7e8e5">${escapeXml(label)}</text>
      `).join('')}
    </g>
  `;
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
    'Usage: pnpm -C frontend skin:guide [mobilePortrait|mobileCompact] [options]',
    '',
    'Options:',
    '  --view <all|live|crops>  Select rectangle groups. Defaults to all.',
    '  --out <path>             Write .svg or .png guide. Defaults to ../_artifacts/skin-guides/<profile>-<view>-layout-guide.svg.'
  ].join('\n'));
}
