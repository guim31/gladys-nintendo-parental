// -----------------------------------------------------------------------------
// The integration end to end, against the SDK's fake Gladys and the fake
// Nintendo: sign-in, consoles, states, scene events, commands, scene actions,
// widget and failures.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { MESSAGES, TEXT } from '../src/i18n.js';
import { createWorld } from './helpers/world.js';
import { SESSION_TOKEN, SWITCH, SWITCH2, createFakeNintendo } from './helpers/fakeNintendo.js';

const sessionRequests = (nintendo) =>
  nintendo.requests.filter((request) => request.url.endsWith('/api/session_token'));
const lastState = (world, deviceId, key) =>
  world.gladys.fake.lastState(world.feature(deviceId, key));
const widget = async (world, settings = {}, language = 'en') =>
  (await world.gladys.fake.widgetGet('consoles', { settings, language })).data.content;

// --- Sign-in ----------------------------------------------------------------

test('without a Nintendo account, the integration waits for Connect and the link', async () => {
  const world = await createWorld({ linked: false });
  try {
    assert.deepEqual(world.gladys.fake.connectionStatus, {
      connected: false,
      message: MESSAGES.notLinked,
    });
    assert.deepEqual(world.gladys.fake.discoveredDevices, []);
    assert.equal(world.nintendo.requests.length, 0);
    const content = await widget(world);
    assert.equal(content.components[0].text, TEXT.notLinked.en);
    await world.tick(5);
    assert.equal(world.nintendo.requests.length, 0, 'nothing to ask Nintendo');
  } finally {
    await world.cleanup();
  }
});

test('Connect, sign in, paste the link: the consoles appear', async () => {
  const world = await createWorld({ linked: false });
  try {
    await world.signIn();
    assert.deepEqual(world.gladys.fake.connectionStatus, { connected: true });
    assert.deepEqual(
      world.gladys.fake.discoveredDevices.map((device) => device.name),
      ['Living room (Nintendo Switch)', 'Bedroom (Nintendo Switch 2)'],
    );
    // The session lives in /data, readable by the integration only; the link does not.
    const file = path.join(world.dir, 'nintendo-state.json');
    const text = await readFile(file, 'utf8');
    assert.ok(text.includes(SESSION_TOKEN));
    assert.ok(!text.includes('SESSION-CODE-SECRET'), 'the pasted code is not kept');
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    // Saving the configuration again does not send the code again.
    await world.gladys.fake.configUpdated({ ...world.gladys.fake.config });
    assert.equal(sessionRequests(world.nintendo).length, 1);
  } finally {
    await world.cleanup();
  }
});

test('a wrong link is explained, and never sent twice to Nintendo', async () => {
  const world = await createWorld({ linked: false });
  try {
    const paste = (link) =>
      world.gladys.fake.configUpdated({ ...world.gladys.fake.config, redirect_link: link });

    await paste('https://accounts.nintendo.com/login');
    assert.deepEqual(world.gladys.fake.connectionStatus.message, MESSAGES.invalidLink);

    // A link of a sign-in this integration did not start.
    await paste('npf54789befb391a838://auth#session_token_code=OTHER&state=unknown');
    assert.deepEqual(world.gladys.fake.connectionStatus.message, MESSAGES.otherLogin);
    assert.equal(sessionRequests(world.nintendo).length, 0);

    // A code Nintendo refuses (here: altered).
    const ack = await world.gladys.fake.oauthAuthorizeUrl('nintendo_account');
    const link = world.nintendo
      .signIn(ack.data.authorize_url)
      .replace('CODE-SECRET-', 'CODE-SECRET-X');
    await paste(link);
    assert.deepEqual(world.gladys.fake.connectionStatus.message, MESSAGES.linkRefused);
    assert.equal(sessionRequests(world.nintendo).length, 1);
    await paste(link);
    await world.tick(1);
    assert.equal(sessionRequests(world.nintendo).length, 1, 'a refused code is not sent again');
    assert.deepEqual(world.gladys.fake.connectionStatus.message, MESSAGES.linkRefused);

    // Another field than the account one.
    const other = await world.gladys.fake.oauthAuthorizeUrl('something_else');
    assert.equal(other.success, false);
  } finally {
    await world.cleanup();
  }
});

