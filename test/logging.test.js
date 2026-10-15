// -----------------------------------------------------------------------------
// Quiet logs: a normal refresh writes nothing at the info level, a failure
// that repeats writes one line when it starts and one when it ends, and no
// secret (session token, id token, pasted code) ever appears, whatever happens.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from './helpers/world.js';
import { CODE_PREFIX, ID_TOKEN_PREFIX, SESSION_TOKEN, SWITCH } from './helpers/fakeNintendo.js';

/** Capture what the SDK logger writes (console.log for debug/info, console.error for warn/error). */
function captureLogs(t, level = 'debug') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  t.after(() => {
    if (previous === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = previous;
  });
  const lines = [];
  const record = (...args) => lines.push(args.map(String).join(' '));
  t.mock.method(console, 'log', record);
  t.mock.method(console, 'error', record);
  return {
    lines,
    at: (lvl) => lines.filter((line) => line.includes(`[${lvl.toUpperCase()}]`)),
    /** The lines at info and above, in order. */
    loud: () => lines.filter((line) => !line.includes('[DEBUG]')),
    clear: () => lines.splice(0),
  };
}

test('a normal refresh cycle writes nothing at the info level', async (t) => {
  const logs = captureLogs(t);
  const world = await createWorld();
  try {
    await world.add(SWITCH);
    world.nintendo.setLimit(SWITCH, 90);
    logs.clear();
    for (let i = 0; i < 40; i += 1) {
      world.nintendo.play(SWITCH, 60 + i);
      await world.tick(1);
    }
    for (let i = 0; i < 40; i += 1) await world.tick(1);
    assert.ok(world.gladys.fake.sceneEvents.length >= 3, 'events fired on the way');
    await world.gladys.fake.widgetGet('consoles', { language: 'fr' });
    await world.gladys.fake.poll({ external_id: world.ids(SWITCH).device });
    assert.deepEqual(logs.loud(), []);
    assert.ok(logs.at('debug').length > 0, 'the cycles are visible with LOG_LEVEL=debug');
  } finally {
    await world.cleanup();
  }
});

test('a repeated failure writes one line when it starts and one when it ends', async (t) => {
  const logs = captureLogs(t);
  const world = await createWorld();
  try {
    logs.clear();
    world.nintendo.failure = { error: 'ECONNRESET' };
    for (let i = 0; i < 10; i += 1) await world.tick(1);
    world.nintendo.failure = null;
    for (let i = 0; i < 3; i += 1) await world.tick(1);
    const lines = logs.loud();
    assert.equal(lines.length, 2, lines.join('\n'));
    assert.match(lines[0], /\[WARN\].*unreachable/);
    assert.match(lines[1], /\[INFO\].*answers again/);
  } finally {
    await world.cleanup();
  }
});

test('a user action writes one info line', async (t) => {
  const logs = captureLogs(t);
  const world = await createWorld();
  try {
    logs.clear();
    await world.gladys.fake.sceneAction('add_bonus_time', {
      console: world.ids(SWITCH).device,
      minutes: '15',
    });
    assert.equal(logs.loud().length, 1, logs.loud().join('\n'));
    assert.match(logs.loud()[0], /\[INFO\].*15 min of bonus for Living room/);
  } finally {
    await world.cleanup();
  }
});

test('no secret reaches the logs, even at the debug level and on errors', async (t) => {
  const logs = captureLogs(t);
  const world = await createWorld({ linked: false });
  try {
    const link = await world.signIn();
    await world.add(SWITCH);
    await world.gladys.fake.action('check_connection');
    for (const failure of [
      { status: 401 },
      { status: 403 },
      { status: 429 },
      { status: 500 },
      { status: 400, errorCode: 'update_required' },
      { error: 'ETIMEDOUT' },
    ]) {
      world.nintendo.failure = failure;
      await world.tick(6);
    }
    world.nintendo.failure = null;
    world.nintendo.expireIdToken();
    await world.tick(6);
    // A refused link, a refused session.
    await world.gladys.fake.configUpdated({
      ...world.gladys.fake.config,
      redirect_link: link.replace('state=', 'state=x'),
    });
    world.nintendo.revokeSessions();
    await world.tick(6);
    await world.gladys.fake.configUpdated({ ...world.gladys.fake.config, redirect_link: link });
    assert.ok(logs.lines.length > 0);
    for (const line of logs.lines) {
      assert.ok(!line.includes(SESSION_TOKEN), `session token in: ${line}`);
      assert.ok(!line.includes(ID_TOKEN_PREFIX), `id token in: ${line}`);
      assert.ok(!line.includes(CODE_PREFIX), `sign-in code in: ${line}`);
      assert.ok(!line.includes('session_token_code_verifier'), `verifier in: ${line}`);
    }
  } finally {
    await world.cleanup();
  }
});
