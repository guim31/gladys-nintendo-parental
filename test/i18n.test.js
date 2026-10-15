// -----------------------------------------------------------------------------
// Every text Gladys shows exists in the four languages of its interface
// (English, French, German, Spanish): the manifest, the message tables of the
// code and the documentation. German says "du", never the polite "Sie";
// Spanish says "usted".
// -----------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LANGUAGES } from '../src/config.js';
import { FORMAT, MESSAGES, NAMES, TEXT, limitLabel } from '../src/i18n.js';
import { limitValues } from '../src/nintendo/model.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const LANGS = ['en', 'fr', 'de', 'es'];
const POLITE_GERMAN = /(?<!\p{L})(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres|Ihnen)(?!\p{L})/u;
// Spanish "tú" forms that would break the "usted" register of the texts.
const FAMILIAR_SPANISH = /(?<!\p{L})(tu|tus|tú|introduce|comprueba|elige|puedes|tienes)(?!\p{L})/iu;

// Upper bounds, in characters: what the Gladys interface shows without cutting.
const MAX = {
  catalog: 100,
  widgetLabel: 30,
  label: 60,
  placeholder: 60,
  description: 300,
  message: 200,
  short: 24,
  featureName: 40,
  status: 40,
};

const sorted = (keys) => [...keys].sort();

/** Checks one multi-language object; returns its problems. */
function problems(value, path, max) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [`${path} must be a multi-language object`];
  }
  const found = [];
  if (JSON.stringify(sorted(Object.keys(value))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${path} has [${Object.keys(value)}], expected exactly [${LANGS}]`);
  }
  for (const [lang, text] of Object.entries(value)) {
    found.push(...textProblems(text, `${path}.${lang}`, lang, max));
  }
  return found;
}

function textProblems(text, path, lang, max) {
  if (typeof text !== 'string' || text.trim() === '') {
    return [`${path} is empty`];
  }
  const found = [];
  if (text.length > max) {
    found.push(`${path} has ${text.length} characters (${max} at most)`);
  }
  if (lang === 'de' && POLITE_GERMAN.test(text)) {
    found.push(`${path} uses the polite form: "${text}"`);
  }
  if (lang === 'es' && FAMILIAR_SPANISH.test(text)) {
    found.push(`${path} uses "tú" instead of "usted": "${text}"`);
  }
  return found;
}

/** Every multi-language object of the manifest, with its length limit. */
function manifestTexts(root) {
  const texts = [];
  const walk = (value, path, key) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`, key));
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }
    const isText =
      ['label', 'description', 'placeholder'].includes(key) ||
      Object.keys(value).some((child) => LANGS.includes(child));
    if (isText) {
      // The store schema caps the catalog and widget descriptions, and widget labels.
      const max =
        path === 'manifest.description' || /^manifest\.widgets\[\d+\]\.description$/.test(path)
          ? MAX.catalog
          : /^manifest\.widgets\[\d+\]\.label$/.test(path)
            ? MAX.widgetLabel
            : (MAX[key] ?? MAX.label);
      texts.push({ path, value, max });
      return;
    }
    for (const [child, item] of Object.entries(value)) {
      walk(item, `${path}.${child}`, child);
    }
  };
  walk(root, 'manifest', null);
  return texts;
}

