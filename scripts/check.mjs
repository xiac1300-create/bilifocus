import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, manifest, runtimeFiles } from './runtime-files.mjs';

assert.equal(manifest.manifest_version, 3);
assert.match(manifest.version, /^\d+\.\d+\.\d+(?:\.\d+)?$/);
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.equal(pkg.version, manifest.version);
assert.equal(pkg.license, 'MIT');
for (const file of runtimeFiles) {
  assert(fs.statSync(path.join(root, file)).isFile(), `Missing file: ${file}`);
  if (file.endsWith('.js')) {
    const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
}
const references = [manifest.background.service_worker, manifest.options_page,
  manifest.action.default_popup, ...Object.values(manifest.icons),
  ...Object.values(manifest.action.default_icon),
  ...manifest.content_scripts.flatMap(c => [...(c.js || []), ...(c.css || [])]),
  ...manifest.web_accessible_resources.flatMap(r => r.resources)];
for (const html of runtimeFiles.filter(f => f.endsWith('.html'))) {
  const text = fs.readFileSync(path.join(root, html), 'utf8');
  for (const match of text.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    if (/^(?:https?:|#|data:)/.test(match[1])) continue;
    references.push(path.posix.join(path.posix.dirname(html), match[1]));
  }
}
for (const file of references) assert(runtimeFiles.includes(file), `Resource excluded from ZIP: ${file}`);
for (const size of [16, 32, 48, 128]) {
  const png = fs.readFileSync(path.join(root, `icons/${size}.png`));
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16), size);
  assert.equal(png.readUInt32BE(20), size);
}
assert(!runtimeFiles.some(f => /\.(?:zip|pem|crx|jsonl)$/i.test(f)));
console.log(`Checked MV3 manifest, ${runtimeFiles.length} packaged files, HTML resources, icons and JavaScript syntax.`);
