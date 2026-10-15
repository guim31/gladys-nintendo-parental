// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { ACTION_KEYS, SCENE_ACTION_KEYS, SCENE_TRIGGER_KEYS, createApp } from '../src/app.js';
import { WIDGET } from '../src/widgets.js';
import { ACCOUNT_FIELD, DEFAULT_CONFIG, REFRESH_INTERVALS } from '../src/config.js';
import { THRESHOLDS } from '../src/tracker.js';
import { BONUS_CHOICES, limitValues } from '../src/nintendo/model.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Every list of form fields the manifest can declare (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...(manifest.contact_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

// The handlers the integration registers, read from a fake Gladys.
const registered = (() => {
  const gladys = createFakeGladys();
  createApp({ gladys, timers: false }).register();
  return gladys;
})();

// Manifest fields older Gladys releases reject as unknown, with the first
// release accepting them. The store validator refuses a manifest whose
// `gladys_version` minimum is lower: these tests catch it before a release.
const CAPABILITY_FIELDS = ['scene_triggers', 'scene_actions', 'widgets'];
const CAPABILITY_MIN_GLADYS_VERSION = [5, 1, 0];
const CATEGORIES_MIN_GLADYS_VERSION = [4, 86, 0];

const keysOf = (list) => (list ?? []).map((entry) => entry.key);

// Minimum version of the manifest `gladys_version` range, e.g. [5, 1, 0].
function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

test('every manifest action has a registered handler, and vice versa', async () => {
  assert.deepEqual(keysOf(manifest.actions), ACTION_KEYS);
  for (const key of ACTION_KEYS) {
    const ack = await registered.fake.action(key);
    assert.notEqual(ack.error, 'not implemented', `action "${key}" has no handler`);
  }
});

test('declaring catalog categories requires Gladys >= 4.86.0', () => {
  // The store vocabulary itself is checked by the store validator (unknown
  // keys are dropped with a warning there) — what this test pins is the
  // coupling rule: older cores reject any unknown manifest field, so a
  // manifest declaring `categories` must not claim compatibility below the
  // first release that accepts it.
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  assert.ok(
    isAtLeast(minGladysVersion(), CATEGORIES_MIN_GLADYS_VERSION),
    `categories requires gladys_version >= 4.86.0, got "${manifest.gladys_version}"`,
  );
});

test('declaring scene triggers, scene actions or widgets requires Gladys >= 5.1.0', () => {
  const declared = CAPABILITY_FIELDS.filter((field) => manifest[field] !== undefined);
  assert.ok(declared.length > 0, 'the integration declares capability fields');
  assert.ok(
    isAtLeast(minGladysVersion(), CAPABILITY_MIN_GLADYS_VERSION),
    `${declared.join(', ')} requires gladys_version >= 5.1.0, got "${manifest.gladys_version}"`,
  );
});

test('every scene_actions key has an onSceneAction handler, and vice versa', async () => {
  assert.deepEqual(keysOf(manifest.scene_actions), SCENE_ACTION_KEYS);
  for (const key of SCENE_ACTION_KEYS) {
    const ack = await registered.fake.sceneAction(key, {});
    assert.notEqual(ack.error, 'not implemented', `scene action "${key}" has no handler`);
  }
});

test('every widgets key has an onWidgetGet handler, and vice versa', async () => {
  assert.deepEqual(keysOf(manifest.widgets), Object.values(WIDGET));
  for (const key of Object.values(WIDGET)) {
    const ack = await registered.fake.widgetGet(key);
    assert.equal(ack.success, true, `widget "${key}" has no content handler`);
  }
});

test('the "limit almost reached" thresholds are the options of its filter', () => {
  const trigger = manifest.scene_triggers.find((t) => t.key === 'limit_approaching');
  const field = trigger.fields.find((f) => f.key === 'minutes');
  assert.deepEqual(
    field.options.map((option) => option.value),
    THRESHOLDS.map(String),
  );
  assert.equal(field.required, true);
});

test('the scene actions offer the values Nintendo accepts', () => {
  const bonus = manifest.scene_actions
    .find((a) => a.key === 'add_bonus_time')
    .fields.find((f) => f.key === 'minutes');
  assert.deepEqual(
    bonus.options.map((option) => option.value),
    BONUS_CHOICES.map(String),
  );
  const limit = manifest.scene_actions
    .find((a) => a.key === 'set_daily_limit')
    .fields.find((f) => f.key === 'limit');
  assert.deepEqual(
    limit.options.map((option) => option.value),
    limitValues(),
  );
});

test('every trigger can be narrowed to one console, and names it to the scene', () => {
  for (const trigger of manifest.scene_triggers) {
    const console = trigger.fields.find((f) => f.key === 'console');
    assert.equal(console?.source, 'devices', `${trigger.key}: console filter`);
    assert.ok(
      trigger.variables.some((v) => v.key === 'console_name'),
      `${trigger.key}: console_name variable`,
    );
  }
  for (const action of manifest.scene_actions) {
    const console = action.fields.find((f) => f.key === 'console');
    assert.equal(console?.source, 'devices', `${action.key}: console field`);
    assert.equal(console?.required, true, `${action.key}: a console is required`);
  }
});

