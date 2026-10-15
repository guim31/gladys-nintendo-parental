// -----------------------------------------------------------------------------
// The integration running against the SDK's fake Gladys and the fake
// Nintendo, with a hand-driven clock and a temporary /data. No timer runs:
// the tests call the refresh cycles themselves (except the timer test).
//
// The clock starts on Monday 2025-12-08 at 19:40 UTC, the day of the fixtures
// (Europe/London is UTC in December).
// -----------------------------------------------------------------------------

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { createApp } from '../../src/app.js';
import { createFakeNintendo } from './fakeNintendo.js';

export const T0 = Date.parse('2025-12-08T19:40:00Z');
export const TIME_ZONE = 'Europe/London';

/**
 * @param {object} [options]
 * @param {object} [options.config]
 * @param {boolean} [options.linked] go through Connect + paste before returning
 */
export async function createWorld({
  config = {},
  devices = [],
  nintendo = createFakeNintendo(),
  dataDir,
  linked = true,
  timers = false,
  connect = true,
} = {}) {
  const dir = dataDir ?? (await mkdtemp(path.join(tmpdir(), 'gladys-nintendo-')));
  const clock = { now: T0 };
  const gladys = createFakeGladys({ config: { language: 'en', ...config }, devices });
  const app = createApp({
    gladys,
    fetch: nintendo.fetch,
    dataDir: dir,
    now: () => clock.now,
    timeZone: TIME_ZONE,
    timers,
    sleep: async () => {},
  });
  app.register();
  const world = {
    gladys,
    nintendo,
    app,
    clock,
    dir,
    /** Connect (as the button), sign in, paste the link, save the configuration. */
    async signIn() {
      const ack = await gladys.fake.oauthAuthorizeUrl('nintendo_account');
      const link = nintendo.signIn(ack.data.authorize_url);
      await gladys.fake.configUpdated({ ...gladys.fake.config, redirect_link: link });
      return link;
    },
    /** Move the clock forward and run one refresh. */
    async tick(minutes = 1) {
      clock.now += minutes * 60000;
      await app.cycle();
    },
    /** Add the discovered device of a console to Gladys, as the user would. */
    async add(deviceId) {
      const device = gladys.fake.discoveredDevices.find((d) =>
        d.external_id.endsWith(`:${deviceId}`),
      );
      await gladys.fake.deviceCreated(device);
      return device;
    },
    ids(deviceId) {
      return gladys.externalIds('console', deviceId);
    },
    feature(deviceId, key) {
      return gladys.externalIds('console', deviceId).feature(key);
    },
    async cleanup() {
      await app.stop();
      if (!dataDir) {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
  if (connect) {
    await gladys.connect();
    if (linked) {
      await world.signIn();
    }
  }
  return world;
}
