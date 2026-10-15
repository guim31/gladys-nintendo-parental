// -----------------------------------------------------------------------------
// From the Nintendo answers to the snapshot of a console: the regulation of
// the day, the limit, the bonus, bedtime and the remaining time, on the real
// answers of the fixtures and on the variants pynintendoparental tests.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildSnapshot,
  gamesOf,
  limitValues,
  localTime,
  parseLimit,
  remainingMinutes,
  withDailyLimit,
  withRestrictionMode,
} from '../src/nintendo/model.js';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/nintendo/${name}`, import.meta.url), 'utf8'));
const owned = fixture('owned_devices.json').ownedDevices;
const daily1 = fixture('daily_summaries_switch.json');
const daily2 = fixture('daily_summaries_switch2.json');
const settings1 = fixture('parental_control_setting_switch.json');
const settings2 = fixture('parental_control_setting_switch2.json');

const MONDAY_EVENING = Date.parse('2025-12-08T19:40:00Z');
const snapshot = (overrides = {}) =>
  buildSnapshot({
    owned: owned[0],
    daily: daily1,
    settings: settings1,
    now: MONDAY_EVENING,
    timeZone: 'Europe/London',
    ...overrides,
  });

test('the local day follows the time zone of Gladys', () => {
  assert.deepEqual(localTime(MONDAY_EVENING, 'Europe/London'), {
    date: '2025-12-08',
    weekday: 'monday',
    hour: 19,
    minute: 40,
  });
  // Already Tuesday in Tokyo: the summaries of Monday are yesterday's there.
  assert.equal(localTime(MONDAY_EVENING, 'Asia/Tokyo').weekday, 'tuesday');
  assert.equal(localTime(MONDAY_EVENING, 'Asia/Tokyo').date, '2025-12-09');
});

test('a Switch in the daily mode without limit (real answers)', () => {
  const s = snapshot();
  assert.equal(s.id, '567D0B5EA9582FB7');
  assert.equal(s.label, 'Living room');
  assert.equal(s.model, 'Switch');
  assert.equal(s.played, 60);
  assert.equal(s.limit, null);
  assert.equal(s.bonus, null);
  assert.equal(s.suspend, false);
  assert.equal(s.timerMode, 'daily');
  // No limit, no bedtime: until midnight, like the app and Home Assistant.
  assert.equal(s.remaining, 260);
  assert.equal(s.constrained, false);
  assert.equal(s.limitReached, false);
  assert.deepEqual(s.games, [{ id: '0100152000022000', title: 'five', minutes: 15 }]);
  assert.deepEqual(s.lastGame, { id: '0100152000022000', title: 'five' });
  assert.equal(s.reportedAt, 1765222472);
});

test('a Switch 2 in the per-day mode: Monday has a 2-hour limit (real summaries)', () => {
  const s = buildSnapshot({
    owned: owned[1],
    daily: daily2,
    settings: settings2,
    now: MONDAY_EVENING,
    timeZone: 'Europe/London',
  });
  assert.equal(s.model, 'Switch 2');
  assert.equal(s.timerMode, 'each_day');
  assert.equal(s.limit, 120);
  assert.equal(s.played, 0);
  assert.equal(s.remaining, 120);
  assert.equal(s.constrained, true);
  assert.equal(s.suspend, true);
  // Nothing played today: the last game is the one of the latest day with play.
  assert.equal(s.lastGame.title, 'Minecraft for Nintendo Switch');
  // Tuesday has a 6-hour limit in this answer, Friday a zero one.
  const tuesday = buildSnapshot({
    owned: owned[1],
    daily: daily2,
    settings: settings2,
    now: Date.parse('2025-12-09T10:00:00Z'),
    timeZone: 'Europe/London',
  });
  assert.equal(tuesday.limit, 360);
  assert.equal(tuesday.played, 0, 'no summary for the day yet: nothing played');
});

test('the summaries of another day are not today', () => {
  const s = snapshot({ now: Date.parse('2025-12-09T08:00:00Z') });
  assert.equal(s.played, 0);
  assert.deepEqual(s.games, []);
  assert.equal(s.lastGame.title, 'five');
});

function withPlay(limit, extra, bedtime) {
  const settings = structuredClone(settings1);
  const daily = settings.parentalControlSetting.playTimerRegulations.dailyRegulations;
  if (limit !== undefined) daily.timeToPlayInOneDay = { enabled: true, limitTime: limit };
  if (bedtime)
    daily.bedtime = { enabled: true, endingTime: bedtime, startingTime: { hour: 6, minute: 0 } };
  settings.ownedDevice.device.extraPlayingTime = extra ?? null;
  return settings;
}

test('limit, bonus and remaining time', () => {
  // 60 played, 90 allowed.
  let s = snapshot({ settings: withPlay(90) });
  assert.equal(s.remaining, 30);
  assert.equal(s.constrained, true);
  assert.equal(s.limitReached, false);
  // 60 played, 45 allowed: reached, nothing left.
  s = snapshot({ settings: withPlay(45) });
  assert.equal(s.remaining, 0);
  assert.equal(s.limitReached, true);
  // + 30 minutes of bonus.
  s = snapshot({
    settings: withPlay(45, { inOneDay: { isInfinity: false, duration: 30 }, bedtime: null }),
  });
  assert.equal(s.bonus, 30);
  assert.equal(s.remaining, 15);
  assert.equal(s.limitReached, false);
  // No limit today.
  s = snapshot({
    settings: withPlay(45, { inOneDay: { isInfinity: true, duration: null }, bedtime: null }),
  });
  assert.equal(s.bonus, -1);
  assert.equal(s.limitReached, false);
  assert.equal(s.remaining, 260);
  // A disabled limit keeps no value.
  const disabled = withPlay(45);
  disabled.parentalControlSetting.playTimerRegulations.dailyRegulations.timeToPlayInOneDay.enabled = false;
  assert.equal(snapshot({ settings: disabled }).limit, null);
});

test('bedtime bounds the remaining time, only while the alarms are shown', () => {
  // Bedtime at 20:00, 20 minutes from 19:40.
  let s = snapshot({ settings: withPlay(undefined, null, { hour: 20, minute: 0 }) });
  assert.equal(s.remaining, 20);
  assert.equal(s.constrained, true);
  // Bedtime pushed back to 21:00 by a bonus: 60 minutes of bonus, 80 left.
  s = snapshot({
    settings: withPlay(
      undefined,
      { bedtime: { endTime: { hour: 21, minute: 0 } }, inOneDay: null },
      { hour: 20, minute: 0 },
    ),
  });
  assert.equal(s.bonus, 60);
  assert.equal(s.remaining, 80);
  // Alarms hidden for today: bedtime does not count.
  const hidden = withPlay(undefined, null, { hour: 20, minute: 0 });
  hidden.ownedDevice.device.alarmSetting.visibility = 'INVISIBLE';
  assert.equal(snapshot({ settings: hidden }).remaining, 260);
});

test('a bedtime after midnight is tonight', () => {
  const local = { hour: 22, minute: 0 };
  assert.deepEqual(remainingMinutes({ local, limit: null, bonus: null, played: 0, bedtime: 60 }), {
    minutes: 120,
    constrained: false,
  });
});

test('the games of both console generations', () => {
  // Switch 2 answers nest the id in `meta`, like the Switch: both read.
  const games = gamesOf(
    {
      players: [
        { playedGames: [{ meta: { applicationId: 'A', title: 'Alpha' }, playingTime: 10 }] },
        {
          playedGames: [
            { applicationId: 'A', playingTime: 5 },
            { applicationId: 'B', playingTime: 7 },
          ],
        },
      ],
    },
    new Map([['B', 'Beta']]),
  );
  assert.deepEqual(games, [
    { id: 'A', title: 'Alpha', minutes: 15 },
    { id: 'B', title: 'Beta', minutes: 7 },
  ]);
});

test('a new daily limit is written where the app writes it', () => {
  const daily = settings1.parentalControlSetting.playTimerRegulations;
  const next = withDailyLimit(daily, 90, 'monday');
  assert.deepEqual(Object.keys(next).sort(), [
    'dailyRegulations',
    'eachDayOfTheWeekRegulations',
    'restrictionMode',
    'timerMode',
  ]);
  assert.deepEqual(next.dailyRegulations.timeToPlayInOneDay, { enabled: true, limitTime: 90 });
  assert.deepEqual(
    next.eachDayOfTheWeekRegulations.monday,
    daily.eachDayOfTheWeekRegulations.monday,
    'the per-day regulations stay',
  );
  assert.equal(daily.dailyRegulations.timeToPlayInOneDay.limitTime, null, 'input untouched');
  assert.equal('bedtimeStartingTime' in next, false);

  const perDay = settings2.parentalControlSetting.playTimerRegulations;
  const removed = withDailyLimit(perDay, null, 'monday');
  assert.deepEqual(removed.eachDayOfTheWeekRegulations.monday.timeToPlayInOneDay, {
    enabled: false,
  });
  assert.deepEqual(removed.dailyRegulations, perDay.dailyRegulations);
});

test('the restriction mode', () => {
  const regulations = settings1.parentalControlSetting.playTimerRegulations;
  assert.equal(withRestrictionMode(regulations, true).restrictionMode, 'FORCED_TERMINATION');
  assert.equal(withRestrictionMode(regulations, false).restrictionMode, 'ALARM');
});

test('the daily limits the app offers', () => {
  assert.equal(parseLimit('none'), null);
  assert.equal(parseLimit('90'), 90);
  assert.equal(parseLimit(360), 360);
  for (const refused of ['0', '10', '375', 'abc', '', '-5', '1.5']) {
    assert.throws(() => parseLimit(refused), RangeError, refused);
  }
  assert.equal(limitValues().length, 25);
  assert.deepEqual(limitValues().slice(0, 3), ['none', '15', '30']);
});
