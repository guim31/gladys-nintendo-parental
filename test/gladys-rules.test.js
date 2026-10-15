// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from realistic
// fixtures (the anonymized Nintendo answers of pynintendoparental): a Switch
// in the daily mode without limit, a Switch 2 in the per-day mode with a
// limit and the software suspended, in every feature-name language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createWorld } from './helpers/world.js';
import { SWITCH, SWITCH2 } from './helpers/fakeNintendo.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

const scenarios = [
  { label: 'English names', config: { language: 'en' } },
  { label: 'French names', config: { language: 'fr' } },
  { label: 'German names', config: { language: 'de' } },
  { label: 'Spanish names', config: { language: 'es' } },
];

for (const scenario of scenarios) {
  test(`every discovered device follows the Gladys rules (${scenario.label})`, async () => {
    const world = await createWorld({ config: scenario.config });
    try {
      const devices = world.gladys.fake.discoveredDevices;
      assert.equal(devices.length, 2, 'one device per fixture console');

      const deviceIds = new Set();
      const deviceNames = new Set();
      for (const device of devices) {
        const where = device.name;
        assert.ok(!deviceIds.has(device.external_id), `${where}: duplicate device external_id`);
        deviceIds.add(device.external_id);
        assert.ok(!deviceNames.has(device.name), `${where}: duplicate device name`);
        deviceNames.add(device.name);

        // should_poll: true if and only if poll_frequency is provided, in ms.
        if (device.poll_frequency === undefined) {
          assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
        } else {
          assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
          assert.ok(
            table.poll_frequencies_ms.includes(device.poll_frequency),
            `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
          );
        }

        assert.ok(device.features.length > 0, `${where}: no feature`);
        const externalIds = new Set();
        const names = new Set();
        for (const feature of device.features) {
          const at = `${where} / ${feature.name}`;
          const pair = table.pairs[`${feature.category}/${feature.type}`];
          assert.ok(
            pair,
            `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`,
          );
          assert.ok(
            pair.label_en && pair.label_fr && pair.icon,
            `${at}: couple without label or icon`,
          );

          assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
          assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
          assert.ok(
            Number.isFinite(feature.min) && Number.isFinite(feature.max),
            `${at}: finite min/max`,
          );
          assert.ok(feature.min <= feature.max, `${at}: min > max`);
          assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
          assert.equal(
            typeof feature.has_feedback,
            'boolean',
            `${at}: has_feedback must be a boolean`,
          );
          if (feature.unit !== undefined) {
            assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
            const allowed = table.units_by_category?.[feature.category];
            if (allowed) {
              assert.ok(
                allowed.includes(feature.unit),
                `${at}: unit ${feature.unit} not for ${feature.category}`,
              );
            }
          }
          if (feature.supported_options !== undefined) {
            // String option values are for text/select only (the core refuses them elsewhere).
            assert.equal(`${feature.category}/${feature.type}`, 'text/select', `${at}: options`);
            const values = feature.supported_options.map((option) => `${option.value}`);
            assert.equal(new Set(values).size, values.length, `${at}: duplicate option values`);
            for (const option of feature.supported_options) {
              assert.ok(String(option.value).trim() !== '', `${at}: empty option value`);
              assert.ok(String(option.label).trim() !== '', `${at}: empty option label`);
            }
          }

          assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
          assert.ok(
            feature.external_id.startsWith(`${device.external_id}:`),
            `${at}: feature id outside its device`,
          );
          externalIds.add(feature.external_id);
          assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
          names.add(feature.name);
        }
      }
    } finally {
      await world.cleanup();
    }
  });
}

test('every published state is accepted for its feature', async () => {
  const world = await createWorld();
  try {
    await world.add(SWITCH);
    await world.add(SWITCH2);
    world.nintendo.play(SWITCH, 75);
    world.nintendo.play(SWITCH2, 130, { id: '0100D71004694000', title: 'Minecraft' });
    await world.tick(1);
    const features = new Map(
      world.gladys.fake.discoveredDevices
        .flatMap((device) => device.features)
        .map((feature) => [feature.external_id, feature]),
    );
    const states = world.gladys.fake.states;
    assert.ok(states.length >= 16);
    for (const state of states) {
      const feature = features.get(state.device_feature_external_id);
      assert.ok(feature, `state for an unknown feature ${state.device_feature_external_id}`);
      if (feature.category === 'text') {
        assert.equal(typeof state.text, 'string');
        assert.ok(state.text.trim() !== '', `${feature.name}: empty text is ignored by Gladys`);
        if (feature.type === 'select') {
          const values = feature.supported_options.map((option) => option.value);
          assert.ok(values.includes(state.text), `${feature.name}: ${state.text} is not an option`);
        }
      } else {
        assert.equal(typeof state.state, 'number', `${feature.name}: numeric state`);
        assert.ok(Number.isFinite(state.state));
        assert.ok(
          state.state >= feature.min && state.state <= feature.max,
          `${feature.name}: ${state.state} outside ${feature.min}..${feature.max}`,
        );
      }
      if (feature.type === 'binary') {
        assert.ok([0, 1].includes(state.state), `${feature.name}: binary state`);
      }
    }
  } finally {
    await world.cleanup();
  }
});