test('the session survives a restart of the container', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'gladys-nintendo-restart-'));
  const first = await createWorld({ dataDir: dir });
  await first.cleanup();
  const nintendo = first.nintendo;
  const world = await createWorld({ nintendo, dataDir: dir, linked: false });
  try {
    assert.deepEqual(world.gladys.fake.connectionStatus, { connected: true });
    assert.equal(world.gladys.fake.discoveredDevices.length, 2);
    assert.equal(sessionRequests(nintendo).length, 1, 'no new sign-in');
  } finally {
    await world.cleanup();
    await rm(dir, { recursive: true, force: true });
  }
});

test('a session Nintendo ends asks for a new sign-in, which brings everything back', async () => {
  const world = await createWorld();
  try {
    world.nintendo.revokeSessions();
    await world.tick(1);
    assert.deepEqual(world.gladys.fake.connectionStatus, {
      connected: false,
      message: MESSAGES.sessionEnded,
    });
    assert.equal((await widget(world)).components[0].text, TEXT.notLinked.en);
    const before = world.nintendo.requests.length;
    await world.tick(1);
    assert.equal(world.nintendo.requests.length, before, 'no request without a session');

    await world.signIn();
    assert.deepEqual(world.gladys.fake.connectionStatus, { connected: true });
  } finally {
    await world.cleanup();
  }
});

test('an expired id token is renewed without the user noticing', async () => {
  const world = await createWorld();
  try {
    world.nintendo.expireIdToken();
    world.nintendo.play(SWITCH, 70);
    await world.tick(1);
    assert.deepEqual(world.gladys.fake.connectionStatus, { connected: true });
    assert.equal(world.app.consoles.get(SWITCH).snapshot.played, 70);
    // Renewed ahead of its expiry, too.
    const tokens = () => world.nintendo.requests.filter((r) => r.url.endsWith('/api/token')).length;
    const count = tokens();
    await world.tick(11);
    assert.equal(tokens(), count + 1, 'renewed 5 minutes before the 15-minute expiry');
  } finally {
    await world.cleanup();
  }
});

test('"Sign out" deletes the session', async () => {
  const world = await createWorld();
  try {
    const ack = await world.gladys.fake.action('sign_out');
    assert.deepEqual(ack.data.message ?? ack.data, MESSAGES.signedOut);
    assert.deepEqual(world.gladys.fake.connectionStatus.connected, false);
    const text = await readFile(path.join(world.dir, 'nintendo-state.json'), 'utf8');
    assert.ok(!text.includes(SESSION_TOKEN));
    const again = await world.gladys.fake.action('sign_out');
    assert.deepEqual(again.data.message ?? again.data, MESSAGES.notSignedIn);
  } finally {
    await world.cleanup();
  }
});

test('"Check the connection" lists the consoles', async () => {
  const world = await createWorld();
  try {
    const ack = await world.gladys.fake.action('check_connection');
    const message = ack.data.message ?? ack.data;
    assert.equal(
      message.en,
      'Connected. Consoles: Living room (Nintendo Switch), Bedroom (Nintendo Switch 2).',
    );
    world.nintendo.failure = { status: 503 };
    const down = await world.gladys.fake.action('check_connection');
    assert.deepEqual(down.data.message ?? down.data, MESSAGES.unreachable);
  } finally {
    await world.cleanup();
  }
});

// --- States -----------------------------------------------------------------

