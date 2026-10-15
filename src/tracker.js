// -----------------------------------------------------------------------------
// What happens between two readings of a console: is someone playing, which
// game, and the scene events.
//
// Nintendo publishes no "playing now" flag: the console uploads its play time
// every few minutes. A console is taken as playing while its play time of the
// day keeps growing; it stops after a grace period without growth (the upload
// pace of the console is not documented, hence a generous grace). The game
// that grew the most between two readings is the current game.
//
// Events, each on a transition only (never twice for the same crossing):
//   - started_playing: the console starts playing;
//   - limit_approaching: while playing, the remaining time goes below one of
//     THRESHOLDS (each threshold is an event, the scene filters on it);
//   - limit_exceeded: the play time reaches the daily limit plus the bonus.
// A raised limit or a bonus re-arms them. The first reading (container
// start, new day) only sets the baseline: no event.
// -----------------------------------------------------------------------------

/** The thresholds of the "limit almost reached" trigger, in minutes. */
export const THRESHOLDS = [5, 10, 15, 30];

/** A console stops "playing" after this long without new play time, at least. */
export const PLAYING_GRACE_MS = 20 * 60 * 1000;

/** A console that sent play data this recently is "online". */
export const ONLINE_WINDOW_MS = 20 * 60 * 1000;

/**
 * @param {object|undefined} track the previous track of the console (persisted)
 * @param {ReturnType<import('./nintendo/model.js').buildSnapshot>} snapshot
 * @param {number} now
 * @param {number} graceMs
 * @returns {{ track: object, events: Array<{ key: string, data: object }> }}
 */
export function observe(track, snapshot, now, graceMs = PLAYING_GRACE_MS) {
  const games = Object.fromEntries(snapshot.games.map((game) => [game.id, game.minutes]));
  if (!track || track.date !== snapshot.date) {
    return {
      track: {
        date: snapshot.date,
        played: snapshot.played,
        games,
        // A new day keeps the last game, not the play in progress.
        lastIncreaseAt: null,
        playing: false,
        game: snapshot.lastGame ?? track?.game ?? null,
        remaining: snapshot.remaining,
        limitReached: snapshot.limitReached,
      },
      events: [],
    };
  }

  let { lastIncreaseAt, game } = track;
  if (snapshot.played > track.played) {
    lastIncreaseAt = now;
    game = grownGame(track.games, snapshot.games) ?? game ?? snapshot.lastGame;
  }
  const playing = lastIncreaseAt !== null && now - lastIncreaseAt < graceMs;

  const events = [];
  const data = {
    game: game?.title ?? '',
    playing_minutes: snapshot.played,
    remaining_minutes: snapshot.remaining,
    limit_minutes: snapshot.limit ?? 0,
  };
  if (playing && !track.playing) {
    events.push({ key: 'started_playing', data });
  }
  if (playing && snapshot.constrained && snapshot.remaining > 0) {
    // The largest first: the order a parent reads them in.
    for (const threshold of [...THRESHOLDS].reverse()) {
      if (track.remaining > threshold && snapshot.remaining <= threshold) {
        events.push({ key: 'limit_approaching', data: { ...data, minutes: threshold } });
      }
    }
  }
  if (snapshot.limitReached && !track.limitReached) {
    events.push({ key: 'limit_exceeded', data });
  }

  return {
    track: {
      date: snapshot.date,
      played: snapshot.played,
      games,
      lastIncreaseAt,
      playing,
      game,
      remaining: snapshot.remaining,
      limitReached: snapshot.limitReached,
    },
    events,
  };
}

/** Still playing at `now`, without a new reading (the grace runs out). */
export function isPlaying(track, now, graceMs = PLAYING_GRACE_MS) {
  return (
    Boolean(track?.lastIncreaseAt !== null && track?.lastIncreaseAt !== undefined) &&
    now - track.lastIncreaseAt < graceMs
  );
}

/**
 * Online: the console sent play data recently, or is playing.
 * @param {{ reportedAt: number|null }} snapshot
 */
export function isOnline(snapshot, track, now, graceMs = PLAYING_GRACE_MS) {
  const reported =
    snapshot.reportedAt !== null && now - snapshot.reportedAt * 1000 < ONLINE_WINDOW_MS;
  return reported || isPlaying(track, now, graceMs);
}

function grownGame(before, games) {
  let best = null;
  let bestDelta = 0;
  for (const game of games) {
    const delta = game.minutes - (before?.[game.id] ?? 0);
    if (delta > bestDelta) {
      best = { id: game.id, title: game.title };
      bestDelta = delta;
    }
  }
  return best;
}