test('the refresh intervals of the manifest are the ones the code accepts', () => {
  const field = manifest.config_schema.find((f) => f.key === 'refresh_interval');
  assert.deepEqual(
    field.options.map((option) => option.value),
    REFRESH_INTERVALS,
  );
});

test('the Nintendo account is linked by the Connect button, the link pasted as a secret', () => {
  const account = manifest.config_schema.find((f) => f.key === ACCOUNT_FIELD);
  assert.equal(account?.type, 'account_link');
  assert.equal(account.default, undefined);
  assert.equal(account.placeholder, undefined);
  const link = manifest.config_schema.find((f) => f.key === 'redirect_link');
  assert.equal(link?.type, 'secret');
  // Nothing sensitive in a field a scene or a dashboard can read.
  for (const field of allFields.filter((f) => !manifest.config_schema.includes(f))) {
    assert.ok(!['secret', 'oauth2', 'account_link'].includes(field.type), field.key);
  }
});

test('the identity of the manifest', () => {
  assert.equal(manifest.name, 'Nintendo Parental Controls');
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.deepEqual(manifest.categories, ['multimedia']);
  assert.match(manifest.docker_image, /^ghcr\.io\/guim31\/gladys-nintendo-parental:/);
  assert.equal(manifest.type, 'device');
});

test('every scene trigger the code fires is declared in scene_triggers, and vice versa', () => {
  // An undeclared key is a 404 on publishSceneEvent; a declared key nobody
  // fires is a dead card in the scene editor.
  const declared = keysOf(manifest.scene_triggers);
  for (const key of SCENE_TRIGGER_KEYS) {
    assert.ok(declared.includes(key), `trigger "${key}" is fired but not declared`);
  }
  for (const key of declared) {
    assert.ok(SCENE_TRIGGER_KEYS.includes(key), `trigger "${key}" is declared but never fired`);
  }
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.default !== undefined) {
      assert.equal(
        DEFAULT_CONFIG[field.key],
        field.default,
        `DEFAULT_CONFIG.${field.key} must match the manifest default`,
      );
    }
  }
});

test('section fields are purely presentational', () => {
  const sections = manifest.config_schema.filter((f) => f.type === 'section');
  assert.ok(sections.length > 0, 'the configuration starts with an intro section');
  for (const section of sections) {
    // A section stores NO value: declaring `required`, `default` or
    // `placeholder` on it rejects the manifest, and its key must never leak
    // into the config the code manipulates.
    assert.equal(section.required, undefined, `section "${section.key}" must not be required`);
    assert.equal(section.default, undefined, `section "${section.key}" must not have a default`);
    assert.equal(
      section.placeholder,
      undefined,
      `section "${section.key}" must not have a placeholder`,
    );
    assert.ok(section.label?.en, `section "${section.key}" needs an English label`);
    assert.ok(
      !(section.key in DEFAULT_CONFIG),
      `section "${section.key}" stores no value and must not appear in DEFAULT_CONFIG`,
    );
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//, 'section links must be https');
    }
  }
});

test('dynamic selects declare a source and no static options', () => {
  const dynamicSelects = allFields.filter((f) => f.source !== undefined);
  assert.ok(dynamicSelects.length > 0, 'the scene declarations pick a console');
  for (const field of dynamicSelects) {
    assert.equal(field.source, 'devices', 'the only core-defined source in V1 is "devices"');
    assert.equal(
      field.options,
      undefined,
      `field "${field.key}": declaring source and options together rejects the manifest`,
    );
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  // The Release workflow writes all three: a mismatch means one was edited by
  // hand, and Gladys would offer a version whose image is another one.
  assert.equal(manifest.version, pkg.version, 'manifest version must match package.json');
  assert.ok(
    manifest.docker_image.endsWith(`:${manifest.version}`),
    `docker_image must be tagged :${manifest.version}, got "${manifest.docker_image}"`,
  );
});

test('the catalog description holds 10 to 100 characters per language', () => {
  // A store rule (the catalog card is short): a longer text rejects the
  // manifest.
  assert.ok(manifest.description.en, 'the description needs an English text');
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(
      text.length >= 10 && text.length <= 100,
      `description.${lang} has ${text.length} characters (10 to 100 allowed)`,
    );
  }
});

test('field placeholders are multi-language objects', () => {
  // Like `label` and `description`: a plain string rejects the manifest.
  const withPlaceholder = allFields.filter((f) => f.placeholder !== undefined);
  assert.ok(withPlaceholder.length > 0, 'the link field shows its beginning');
  for (const field of withPlaceholder) {
    assert.equal(typeof field.placeholder, 'object', `field "${field.key}": placeholder`);
    assert.ok(field.placeholder.en, `field "${field.key}": placeholder needs an English text`);
  }
});