test('the states of an added console, only when they change', async () => {
  const world = await createWorld();
  try {
    assert.equal(world.gladys.fake.states.length, 0, 'nothing before "Add to Gladys"');
    await world.add(SWITCH);
    const first = world.gladys.fake.states.length;
    assert.equal(first, 8);
    assert.equal(lastState(world, SWITCH, 'playing_time'), 60);
    assert.equal(lastState(world, SWITCH, 'time_remaining'), 260);
    assert.deepEqual(lastState(world, SWITCH, 'daily_limit'), 'none');
    assert.deepEqual(lastState(world, SWITCH, 'game'), 'five');
    assert.equal(lastState(world, SWITCH, 'online'), 1, 'data sent 6 minutes ago');
    assert.equal(lastState(world, SWITCH, 'suspend_software'), 0);

    await world.tick(1);
    // Only the remaining time moves (until midnight, one minute less).
    assert.equal(world.gladys.fake.states.length, first + 1);

    // Added again (Gladys "update"): every state again.
    await world.add(SWITCH);
    assert.equal(world.gladys.fake.states.length, first + 1 + 8);
  } finally {
    await world.cleanup();
  }
});

test('playing: the play time grows, the game is the one that grew', async () => {
  const world = await createWorld();
  try {
    await world.add(SWITCH);
    world.nintendo.play(SWITCH, 75, { id: '0100ABC', title: 'Mario Kart 8 Deluxe' });
    await world.tick(5);
    assert.equal(lastState(world, SWITCH, 'playing'), 1);
    assert.equal(lastState(world, SWITCH, 'playing_time'), 75);
    assert.deepEqual(lastState(world, SWITCH, 'game'), 'Mario Kart 8 Deluxe');
    // No new play time for 20 minutes: not playing any more, the game stays the last one.
    for (let i = 0; i < 4; i += 1) await world.tick(5);
    assert.equal(lastState(world, SWITCH, 'playing'), 0);
    assert.deepEqual(lastState(world, SWITCH, 'game'), 'Mario Kart 8 Deluxe');
    // The console has not sent anything for more than 20 minutes: offline.
    assert.equal(lastState(world, SWITCH, 'online'), 0);
  } finally {
    await world.cleanup();
  }
});

// --- Scene events -----------------------------------------------------------

test('"Starts playing" fires once per session, never on the first reading', async () => {
  const world = await createWorld();
  try {
    const events = () => world.gladys.fake.sceneEvents.filter((e) => e.key === 'started_playing');
    assert.equal(events().length, 0, "today's 60 minutes are the baseline");
    world.nintendo.play(SWITCH, 70, { id: '0100ABC', title: 'Mario Kart 8 Deluxe' });
    await world.tick(5);
    world.nintendo.play(SWITCH, 80, { id: '0100ABC', title: 'Mario Kart 8 Deluxe' });
    await world.tick(5);
    assert.equal(events().length, 1);
    assert.deepEqual(events()[0].data, {
      console: world.ids(SWITCH).device,
      console_name: 'Living room (Nintendo Switch)',
      game: 'Mario Kart 8 Deluxe',
      playing_minutes: 70,
      remaining_minutes: 255,
      limit_minutes: 0,
    });
    // A pause longer than the grace, then play again: a new session.
    for (let i = 0; i < 5; i += 1) await world.tick(5);
    world.nintendo.play(SWITCH, 85);
    await world.tick(5);
    assert.equal(events().length, 2);
  } finally {
    await world.cleanup();
  }
});

