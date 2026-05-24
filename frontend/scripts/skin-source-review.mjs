import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { buildStateSheetLayout, stateSheetCropsForProfile, stateSheetSourceFile } from './skin-state-sheet-layout.mjs';

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(new URL('..', import.meta.url).pathname);
const contractPath = path.join(rootDir, 'src/skins/SKIN_LAYOUT_CONTRACT_V1.json');
const artBlueprintPath = path.join(rootDir, 'src/skins/SKIN_ART_BLUEPRINT_V1.json');
const contract = JSON.parse(await fs.readFile(contractPath, 'utf8'));
const artBlueprint = JSON.parse(await fs.readFile(artBlueprintPath, 'utf8'));
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
const jsonOutputPath = jsonReviewPath(parsedArgs.options.json, outputPath);

const review = await buildReview(packDir, kit, profile);
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, review.html, 'utf8');
console.error(`Wrote ${path.relative(process.cwd(), outputPath)}`);
if (jsonOutputPath) {
  await fs.mkdir(path.dirname(jsonOutputPath), { recursive: true });
  await fs.writeFile(jsonOutputPath, `${JSON.stringify(review.report, null, 2)}\n`, 'utf8');
  console.error(`Wrote ${path.relative(process.cwd(), jsonOutputPath)}`);
}
if (shouldFailReview(parsedArgs.options, review.report)) {
  process.exitCode = 1;
}

async function buildReview(dir, skinKit, selectedProfile) {
  const stateSheetLayout = buildStateSheetLayout(selectedProfile);
  const buildUsesStateSheet = (skinKit.build?.crops ?? []).some((crop) => path.basename(crop.source ?? '') === stateSheetSourceFile);
  const stateSheetRequired = buildUsesStateSheet || sourcePackRequiresStateSheet(skinKit);
  const sources = {
    chassis: await readOptionalImage(dir, 'source-chassis.png'),
    widgets: await readOptionalImage(dir, 'source-widgets.png'),
    stateSheet: await readOptionalImage(dir, stateSheetSourceFile),
    materials: await readOptionalImage(dir, 'source-materials.png')
  };
  const expected = selectedProfile.size;
  const metrics = await reviewMetrics(sources, selectedProfile);
  const issues = reviewIssues(sources, skinKit, selectedProfile);
  const warnings = reviewWarnings(metrics);
  const report = buildReport(dir, skinKit, selectedProfile, sources, metrics, issues, warnings, stateSheetLayout, stateSheetRequired);

  const html = [
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
    stat('Art Blueprint', `${artBlueprint.name} ${artBlueprint.version}`),
    stat('Source Pack', relativePath(dir)),
    '</section>',
    checklist(issues, warnings),
    artBlueprintPanel(artBlueprint, skinKit),
    metricsPanel(metrics),
    sourcePanel('source-chassis.png', sources.chassis, selectedProfile.size, [
      rectLayer('live regions', selectedProfile.regions, '#66ff99', 'rgba(102,255,153,0.10)'),
      rectLayer('runtime slots', flattenRuntimeSlots(selectedProfile.runtime), '#c9ff5a', 'rgba(201,255,90,0.10)', true)
    ]),
    sourcePanel('source-widgets.png', sources.widgets, selectedProfile.size, [
      rectLayer('button crops', selectedProfile.layout.buttons, '#ffbd4a', 'rgba(255,189,74,0.14)'),
      rectLayer('indicator crops', selectedProfile.layout.indicators, '#68d8ff', 'rgba(104,216,255,0.16)'),
      rectLayer('meter crops', selectedProfile.layout.fills, '#ff6de8', 'rgba(255,109,232,0.15)', true)
    ]),
    sourcePanel(stateSheetSourceFile, sources.stateSheet, stateSheetLayout.size, [
      rectLayer('state crops', stateSheetRectMap(selectedProfile), '#80ff74', 'rgba(128,255,116,0.10)')
    ], { optional: !stateSheetRequired }),
    materialPanel(sources.materials, selectedProfile.materials),
    '<section class="notes">',
    '<h2>Review Notes</h2>',
    '<p>This is a review artifact, not runtime UI. Use it to reject source art before building a skin kit when baked text, map content, misaligned buttons, or unsafe material detail crosses fixed Phaser slots.</p>',
    '</section>',
    '</main>',
    '</body>',
    '</html>'
  ].join('\n');

  return { html, report };
}

