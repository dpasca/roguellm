import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(scriptDir, '..');

const checkedFiles = [
  'src/workbench/workbenchFixtures.ts',
  'src/workbench/phaserFixedSkinWorkbench.ts'
];

const forbiddenVisibleFragments = [
  'Skin Bench:',
  'Phaser fixed-skin pass',
  'Canvas-only skin pass',
  'Diagnostics:',
  'Status test:',
  'Defeat test:',
  'Victory test:',
  'Phaser-rendered',
  'workbench scenario',
  'button state check',
  'equipped row check',
  'glossy highlight check',
  'skin rule',
  'can be inspected'
];

const failures = [];

for (const relativePath of checkedFiles) {
  const filePath = path.join(frontendDir, relativePath);
  const source = await fs.readFile(filePath, 'utf8');

  for (const fragment of forbiddenVisibleFragments) {
    if (source.includes(fragment)) {
      failures.push(`${relativePath} contains developer-facing visible copy: "${fragment}"`);
    }
  }
}

if (failures.length > 0) {
  console.error('Workbench copy validation failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log('Workbench copy OK: visual bench fixture copy stays in-world.');
}