test('"Limit almost reached" fires each threshold once, "Limit exceeded" once', async () => {
  const world = await createWorld();
  try {
    world.nintendo.setLimit(SWITCH, 90); // 60 played: 30 left
    await world.tick(1);
    const fired = () =>
      world.gladys.fake.sceneEvents
        .filter((e) => e.key !== 'started_playing')
        .map((e) => `${e.key}${e.data.minutes ? `:${e.data.minutes}` : ''}`);
    assert.deepEqual(fired(), []);

    world.nintendo.play(SWITCH, 76); // 14 left
    await world.tick(2);
    assert.deepEqual(fired(), ['limit_approaching:15']);
    world.nintendo.play(SWITCH, 86); // 4 left: 10 and 5 crossed together
    await world.tick(2);
    assert.deepEqual(fired(), [
      'limit_approaching:15',
      'limit_approaching:10',
      'limit_approaching:5',
    ]);
    world.nintendo.play(SWITCH, 90); // reached
    await world.tick(2);
    world.nintendo.play(SWITCH, 95);
    await world.tick(2);
    assert.deepEqual(fired().slice(3), ['limit_exceeded']);
    const exceeded = world.gladys.fake.sceneEvents.find((e) => e.key === 'limit_exceeded');
    assert.equal(exceeded.data.limit_minutes, 90);
    assert.equal(exceeded.data.playing_minutes, 90);

    // A bonus re-arms them.
    const ack = await world.gladys.fake.sceneAction('add_bonus_time', {
      console: world.ids(SWITCH).device,
      minutes: '15',
    });
    assert.equal(ack.success, true, ack.error);
    assert.deepEqual(ack.data.outputs ?? ack.data, { bonus_minutes: 15, remaining_minutes: 10 });
    await world.tick(1);
    world.nintendo.play(SWITCH, 101);
    await world.tick(2);
    assert.deepEqual(fired().slice(4), ['limit_approaching:5']);
    world.nintendo.play(SWITCH, 110);
    await world.tick(2);
    assert.deepEqual(fired().slice(5), ['limit_exceeded']);
  } finally {
    await world.cleanup();
  }
});

test('bedtime approaching while nobody plays fires nothing', async () => {
  const world = await createWorld();
  try {
    const regulation =
      world.nintendo.state.settings[SWITCH].parentalControlSetting.playTimerRegulations
        .dailyRegulations;
    regulation.bedtime = {
      enabled: true,
      endingTime: { hour: 20, minute: 30 },
      startingTime: null,
    };
    for (let i = 0; i < 12; i += 1) await world.tick(5); // until 20:40
    assert.deepEqual(world.gladys.fake.sceneEvents, []);
  } finally {
    await world.cleanup();
  }
});

test('a new day starts from zero, without event', async () => {
  const world = await createWorld();
  try {
    world.nintendo.setLimit(SWITCH, 70);
    world.nintendo.play(SWITCH, 65);
    await world.tick(1);
    const count = world.gladys.fake.sceneEvents.length;
    world.nintendo.newDay('2025-12-09');
    world.clock.now = Date.parse('2025-12-09T07:00:00Z');
    await world.app.cycle();
    assert.equal(world.gladys.fake.sceneEvents.length, count);
    assert.equal(world.app.consoles.get(SWITCH).snapshot.played, 0);
    assert.equal(world.app.consoles.get(SWITCH).snapshot.remaining, 70);
  } finally {
    await world.cleanup();
  }
});

// --- Commands ---------------------------------------------------------------

const playTimerBodies = (nintendo) =>
  nintendo.requests
    .filter((r) => r.url.endsWith('/v3/actions/parentalControlSetting/updatePlayTimer'))
    .map((r) => JSON.parse(r.body));

test('the daily limit is a list of the app limits, written where the app writes it', async () => {
  const world = await createWorld();
  try {
    const [device] = await Promise.all([world.add(SWITCH), world.add(SWITCH2)]);
    const feature = device.features.find((f) => f.external_id.endsWith(':daily_limit'));
    assert.equal(feature.supported_options.length, 25);
    assert.deepEqual(feature.supported_options[0], {
      value: 'none',
      label: 'No limit',
      sort_order: 0,
    });
    assert.deepEqual(feature.supported_options[6], { value: '90', label: '1 h 30', sort_order: 6 });

    let ack = await world.gladys.fake.setValue(device, feature, '90');
    assert.equal(ack.success, true, ack.error);
    let [body] = playTimerBodies(world.nintendo);
    assert.equal(body.deviceId, SWITCH);
    assert.deepEqual(body.playTimerRegulations.dailyRegulations.timeToPlayInOneDay, {
      enabled: true,
      limitTime: 90,
    });
    assert.deepEqual(lastState(world, SWITCH, 'daily_limit'), '90');
    assert.equal(lastState(world, SWITCH, 'time_remaining'), 30);

    // The Switch 2 is in the per-day mode: Monday's limit changes.
    const device2 = world.gladys.fake.discoveredDevices[1];
    const feature2 = device2.features.find((f) => f.external_id.endsWith(':daily_limit'));
    ack = await world.gladys.fake.setValue(device2, feature2, 'none');
    assert.equal(ack.success, true, ack.error);
    body = playTimerBodies(world.nintendo)[1];
    assert.deepEqual(
      body.playTimerRegulations.eachDayOfTheWeekRegulations.monday.timeToPlayInOneDay,
      {
        enabled: false,
      },
    );
    assert.deepEqual(
      body.playTimerRegulations.eachDayOfTheWeekRegulations.tuesday.timeToPlayInOneDay,
      {
        enabled: true,
        limitTime: 360,
      },
    );
    assert.deepEqual(lastState(world, SWITCH2, 'daily_limit'), 'none');

    // Outside the app's bounds.
    ack = await world.gladys.fake.setValue(device, feature, '7');
    assert.equal(ack.success, false);
    assert.equal(playTimerBodies(world.nintendo).length, 2);
  } finally {
    await world.cleanup();
  }
});