function buildReport(dir, skinKit, selectedProfile, sources, metrics, issues, warnings, stateSheetLayout, stateSheetRequired) {
  return {
    skinId: skinKit.id ?? path.basename(dir),
    label: skinKit.meta?.label ?? skinKit.id ?? path.basename(dir),
    profile: skinKit.kind,
    role: skinKit.meta?.role ?? 'unknown',
    sourcePack: relativePath(dir),
    issueCount: issues.length,
    warningCount: warnings.length,
    issues,
    warnings,
    artBlueprint: artBlueprintSummary(artBlueprint, skinKit.kind),
    expected: {
      artboard: selectedProfile.size,
      stateSheet: stateSheetLayout.size,
      stateSheetRequired,
      materials: {
        minimumWidth: 152,
        minimumHeight: 304
      }
    },
    sources: {
      chassis: sourceSummary(sources.chassis, selectedProfile.size),
      widgets: sourceSummary(sources.widgets, selectedProfile.size),
      stateSheet: sourceSummary(sources.stateSheet, stateSheetLayout.size, { optional: !stateSheetRequired }),
      materials: sourceSummary(sources.materials, { width: 152, height: 304 }, { minimum: true })
    },
    metrics
  };
}

function artBlueprintSummary(blueprint, profileName) {
  return {
    version: blueprint.version,
    name: blueprint.name,
    targetProfile: blueprint.targetProfile,
    appliesDirectly: profileName === blueprint.targetProfile,
    intent: blueprint.intent,
    visualTarget: blueprint.visualTarget,
    sourceFiles: Object.keys(blueprint.sourceFiles ?? {}),
    widgetFamilies: (blueprint.widgetFamilies ?? []).map((family) => ({
      id: family.id,
      assets: family.assets ?? [],
      states: family.states ?? []
    })),
    forbiddenDynamicContent: blueprint.forbiddenDynamicContent ?? [],
    qualityGates: blueprint.qualityGates ?? [],
    manualReviewRequired: true
  };
}

function sourceSummary(source, expected, options = {}) {
  return {
    present: Boolean(source),
    path: source ? relativePath(source.path) : null,
    width: source?.width ?? null,
    height: source?.height ?? null,
    expectedWidth: expected.width,
    expectedHeight: expected.height,
    optional: Boolean(options.optional),
    minimum: Boolean(options.minimum)
  };
}

