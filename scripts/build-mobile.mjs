import {
    cp,
    mkdir,
    readFile,
    rm,
    writeFile
} from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';


const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const outputDirectory = path.join(repositoryRoot, 'mobile-dist');
const staticDirectory = path.join(repositoryRoot, 'static');

const apiBaseUrl = (
    process.env.ROGUELLM_API_BASE_URL || 'https://roguellm.com'
).replace(/\/$/, '');
const publicWebUrl = (
    process.env.ROGUELLM_PUBLIC_WEB_URL || apiBaseUrl
).replace(/\/$/, '');
const appleEnvironment = (
    process.env.ROGUELLM_APPLE_ENVIRONMENT || 'production'
).trim().toLowerCase();

if (!apiBaseUrl.startsWith('https://')) {
    throw new Error('ROGUELLM_API_BASE_URL must use HTTPS');
}
if (!publicWebUrl.startsWith('https://')) {
    throw new Error('ROGUELLM_PUBLIC_WEB_URL must use HTTPS');
}
if (!['production', 'sandbox'].includes(appleEnvironment)) {
    throw new Error('ROGUELLM_APPLE_ENVIRONMENT must be production or sandbox');
}

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
await cp(staticDirectory, path.join(outputDirectory, 'static'), {
    recursive: true
});
for (const serverOnlyHtml of ['admin.html', 'game.html', 'index.html']) {
    await rm(path.join(outputDirectory, 'static', serverOnlyHtml), {
        force: true
    });
}

const copiedBaseCssPath = path.join(outputDirectory, 'static', 'css', 'base.css');
const copiedBaseCss = await readFile(copiedBaseCssPath, 'utf-8');
await writeFile(
    copiedBaseCssPath,
    copiedBaseCss.replace(/^@import url\([^\n]+\);\s*/, ''),
    'utf-8'
);

const poppinsSourceDirectory = path.join(
    repositoryRoot,
    'node_modules',
    '@fontsource',
    'poppins'
);
const poppinsOutputDirectory = path.join(outputDirectory, 'vendor', 'poppins');
await mkdir(path.join(poppinsOutputDirectory, 'files'), { recursive: true });
const poppinsCss = (
    await Promise.all(
        ['400', '600', '700'].map(weight => readFile(
            path.join(poppinsSourceDirectory, `${weight}.css`),
            'utf-8'
        ))
    )
).join('\n');
await writeFile(
    path.join(poppinsOutputDirectory, 'poppins.css'),
    poppinsCss,
    'utf-8'
);
const poppinsFiles = new Set(
    [...poppinsCss.matchAll(/\.\/files\/([^)\s'"]+)/g)]
        .map(match => match[1])
);
for (const fontFile of poppinsFiles) {
    await cp(
        path.join(poppinsSourceDirectory, 'files', fontFile),
        path.join(poppinsOutputDirectory, 'files', fontFile)
    );
}
await cp(
    path.join(poppinsSourceDirectory, 'LICENSE'),
    path.join(poppinsOutputDirectory, 'LICENSE.txt')
);

await mkdir(path.join(outputDirectory, 'vendor', 'fontawesome'), {
    recursive: true
});
await cp(
    path.join(repositoryRoot, 'node_modules', '@fortawesome', 'fontawesome-free', 'css'),
    path.join(outputDirectory, 'vendor', 'fontawesome', 'css'),
    { recursive: true }
);
await cp(
    path.join(repositoryRoot, 'node_modules', '@fortawesome', 'fontawesome-free', 'webfonts'),
    path.join(outputDirectory, 'vendor', 'fontawesome', 'webfonts'),
    { recursive: true }
);
await cp(
    path.join(repositoryRoot, 'node_modules', 'vue', 'dist', 'vue.global.prod.js'),
    path.join(outputDirectory, 'vendor', 'vue.global.prod.js')
);
await cp(
    path.join(
        repositoryRoot,
        'node_modules',
        'vue-i18n',
        'dist',
        'vue-i18n.global.prod.js'
    ),
    path.join(outputDirectory, 'vendor', 'vue-i18n.global.prod.js')
);

const configJson = JSON.stringify({
    apiBaseUrl,
    publicWebUrl,
    appleEnvironment
}).replace(/</g, '\\u003c');
await writeFile(
    path.join(outputDirectory, 'mobile-config.js'),
    `window.ROGUELLM_MOBILE_CONFIG = ${configJson};\n`,
    'utf-8'
);

await build({
    entryPoints: [path.join(repositoryRoot, 'mobile', 'mobile-bootstrap.js')],
    outfile: path.join(outputDirectory, 'mobile-bootstrap.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['safari15', 'chrome100'],
    minify: true,
    sourcemap: true
});

function transformHtml(html, isGamePage) {
    const runtimeScript = isGamePage
        ? '<script src="/static/js/platformRuntime.js"></script>'
        : '<script src="static/js/platformRuntime.js"></script>';
    return html
        .replace(
            runtimeScript,
            `${runtimeScript}\n    <script src="/mobile-config.js"></script>\n    <script src="/mobile-bootstrap.js"></script>`
        )
        .replace(
            'https://unpkg.com/vue@3/dist/vue.global.prod.js',
            '/vendor/vue.global.prod.js'
        )
        .replace(
            'https://unpkg.com/vue-i18n@9',
            '/vendor/vue-i18n.global.prod.js'
        )
        .replace(
            /https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/font-awesome\/[\d.]+\/css\/all\.min\.css/g,
            '/vendor/fontawesome/css/all.min.css'
        )
        .replace(
            /(<link rel="stylesheet" href="\/?static\/css\/base\.css">)/,
            '<link rel="stylesheet" href="/vendor/poppins/poppins.css">\n    $1'
        )
        .replace('{{ analytics_head | safe }}', '')
        .replace("<title>{{ t('title') }}</title>", '<title>RogueLLM</title>');
}

for (const htmlFile of ['index.html', 'game.html']) {
    const source = await readFile(path.join(staticDirectory, htmlFile), 'utf-8');
    const transformed = transformHtml(source, htmlFile === 'game.html');
    await writeFile(
        path.join(outputDirectory, htmlFile),
        transformed,
        'utf-8'
    );
}

console.log(`Built RogueLLM mobile shell for ${apiBaseUrl}`);