test('the software suspension switch', async () => {
  const world = await createWorld();
  try {
    const device = await world.add(SWITCH);
    const feature = device.features.find((f) => f.external_id.endsWith(':suspend_software'));
    assert.equal(feature.read_only, false);
    const ack = await world.gladys.fake.setValue(device, feature, 1);
    assert.equal(ack.success, true, ack.error);
    assert.equal(
      playTimerBodies(world.nintendo)[0].playTimerRegulations.restrictionMode,
      'FORCED_TERMINATION',
    );
    assert.equal(lastState(world, SWITCH, 'suspend_software'), 1);
    // Read-only features refuse commands.
    const playing = device.features.find((f) => f.external_id.endsWith(':playing_time'));
    assert.equal((await world.gladys.fake.setValue(device, playing, 5)).success, false);
  } finally {
    await world.cleanup();
  }
});

test('once a bonus is granted, the limit and the mode are refused with the reason', async () => {
  const world = await createWorld();
  try {
    const device = await world.add(SWITCH);
    const ack = await world.gladys.fake.sceneAction('add_bonus_time', {
      console: device.external_id,
      minutes: '30',
    });
    assert.equal(ack.success, true, ack.error);
    assert.deepEqual(
      JSON.parse(
        world.nintendo.requests.find((r) => r.url.endsWith('/updateExtraPlayingTime')).body,
      ),
      { deviceId: SWITCH, additionalTime: 30, status: 'TO_ADDED' },
    );
    assert.equal(lastState(world, SWITCH, 'bonus_time'), 30);
    const feature = device.features.find((f) => f.external_id.endsWith(':daily_limit'));
    const refused = await world.gladys.fake.setValue(device, feature, '120');
    assert.equal(refused.success, false);
    assert.equal(refused.error, MESSAGES.bonusActive.en);
    assert.equal(playTimerBodies(world.nintendo).length, 0);
    const limit = await world.gladys.fake.sceneAction('set_daily_limit', {
      console: device.external_id,
      limit: '120',
    });
    assert.equal(limit.error, MESSAGES.bonusActive.en);
  } finally {
    await world.cleanup();
  }
});

test('a bonus Nintendo refuses says why', async () => {
  const world = await createWorld({ config: { language: 'fr' } });
  try {
    world.nintendo.extraAnswer = { deviceId: SWITCH, status: 'OVERTIME_ERROR' };
    const ack = await world.gladys.fake.sceneAction('add_bonus_time', {
      console: world.ids(SWITCH).device,
      minutes: '15',
    });
    assert.equal(ack.success, false);
    assert.equal(ack.error, MESSAGES.bonusRefused.fr);
    // Values the manifest does not offer, an unknown console.
    const odd = await world.gladys.fake.sceneAction('add_bonus_time', {
      console: world.ids(SWITCH).device,
      minutes: '45',
    });
    assert.equal(odd.success, false);
    const unknown = await world.gladys.fake.sceneAction('add_bonus_time', {
      console: world.ids('FFFFFFFFFFFFFFFF').device,
      minutes: '15',
    });
    assert.equal(unknown.error, MESSAGES.unknownConsole.fr);
  } finally {
    await world.cleanup();
  }
});

