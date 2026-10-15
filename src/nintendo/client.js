// -----------------------------------------------------------------------------
// Client of the Nintendo Switch Parental Controls API ("moon"), the private
// API of the mobile app, as documented by the pynintendoparental library
// (MIT, Justin Hammond) used by Home Assistant. Same endpoints, same headers:
// the API answers only to requests that look like the app's.
//
// The id token comes from `getIdToken()` (src/session.js): a 401 asks for a
// new one and the request is tried once more.
// -----------------------------------------------------------------------------

export const BASE_URL = 'https://app.lp1.znma.srv.nintendo.net';

// The app the requests present themselves as (pynintendoparental 2.6).
const APP = {
  package: 'com.nintendo.znma',
  version: '2.6.0',
  build: '700',
  os: 'ANDROID',
  osVersion: '34',
  model: 'Pixel 4 XL',
};
const USER_AGENT = `moon_ANDROID/${APP.version} (${APP.package}; build:${APP.build}; ${APP.os} ${APP.osVersion})`;

/**
 * A Parental Controls API problem. `kind`:
 * - `auth`: the id token was refused twice;
 * - `not_found`: no console on the account (404 on the device list) or unknown console;
 * - `update_required`: Nintendo requires a newer app version;
 * - `rate_limit`: HTTP 429;
 * - `rejected`: Nintendo answered but did not apply a change (bonus refused...);
 * - `unreachable`: network error, timeout or server error.
 */
