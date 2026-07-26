import { copyFile, mkdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const dist = resolve(root, 'dist');
const source = resolve(root, 'wallpaper/project.json');
const destination = resolve(dist, 'project.json');
const previewSource = resolve(root, 'wallpaper/preview.png');
const previewDestination = resolve(dist, 'preview.png');

try {
  await stat(resolve(dist, 'index.html'));
} catch {
  throw new Error('dist/index.html was not found. Run the Vite production build before packaging Wallpaper Engine assets.');
}

await mkdir(dist, { recursive: true });
await copyFile(source, destination);
await copyFile(previewSource, previewDestination);
console.log(`Wallpaper Engine assets copied to ${dist}`);
