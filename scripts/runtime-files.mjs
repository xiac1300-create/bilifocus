import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
// An allowlist keeps archives, exports and development material out of the store ZIP.
export const runtimeFiles = [
  'manifest.json', 'background.js', 'logic.js', 'records.js',
  'content.js', 'content.css', 'blocked.html', 'blocked.js',
  'gate.html', 'gate.js', 'library.html', 'options.html', 'options.js',
  'popup.html', 'popup.js', 'records-ui.js', 'ui-common.js', 'ui.css',
  'icons/16.png', 'icons/32.png', 'icons/48.png', 'icons/128.png',
  'LICENSE', 'PRIVACY.md'
].sort();
