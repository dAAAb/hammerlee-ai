import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist');
const client = path.join(output, 'client');
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

await fs.rm(output, { recursive: true, force: true });
await build({ root, configFile: path.join(root, 'vite.config.js') });

const assets = {};
async function addAsset(filename, route) {
  const bytes = await fs.readFile(filename);
  assets[route] = {
    base64: bytes.toString('base64'),
    type: types[path.extname(filename)] || 'application/octet-stream',
    etag: `"${createHash('sha256').update(bytes).digest('hex').slice(0, 32)}"`,
    cacheControl: /^\/assets\/.*-[A-Za-z0-9_-]{8,}\.(?:js|css)$/.test(route)
      ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate',
  };
}
async function walk(directory) {
  for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(filename);
    else if (entry.isFile()) await addAsset(filename, '/' + path.relative(client, filename).split(path.sep).join('/'));
    else throw new Error(`Build assets must be regular files: ${filename}`);
  }
}
await walk(client);
await addAsset(path.join(root, 'server/assets/og-fallback.png'), '/og/default.png');

// The Sites Worker-ESM contract is a self-contained dist/server/index.js.
// Raster images and the Vite output are embedded, with no external asset binding.
await build({
  root, configFile: false, publicDir: false,
  plugins: [{
    name: 'embedded-client-assets',
    resolveId(id) { if (id === 'virtual:client-assets') return '\0embedded-client-assets'; },
    load(id) { if (id === '\0embedded-client-assets') return `export default Object.freeze(${JSON.stringify(assets)});`; },
  }],
  build: {
    ssr: path.join(root, 'server/index.js'), outDir: path.join(output, 'server'), emptyOutDir: true,
    minify: 'esbuild', sourcemap: false,
    rollupOptions: { output: { format: 'es', entryFileNames: 'index.js', inlineDynamicImports: true } },
  },
});

const sourceManifest = path.join(root, '.openai/hosting.json');
try {
  const manifest = await fs.readFile(sourceManifest, 'utf8');
  if (JSON.parse(manifest).static != null) throw new Error('Worker builds require the source hosting manifest to omit static.');
  await fs.mkdir(path.join(output, '.openai'), { recursive: true });
  await fs.writeFile(path.join(output, '.openai/hosting.json'), manifest);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  console.log('No Site identity configured yet; local Worker build is ready.');
}

const source = await fs.readFile(path.join(output, 'server/index.js'), 'utf8');
const runtime = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
if (typeof runtime.default?.fetch !== 'function') throw new Error('Built Worker must export default.fetch.');
const homepage = await runtime.default.fetch(new Request('https://hammerlee.ai/'), {});
if (homepage.status !== 200 || !(await homepage.text()).includes('rel="canonical"')) throw new Error('Built homepage validation failed.');
console.log(JSON.stringify({ worker: 'dist/server/index.js', embeddedAssets: Object.keys(assets).length, bytes: Buffer.byteLength(source), gzipBytes: gzipSync(source).byteLength }));
