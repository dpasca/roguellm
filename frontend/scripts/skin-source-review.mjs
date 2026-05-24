import fs from 'node:fs/promises';
import path from 'node:path';

const rootDir = path.resolve(new URL('..', import.meta.url).pathname);
const contractPath = path.join(rootDir, 'src/skins/SKIN_LAYOUT_CONTRACT_V1.json');
const contract = JSON.parse(await fs.readFile(contractPath, 'utf8'));
const parsedArgs = parseArgs(process.argv.slice(2));
const packArg = parsedArgs.positionals[0];

if (parsedArgs.options.help || !packArg) {
  printUsage();
  process.exit(parsedArgs.options.help ? 0 : 1);
}

const packDir = await resolvePackDir(packArg);
const kitPath = path.join(packDir, 'skin-kit.json');
const kit = JSON.parse(await fs.readFile(kitPath, 'utf8'));
const profile = contract.profiles?.[kit.kind];

if (!profile) {
  console.error(`Skin kit kind "${kit.kind ?? 'none'}" is not in Skin Layout Contract ${contract.version}.`);
  process.exit(1);
}

const outputPath = parsedArgs.options.out
  ? path.resolve(rootDir, parsedArgs.options.out)
  : path.resolve(rootDir, `../_artifacts/skin-reviews/${kit.id ?? path.basename(packDir)}/index.html`);

const review = await buildReview(packDir, kit, profile);
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, review, 'utf8');
console.error(`Wrote ${path.relative(process.cwd(), outputPath)}`);

async function buildReview(dir, skinKit, selectedProfile) {
  const sources = {
    chassis: await readOptionalImage(dir, 'source-chassis.png'),
    widgets: await readOptionalImage(dir, 'source-widgets.png'),
    materials: await readOptionalImage(dir, 'source-materials.png')
  };
  const expected = selectedProfile.size;
  const issues = reviewIssues(sources, skinKit, selectedProfile);

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(skinKit.id ?? path.basename(dir))} Source Pack Review</title>`,
    '<style>',
    htmlStyles(),
    '</style>',
    '</head>',
    '<body>',
    '<main>',
    `<header><p>RogueLLM Skin Source Review</p><h1>${escapeHtml(skinKit.meta?.label ?? skinKit.id ?? path.basename(dir))}</h1></header>`,
    '<section class="summary">',
    stat('Profile', `${skinKit.kind} ${expected.width}x${expected.height}`),
    stat('Role', skinKit.meta?.role ?? 'unknown'),
    stat('Palette', (skinKit.meta?.palette ?? []).join(', ') || 'none'),
    stat('Source Pack', relativePath(dir)),
    '</section>',
    checklist(issues),
    sourcePanel('source-chassis.png', sources.chassis, selectedProfile.size, [
      rectLayer('live regions', selectedProfile.regions, '#66ff99', 'rgba(102,255,153,0.10)'),
      rectLayer('runtime slots', flattenRuntimeSlots(selectedProfile.runtime), '#c9ff5a', 'rgba(201,255,90,0.10)', true)
    ]),
    sourcePanel('source-widgets.png', sources.widgets, selectedProfile.size, [
      rectLayer('button crops', selectedProfile.layout.buttons, '#ffbd4a', 'rgba(255,189,74,0.14)'),
      rectLayer('indicator crops', selectedProfile.layout.indicators, '#68d8ff', 'rgba(104,216,255,0.16)'),
      rectLayer('meter crops', selectedProfile.layout.fills, '#ff6de8', 'rgba(255,109,232,0.15)', true)
    ]),
    materialPanel(sources.materials, selectedProfile.materials),
    '<section class="notes">',
    '<h2>Review Notes</h2>',
    '<p>This is a review artifact, not runtime UI. Use it to reject source art before building a skin kit when baked text, map content, misaligned buttons, or unsafe material detail crosses fixed Phaser slots.</p>',
    '</section>',
    '</main>',
    '</body>',
    '</html>'
  ].join('\n');
}

function stat(label, value) {
  return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function checklist(issues) {
  const items = issues.length > 0
    ? issues.map((issue) => `<li class="bad">${escapeHtml(issue)}</li>`).join('\n')
    : '<li class="good">Geometry preflight looks aligned. Manual art-quality review is still required.</li>';

  return `<section class="checklist"><h2>Preflight</h2><ul>${items}</ul></section>`;
}

function sourcePanel(title, source, expectedSize, layers) {
  const image = source
    ? `<img src="${source.dataUri}" alt="${escapeHtml(title)}">`
    : `<div class="missing">Missing ${escapeHtml(title)}</div>`;
  const width = source?.width ?? expectedSize.width;
  const height = source?.height ?? expectedSize.height;

  return [
    '<section class="panel">',
    `<h2>${escapeHtml(title)}</h2>`,
    `<p>${width}x${height}; expected ${expectedSize.width}x${expectedSize.height}</p>`,
    `<div class="artboard" style="aspect-ratio:${expectedSize.width}/${expectedSize.height}">`,
    image,
    `<svg viewBox="0 0 ${expectedSize.width} ${expectedSize.height}" aria-hidden="true">`,
    grid(expectedSize.width, expectedSize.height),
    layers.map((layer) => layer.svg).join('\n'),
    '</svg>',
    '</div>',
    legend(layers),
    '</section>'
  ].join('\n');
}

function materialPanel(source, materials) {
  const width = source?.width ?? 160;
  const height = source?.height ?? 304;
  const rows = ['panel', 'lcd', 'button'];
  const rects = Object.fromEntries(
    rows.flatMap((name, index) => {
      const material = materials[name];
      const y = index * 104;
      return [
        [`${name}.fill`, { x: 0, y, width: material.fill.width, height: material.fill.height }],
        [`${name}.frame`, { x: 104, y, width: material.frame.width, height: material.frame.height }]
      ];
    })
  );
  const image = source
    ? `<img src="${source.dataUri}" alt="source-materials.png">`
    : '<div class="missing">Missing source-materials.png</div>';
  const layer = rectLayer('material crops', rects, '#68d8ff', 'rgba(104,216,255,0.16)');

  return [
    '<section class="panel">',
    '<h2>source-materials.png</h2>',
    `<p>${width}x${height}; expected at least 152x304</p>`,
    `<div class="artboard material" style="aspect-ratio:${Math.max(160, width)}/${Math.max(304, height)}">`,
    image,
    `<svg viewBox="0 0 ${Math.max(160, width)} ${Math.max(304, height)}" aria-hidden="true">`,
    grid(Math.max(160, width), Math.max(304, height)),
    layer.svg,
    '</svg>',
    '</div>',
    legend([layer]),
    '</section>'
  ].join('\n');
}

function rectLayer(label, rects, stroke, fill, dashed = false) {
  const dash = dashed ? ' stroke-dasharray="4 3"' : '';
  const svg = Object.entries(rects)
    .map(([name, rect], index) => {
      const labelY = rect.y + 12 + (index % 3) * 9;
      return [
        `<g data-layer="${escapeHtml(label)}" data-name="${escapeHtml(name)}">`,
        `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" fill="${fill}" stroke="${stroke}" stroke-width="1.25"${dash}/>`,
        `<text x="${rect.x + 3}" y="${labelY}" fill="${stroke}">${escapeHtml(name)}</text>`,
        '</g>'
      ].join('');
    })
    .join('\n');
  return { label, stroke, svg };
}