function stat(label, value) {
  return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function checklist(issues, warnings) {
  const issueItems = issues.map((issue) => `<li class="bad">${escapeHtml(issue)}</li>`);
  const warningItems = warnings.map((warning) => `<li class="warn">${escapeHtml(warning)}</li>`);
  const items = [...issueItems, ...warningItems];
  const content = items.length > 0
    ? items.join('\n')
    : '<li class="good">Geometry and measured source-art preflight look aligned. Manual art-quality review is still required.</li>';

  return `<section class="checklist"><h2>Preflight</h2><ul>${content}</ul></section>`;
}

function artBlueprintPanel(blueprint, skinKit) {
  const sourceFiles = Object.entries(blueprint.sourceFiles ?? {})
    .map(([fileName, source]) => `
      <article>
        <h3>${escapeHtml(fileName)}</h3>
        <p>${escapeHtml(source.purpose)}</p>
      </article>
    `)
    .join('\n');
  const widgetFamilies = (blueprint.widgetFamilies ?? [])
    .map((family) => `
      <article>
        <h3>${escapeHtml(titleFromId(family.id))}</h3>
        <p>${escapeHtml(family.shape)}; assets: ${escapeHtml((family.assets ?? []).join(', '))}${family.states?.length ? `; states: ${escapeHtml(family.states.join(', '))}` : ''}.</p>
      </article>
    `)
    .join('\n');
  const qualityGates = (blueprint.qualityGates ?? [])
    .map((gate) => `<li>${escapeHtml(gate)}</li>`)
    .join('\n');
  const forbidden = (blueprint.forbiddenDynamicContent ?? [])
    .map((item) => `<span>${escapeHtml(item)}</span>`)
    .join('\n');
  const applicability = skinKit.kind === blueprint.targetProfile
    ? `This review directly targets ${blueprint.targetProfile}.`
    : `This review uses ${skinKit.kind}; adapt the ${blueprint.targetProfile} blueprint without stretching or changing fixed widget names.`;

  return `
    <section class="panel blueprint">
      <h2>Premium Art Blueprint</h2>
      <p class="blueprint-target">${escapeHtml(blueprint.name)} ${escapeHtml(blueprint.version)}. ${escapeHtml(applicability)}</p>
      <p>${escapeHtml(blueprint.intent)}</p>
      <p><strong>Visual target:</strong> ${escapeHtml(blueprint.visualTarget)}</p>
      <h3>Source Responsibilities</h3>
      <div class="blueprint-grid">${sourceFiles}</div>
      <h3>Widget Families</h3>
      <div class="blueprint-grid">${widgetFamilies}</div>
      <h3>Manual Quality Gates</h3>
      <ul>${qualityGates}</ul>
      <h3>Forbidden Dynamic Content</h3>
      <div class="chips">${forbidden}</div>
    </section>
  `;
}

function sourcePanel(title, source, expectedSize, layers, options = {}) {
  const image = source
    ? `<img src="${source.dataUri}" alt="${escapeHtml(title)}">`
    : `<div class="missing">${options.optional ? `Optional ${escapeHtml(title)} not present` : `Missing ${escapeHtml(title)}`}</div>`;
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

function metricsPanel(metrics) {
  const liveRows = metrics.liveRegions.length > 0
    ? metrics.liveRegions.map((metric) => `
      <tr class="${metric.warning ? 'warn-row' : ''}">
        <td>${escapeHtml(metric.name)}</td>
        <td>${formatNumber(metric.contrast, 4)}</td>
        <td>${formatNumber(metric.edgeMean, 4)}</td>
        <td>${formatNumber(metric.uniqueColors, 0)}</td>
      </tr>
    `).join('\n')
    : '<tr><td colspan="4">No chassis live-region metrics available.</td></tr>';
  const widgetRows = metrics.widgetCrops.length > 0
    ? metrics.widgetCrops.map((metric) => `
      <tr class="${metric.warning ? 'warn-row' : ''}">
        <td>${escapeHtml(metric.name)}</td>
        <td>${formatPercent(metric.alphaMean)}</td>
        <td>${formatNumber(metric.contrast, 4)}</td>
        <td>${formatNumber(metric.edgeMean, 4)}</td>
      </tr>
    `).join('\n')
    : '<tr><td colspan="4">No widget crop metrics available.</td></tr>';
  const materialRows = metrics.materials.length > 0
    ? metrics.materials.map((metric) => `
      <tr class="${metric.warning ? 'warn-row' : ''}">
        <td>${escapeHtml(metric.name)}</td>
        <td>${formatNumber(metric.horizontalSeam, 4)}</td>
        <td>${formatNumber(metric.verticalSeam, 4)}</td>
        <td>${formatNumber(metric.contrast, 4)}</td>
      </tr>
    `).join('\n')
    : '<tr><td colspan="4">No material metrics available.</td></tr>';
  const stateSheetRows = metrics.stateSheetCrops.length > 0
    ? metrics.stateSheetCrops.map((metric) => `
      <tr class="${metric.warning ? 'warn-row' : ''}">
        <td>${escapeHtml(metric.name)}</td>
        <td>${formatPercent(metric.alphaMean)}</td>
        <td>${formatNumber(metric.contrast, 4)}</td>
        <td>${formatNumber(metric.edgeMean, 4)}</td>
      </tr>
    `).join('\n')
    : '<tr><td colspan="4">No source-owned state-sheet metrics available.</td></tr>';
  const stateDeltaRows = metrics.stateDeltas.length > 0
    ? metrics.stateDeltas.map((metric) => `
      <tr class="${metric.warning ? 'warn-row' : ''}">
        <td>${escapeHtml(metric.name)}</td>
        <td>${escapeHtml(metric.baseState)}</td>
        <td>${escapeHtml(metric.state)}</td>
        <td>${formatNumber(metric.delta, 4)}</td>
      </tr>
    `).join('\n')
    : '<tr><td colspan="4">No authored state delta metrics available.</td></tr>';
  const sourceCoherenceRows = metrics.sourceCoherence.length > 0
    ? metrics.sourceCoherence.map((metric) => `
      <tr class="${metric.warning ? 'warn-row' : ''}">
        <td>${escapeHtml(metric.left)}</td>
        <td>${escapeHtml(metric.right)}</td>
        <td>${formatNumber(metric.distance, 4)}</td>
        <td>${formatNumber(metric.threshold, 4)}</td>
      </tr>
    `).join('\n')
    : '<tr><td colspan="4">No complete source-file coherence metrics available.</td></tr>';

  return `
    <section class="panel metrics">
      <h2>Measured Preflight</h2>
      <p>These signals are review aids. They catch likely baked content, empty widget crops, and repeat-unsafe materials before a source pack is promoted.</p>
      <h3>Chassis Live Regions</h3>
      <table>
        <thead><tr><th>Region</th><th>Contrast</th><th>Edge Mean</th><th>Colors</th></tr></thead>
        <tbody>${liveRows}</tbody>
      </table>
      <h3>Widget Crops</h3>
      <table>
        <thead><tr><th>Crop</th><th>Alpha</th><th>Contrast</th><th>Edge Mean</th></tr></thead>
        <tbody>${widgetRows}</tbody>
      </table>
      <h3>State Sheet Crops</h3>
      <table>
        <thead><tr><th>State Crop</th><th>Alpha</th><th>Contrast</th><th>Edge Mean</th></tr></thead>
        <tbody>${stateSheetRows}</tbody>
      </table>
      <h3>Authored State Difference</h3>
      <table>
        <thead><tr><th>Widget</th><th>Base</th><th>State</th><th>Visual Delta</th></tr></thead>
        <tbody>${stateDeltaRows}</tbody>
      </table>
      <h3>Material Tile Seams</h3>
      <table>
        <thead><tr><th>Material</th><th>Left/Right</th><th>Top/Bottom</th><th>Contrast</th></tr></thead>
        <tbody>${materialRows}</tbody>
      </table>
      <h3>Source File Coherence</h3>
      <table>
        <thead><tr><th>Left</th><th>Right</th><th>Distance</th><th>Warning Floor</th></tr></thead>
        <tbody>${sourceCoherenceRows}</tbody>
      </table>
    </section>
  `;
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

function stateSheetRectMap(selectedProfile) {
  return Object.fromEntries(
    stateSheetCropsForProfile(selectedProfile).map((crop) => [`${crop.id}.${crop.state}`, crop.rect])
  );
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
  const stateSheetLayout = buildStateSheetLayout(selectedProfile);
  const buildUsesStateSheet = (skinKit.build?.crops ?? []).some((crop) => path.basename(crop.source ?? '') === stateSheetSourceFile);

  if (sourcePackRequiresStateSheet(skinKit) && !buildUsesStateSheet) {
    issues.push(
      `Promoted source packs with role="${skinKit.meta?.role}" must crop button, toggle, status, and LED states from ${stateSheetSourceFile}.`
    );
  }

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

  if (buildUsesStateSheet || sourcePackRequiresStateSheet(skinKit) || sources.stateSheet) {
    if (!sources.stateSheet) {
      issues.push(`Missing ${stateSheetSourceFile}`);
    } else if (
      sources.stateSheet.width !== stateSheetLayout.size.width ||
      sources.stateSheet.height !== stateSheetLayout.size.height
    ) {
      issues.push(
        `${stateSheetSourceFile} is ${sources.stateSheet.width}x${sources.stateSheet.height}; ` +
        `expected ${stateSheetLayout.size.width}x${stateSheetLayout.size.height}`
      );
    }
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

function sourcePackRequiresStateSheet(skinKit) {
  return new Set(['default', 'variant']).has(skinKit.meta?.role);
}

async function reviewMetrics(sources, selectedProfile) {
  const liveRegions = sources.chassis
    ? await Promise.all(Object.entries(selectedProfile.regions)
        .map(async ([name, rect]) => {
          const metrics = await imageCropMetrics(sources.chassis.path, insetRect(rect, 8));
          return {
            name,
            ...metrics,
            warning: liveRegionLooksBusy(name, metrics)
          };
        }))
    : [];
  const widgetRects = {
    ...selectedProfile.layout.buttons,
    ...selectedProfile.layout.indicators
  };
  const widgetCrops = sources.widgets
    ? await Promise.all(Object.entries(widgetRects)
        .map(async ([name, rect]) => {
          const metrics = await imageCropMetrics(sources.widgets.path, rect);
          return {
            name,
            ...metrics,
            warning: widgetCropLooksWeak(metrics)
          };
        }))
    : [];
  const materials = sources.materials
    ? await Promise.all(Object.entries(selectedProfile.materials)
        .flatMap(([name, material], index) => [
          materialMetric(sources.materials.path, `${name}.fill`, {
            x: 0,
            y: index * 104,
            width: material.fill.width,
            height: material.fill.height
          }),
          materialMetric(sources.materials.path, `${name}.frame`, {
            x: 104,
            y: index * 104,
            width: material.frame.width,
            height: material.frame.height
          })
        ]))
    : [];
  const stateSheetCrops = sources.stateSheet
    ? await Promise.all(stateSheetCropsForProfile(selectedProfile)
        .map(async (crop) => {
          const metrics = await imageCropMetrics(sources.stateSheet.path, crop.rect);
          return {
            name: `${crop.id}.${crop.state}`,
            ...metrics,
            warning: widgetCropLooksWeak(metrics)
          };
        }))
    : [];
  const stateDeltas = sources.stateSheet
    ? await stateDifferenceMetrics(sources.stateSheet.path, selectedProfile)
    : [];
  const sourceCoherence = await sourceCoherenceMetrics(sources);

  return { liveRegions, widgetCrops, stateSheetCrops, stateDeltas, materials, sourceCoherence };
}

function reviewWarnings(metrics) {
  const warnings = [];
  for (const metric of metrics.liveRegions.filter((entry) => entry.warning)) {
    warnings.push(
      `Live region ${metric.name} looks visually busy; inspect for baked text, map tiles, item icons, or decorative detail crossing Phaser slots.`
    );
  }
  for (const metric of metrics.widgetCrops.filter((entry) => entry.warning)) {
    warnings.push(
      `Widget crop ${metric.name} may be too empty or too flat; inspect before deriving button/indicator states.`
    );
  }
  for (const metric of metrics.stateSheetCrops.filter((entry) => entry.warning)) {
    warnings.push(
      `State-sheet crop ${metric.name} may be too empty or too flat; inspect the authored state before build.`
    );
  }
  for (const metric of metrics.stateDeltas.filter((entry) => entry.warning)) {
    warnings.push(
      `State-sheet ${metric.name}.${metric.state} is too close to ${metric.baseState}; inspect before promoting collapsed button or indicator states.`
    );
  }
  for (const metric of metrics.materials.filter((entry) => entry.warning)) {
    warnings.push(
      `Material crop ${metric.name} has high opposite-edge seam delta; inspect tile/nine-slice repeat safety.`
    );
  }
  for (const metric of metrics.sourceCoherence.filter((entry) => entry.warning)) {
    warnings.push(
      `${metric.left} and ${metric.right} look visually disconnected ` +
      `(signature distance ${metric.distance.toFixed(4)} > ${metric.threshold.toFixed(4)}); ` +
      'inspect whether the split source files still read as one manufactured skin.'
    );
  }
  return warnings;
}

async function sourceCoherenceMetrics(sources) {
  const entries = [
    ['source-chassis.png', sources.chassis],
    ['source-widgets.png', sources.widgets],
    [stateSheetSourceFile, sources.stateSheet],
    ['source-materials.png', sources.materials]
  ].filter(([, source]) => source);
  const signatures = new Map(
    await Promise.all(entries.map(async ([name, source]) => [
      name,
      await imageSignature(source.path, { size: 12 })
    ]))
  );
  const metrics = [];

  for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
      const left = entries[leftIndex][0];
      const right = entries[rightIndex][0];
      const distance = signatureDistance(signatures.get(left), signatures.get(right));
      const threshold = sourceCoherenceThreshold(left, right);
      metrics.push({
        left,
        right,
        distance,
        threshold,
        warning: Number.isFinite(distance) && distance > threshold
      });
    }
  }

  return metrics;
}

function sourceCoherenceThreshold(left, right) {
  if (left === 'source-materials.png' || right === 'source-materials.png') {
    return 0.18;
  }
  return 0.14;
}

async function stateDifferenceMetrics(imagePath, selectedProfile) {
  const layout = buildStateSheetLayout(selectedProfile);
  const rows = layout.sections.flatMap((section) => section.rows);
  const metrics = [];

  for (const row of rows) {
    const baseState = baseStateForRow(row);
    const baseRect = row.slots[baseState];
    if (!baseRect) {
      continue;
    }

    const basePixels = await imageCropRgbBuffer(imagePath, baseRect);
    for (const state of row.states) {
      if (state === baseState) {
        continue;
      }
      const rect = row.slots[state];
      const statePixels = await imageCropRgbBuffer(imagePath, rect);
      const delta = meanPixelDelta(basePixels, statePixels);
      metrics.push({
        name: row.id,
        baseState,
        state,
        delta,
        warning: delta < stateDeltaFloor(state)
      });
    }
  }

  return metrics;
}

function baseStateForRow(row) {
  if (row.states.includes('idle')) {
    return 'idle';
  }
  if (row.states.includes('ready')) {
    return 'ready';
  }
  if (row.states.includes('off')) {
    return 'off';
  }
  return row.states[0];
}

function stateDeltaFloor(state) {
  if (state === 'hover') {
    return 0.006;
  }
  return 0.012;
}

async function materialMetric(imagePath, name, rect) {
  const [metrics, horizontalSeam, verticalSeam] = await Promise.all([
    imageCropMetrics(imagePath, rect),
    edgeDelta(imagePath, rect, 'horizontal'),
    edgeDelta(imagePath, rect, 'vertical')
  ]);
  return {
    name,
    ...metrics,
    horizontalSeam,
    verticalSeam,
    warning: horizontalSeam > 0.16 || verticalSeam > 0.16
  };
}

async function imageCropMetrics(imagePath, rect) {
  const crop = cropArg(rect);
  const [basic, edgeMean, alphaMean, uniqueColors] = await Promise.all([
    magick([
      imagePath,
      '-crop',
      crop,
      '+repage',
      '-colorspace',
      'sRGB',
      '-format',
      '%[fx:mean] %[fx:standard_deviation]',
      'info:'
    ]),
    magick([
      imagePath,
      '-crop',
      crop,
      '+repage',
      '-alpha',
      'remove',
      '-colorspace',
      'Gray',
      '-edge',
      '1',
      '-format',
      '%[fx:mean]',
      'info:'
    ]),
    magick([
      imagePath,
      '-crop',
      crop,
      '+repage',
      '-alpha',
      'extract',
      '-format',
      '%[fx:mean]',
      'info:'
    ]),
    magick([
      imagePath,
      '-crop',
      crop,
      '+repage',
      '-format',
      '%k',
      'info:'
    ])
  ]);
  const [mean, contrast] = basic.trim().split(/\s+/).map(Number);
  return {
    mean,
    contrast,
    edgeMean: Number(edgeMean.trim()),
    alphaMean: Number(alphaMean.trim()),
    uniqueColors: Number(uniqueColors.trim())
  };
}

async function imageCropRgbBuffer(imagePath, rect) {
  return magickBuffer([
    imagePath,
    '-crop',
    cropArg(rect),
    '+repage',
    '-background',
    '#000000',
    '-alpha',
    'background',
    '-alpha',
    'off',
    '-resize',
    '24x24!',
    '-depth',
    '8',
    'RGB:-'
  ]);
}

async function imageSignature(imagePath, options = {}) {
  const size = options.size ?? 12;
  const output = await magick([
    imagePath,
    '-alpha',
    'off',
    '-resize',
    `${size}x${size}!`,
    '-colorspace',
    'sRGB',
    '-depth',
    '8',
    'txt:-'
  ]);

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

function meanPixelDelta(first, second) {
  const length = Math.min(first.length, second.length);
  if (length === 0) {
    return 0;
  }
  let total = 0;
  for (let index = 0; index < length; index += 1) {
    total += Math.abs(first[index] - second[index]) / 255;
  }
  return total / length;
}

async function edgeDelta(imagePath, rect, axis) {
  const first = axis === 'horizontal'
    ? { x: rect.x, y: rect.y, width: 1, height: rect.height }
    : { x: rect.x, y: rect.y, width: rect.width, height: 1 };
  const second = axis === 'horizontal'
    ? { x: rect.x + rect.width - 1, y: rect.y, width: 1, height: rect.height }
    : { x: rect.x, y: rect.y + rect.height - 1, width: rect.width, height: 1 };
  const [firstMean, secondMean] = await Promise.all([
    imageMeanRgb(imagePath, first),
    imageMeanRgb(imagePath, second)
  ]);
  return Math.sqrt(
    firstMean.reduce((total, value, index) => {
      const delta = value - secondMean[index];
      return total + delta * delta;
    }, 0) / firstMean.length
  );
}

async function imageMeanRgb(imagePath, rect) {
  const output = await magick([
    imagePath,
    '-crop',
    cropArg(rect),
    '+repage',
    '-alpha',
    'remove',
    '-colorspace',
    'sRGB',
    '-resize',
    '1x1!',
    '-depth',
    '8',
    'txt:-'
  ]);
  const match = output.match(/\((\d+(?:\.\d+)?),(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)\)/);
  if (!match) {
    return [0, 0, 0];
  }
  return [
    Number(match[1]) / 255,
    Number(match[2]) / 255,
    Number(match[3]) / 255
  ];
}

async function magick(args) {
  try {
    const { stdout } = await execFileAsync('magick', args, {
      maxBuffer: 4 * 1024 * 1024
    });
    return stdout;
  } catch (error) {
    throw new Error(`ImageMagick failed for ${args.join(' ')}: ${error.message}`);
  }
}

async function magickBuffer(args) {
  try {
    const { stdout } = await execFileAsync('magick', args, {
      encoding: 'buffer',
      maxBuffer: 4 * 1024 * 1024
    });
    return stdout;
  } catch (error) {
    throw new Error(`ImageMagick failed for ${args.join(' ')}: ${error.message}`);
  }
}

function liveRegionLooksBusy(name, metrics) {
  const lenientRegions = new Set(['map', 'controls', 'endState']);
  const edgeFloor = lenientRegions.has(name) ? 0.055 : 0.042;
  const colorFloor = lenientRegions.has(name) ? 520 : 340;
  return metrics.edgeMean > edgeFloor || metrics.uniqueColors > colorFloor;
}

function widgetCropLooksWeak(metrics) {
  return metrics.alphaMean < 0.06 || metrics.contrast < 0.018;
}

function insetRect(rect, inset) {
  const safeInset = Math.min(inset, Math.floor(rect.width / 3), Math.floor(rect.height / 3));
  return {
    x: rect.x + safeInset,
    y: rect.y + safeInset,
    width: rect.width - safeInset * 2,
    height: rect.height - safeInset * 2
  };
}

function cropArg(rect) {
  return `${rect.width}x${rect.height}+${rect.x}+${rect.y}`;
}

function formatNumber(value, digits) {
  if (!Number.isFinite(value)) {
    return 'n/a';
  }
  const normalized = Math.abs(value) < 0.00005 ? 0 : value;
  return normalized.toFixed(digits);
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${Math.round(value * 100)}%` : 'n/a';
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
    path: filePath,
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

function jsonReviewPath(optionValue, htmlOutputPath) {
  if (optionValue === undefined) {
    return null;
  }

  if (optionValue === 'true') {
    return path.join(path.dirname(htmlOutputPath), 'review.json');
  }

  return path.resolve(rootDir, optionValue);
}

function shouldFailReview(options, report) {
  const failOnWarning = options['fail-on-warning'] === 'true';
  const failOnIssue = failOnWarning || options['fail-on-issue'] === 'true';

  if (failOnIssue && report.issueCount > 0) {
    console.error(`Source review found ${report.issueCount} issue${report.issueCount === 1 ? '' : 's'}.`);
    return true;
  }

  if (failOnWarning && report.warningCount > 0) {
    console.error(`Source review found ${report.warningCount} warning${report.warningCount === 1 ? '' : 's'}.`);
    return true;
  }

  return false;
}

function titleFromId(id) {
  return String(id ?? '')
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
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
    .warn { color: #ffd460; }
    .metrics h3 { margin: 18px 0 8px; color: #d7f7ef; font-size: 14px; }
    .blueprint { border-color: #335057; background: linear-gradient(180deg, #10191a, #090f10); }
    .blueprint h3 { margin: 18px 0 8px; color: #8de7ff; font-size: 13px; text-transform: uppercase; }
    .blueprint-target { color: #d7fff2; font-weight: 800; }
    .blueprint-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; }
    .blueprint article { border: 1px solid #203637; background: #071011; border-radius: 7px; padding: 10px; }
    .blueprint article h3 { margin-top: 0; }
    .blueprint ul { margin: 0; padding-left: 20px; color: #c8d8d5; }
    .blueprint li { margin: 5px 0; }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .chips span { border: 1px solid #2b4d4f; border-radius: 999px; background: #0d1718; padding: 5px 8px; color: #cfe6e2; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 12px; overflow: hidden; border: 1px solid #26393a; border-radius: 6px; }
    th, td { padding: 7px 9px; border-bottom: 1px solid #1b2a2b; text-align: left; font-size: 12px; }
    th { color: #8de7ff; background: #101819; font-size: 11px; text-transform: uppercase; }
    tr:last-child td { border-bottom: 0; }
    .warn-row td { color: #ffd460; background: rgba(255, 212, 96, 0.06); }
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
    '  --out <path>         Write review HTML. Defaults to ../_artifacts/skin-reviews/<skin-id>/index.html.',
    '  --json [path]        Write machine-readable review JSON. Defaults to review.json beside the HTML.',
    '  --fail-on-issue      Exit nonzero if geometry/source issues are present.',
    '  --fail-on-warning    Exit nonzero if issues or warning-level quality signals are present.'
  ].join('\n'));
}
