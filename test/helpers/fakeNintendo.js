// -----------------------------------------------------------------------------
// A fake Nintendo, behind a `fetch` stub: the accounts server (sign-in, id
// tokens) and the Parental Controls API, serving the fixtures of
// test/fixtures/nintendo. No network: every URL the integration may call is
// answered here, any other one fails the test.
//
// It checks what the real servers check: the PKCE verifier against the
// challenge of the sign-in URL, a session code used once, the bearer id
// token, the shape of the play timer update.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/nintendo/${name}`, import.meta.url), 'utf8'));

/** The two consoles of the fixtures. */
export const SWITCH = '567D0B5EA9582FB7';
export const SWITCH2 = '0A1B2C3D4E5F6071';

/** Secrets the logs must never show. */
export const SESSION_TOKEN = 'SESSION-TOKEN-SECRET-abcdef0123456789';
export const ID_TOKEN_PREFIX = 'ID-TOKEN-SECRET-';
export const CODE_PREFIX = 'SESSION-CODE-SECRET-';

const ACCOUNTS = 'https://accounts.nintendo.com/connect/1.0.0';
const MOON = 'https://app.lp1.znma.srv.nintendo.net';

export function createFakeNintendo() {
  const state = {
    owned: fixture('owned_devices.json'),
    daily: {
      [SWITCH]: fixture('daily_summaries_switch.json'),
      [SWITCH2]: fixture('daily_summaries_switch2.json'),
    },
    settings: {
      [SWITCH]: fixture('parental_control_setting_switch.json'),
      [SWITCH2]: fixture('parental_control_setting_switch2.json'),
    },
  };
  const logins = new Map(); // state -> { challenge, code }
  const usedCodes = new Set();
  const sessions = new Set();
  let idTokens = 0;
  let validIdToken = null;

  const fake = {
    state,
    /** Every request: `{ method, url, headers, body }`. */
    requests: [],
    /** Applied to the Parental Controls API: `{ status, errorCode? }` or `{ error: 'ECONNRESET' }`. */
    failure: null,
    /** Applied to the accounts server. */
    accountsFailure: null,
    /** Answer of updateExtraPlayingTime, when set (e.g. `{ status: 'OVERTIME_ERROR' }`). */
    extraAnswer: null,
    /** Requests seen on the Parental Controls API. */
    get apiRequests() {
      return fake.requests.filter((request) => request.url.startsWith(MOON));
    },

    /**
     * The user signs in on the page of the sign-in URL and copies the link
     * of "Select this person".
     * @param {string} url the URL the "Connect" button opened
     */
    signIn(url) {
      const query = new URL(url).searchParams;
      const code = `${CODE_PREFIX}${logins.size + 1}`;
      logins.set(query.get('state'), {
        challenge: query.get('session_token_code_challenge'),
        code,
      });
      return `npf54789befb391a838://auth#session_state=abc&session_token_code=${code}&state=${query.get('state')}`;
    },

    /** Nintendo revokes the session (password changed). */
    revokeSessions() {
      sessions.clear();
      validIdToken = null;
    },

    /** The current id token expires early. */
    expireIdToken() {
      validIdToken = null;
    },

    /** Today's play time of a console, the extra minutes going to one game. */
    play(deviceId, minutes, game = { id: '0100152000022000', title: 'five' }) {
      const today = state.daily[deviceId].dailySummaries[0];
      const added = minutes - today.playingTime;
      today.playingTime = minutes;
      today.players ??= [];
      if (today.players.length === 0) {
        today.players.push({
          profile: { playerId: 'player-1', nickname: 'Player 1' },
          playingTime: 0,
          playedGames: [],
        });
      }
      const player = today.players[0];
      player.playingTime = (player.playingTime ?? 0) + Math.max(0, added);
      let entry = player.playedGames.find(
        (g) => (g.meta?.applicationId ?? g.applicationId) === game.id,
      );
      if (!entry) {
        entry = { meta: { applicationId: game.id, title: game.title }, playingTime: 0 };
        player.playedGames.push(entry);
      }
      entry.playingTime += Math.max(0, added);
    },

    /** The daily regulation of a console (daily mode). */
    setLimit(deviceId, minutes) {
      const regulations = state.settings[deviceId].parentalControlSetting.playTimerRegulations;
      const target =
        regulations.timerMode === 'EACH_DAY_OF_THE_WEEK'
          ? regulations.eachDayOfTheWeekRegulations.monday
          : regulations.dailyRegulations;
      target.timeToPlayInOneDay =
        minutes === null
          ? { enabled: false, limitTime: null }
          : { enabled: true, limitTime: minutes };
    },

    /** Move every daily summary to a new "today" (a new day starts at 0). */
    newDay(date) {
      for (const daily of Object.values(state.daily)) {
        daily.dailySummaries.unshift({
          date,
          result: 'CALCULATING',
          playingTime: 0,
          exceededTime: 0,
          disabledTime: 0,
          miscTime: 0,
          players: [],
        });
      }
    },

    async fetch(url, init = {}) {
      const method = init.method ?? 'GET';
      const headers = init.headers ?? {};
      const request = { method, url: String(url), headers, body: init.body };
      fake.requests.push(request);
      const href = String(url);

      if (href.startsWith(ACCOUNTS)) {
        if (fake.accountsFailure?.error) throw networkError(fake.accountsFailure.error);
        if (fake.accountsFailure)
          return json(fake.accountsFailure.status, { error: 'server_error' });
        if (href === `${ACCOUNTS}/api/session_token` && method === 'POST') {
          const form = new URLSearchParams(init.body);
          const code = form.get('session_token_code');
          const login = [...logins.values()].find((entry) => entry.code === code);
          if (!login || usedCodes.has(code) || form.get('client_id') !== '54789befb391a838') {
            return json(400, { error: 'invalid_grant', error_description: `bad code ${code}` });
          }
          const challenge = createHash('sha256')
            .update(form.get('session_token_code_verifier') ?? '')
            .digest('base64url');
          if (challenge !== login.challenge) {
            return json(400, { error: 'invalid_request' });
          }
          usedCodes.add(code);
          sessions.add(SESSION_TOKEN);
          return json(200, { session_token: SESSION_TOKEN, code: 'xyz' });
        }
        if (href === `${ACCOUNTS}/api/token` && method === 'POST') {
          const body = JSON.parse(init.body);
          if (!sessions.has(body.session_token)) {
            return json(400, { error: 'invalid_grant' });
          }
          idTokens += 1;
          validIdToken = `${ID_TOKEN_PREFIX}${idTokens}`;
          return json(200, {
            id_token: validIdToken,
            access_token: `ACCESS-${idTokens}`,
            expires_in: 900,
            token_type: 'Bearer',
          });
        }
      }

      if (href.startsWith(MOON)) {
        if (fake.failure?.error) throw networkError(fake.failure.error);
        if (fake.failure) {
          return json(
            fake.failure.status,
            fake.failure.errorCode ? { detail: 'x', errorCode: fake.failure.errorCode } : {},
            'application/problem+json',
          );
        }
        if (headers.Authorization !== `Bearer ${validIdToken}` || !validIdToken) {
          return json(401, { errorCode: 'invalid_token' }, 'application/problem+json');
        }
        if (headers['X-Moon-App-Id'] !== 'com.nintendo.znma' || !headers['X-Moon-TimeZone']) {
          return json(400, { errorCode: 'bad_headers' }, 'application/problem+json');
        }
        const path = href.slice(MOON.length);
        const deviceId = new URL(href).searchParams.get('deviceId');
        if (path === '/v2/actions/user/fetchOwnedDevices') {
          return state.owned.ownedDevices.length === 0
            ? json(404, { errorCode: 'not_found' }, 'application/problem+json')
            : json(200, state.owned);
        }
        if (path.startsWith('/v2/actions/playSummary/fetchDailySummaries')) {
          return state.daily[deviceId] ? json(200, state.daily[deviceId]) : json(404, {});
        }
        if (path.startsWith('/v2/actions/parentalControlSetting/fetchParentalControlSetting')) {
          return state.settings[deviceId] ? json(200, state.settings[deviceId]) : json(404, {});
        }
        const body = init.body ? JSON.parse(init.body) : {};
        if (path === '/v3/actions/parentalControlSetting/updatePlayTimer' && method === 'POST') {
          const keys = Object.keys(body.playTimerRegulations ?? {}).sort();
          const expected = [
            'dailyRegulations',
            'eachDayOfTheWeekRegulations',
            'restrictionMode',
            'timerMode',
          ];
          if (JSON.stringify(keys) !== JSON.stringify(expected) || !state.settings[body.deviceId]) {
            return json(400, { errorCode: 'invalid_parameter' }, 'application/problem+json');
          }
          state.settings[body.deviceId].parentalControlSetting.playTimerRegulations =
            structuredClone(body.playTimerRegulations);
          // Like the real answer: the settings, without the owned device.
          return json(200, {
            parentalControlSetting: state.settings[body.deviceId].parentalControlSetting,
          });
        }
        if (path === '/v2/actions/device/updateExtraPlayingTime' && method === 'POST') {
          if (fake.extraAnswer) return json(200, fake.extraAnswer);
          const device = state.settings[body.deviceId].ownedDevice.device;
          const before = device.extraPlayingTime?.inOneDay?.duration ?? 0;
          device.extraPlayingTime = {
            inOneDay: { isInfinity: false, duration: before + body.additionalTime },
            bedtime: null,
            expiresAt: 1765238399,
          };
          return json(200, { deviceId: body.deviceId, status: 'SUCCESS' });
        }
      }
      throw new Error(`Unexpected request ${method} ${href}`);
    },
  };
  return fake;
}

function json(status, body, type = 'application/json') {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': type } });
}

function networkError(code) {
  const err = new TypeError('fetch failed');
  err.cause = { code };
  return err;
}
