import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import './check.mjs';
import { root, manifest, runtimeFiles } from './runtime-files.mjs';

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
const local = [], central = [];
let offset = 0;
for (const file of runtimeFiles) {
  const name = Buffer.from(file, 'utf8');
  const raw = fs.readFileSync(path.join(root, file));
  const packed = deflateRawSync(raw, { level: 9 });
  const crc = crc32(raw);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x800, 6);
  header.writeUInt16LE(8, 8);
  header.writeUInt16LE(33, 12); // 1980-01-01, deterministic ZIP date.
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(packed.length, 18);
  header.writeUInt32LE(raw.length, 22);
  header.writeUInt16LE(name.length, 26);
  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0);
  entry.writeUInt16LE(20, 4);
  entry.writeUInt16LE(20, 6);
  header.copy(entry, 8, 6, 28);
  entry.writeUInt32LE(offset, 42);
  local.push(header, name, packed);
  central.push(entry, name);
  offset += header.length + name.length + packed.length;
  if (!inflateRawSync(packed).equals(raw)) throw new Error(`ZIP verification failed: ${file}`);
}
const directory = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(runtimeFiles.length, 8);
end.writeUInt16LE(runtimeFiles.length, 10);
end.writeUInt32LE(directory.length, 12);
end.writeUInt32LE(offset, 16);
const zip = Buffer.concat([...local, directory, end]);
const out = path.join(root, 'dist');
fs.mkdirSync(out, { recursive: true });
const filename = `BiliFocus-v${manifest.version}-store.zip`;
fs.writeFileSync(path.join(out, filename), zip);
const digest = crypto.createHash('sha256').update(zip).digest('hex');
fs.writeFileSync(path.join(out, `${filename}.sha256`), `${digest}  ${filename}\n`);
console.log(`${filename}: ${runtimeFiles.length} files, ${zip.length} bytes\nSHA-256 ${digest}`);
