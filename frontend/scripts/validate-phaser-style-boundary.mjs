import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(scriptDir, '..');
const srcDir = path.join(frontendDir, 'src');
const outputDir = path.resolve(frontendDir, '..', 'static', 'game2');
const manifestPath = path.join(outputDir, '.vite', 'manifest.json');

const sourceExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs'];
const legacyCssSources = new Set(['src/styles.css']);
const failures = [];

await validateMainCssBoundary();
await validatePhaserRendererSourceGraph();
await validateBuiltCssBoundary();

if (failures.length > 0) {
  console.error('Phaser style boundary validation failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log('Phaser style boundary OK: fixed-skin Phaser path is canvas-owned.');
}

async function validateMainCssBoundary() {
  const mainPath = path.join(srcDir, 'main.ts');
  const imports = await collectImports(mainPath);

  for (const entry of imports) {
    if (!isCssSpecifier(entry.specifier)) {
      continue;
    }

    if (entry.kind === 'static') {
      failures.push(`${formatSource(mainPath)} statically imports ${entry.specifier}; CSS must stay behind loadLegacyDomStyles()`);
    } else if (entry.functionName !== 'loadLegacyDomStyles') {
      failures.push(
        `${formatSource(mainPath)} dynamically imports ${entry.specifier} from ${entry.functionName ?? 'top level'}; ` +
        'CSS imports are only allowed inside loadLegacyDomStyles()'
      );
    }
  }
}

async function validatePhaserRendererSourceGraph() {
  const entryPath = path.join(srcDir, 'workbench', 'phaserFixedSkinWorkbench.ts');
  const visited = new Set();
  const stack = [entryPath];

  while (stack.length > 0) {
    const filePath = stack.pop();
    if (!filePath || visited.has(filePath)) {
      continue;
    }
    visited.add(filePath);

    const imports = await collectImports(filePath);
    for (const entry of imports) {
      if (isCssSpecifier(entry.specifier)) {
        failures.push(
          `${formatSource(filePath)} imports ${entry.specifier}; Phaser fixed-skin renderer must not depend on DOM stylesheets`
        );
        continue;
      }

      const nextPath = await resolveSourceImport(filePath, entry.specifier);
      if (nextPath && !visited.has(nextPath)) {
        stack.push(nextPath);
      }
    }
  }
}

async function validateBuiltCssBoundary() {
  const manifest = await readJson(manifestPath);
  const entry = manifest['index.html'];
  const manifestEntries = Object.values(manifest);
  const phaserEntry = manifestEntries.find((item) => item?.name === 'phaser-no-physics');

  if ((entry?.css ?? []).length > 0) {
    failures.push(`index.html has eager CSS in the Vite manifest: ${entry.css.join(', ')}`);
  }

  if ((phaserEntry?.css ?? []).length > 0) {
    failures.push(`phaser-no-physics chunk has CSS in the Vite manifest: ${phaserEntry.css.join(', ')}`);
  }

  for (const manifestEntry of manifestEntries) {
    const file = String(manifestEntry?.file ?? '');
    if (!file.endsWith('.css')) {
      continue;
    }

    const source = String(manifestEntry?.src ?? '');
    if (legacyCssSources.has(source) || isFontAwesomeLegacyCssSource(source)) {
      continue;
    }

    failures.push(`unexpected CSS asset in Vite manifest: ${source || file}`);
  }
}

async function collectImports(filePath) {
  const source = await fs.readFile(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, scriptKindFor(filePath));
  const imports = [];

  function walk(node, functionName = null) {
    const scopedFunctionName = functionNameForNode(node) ?? functionName;

    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      if (!node.importClause?.isTypeOnly) {
        imports.push({
          kind: 'static',
          specifier: node.moduleSpecifier.text,
          functionName: scopedFunctionName
        });
      }
    }

    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      if (!node.isTypeOnly) {
        imports.push({
          kind: 'static',
          specifier: node.moduleSpecifier.text,
          functionName: scopedFunctionName
        });
      }
    }

    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      imports.push({
        kind: 'dynamic',
        specifier: node.arguments[0].text,
        functionName: scopedFunctionName
      });
    }

    ts.forEachChild(node, (child) => walk(child, scopedFunctionName));
  }

  walk(sourceFile);
  return imports;
}

function functionNameForNode(node) {
  if (ts.isFunctionDeclaration(node) && node.name) {
    return node.name.text;
  }

  if ((ts.isFunctionExpression(node) || ts.isArrowFunction(node)) && ts.isVariableDeclaration(node.parent)) {
    const name = node.parent.name;
    if (ts.isIdentifier(name)) {
      return name.text;
    }
  }

  if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
    return node.name.text;
  }

  return null;
}

async function resolveSourceImport(fromPath, specifier) {
  if (!specifier.startsWith('.')) {
    return null;
  }

  const cleanSpecifier = stripImportQuery(specifier);
  const basePath = path.resolve(path.dirname(fromPath), cleanSpecifier);
  const extension = path.extname(basePath);

  if (extension && !sourceExtensions.includes(extension)) {
    return null;
  }

  if (extension) {
    return await existingPath(basePath);
  }

  for (const sourceExtension of sourceExtensions) {
    const candidate = await existingPath(`${basePath}${sourceExtension}`);
    if (candidate) {
      return candidate;
    }
  }

  for (const sourceExtension of sourceExtensions) {
    const candidate = await existingPath(path.join(basePath, `index${sourceExtension}`));
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

async function existingPath(candidate) {
  try {
    const stat = await fs.stat(candidate);
    return stat.isFile() ? candidate : null;
  } catch {
    return null;
  }
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    console.error(`Unable to read ${path.relative(frontendDir, filePath)}. Run pnpm build first.`);
    throw error;
  }
}

function isCssSpecifier(specifier) {
  return stripImportQuery(specifier).endsWith('.css');
}

function isFontAwesomeLegacyCssSource(source) {
  return source.includes('@fortawesome') &&
    source.includes('fontawesome-free') &&
    source.endsWith('/css/all.min.css');
}

function stripImportQuery(specifier) {
  return specifier.split('?')[0].split('#')[0];
}

function scriptKindFor(filePath) {
  if (filePath.endsWith('.tsx')) {
    return ts.ScriptKind.TSX;
  }
  if (filePath.endsWith('.jsx')) {
    return ts.ScriptKind.JSX;
  }
  if (filePath.endsWith('.js') || filePath.endsWith('.mjs')) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function formatSource(filePath) {
  return path.relative(frontendDir, filePath);
}
