// -----------------------------------------------------------------------------
// From the Nintendo answers to what the integration shows: one snapshot per
// console. Pure functions, ported from pynintendoparental (MIT): the "today"
// regulation, the daily limit, the bonus time, bedtime and the remaining time.
//
// "Today" is the calendar day in the time zone of Gladys, the zone sent to
// Nintendo in X-Moon-TimeZone: the daily summaries are dated in it.
// -----------------------------------------------------------------------------

export const DAYS_OF_WEEK = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

/** The limits offered by the Parental Controls app: 15 minutes to 6 hours, by 15 minutes. */
export const LIMIT_STEP = 15;
export const LIMIT_MAX = 360;

/** Extra time Nintendo accepts per request (the bounds Home Assistant uses). */
export const BONUS_CHOICES = [5, 10, 15, 30];

const MODELS = { P00: 'Switch', P01: 'Switch 2' };

/**
 * Date and time of an instant in a time zone.
 * @param {number} ms
 * @param {string} timeZone
 * @returns {{ date: string, weekday: string, hour: number, minute: number }}
 */
export function localTime(ms, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      weekday: 'long',
    })
      .formatToParts(new Date(ms))
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: parts.weekday.toLowerCase(),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

/**
 * The identity of a console from the device list.
 * @param {object} owned an entry of `ownedDevices`
 */
export function parseOwnedDevice(owned) {
  const generation = owned?.device?.platformGeneration ?? null;
  return {
    id: String(owned.deviceId),
    label: typeof owned.label === 'string' && owned.label.trim() !== '' ? owned.label.trim() : null,
    model: MODELS[generation] ?? null,
  };
}

/**
 * The regulation that applies today: the daily one, or the one of the day of
 * the week in the "each day" timer mode.
 * @param {object} regulations `playTimerRegulations`
 * @param {string} weekday
 */
export function todayRegulation(regulations, weekday) {
  if (regulations?.timerMode === 'EACH_DAY_OF_THE_WEEK') {
    return regulations.eachDayOfTheWeekRegulations?.[weekday] ?? {};
  }
  return regulations?.dailyRegulations ?? {};
}

function toMinutes(time) {
  if (!time || !Number.isFinite(time.hour) || !Number.isFinite(time.minute)) {
    return null;
  }
  return time.hour * 60 + time.minute;
}

/**
 * Everything the integration knows about a console at one instant.
 * @param {object} input
 * @param {object} input.owned entry of `ownedDevices`
 * @param {object} input.daily answer of fetchDailySummaries
 * @param {object} input.settings answer of fetchParentalControlSetting
 * @param {number} input.now
 * @param {string} input.timeZone
 */
export function buildSnapshot({ owned, daily, settings, now, timeZone }) {
  const identity = parseOwnedDevice(owned);
  const local = localTime(now, timeZone);
  const setting = settings?.parentalControlSetting ?? {};
  const regulations = setting.playTimerRegulations ?? {};
  const regulation = todayRegulation(regulations, local.weekday);
  const device = settings?.ownedDevice?.device ?? owned?.device ?? {};

  // Daily limit: null when none applies today.
  const playLimit = regulation.timeToPlayInOneDay ?? {};
  const limit =
    playLimit.enabled !== false && Number.isFinite(playLimit.limitTime)
      ? playLimit.limitTime
      : null;

  // Bedtime alarm: when the console asks to stop for the night.
  const bedtimeEnabled = regulation.bedtime?.enabled === true;
  let bedtime = bedtimeEnabled ? toMinutes(regulation.bedtime?.endingTime) : null;
  const alarmsEnabled = device.alarmSetting?.visibility === 'VISIBLE';

  // Extra time granted today: -1 for "no limit today", null for none.
  let bonus = null;
  const extra = device.extraPlayingTime;
  if (extra && bedtimeEnabled && extra.bedtime) {
    const extended = toMinutes(extra.bedtime.endTime);
    if (extended !== null && bedtime !== null) {
      bonus = (((extended - bedtime) % 1440) + 1440) % 1440;
      bedtime = extended;
    }
  } else if (extra?.inOneDay?.isInfinity) {
    bonus = -1;
  } else if (extra?.inOneDay && Number.isFinite(extra.inOneDay.duration)) {
    bonus = extra.inOneDay.duration;
  }

  const summaries = Array.isArray(daily?.dailySummaries) ? daily.dailySummaries : [];
  const titles = applicationTitles(setting);
  const todaySummary = summaries[0]?.date === local.date ? summaries[0] : null;
  const played = Math.max(0, Number(todaySummary?.playingTime) || 0);
  const games = todaySummary ? gamesOf(todaySummary, titles) : [];

  const remaining = remainingMinutes({
    local,
    limit,
    bonus,
    played,
    bedtime: alarmsEnabled && bedtime !== null && bedtime !== 0 ? bedtime : null,
  });

  return {
    ...identity,
    date: local.date,
    played,
    games,
    lastGame: games.length > 0 ? maxBy(games) : latestGame(summaries, titles),
    limit,
    bonus,
    remaining: remaining.minutes,
    // The remaining time is bounded by a limit or bedtime, not just by midnight.
    constrained: remaining.constrained,
    limitReached: limit !== null && bonus !== -1 && played >= limit + (bonus ?? 0),
    suspend: regulations.restrictionMode === 'FORCED_TERMINATION',
    timerMode: regulations.timerMode === 'EACH_DAY_OF_THE_WEEK' ? 'each_day' : 'daily',
    // Seconds: the last time the console sent its play data.
    reportedAt: Number.isFinite(daily?.lastUpdatedAt) ? daily.lastUpdatedAt : null,
  };
}