test('"Set the daily limit" scene action', async () => {
  const world = await createWorld();
  try {
    const ack = await world.gladys.fake.sceneAction('set_daily_limit', {
      console: world.ids(SWITCH2).device,
      limit: '45',
    });
    assert.equal(ack.success, true, ack.error);
    assert.equal(world.app.consoles.get(SWITCH2).snapshot.limit, 45);
  } finally {
    await world.cleanup();
  }
});

// --- Widget -----------------------------------------------------------------

test('the widget: every console, then one with its buttons', async () => {
  const world = await createWorld();
  try {
    await world.add(SWITCH2);
    world.nintendo.play(SWITCH, 70);
    await world.tick(1);
    const overview = await widget(world, {}, 'fr');
    assert.deepEqual(validateWidgetContent(overview), []);
    const rows = overview.components.find((c) => c.type === 'status').items;
    assert.deepEqual(
      rows.map((row) => `${row.label} = ${row.value}`),
      ['Bedroom (Nintendo Switch 2) = 0 min / 2 h', 'Living room (Nintendo Switch) = 1 h 10'],
    );
    assert.equal(overview.components.filter((c) => c.type === 'button').length, 0);

    const one = await widget(world, { console: world.ids(SWITCH2).device }, 'de');
    assert.deepEqual(validateWidgetContent(one), []);
    const buttons = one.components.filter((c) => c.type === 'button');
    assert.deepEqual(
      buttons.map((b) => [b.label, b.icon, b.action.key, b.action.confirm]),
      [
        ['+15 Min.', 'plus-circle', 'bonus', true],
        ['Nur Alarm', 'bell', 'alarm', true],
        ['Unterbrechen', 'check-circle', 'suspend', true],
      ],
    );
    assert.ok(
      buttons.every((b) => b.style !== 'primary'),
      'primary is invisible in dark mode',
    );

    // The buttons work.
    let ack = await world.gladys.fake.widgetAction('consoles', 'alarm', buttons[1].action.params);
    assert.equal(ack.success, true, ack.error);
    assert.equal(world.app.consoles.get(SWITCH2).snapshot.suspend, false);
    ack = await world.gladys.fake.widgetAction('consoles', 'bonus', buttons[0].action.params);
    assert.equal(ack.success, true, ack.error);
    assert.equal(world.app.consoles.get(SWITCH2).snapshot.bonus, 15);
    // Bonus granted: no mode buttons, the reason instead.
    const after = await widget(world, { console: world.ids(SWITCH2).device });
    assert.deepEqual(validateWidgetContent(after), []);
    assert.equal(after.components.filter((c) => c.type === 'button').length, 1);
    ack = await world.gladys.fake.widgetAction('consoles', 'suspend', buttons[2].action.params);
    assert.equal(ack.success, true, 'a toast, not an error');
    assert.equal(world.app.consoles.get(SWITCH2).snapshot.suspend, false);
    assert.ok(world.gladys.fake.widgetRefreshes.length > 0);
  } finally {
    await world.cleanup();
  }
});

test('the widget within the core budget in every state', async () => {
  const world = await createWorld();
  try {
    world.nintendo.state.settings[SWITCH].ownedDevice.device.extraPlayingTime = {
      inOneDay: { isInfinity: true, duration: null },
      bedtime: null,
    };
    await world.tick(1);
    world.nintendo.failure = { status: 500 };
    await world.tick(1);
    for (const settings of [{}, { console: world.ids(SWITCH).device }, { console: 'ext:x' }]) {
      for (const language of ['en', 'fr', 'de', 'es']) {
        const content = await widget(world, settings, language);
        assert.deepEqual(validateWidgetContent(content), [], JSON.stringify(content));
        assert.ok(content.components.filter((c) => c.type === 'text').length <= 2);
      }
    }
    const down = await widget(world, { console: world.ids(SWITCH).device });
    assert.ok(down.components.some((c) => c.text === TEXT.nintendoDown.en));
    const unknown = await widget(world, { console: 'ext:x' });
    assert.equal(unknown.components[0].text, TEXT.unknownConsole.en);
  } finally {
    await world.cleanup();
  }
});

