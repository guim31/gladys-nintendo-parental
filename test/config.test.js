// -----------------------------------------------------------------------------
// Normalization of the configuration received from Gladys.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG,
  nintendoLanguage,
  normalizeConfig,
  refreshPeriodMs,
} from '../src/config.js';

test('the defaults, and the values the code cannot use', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
  assert.deepEqual(
    normalizeConfig({
      redirect_link: '  npf54789befb391a838://auth#x\n',
      refresh_interval: 7,
      language: 'it',
    }),
    { redirect_link: 'npf54789befb391a838://auth#x', refresh_interval: '60', language: 'fr' },
  );
  assert.equal(refreshPeriodMs(normalizeConfig({ refresh_interval: '300' })), 300000);
});

test('Nintendo is asked in the language of the configuration', () => {
  assert.equal(nintendoLanguage('fr'), 'fr-FR');
  assert.equal(nintendoLanguage('de'), 'de-DE');
  assert.equal(nintendoLanguage('xx'), 'en-US');
});