function legend(layers) {
  return `<div class="legend">${layers.map((layer) => `<span><i style="background:${layer.stroke}"></i>${escapeHtml(layer.label)}</span>`).join('')}</div>`;
}

function grid(width, height) {
  const lines = [];
  for (let x = 50; x < width; x += 50) {
    lines.push(`<path d="M${x} 0V${height}" class="grid major"/>`);
  }
  for (let y = 50; y < height; y += 50) {
    lines.push(`<path d="M0 ${y}H${width}" class="grid major"/>`);
  }
  for (let x = 10; x < width; x += 10) {
    lines.push(`<path d="M${x} 0V${height}" class="grid minor"/>`);
  }
  for (let y = 10; y < height; y += 10) {
    lines.push(`<path d="M0 ${y}H${width}" class="grid minor"/>`);
  }
  return lines.join('\n');
}

function reviewIssues(sources, skinKit, selectedProfile) {
  const issues = [];
  const expected = selectedProfile.size;

  for (const [name, source] of Object.entries({ chassis: sources.chassis, widgets: sources.widgets })) {
    if (!source) {
      issues.push(`Missing source-${name}.png`);
      continue;
    }
    if (source.width !== expected.width || source.height !== expected.height) {
      issues.push(`source-${name}.png is ${source.width}x${source.height}; expected ${expected.width}x${expected.height}`);
    }
  }

  if (!sources.materials) {
    issues.push('Missing source-materials.png');
  } else if (sources.materials.width < 152 || sources.materials.height < 304) {
    issues.push(`source-materials.png is ${sources.materials.width}x${sources.materials.height}; expected at least 152x304`);
  }

  if (skinKit.build?.source !== 'source-widgets.png') {
    issues.push('skin-kit build.source does not point at source-widgets.png');
  }

  const chassisCrop = skinKit.build?.crops?.find((crop) => crop.path === 'chassis.png');
  if (chassisCrop?.source !== 'source-chassis.png') {
    issues.push('chassis crop does not point at source-chassis.png');
  }

  return issues;
}

