// -----------------------------------------------------------------------------
// Nintendo account sign-in, as the Nintendo Switch Parental Controls app does
// it (and the pynintendoauth library, Apache-2.0, that Home Assistant uses).
//
// 1. The container builds a sign-in URL with a PKCE challenge
//    (`createLogin`). The user opens it, signs in on accounts.nintendo.com and
//    copies the link of the "Select this person" button: an
//    `npf54789befb391a838://auth#session_token_code=...&state=...` address
//    that only the mobile app can open.
// 2. The pasted link gives a `session_token_code`, exchanged with the PKCE
//    verifier for a long-lived `session_token` (`exchangeCode`), kept in /data.
// 3. The session token gives a short-lived `id_token` (about 15 minutes,
//    `refreshTokens`), sent as the bearer of every Parental Controls request.
//
// No password ever goes through the integration, and nothing here works
// around a Nintendo protection: if Nintendo asks for anything else, the
// sign-in fails with a clear message.
// -----------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';

export const CLIENT_ID = '54789befb391a838';
export const REDIRECT_URI = `npf${CLIENT_ID}://auth`;
export const AUTHORIZE_URL = 'https://accounts.nintendo.com/connect/1.0.0/authorize';
export const SESSION_TOKEN_URL = 'https://accounts.nintendo.com/connect/1.0.0/api/session_token';
export const TOKEN_URL = 'https://accounts.nintendo.com/connect/1.0.0/api/token';
const GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:jwt-bearer-session-token';

/** The scopes of the Parental Controls app. */
export const SCOPES = [
  'openid',
  'user',
  'moonUser:administration',
  'moonDevice:create',
  'moonOwnedDevice:administration',
  'moonParentalControlSetting',
  'moonParentalControlSetting:update',
  'moonParentalControlSettingState',
  'moonPairingState',
  'moonSmartDevice:administration',
  'moonDailySummary',
  'moonMonthlySummary',
];

/** An id token is renewed this long before it expires. */
export const TOKEN_EXPIRY_MARGIN_MS = 5 * 60 * 1000;

/**
 * A sign-in problem. `kind`:
 * - `invalid_link`: the pasted text is not a "Select this person" link;
 * - `refused`: Nintendo refused the code (already used, expired) or the session token;
 * - `unreachable`: network error or Nintendo server error;
 * - `unexpected`: Nintendo answered something the integration does not understand.
 */
export class NintendoAuthError extends Error {
  /**
   * @param {'invalid_link'|'refused'|'unreachable'|'unexpected'} kind
   * @param {string} message never contains a token or a code
   * @param {number} [status]
   */
  constructor(kind, message, status) {
    super(message);
    this.name = 'NintendoAuthError';
    this.kind = kind;
    this.status = status;
  }
}

/** base64url without padding. */
function base64url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * A new sign-in: the URL to open and what must be kept to finish it.
 * @returns {{ url: string, state: string, verifier: string }}
 */
export function createLogin() {
  const verifier = base64url(randomBytes(36)); // 48 characters of [A-Za-z0-9_-]
  const state = base64url(randomBytes(24));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  const query = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'session_token_code',
    scope: SCOPES.join(' '),
    session_token_code_challenge: challenge,
    session_token_code_challenge_method: 'S256',
    state,
    theme: 'login_form',
  });
  return { url: `${AUTHORIZE_URL}?${query}`, state, verifier };
}

/**
 * Read the link of the "Select this person" button.
 * @param {string} link
 * @returns {{ code: string, state: string }}
 */
export function parseRedirectLink(link) {
  const text = String(link ?? '').trim();
  const hash = text.indexOf('#');
  if (!text.toLowerCase().startsWith(REDIRECT_URI) || hash === -1) {
    throw new NintendoAuthError(
      'invalid_link',
      `Not a sign-in link: it must start with ${REDIRECT_URI}#`,
    );
  }
  const params = new URLSearchParams(text.slice(hash + 1));
  if (params.get('error')) {
    throw new NintendoAuthError('refused', `Nintendo ended the sign-in (${params.get('error')})`);
  }
  const code = params.get('session_token_code');
  const state = params.get('state');
  if (!code || !state) {
    throw new NintendoAuthError('invalid_link', 'The sign-in link carries no session code');
  }
  return { code, state };
}

/** Fingerprint of a pasted link, to recognize one already used without keeping it. */
export function linkFingerprint(link) {
  return createHash('sha256').update(String(link).trim()).digest('hex').slice(0, 32);
}

/**
 * @param {typeof fetch} fetch
 * @param {string} url
 * @param {RequestInit} init
 */
async function post(fetch, url, init) {
  let response;
  try {
    response = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(15000), ...init });
  } catch (err) {
    throw new NintendoAuthError(
      'unreachable',
      `Nintendo accounts unreachable (${err.cause?.code ?? err.name})`,
    );
  }
  let body = null;
  try {
    body = await response.json();
  } catch {
    // An HTML error page: only the status matters below.
  }
  return { status: response.status, ok: response.ok, body };
}

/**
 * Exchange the code of a pasted link for a session token.
 * @param {object} options
 * @param {typeof fetch} options.fetch
 * @param {string} options.code
 * @param {string} options.verifier
 * @returns {Promise<string>} the session token
 */
export async function exchangeCode({ fetch, code, verifier }) {
  const { status, ok, body } = await post(fetch, SESSION_TOKEN_URL, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      session_token_code: code,
      session_token_code_verifier: verifier,
    }).toString(),
  });
  if (status >= 500) {
    throw new NintendoAuthError('unreachable', `Nintendo accounts error HTTP ${status}`, status);
  }
  if (!ok) {
    throw new NintendoAuthError(
      'refused',
      `Nintendo refused the sign-in link (HTTP ${status}${errorName(body)})`,
      status,
    );
  }
  if (typeof body?.session_token !== 'string' || body.session_token === '') {
    throw new NintendoAuthError('unexpected', 'Nintendo answered without a session token');
  }
  return body.session_token;
}

/**
 * Get a fresh id token from the session token.
 * @param {object} options
 * @param {typeof fetch} options.fetch
 * @param {string} options.sessionToken
 * @param {() => number} [options.now]
 * @returns {Promise<{ idToken: string, expiresAt: number }>}
 */
export async function refreshTokens({ fetch, sessionToken, now = Date.now }) {
  const { status, ok, body } = await post(fetch, TOKEN_URL, {
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      grant_type: GRANT_TYPE,
      session_token: sessionToken,
    }),
  });
  if (status === 400 || status === 401) {
    // invalid_grant: the session was revoked (password changed, signed out
    // everywhere) or has expired. Only a new sign-in helps.
    throw new NintendoAuthError(
      'refused',
      `Nintendo refused the session (HTTP ${status}${errorName(body)})`,
      status,
    );
  }
  if (!ok) {
    throw new NintendoAuthError('unreachable', `Nintendo accounts error HTTP ${status}`, status);
  }
  const idToken = body?.id_token;
  const expiresIn = Number(body?.expires_in);
  if (typeof idToken !== 'string' || idToken === '' || !Number.isFinite(expiresIn)) {
    throw new NintendoAuthError('unexpected', 'Nintendo answered without an id token');
  }
  return { idToken, expiresAt: now() + expiresIn * 1000 };
}

// The OAuth error name (`invalid_grant`...), never the description, which may
// echo what was sent.
function errorName(body) {
  return typeof body?.error === 'string' && /^[a-z_]{1,40}$/.test(body.error)
    ? `, ${body.error}`
    : '';
}
