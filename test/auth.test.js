// -----------------------------------------------------------------------------
// The Nintendo sign-in: the URL of the Connect button, the pasted link, the
// exchange of the code and the id tokens, against the fake accounts server.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  CLIENT_ID,
  NintendoAuthError,
  SCOPES,
  createLogin,
  exchangeCode,
  linkFingerprint,
  parseRedirectLink,
  refreshTokens,
} from '../src/nintendo/auth.js';
import { SESSION_TOKEN, createFakeNintendo } from './helpers/fakeNintendo.js';

test('the sign-in URL is the one of the Parental Controls app, with a PKCE challenge', () => {
  const login = createLogin();
  const url = new URL(login.url);
  assert.equal(url.origin + url.pathname, 'https://accounts.nintendo.com/connect/1.0.0/authorize');
  const query = url.searchParams;
  assert.equal(query.get('client_id'), CLIENT_ID);
  assert.equal(query.get('redirect_uri'), 'npf54789befb391a838://auth');
  assert.equal(query.get('response_type'), 'session_token_code');
  assert.equal(query.get('scope'), SCOPES.join(' '));
  assert.equal(query.get('session_token_code_challenge_method'), 'S256');
  assert.equal(query.get('state'), login.state);
  assert.equal(
    query.get('session_token_code_challenge'),
    createHash('sha256').update(login.verifier).digest('base64url'),
  );
  assert.match(login.verifier, /^[A-Za-z0-9_-]{43,128}$/);
  assert.notEqual(createLogin().state, login.state, 'a new state each time');
  // Spaces of the scope as "+", like the app.
  assert.ok(login.url.includes('scope=openid+user+moonUser%3Aadministration'));
});

test('the pasted link', () => {
  const link =
    'npf54789befb391a838://auth#session_state=abc&session_token_code=CODE.x-y&state=STATE1';
  assert.deepEqual(parseRedirectLink(`  ${link}\n`), { code: 'CODE.x-y', state: 'STATE1' });
  for (const wrong of [
    '',
    'https://accounts.nintendo.com/',
    'npf54789befb391a838://auth',
    'npf54789befb391a838://auth#state=STATE1',
    'npf71b963c1b7b6d119://auth#session_token_code=A&state=B',
  ]) {
    assert.throws(
      () => parseRedirectLink(wrong),
      (err) => err instanceof NintendoAuthError && err.kind === 'invalid_link',
      wrong,
    );
  }
  assert.throws(
    () => parseRedirectLink('npf54789befb391a838://auth#error=access_denied&state=B'),
    (err) => err.kind === 'refused',
  );
  assert.equal(linkFingerprint(link), linkFingerprint(` ${link} `));
  assert.ok(!linkFingerprint(link).includes('CODE'));
});

test('the code becomes a session token, then id tokens', async () => {
  const nintendo = createFakeNintendo();
  const login = createLogin();
  const { code } = parseRedirectLink(nintendo.signIn(login.url));
  // A wrong verifier is refused: the code is bound to this sign-in.
  await assert.rejects(
    exchangeCode({ fetch: nintendo.fetch, code, verifier: 'x'.repeat(48) }),
    (err) => err.kind === 'refused' && err.status === 400,
  );
  const sessionToken = await exchangeCode({
    fetch: nintendo.fetch,
    code,
    verifier: login.verifier,
  });
  assert.equal(sessionToken, SESSION_TOKEN);
  // Single use.
  await assert.rejects(
    exchangeCode({ fetch: nintendo.fetch, code, verifier: login.verifier }),
    (err) => err.kind === 'refused' && !err.message.includes(code),
  );
  const tokens = await refreshTokens({ fetch: nintendo.fetch, sessionToken, now: () => 1000 });
  assert.match(tokens.idToken, /^ID-TOKEN-SECRET-/);
  assert.equal(tokens.expiresAt, 1000 + 900 * 1000);

  nintendo.revokeSessions();
  await assert.rejects(
    refreshTokens({ fetch: nintendo.fetch, sessionToken }),
    (err) => err.kind === 'refused' && /invalid_grant/.test(err.message),
  );
});

test('the accounts server down is not a refusal', async () => {
  const nintendo = createFakeNintendo();
  nintendo.accountsFailure = { error: 'ECONNRESET' };
  await assert.rejects(
    refreshTokens({ fetch: nintendo.fetch, sessionToken: SESSION_TOKEN }),
    (err) => err.kind === 'unreachable' && /ECONNRESET/.test(err.message),
  );
  nintendo.accountsFailure = { status: 503 };
  await assert.rejects(
    exchangeCode({ fetch: nintendo.fetch, code: 'C', verifier: 'V' }),
    (err) => err.kind === 'unreachable',
  );
});