function flattenRuntimeSlots(runtime) {
  const entries = [];
  collectRuntimeSlots('', runtime, entries);
  return Object.fromEntries(entries);
}

function collectRuntimeSlots(prefix, value, entries) {
  if (!value || typeof value !== 'object') {
    return;
  }

  if (isRect(value)) {
    entries.push([prefix, value]);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      const name = entry?.id ? `${prefix}.${entry.id}` : `${prefix}[${index}]`;
      collectRuntimeSlots(name, entry, entries);
    });
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (key === 'rowHeight' || key === 'id' || (key === 'label' && typeof nested === 'string')) {
      continue;
    }
    collectRuntimeSlots(prefix ? `${prefix}.${key}` : key, nested, entries);
  }
}

function isRect(value) {
  return ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(value[key]));
}

async function readOptionalImage(dir, fileName) {
  const filePath = path.join(dir, fileName);
  let data;
  try {
    data = await fs.readFile(filePath);
  } catch {
    return null;
  }

  const dimensions = imageDimensionsFor(data, filePath);
  return {
    ...dimensions,
    dataUri: `data:${mimeTypeFor(filePath)};base64,${data.toString('base64')}`
  };
}

function imageDimensionsFor(data, filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (
    extension === '.png' &&
    data.length >= 24 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47
  ) {
    return {
      width: data.readUInt32BE(16),
      height: data.readUInt32BE(20)
    };
  }
  return { width: 0, height: 0 };
}

function mimeTypeFor(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.jpg' || extension === '.jpeg') {
    return 'image/jpeg';
  }
  if (extension === '.webp') {
    return 'image/webp';
  }
  return 'image/png';
}

async function resolvePackDir(input) {
  const resolved = path.resolve(rootDir, input);
  const stat = await fs.stat(resolved);
  return stat.isDirectory() ? resolved : path.dirname(resolved);
}

function relativePath(filePath) {
  return path.relative(rootDir, filePath) || '.';
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

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function htmlStyles() {
  return `
    :root { color-scheme: dark; font-family: Inter, Arial, sans-serif; background: #050808; color: #dce8e5; }
    body { margin: 0; }
    main { max-width: 1180px; margin: 0 auto; padding: 28px; }
    header { margin-bottom: 18px; }
    header p { margin: 0 0 6px; color: #8de7ff; font-size: 12px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; }
    h1 { margin: 0; font-size: 28px; }
    h2 { margin: 0 0 8px; font-size: 18px; color: #f4fff8; }
    p { color: #9fb4b2; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; margin: 18px 0; }
    .summary div, .checklist, .panel, .notes { border: 1px solid #253839; background: #0b1112; border-radius: 8px; }
    .summary div { padding: 12px; }
    .summary span { display: block; color: #84a2a0; font-size: 11px; text-transform: uppercase; }
    .summary strong { display: block; margin-top: 4px; color: #e9fff5; font-size: 14px; }
    .checklist, .panel, .notes { margin-top: 18px; padding: 16px; }
    .checklist ul { margin: 0; padding-left: 20px; }
    .checklist li { margin: 6px 0; }
    .good { color: #9cff86; }
    .bad { color: #ff91a2; }
    .artboard { position: relative; width: min(100%, 780px); background: #020504; border: 1px solid #314748; overflow: hidden; image-rendering: pixelated; }
    .artboard.material { max-width: 520px; }
    .artboard img, .missing, .artboard svg { position: absolute; inset: 0; width: 100%; height: 100%; }
    .artboard img { object-fit: fill; }
    .missing { display: grid; place-items: center; color: #ff91a2; background: #16070a; font-weight: 800; }
    svg text { font: 700 8px Arial, sans-serif; paint-order: stroke; stroke: #000; stroke-width: 2px; stroke-linejoin: round; }
    .grid.minor { stroke: #132224; stroke-width: 0.35; }
    .grid.major { stroke: #2b4648; stroke-width: 0.75; }
    .legend { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 10px; color: #b9ccca; font-size: 12px; }
    .legend span { display: inline-flex; align-items: center; gap: 6px; }
    .legend i { width: 10px; height: 10px; display: inline-block; border-radius: 2px; }
  `;
}

function printUsage() {
  console.error([
    'Usage: pnpm -C frontend skin:review-source <skin-pack-dir|skin-kit.json> [options]',
    '',
    'Options:',
    '  --out <path>  Write review HTML. Defaults to ../_artifacts/skin-reviews/<skin-id>/index.html.'
  ].join('\n'));
}
