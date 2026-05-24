export const stateSheetSourceFile = 'source-state-sheet.png';

const margin = 16;
const titleHeight = 36;
const sectionHeaderHeight = 22;
const columnHeaderHeight = 18;
const labelWidth = 116;
const columnGap = 10;
const rowGap = 10;
const sectionGap = 18;
const bottomPadding = 18;

export function buildStateSheetLayout(profile) {
  const sections = [
    buildSection(profile, {
      id: 'primary-controls',
      title: 'Primary Controls',
      rowIds: ['attack', 'run', 'restart'],
      states: profile.requiredStates.buttons
    }),
    buildSection(profile, {
      id: 'directional-controls',
      title: 'Directional Controls',
      rowIds: ['moveN', 'moveE', 'moveS', 'moveW'],
      states: profile.requiredStates.buttons
    }),
    buildSection(profile, {
      id: 'drawer-toggles',
      title: 'Drawer Toggles',
      rowIds: profile.requiredStates.toggleButtons ?? [],
      states: profile.requiredStates.toggleButtonStates ?? profile.requiredStates.buttons
    }),
    buildSection(profile, {
      id: 'status-indicators',
      title: 'Status Indicators',
      rows: [
        {
          id: 'status',
          label: 'status',
          prefix: 'status',
          rect: profile.layout.indicators.status,
          states: profile.requiredStates.status,
          assetPathForState: (state) => `status-${state}.png`
        },
        {
          id: 'combatLed',
          label: 'combatLed',
          prefix: 'led',
          rect: profile.layout.indicators.combatLed,
          states: combatLedStates(profile.requiredStates.combatLedFiles),
          assetPathForState: (state) => `led-${state}.png`
        }
      ]
    })
  ].filter((section) => section.rows.length > 0);

  let y = titleHeight;
  let width = 0;
  for (const section of sections) {
    layoutSection(section, y);
    y += section.height + sectionGap;
    width = Math.max(width, section.width);
  }

  return {
    source: stateSheetSourceFile,
    size: {
      width,
      height: y - sectionGap + bottomPadding
    },
    sections
  };
}

export function stateSheetCropsForProfile(profile) {
  const layout = buildStateSheetLayout(profile);
  return layout.sections.flatMap((section) =>
    section.rows.flatMap((row) =>
      row.states.map((state) => ({
        id: row.id,
        state,
        path: row.assetPathForState(state),
        source: layout.source,
        rect: row.slots[state],
        alphaRadius: alphaRadiusForRow(row.id)
      }))
    )
  );
}

export function buttonPrefix(name) {
  return {
    moveN: 'dpad-n',
    moveS: 'dpad-s',
    moveE: 'dpad-e',
    moveW: 'dpad-w'
  }[name] ?? name;
}

function buildSection(profile, config) {
  const rows = config.rows ?? config.rowIds.map((id) => buttonRow(profile, id, config.states));
  if (rows.length === 0) {
    return {
      id: config.id,
      title: config.title,
      x: margin,
      y: 0,
      width: 0,
      height: 0,
      labelWidth,
      columnWidth: 0,
      rowHeight: 0,
      states: config.states,
      rows
    };
  }
  const maxSlotWidth = Math.max(...rows.map((row) => row.rect.width));
  const stateCount = Math.max(...rows.map((row) => row.states.length));
  const maxRowHeight = Math.max(...rows.map((row) => row.rect.height));
  const width = margin * 2 + labelWidth + stateCount * maxSlotWidth + (stateCount - 1) * columnGap;
  const height = sectionHeaderHeight + columnHeaderHeight + rows.length * maxRowHeight + (rows.length - 1) * rowGap;

  return {
    id: config.id,
    title: config.title,
    x: margin,
    y: 0,
    width,
    height,
    labelWidth,
    columnWidth: maxSlotWidth,
    rowHeight: maxRowHeight,
    states: config.states,
    rows
  };
}

function layoutSection(section, y) {
  section.y = y;
  const tableTop = section.y + sectionHeaderHeight + columnHeaderHeight;
  const columnStart = margin + labelWidth;

  for (const [rowIndex, row] of section.rows.entries()) {
    const rowY = tableTop + rowIndex * (section.rowHeight + rowGap);
    row.y = rowY;
    row.slots = {};

    for (const [stateIndex, state] of row.states.entries()) {
      const x = columnStart + stateIndex * (section.columnWidth + columnGap);
      row.slots[state] = {
        x: x + Math.floor((section.columnWidth - row.rect.width) / 2),
        y: rowY + Math.floor((section.rowHeight - row.rect.height) / 2),
        width: row.rect.width,
        height: row.rect.height
      };
    }
  }
}

function buttonRow(profile, id, states) {
  const rect = profile.layout.buttons[id];
  const prefix = buttonPrefix(id);
  return {
    id,
    label: id,
    prefix,
    rect,
    states,
    assetPathForState: (state) => `${prefix}-${state}.png`
  };
}

function combatLedStates(files) {
  const states = (files ?? [])
    .map((file) => /^led-(.+)\.png$/.exec(file)?.[1])
    .filter(Boolean);
  return states.includes('off') && states.includes('on') ? ['off', 'on'] : states;
}

function alphaRadiusForRow(id) {
  if (id === 'log' || id === 'inventory' || id === 'status') {
    return 6;
  }

  if (id === 'combatLed') {
    return 9;
  }

  if (id.startsWith('move')) {
    return 10;
  }

  return 12;
}
