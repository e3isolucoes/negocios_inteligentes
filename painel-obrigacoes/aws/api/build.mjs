import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('.', import.meta.url));
const outputDirectory = resolve(root, 'dist');
await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: false,
  minify: false,
  logLevel: 'info'
};
await Promise.all([
  build({ ...common, entryPoints: [resolve(root, 'src/handler.mjs')], outfile: resolve(root, 'dist/handler.js') }),
  build({ ...common, entryPoints: [resolve(root, 'src/notifications.mjs')], outfile: resolve(root, 'dist/notifications.js') })
]);
