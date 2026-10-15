// -----------------------------------------------------------------------------
// The Nintendo session of the integration: the sign-ins in progress, the
// session token kept in /data, the id token kept in memory and renewed before
// it expires (one renewal at a time, whoever asks).
//
// A pasted link is used once: its fingerprint and outcome are remembered, so
// a restart or another configuration change does not send a refused code to
// Nintendo again. Only a network failure is tried again.
// -----------------------------------------------------------------------------

import {
  NintendoAuthError,
  TOKEN_EXPIRY_MARGIN_MS,
  createLogin,
  exchangeCode,
  linkFingerprint,
  parseRedirectLink,
  refreshTokens,
} from './nintendo/auth.js';
import { MAX_PENDING, PENDING_TTL_MS } from './store.js';

/**
 * @param {object} options
 * @param {ReturnType<import('./store.js').createStore>} options.store
 * @param {typeof fetch} options.fetch
 * @param {() => number} options.now
 */
export function createSession({ store, fetch, now }) {
  let idToken = null;
  let expiresAt = 0;
  let renewing = null;

  async function renew() {
    const token = store.data.session?.token;
    if (!token) {
      throw new NintendoAuthError('not_linked', 'No Nintendo account connected');
    }
    try {
      const fresh = await refreshTokens({ fetch, sessionToken: token, now });
      idToken = fresh.idToken;
      expiresAt = fresh.expiresAt;
      return idToken;
    } catch (err) {
      if (err.kind === 'refused' && store.data.session?.token === token) {
        // Dead for good: forget it, only a new sign-in helps.
        store.data.session = null;
        store.data.ended = true;
        idToken = null;
      }
      throw err;
    }
  }

  return {
    /** True when a session token is known. */
    get linked() {
      return Boolean(store.data.session?.token);
    },

    /** True when Nintendo refused the last session token (signed out, password changed). */
    get ended() {
      return store.data.ended === true;
    },

    /** Outcome of the last pasted link: 'linked' | 'invalid_link' | 'other_login' | 'refused' | null. */
    get linkOutcome() {
      return store.data.linkAttempt?.result ?? null;
    },

    /** Start a sign-in: the URL the "Connect" button opens. */
    startLogin() {
      const login = createLogin();
      const at = now();
      store.data.pending = [
        { state: login.state, verifier: login.verifier, at },
        ...store.data.pending.filter((entry) => at - entry.at < PENDING_TTL_MS),
      ].slice(0, MAX_PENDING);
      return login.url;
    },

    /**
     * Finish a sign-in with the pasted link, once per link.
     * @param {string} link
     * @returns {Promise<'linked'|'already'>}
     */
    async finishLogin(link) {
      const fingerprint = linkFingerprint(link);
      const attempt = store.data.linkAttempt;
      if (attempt?.fingerprint === fingerprint) {
        if (attempt.result === 'linked') {
          if (store.data.session?.token) {
            return 'already';
          }
          // The session it gave has ended: a code is single use.
          throw new NintendoAuthError('refused', 'This link was already used');
        }
        throw new NintendoAuthError(attempt.result, 'This link was already tried');
      }
      const remember = (result) => {
        store.data.linkAttempt = { fingerprint, result };
      };
      let parsed;
      try {
        parsed = parseRedirectLink(link);
      } catch (err) {
        remember(err.kind);
        throw err;
      }
      const pending = store.data.pending.find((entry) => entry.state === parsed.state);
      if (!pending) {
        remember('other_login');
        throw new NintendoAuthError(
          'other_login',
          'The link does not match a sign-in started from this integration',
        );
      }
      let token;
      try {
        token = await exchangeCode({ fetch, code: parsed.code, verifier: pending.verifier });
      } catch (err) {
        if (err.kind !== 'unreachable') {
          remember(err.kind);
          store.data.pending = store.data.pending.filter((entry) => entry !== pending);
        }
        throw err;
      }
      remember('linked');
      store.data.session = { token, linked_at: now() };
      store.data.ended = false;
      store.data.pending = store.data.pending.filter((entry) => entry !== pending);
      idToken = null;
      expiresAt = 0;
      return 'linked';
    },

    /**
     * A valid id token, renewed when it expires within 5 minutes.
     * @param {{ force?: boolean }} [options] force: renew now (the API refused the current one)
     */
    async getIdToken({ force = false } = {}) {
      if (!force && idToken && now() < expiresAt - TOKEN_EXPIRY_MARGIN_MS) {
        return idToken;
      }
      renewing ??= renew().finally(() => {
        renewing = null;
      });
      return renewing;
    },

    /** Forget the session (the "Sign out" action). */
    signOut() {
      const had = Boolean(store.data.session?.token);
      store.data.session = null;
      store.data.pending = [];
      idToken = null;
      expiresAt = 0;
      return had;
    },
  };
}