/**
 * The remaining play time of today, as the Parental Controls app shows it:
 * the smallest of what the limit (plus the bonus) leaves and of the time until
 * the bedtime alarm; without either, the time until midnight.
 */
export function remainingMinutes({ local, limit, bonus, played, bedtime }) {
  const nowMinutes = local.hour * 60 + local.minute;
  const endOfDay = 1440 - nowMinutes;
  const byLimit = limit === null || bonus === -1 ? endOfDay : limit + (bonus ?? 0) - played;
  let byBedtime = endOfDay;
  if (bedtime !== null) {
    let at = bedtime;
    // A bedtime after midnight (before 6:00) is tonight's, seen from the day.
    if (at <= nowMinutes && at < 360 && nowMinutes >= 360) {
      at += 1440;
    }
    byBedtime = Math.max(0, at - nowMinutes);
  }
  const minutes = Math.max(0, Math.min(byLimit, byBedtime));
  return { minutes, constrained: Math.min(byLimit, byBedtime) < endOfDay };
}

/** Titles of the applications known to the console, by application id. */
function applicationTitles(setting) {
  const titles = new Map();
  for (const app of setting.whitelistedApplicationList ?? []) {
    if (app?.applicationId && typeof app.title === 'string') {
      titles.set(app.applicationId, app.title);
    }
  }
  return titles;
}

/**
 * The games of one daily summary, every player added up.
 * @returns {Array<{ id: string, title: string, minutes: number }>}
 */
export function gamesOf(summary, titles = new Map()) {
  const games = new Map();
  for (const player of summary?.players ?? []) {
    for (const entry of player?.playedGames ?? []) {
      // The two console generations do not nest the id the same way.
      const id = entry?.applicationId ?? entry?.meta?.applicationId;
      if (!id) {
        continue;
      }
      const title = entry?.meta?.title ?? entry?.title ?? titles.get(id) ?? id;
      const game = games.get(id) ?? { id, title: String(title), minutes: 0 };
      game.minutes += Math.max(0, Number(entry.playingTime) || 0);
      games.set(id, game);
    }
  }
  return [...games.values()];
}

/** The game played most on the most recent day with play, for a fresh start. */
function latestGame(summaries, titles) {
  for (const summary of summaries) {
    const games = gamesOf(summary, titles);
    if (games.length > 0) {
      return maxBy(games);
    }
  }
  return null;
}

function maxBy(games) {
  const best = games.reduce((a, b) => (b.minutes > a.minutes ? b : a));
  return { id: best.id, title: best.title };
}

/**
 * The `playTimerRegulations` to send for a new daily limit, written where the
 * app writes it: the daily regulation, or today's day of the week.
 * @param {object} regulations current `playTimerRegulations`
 * @param {number|null} minutes null removes the limit
 * @param {string} weekday
 */
export function withDailyLimit(regulations, minutes, weekday) {
  const next = pickRegulations(structuredClone(regulations));
  const regulation =
    next.timerMode === 'EACH_DAY_OF_THE_WEEK'
      ? (next.eachDayOfTheWeekRegulations[weekday] ??= {})
      : (next.dailyRegulations ??= {});
  const playLimit = (regulation.timeToPlayInOneDay ??= {});
  playLimit.enabled = minutes !== null;
  if (minutes === null && 'limitTime' in playLimit) {
    delete playLimit.limitTime;
  } else {
    playLimit.limitTime = minutes;
  }
  return next;
}

/**
 * The `playTimerRegulations` to send for a restriction mode.
 * @param {object} regulations
 * @param {boolean} suspend true: suspend the software at the limit; false: alarm only
 */
export function withRestrictionMode(regulations, suspend) {
  const next = pickRegulations(structuredClone(regulations));
  next.restrictionMode = suspend ? 'FORCED_TERMINATION' : 'ALARM';
  return next;
}

// The update accepts these four keys only (the app drops the others).
function pickRegulations(regulations) {
  return {
    timerMode: regulations.timerMode,
    restrictionMode: regulations.restrictionMode,
    dailyRegulations: regulations.dailyRegulations ?? {},
    eachDayOfTheWeekRegulations: regulations.eachDayOfTheWeekRegulations ?? {},
  };
}

/**
 * A daily limit typed or chosen by the user: minutes, null for "no limit".
 * The Parental Controls app offers 15 minutes to 6 hours by steps of 15.
 * @param {unknown} value 'none', '90', 90...
 * @returns {number|null}
 */
export function parseLimit(value) {
  const text = String(value ?? '')
    .trim()
    .toLowerCase();
  if (text === 'none' || text === '-1') {
    return null;
  }
  const minutes = Number(text);
  if (
    !Number.isInteger(minutes) ||
    minutes < LIMIT_STEP ||
    minutes > LIMIT_MAX ||
    minutes % LIMIT_STEP !== 0
  ) {
    throw new RangeError(
      `Daily limit "${String(value).slice(0, 20)}" refused: 15 to 360 minutes by steps of 15, or none`,
    );
  }
  return minutes;
}

/** The values of the daily limit select: "none", then 15 to 360. */
export function limitValues() {
  const values = ['none'];
  for (let minutes = LIMIT_STEP; minutes <= LIMIT_MAX; minutes += LIMIT_STEP) {
    values.push(String(minutes));
  }
  return values;
}