// Tables written one language at a time: same keys everywhere, no empty text.
function tableProblems(table, name, max, render = (value) => value) {
  const found = [];
  if (JSON.stringify(sorted(Object.keys(table))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${name} has [${Object.keys(table)}], expected exactly [${LANGS}]`);
  }
  for (const lang of LANGS) {
    const entries = table[lang] ?? {};
    if (
      JSON.stringify(sorted(Object.keys(entries))) !== JSON.stringify(sorted(Object.keys(table.en)))
    ) {
      found.push(`${name}.${lang} does not have the keys of ${name}.en`);
    }
    for (const [key, value] of Object.entries(entries)) {
      found.push(...textProblems(render(value), `${name}.${lang}.${key}`, lang, max));
    }
  }
  return found;
}

test('the configuration offers the four languages, French by default', () => {
  assert.deepEqual(LANGUAGES, LANGS);
  const field = manifest.config_schema.find((f) => f.key === 'language');
  assert.deepEqual(
    field.options.map((option) => option.value),
    LANGS,
  );
  assert.equal(field.default, 'fr');
});

test('every text of the manifest is in English, French, German and Spanish', () => {
  const texts = manifestTexts(manifest);
  assert.ok(texts.length >= 60, `only ${texts.length} texts found in the manifest`);
  const found = texts.flatMap(({ path, value, max }) => problems(value, path, max));
  assert.deepEqual(found, []);
});

test('the name is short and the same in every language', () => {
  assert.equal(typeof manifest.name, 'string');
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
});

test('the feature names, the limits and the texts exist in every language', () => {
  assert.deepEqual(tableProblems(NAMES, 'NAMES', MAX.featureName), []);
  const long = new Set([
    'notLinked',
    'waiting',
    'noConsole',
    'unknownConsole',
    'nintendoDown',
    'bonusActive',
  ]);
  const found = Object.entries(TEXT).flatMap(([key, value]) =>
    problems(value, `TEXT.${key}`, long.has(key) ? MAX.message : MAX.short),
  );
  assert.deepEqual(found, []);
  assert.deepEqual(
    Object.entries(MESSAGES).flatMap(([key, value]) =>
      problems(value, `MESSAGES.${key}`, MAX.message),
    ),
    [],
  );
  // The widget captions are cut at 80 characters by the core.
  for (const key of ['nintendoDown', 'bonusActive']) {
    for (const [lang, text] of Object.entries(TEXT[key])) {
      assert.ok(text.length <= 80, `TEXT.${key}.${lang} is longer than a caption`);
    }
  }
  const render = (value) =>
    typeof value === 'function' ? value(15, 'Living room (Nintendo Switch 2)') : value;
  assert.deepEqual(tableProblems(FORMAT, 'FORMAT', MAX.message, render), []);
  const consoles = (lang) =>
    FORMAT[lang].consoles('Living room (Nintendo Switch), Bedroom (Nintendo Switch 2)');
  for (const lang of LANGS) {
    assert.ok(consoles(lang).length <= MAX.message);
    assert.ok(FORMAT[lang].modeSet(false, 'Bedroom').length <= MAX.message);
    for (const value of limitValues()) {
      assert.ok(limitLabel(value, lang).trim() !== '', `limit ${value} has no ${lang} label`);
    }
  }
});

test('the guard catches a missing language, an empty text and the wrong register', () => {
  assert.equal(problems({ en: 'Game', fr: 'Jeu', de: 'Spiel' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'Game', fr: 'Jeu', de: '', es: 'Juego' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a', es: 'a', it: 'a' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a'.repeat(61), es: 'a' }, 'x', 60).length, 1);
  for (const polite of ['Prüfen Sie', 'Ihr Konto', 'Ihre Konten', 'mit Ihrem', 'Ihnen']) {
    assert.equal(problems({ en: 'a', fr: 'a', de: polite, es: 'a' }, 'x', 60).length, 1, polite);
  }
  for (const familiar of ['Introduce tu clave', 'comprueba la cuenta']) {
    assert.equal(
      problems({ en: 'a', fr: 'a', de: 'a', es: familiar }, 'x', 60).length,
      1,
      familiar,
    );
  }
  assert.deepEqual(
    problems({ en: 'a', fr: 'a', de: 'Siebenschläfer, ihre', es: 'Introduzca su clave' }, 'x', 60),
    [],
  );
  const forgotten = structuredClone(manifest);
  delete forgotten.scene_triggers[0].label.de;
  const found = manifestTexts(forgotten).flatMap(({ path, value, max }) =>
    problems(value, path, max),
  );
  assert.deepEqual(found, [
    'manifest.scene_triggers[0].label has [en,fr,es], expected exactly [en,fr,de,es]',
  ]);
});

/** The `##` and `###` headings of a Markdown document, by level. */
async function outline(lang) {
  const text = await readFile(new URL(`../docs/${lang}.md`, import.meta.url), 'utf8');
  return {
    text,
    levels: text
      .split('\n')
      .filter((line) => /^#{1,3} /.test(line))
      .map((line) => line.match(/^#+/)[0].length),
  };
}

test('the four documentations exist and have the same sections', async () => {
  const docs = Object.fromEntries(
    await Promise.all(LANGS.map(async (lang) => [lang, await outline(lang)])),
  );
  for (const lang of LANGS) {
    assert.ok(docs[lang].text.length >= 300, `docs/${lang}.md is too short for the store`);
    assert.deepEqual(
      docs[lang].levels,
      docs.en.levels,
      `docs/${lang}.md does not have the sections of docs/en.md`,
    );
    assert.ok(
      docs[lang].levels.filter((level) => level === 2).length >= 8,
      `docs/${lang}.md: sections missing`,
    );
    assert.ok(
      /not affiliated|n'est pas affiliée|nicht mit Nintendo verbunden|no está afiliada/.test(
        docs[lang].text,
      ),
      `docs/${lang}.md: the "not affiliated" notice`,
    );
    assert.ok(
      /feedback welcome|retours bienvenus|Rückmeldungen willkommen|comentarios son bienvenidos/i.test(
        docs[lang].text,
      ),
      `docs/${lang}.md: the "developed without the hardware" notice`,
    );
    // Every trigger, the action, the scene action and the widget are documented,
    // by their label in that language.
    const labels = [
      manifest.widgets[0].label[lang],
      ...manifest.actions.map((action) => action.label[lang]),
      ...manifest.scene_triggers.map((trigger) => trigger.label[lang]),
      ...manifest.scene_actions.map((action) => action.label[lang]),
    ];
    for (const label of labels) {
      assert.ok(docs[lang].text.includes(label), `docs/${lang}.md does not document "${label}"`);
    }
  }
  const strip = (text) => text.replace(/`[^`]*`|\([^)]*\)/g, '');
  assert.ok(!POLITE_GERMAN.test(strip(docs.de.text)), 'docs/de.md uses the polite form');
  assert.ok(!FAMILIAR_SPANISH.test(strip(docs.es.text)), 'docs/es.md uses "tú"');
});
