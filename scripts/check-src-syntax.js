#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    console.error('[check-src-syntax]', dir, e.message);
    process.exit(1);
  }
  for (const ent of entries) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else if (ent.name.endsWith('.js')) out.push(p);
  }
  return out;
}

const root = path.join(__dirname, '..', 'src');
const files = walk(root);
if (!files.length) {
  console.error('[check-src-syntax] no .js files under', root);
  process.exit(1);
}
for (const f of files.sort()) {
  const r = spawnSync(process.execPath, ['--check', f], { stdio: 'inherit' });
  if (r.status) process.exit(r.status || 1);
}
console.log('[check-src-syntax]', files.length, 'files ok');
