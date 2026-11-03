#!/usr/bin/env node
// NSP 3D i18n key-integrity check (ESM, zero hardcoded paths).
// Guards the KO/EN toggle: every key must exist in both languages, and every
// data-i18n / t('...') reference in live pages must resolve to a real key
// (t() renders the raw key name when both languages miss it).
// Run: node nsp3d/tests/verify-i18n.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STRINGS } from '../src/ui/i18n.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

// 1) ko/en key parity (top level + statuses sub-object).
for (const scope of [[STRINGS.ko, STRINGS.en, 'top'], [STRINGS.ko.statuses, STRINGS.en.statuses, 'statuses']]) {
  const [ko, en, name] = scope;
  const koKeys = Object.keys(ko).sort(), enKeys = Object.keys(en).sort();
  assert.deepEqual(koKeys, enKeys, `i18n ${name} scope: ko/en key mismatch (ko-only: ${koKeys.filter((k) => !enKeys.includes(k))}, en-only: ${enKeys.filter((k) => !koKeys.includes(k))})`);
}
const nKeys = Object.keys(STRINGS.ko).length;

// 2) every data-i18n="K" in live pages resolves in both languages.
const pages = ['index.html', ...fs.readdirSync(path.join(root, 'pages')).filter((f) => f.endsWith('.html')).map((f) => `pages/${f}`)];
const i18nAttr = /data-i18n="([A-Za-z0-9_]+)"/g;
// Standalone t('k') only: the lookbehind skips method tails like createElement('div').
const tCall = /(?<![A-Za-z0-9_$.])t\(\s*['"]([A-Za-z0-9_]+)['"]\s*\)/g;
const i18nImport = /from\s+['"][^'"]*i18n\.js['"]/;
const checked = { attr: 0, call: 0 };
const sources = [...pages.map((p) => path.join(root, p)), path.join(root, 'src/ui/app.js')];
for (const file of sources) {
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(i18nAttr)) {
    checked.attr++;
    assert.ok(STRINGS.ko[m[1]] !== undefined && STRINGS.en[m[1]] !== undefined,
      `${path.relative(root, file)}: data-i18n="${m[1]}" has no dictionary entry`);
  }
  if (!i18nImport.test(text)) continue; // legacy pages without the i18n import own no t() contract
  for (const m of text.matchAll(tCall)) {
    checked.call++;
    assert.ok(STRINGS.ko[m[1]] !== undefined && STRINGS.en[m[1]] !== undefined,
      `${path.relative(root, file)}: t('${m[1]}') has no dictionary entry`);
  }
}

console.log(JSON.stringify({ keysPerLang: nKeys, dataI18nRefs: checked.attr, tCallRefs: checked.call, pages }, null, 2));