// --- Failures and pace ------------------------------------------------------

test('each refresh reads 2 answers per console, the console list every 30 minutes', async () => {
  const world = await createWorld();
  try {
    const before = world.nintendo.apiRequests.length;
    await world.tick(1);
    assert.equal(world.nintendo.apiRequests.length - before, 4);
    const lists = () =>
      world.nintendo.apiRequests.filter((r) => r.url.endsWith('/fetchOwnedDevices')).length;
    const listed = lists();
    for (let i = 0; i < 30; i += 1) await world.tick(1);
    assert.equal(lists(), listed + 1);
    const headers = world.nintendo.apiRequests.at(-1).headers;
    assert.equal(headers['X-Moon-TimeZone'], 'Europe/London');
    assert.equal(headers['X-Moon-App-Language'], 'en-US');
  } finally {
    await world.cleanup();
  }
});

test('Nintendo down, then back: one status each way, the last values kept', async () => {
  const world = await createWorld();
  try {
    world.nintendo.failure = { error: 'ECONNRESET' };
    await world.tick(1);
    assert.deepEqual(world.gladys.fake.connectionStatus.message, MESSAGES.unreachable);
    assert.equal(world.app.consoles.get(SWITCH).snapshot.played, 60);
    world.nintendo.failure = null;
    await world.tick(1);
    assert.deepEqual(world.gladys.fake.connectionStatus, { connected: true });
  } finally {
    await world.cleanup();
  }
});

test('a 429 pauses the requests for 5 minutes', async () => {
  const world = await createWorld();
  try {
    world.nintendo.failure = { status: 429 };
    await world.tick(1);
    world.nintendo.failure = null;
    const count = world.nintendo.apiRequests.length;
    for (let i = 0; i < 4; i += 1) await world.tick(1);
    assert.equal(world.nintendo.apiRequests.length, count);
    await world.tick(2);
    assert.ok(world.nintendo.apiRequests.length > count);
  } finally {
    await world.cleanup();
  }
});

test('Nintendo requiring a newer app, and an account without console, are explained', async () => {
  const world = await createWorld();
  try {
    world.nintendo.failure = { status: 400, errorCode: 'update_required' };
    await world.tick(1);
    assert.deepEqual(world.gladys.fake.connectionStatus.message, MESSAGES.updateRequired);
  } finally {
    await world.cleanup();
  }
  const nintendo = createFakeNintendo();
  nintendo.state.owned.ownedDevices = [];
  const empty = await createWorld({ nintendo });
  try {
    assert.deepEqual(empty.gladys.fake.connectionStatus.message, MESSAGES.noConsole);
    assert.equal((await widget(empty)).components[0].text, TEXT.noConsole.en);
  } finally {
    await empty.cleanup();
  }
});

test('onPoll is a fallback: skipped right after a refresh', async () => {
  const world = await createWorld();
  try {
    const device = await world.add(SWITCH);
    const count = world.nintendo.apiRequests.length;
    await world.gladys.fake.poll(device);
    assert.equal(world.nintendo.apiRequests.length, count);
    world.clock.now += 61000;
    await world.gladys.fake.poll(device);
    assert.ok(world.nintendo.apiRequests.length > count);
  } finally {
    await world.cleanup();
  }
});

test('the states refresh by the internal timer, without onPoll', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const world = await createWorld({ timers: true });
  try {
    await world.add(SWITCH);
    world.nintendo.play(SWITCH, 66);
    world.clock.now += 60000;
    t.mock.timers.tick(60000);
    for (let i = 0; i < 50 && lastState(world, SWITCH, 'playing_time') !== 66; i += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(lastState(world, SWITCH, 'playing_time'), 66);
    assert.ok(
      !world.gladys.fake.wsMessages.some((m) => m.type === 'external-integration.poll'),
      'no onPoll involved',
    );
  } finally {
    await world.cleanup();
  }
});