export class NintendoApiError extends Error {
  /**
   * @param {string} kind
   * @param {string} message never contains a token
   * @param {object} [details] { status, code }
   */
  constructor(kind, message, { status, code } = {}) {
    super(message);
    this.name = 'NintendoApiError';
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

/** Answers of `updateExtraPlayingTime` / `confirmExtraPlayingTime` that applied nothing. */
export const EXTRA_TIME_ERRORS = [
  'NO_EFFECT',
  'OVERTIME_ERROR',
  'DURING_LATE_NIGHT_ERROR',
  'FAILED',
];

/**
 * @param {object} options
 * @param {typeof fetch} options.fetch
 * @param {(options?: { force?: boolean }) => Promise<string>} options.getIdToken
 * @param {string} options.timeZone IANA zone of Gladys: Nintendo computes "today" in it
 * @param {string} options.language e.g. fr-FR, for the game titles
 * @param {number} [options.timeoutMs]
 */
export function createNintendoClient({ fetch, getIdToken, timeZone, language, timeoutMs = 15000 }) {
  function headers(idToken) {
    return {
      'User-Agent': USER_AGENT,
      'X-Moon-App-Id': APP.package,
      'X-Moon-Os': APP.os,
      'X-Moon-Os-Version': APP.osVersion,
      'X-Moon-Model': APP.model,
      'X-Moon-App-Display-Version': APP.version,
      'X-Moon-App-Internal-Version': APP.build,
      'X-Moon-TimeZone': timeZone,
      'X-Moon-Os-Language': language,
      'X-Moon-App-Language': language,
      Authorization: `Bearer ${idToken}`,
      Accept: 'application/json',
    };
  }

  async function send(method, path, body, retried = false) {
    const idToken = await getIdToken({ force: retried });
    let response;
    try {
      response = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: {
          ...headers(idToken),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new NintendoApiError(
        'unreachable',
        `Nintendo Parental Controls unreachable (${err.cause?.code ?? err.name})`,
      );
    }
    const endpoint = path.split('?')[0];
    if (response.status === 401 && !retried) {
      return send(method, path, body, true);
    }
    if (!response.ok) {
      throw await toError(response, endpoint);
    }
    try {
      return await response.json();
    } catch {
      throw new NintendoApiError('unreachable', `${endpoint}: answer is not JSON`, {
        status: response.status,
      });
    }
  }

  const query = (deviceId) => `deviceId=${encodeURIComponent(deviceId)}`;

  return {
    /** Consoles linked to the account (`ownedDevices`). */
    async getOwnedDevices() {
      const json = await send('GET', '/v2/actions/user/fetchOwnedDevices');
      return Array.isArray(json?.ownedDevices) ? json.ownedDevices : [];
    },

    /** Daily play summaries, the latest day first (`dailySummaries`, `lastUpdatedAt`). */
    getDailySummaries(deviceId) {
      return send('GET', `/v2/actions/playSummary/fetchDailySummaries?${query(deviceId)}`);
    },

    /** Settings of the console (`parentalControlSetting`, `ownedDevice`). */
    getParentalControlSetting(deviceId) {
      return send(
        'GET',
        `/v2/actions/parentalControlSetting/fetchParentalControlSetting?${query(deviceId)}`,
      );
    },

    /**
     * Write the play timer of a console (limit, restriction mode). Answers the
     * new settings, like `getParentalControlSetting`.
     * @param {string} deviceId
     * @param {object} playTimerRegulations
     */
    updatePlayTimer(deviceId, playTimerRegulations) {
      return send('POST', '/v3/actions/parentalControlSetting/updatePlayTimer', {
        deviceId,
        playTimerRegulations,
      });
    },

    /**
     * Grant extra play time for today. When it would run into bedtime, Nintendo
     * asks for a confirmation (`nextStepDetail`) that the app gives by pushing
     * bedtime back too: done here the same way.
     * @param {string} deviceId
     * @param {number} minutes
     */
    async addExtraPlayingTime(deviceId, minutes) {
      const answer = await send('POST', '/v2/actions/device/updateExtraPlayingTime', {
        deviceId,
        additionalTime: minutes,
        status: 'TO_ADDED',
      });
      checkExtraTime(answer);
      if (answer?.nextStepDetail) {
        const confirmed = await send('POST', '/v2/actions/device/confirmExtraPlayingTime', {
          deviceId,
          additionalTime: minutes,
          withBedtime: true,
        });
        checkExtraTime(confirmed);
      }
    },
  };
}

// Nintendo answers 200 whatever the outcome of an extra time request: the
// JSON status says whether it applied. An unknown status is taken as a
// success, so that a new value does not break a working setup.
function checkExtraTime(answer) {
  const status = answer?.status;
  if (typeof status === 'string' && EXTRA_TIME_ERRORS.includes(status)) {
    throw new NintendoApiError('rejected', `Nintendo did not add the time (${status})`, {
      code: status,
    });
  }
}

async function toError(response, endpoint) {
  const status = response.status;
  let code;
  if (String(response.headers.get('content-type') ?? '').includes('json')) {
    try {
      const problem = await response.json();
      code = typeof problem?.errorCode === 'string' ? problem.errorCode.slice(0, 60) : undefined;
    } catch {
      // No details.
    }
  }
  const suffix = code ? `, ${code}` : '';
  if (code === 'update_required') {
    return new NintendoApiError(
      'update_required',
      `Nintendo requires a newer version of the app (HTTP ${status}${suffix})`,
      { status, code },
    );
  }
  if (status === 401 || status === 403) {
    return new NintendoApiError('auth', `${endpoint}: access refused (HTTP ${status}${suffix})`, {
      status,
      code,
    });
  }
  if (status === 404) {
    return new NintendoApiError('not_found', `${endpoint}: not found (HTTP 404${suffix})`, {
      status,
      code,
    });
  }
  if (status === 429) {
    return new NintendoApiError('rate_limit', `${endpoint}: too many requests (HTTP 429)`, {
      status,
      code,
    });
  }
  if (status >= 400 && status < 500) {
    return new NintendoApiError('rejected', `${endpoint}: refused (HTTP ${status}${suffix})`, {
      status,
      code,
    });
  }
  return new NintendoApiError('unreachable', `${endpoint}: server error (HTTP ${status})`, {
    status,
    code,
  });
}
