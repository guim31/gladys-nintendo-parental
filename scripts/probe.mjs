#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Probe of the real Nintendo servers, read-only, from a machine with network
// access (not part of the Docker image).
//
//   node scripts/probe.mjs
//     Walks the sign-in with FAKE values until Nintendo refuses them: the
//     sign-in page answers, a fake code, a fake session token and a fake id
//     token are refused the way the integration expects. Nothing to configure,
//     nothing sensitive printed.
//
//   NINTENDO_SESSION_TOKEN=... node scripts/probe.mjs
//     Also reads a real account, read-only: number of consoles, models, today's
//     play time, limit and mode of each. No token, id, name or label printed.
//     (Get a session token by signing in with the integration: it is in
//     /data/nintendo-state.json.)
// -----------------------------------------------------------------------------

import { AUTHORIZE_URL, createLogin, exchangeCode, refreshTokens } from '../src/nintendo/auth.js';
import { NintendoApiError, createNintendoClient } from '../src/nintendo/client.js';
import { buildSnapshot } from '../src/nintendo/model.js';

const timeZone = process.env.TZ || 'Europe/Paris';
let failures = 0;

function report(step, ok, detail) {
  if (!ok) failures += 1;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${step}: ${detail}`);
}

async function expectRefusal(step, promise, accept) {
  try {
    await promise;
    report(step, false, 'accepted (a fake value should be refused)');
  } catch (err) {
    report(step, accept(err), `${err.name} ${err.kind ?? ''} ${err.status ?? ''} ${err.message}`);
  }
}

// 1. The sign-in page of the Connect button.
const login = createLogin();
try {
  const response = await fetch(login.url, { redirect: 'manual' });
  report(
    'sign-in page',
    response.status === 200 || (response.status >= 300 && response.status < 400),
    `HTTP ${response.status} from ${AUTHORIZE_URL}`,
  );
} catch (err) {
  report('sign-in page', false, `network error ${err.cause?.code ?? err.name}`);
}

// 2. A fake code: refused (400), not a network error.
await expectRefusal(
  'fake session code',
  exchangeCode({ fetch, code: 'probe-fake-code', verifier: login.verifier }),
  (err) => err.kind === 'refused',
);

// 3. A fake session token: refused (invalid_grant).
await expectRefusal(
  'fake session token',
  refreshTokens({ fetch, sessionToken: 'probe-fake-session-token' }),
  (err) => err.kind === 'refused',
);

// 4. A fake id token on the Parental Controls API: refused (401/403), the
//    headers of the app accepted (no update_required).
const fakeClient = createNintendoClient({
  fetch,
  getIdToken: async () => 'probe-fake-id-token',
  timeZone,
  language: 'fr-FR',
});
await expectRefusal(
  'fake id token on the Parental Controls API',
  fakeClient.getOwnedDevices(),
  (err) => err instanceof NintendoApiError && err.kind === 'auth',
);

// 5. A real account, read-only, when a session token is given.
const sessionToken = process.env.NINTENDO_SESSION_TOKEN;
if (sessionToken) {
  try {
    const { idToken } = await refreshTokens({ fetch, sessionToken });
    report('real session token', true, 'id token obtained');
    const client = createNintendoClient({
      fetch,
      getIdToken: async () => idToken,
      timeZone,
      language: 'fr-FR',
    });
    const owned = await client.getOwnedDevices();
    report('consoles', owned.length > 0, `${owned.length} console(s)`);
    for (const [index, entry] of owned.entries()) {
      const [daily, settings] = await Promise.all([
        client.getDailySummaries(entry.deviceId),
        client.getParentalControlSetting(entry.deviceId),
      ]);
      const s = buildSnapshot({ owned: entry, daily, settings, now: Date.now(), timeZone });
      report(
        `console ${index + 1}`,
        true,
        `model ${s.model ?? 'unknown'}, played today ${s.played} min, limit ${s.limit ?? 'none'}, ` +
          `bonus ${s.bonus ?? 'none'}, remaining ${s.remaining} min, mode ${s.suspend ? 'suspend' : 'alarm'}, ` +
          `timer ${s.timerMode}, games today ${s.games.length}, ` +
          `last report ${s.reportedAt ? `${Math.round(Date.now() / 1000 - s.reportedAt)} s ago` : 'unknown'}`,
      );
    }
  } catch (err) {
    report('real account', false, `${err.name} ${err.kind ?? ''} ${err.message}`);
  }
}

process.exitCode = failures === 0 ? 0 : 1;
