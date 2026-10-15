// -----------------------------------------------------------------------------
// What the integration remembers across restarts, in /data (the only
// writable volume of the container), in one file readable by its owner only:
//   - `session`: the Nintendo session token (the long-lived credential of the
//     account, never logged), and `ended` when Nintendo refused it;
//   - `pending`: the sign-ins started with "Connect" and not finished yet
//     (state and PKCE verifier, so that a restart between "Connect" and the
//     paste does not lose them);
//   - `linkAttempt`: the fingerprint (not the link) of the last pasted link
//     and its outcome, so a refused code is never sent twice;
//   - `tracks`: what was seen of each console today (src/tracker.js), so an
//     update of the integration in the middle of a game does not fire
//     "starts playing" again.
// A file that cannot be read or written costs the memory, never a crash.
// -----------------------------------------------------------------------------

import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const FILE_NAME = 'nintendo-state.json';

/** Sign-ins kept waiting for their link, the latest first. */
export const MAX_PENDING = 5;

/** A sign-in not finished after this long is forgotten (the code expires long before). */
export const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

const empty = () => ({ session: null, pending: [], tracks: {}, linkAttempt: null, ended: false });

/**
 * @param {object} options
 * @param {string} [options.dir] defaults to $DATA_DIR or /data
 * @param {{ debug: Function, warn: Function }} options.logger
 */
export function createStore({ dir = process.env.DATA_DIR || '/data', logger }) {
  const file = path.join(dir, FILE_NAME);
  let data = empty();
  let saved = JSON.stringify(data);
  let warned = false;

  return {
    async load() {
      try {
        const parsed = JSON.parse(await readFile(file, 'utf8'));
        data = {
          session:
            isObject(parsed.session) && typeof parsed.session.token === 'string'
              ? parsed.session
              : null,
          pending: Array.isArray(parsed.pending) ? parsed.pending.filter(isObject) : [],
          tracks: isObject(parsed.tracks) ? parsed.tracks : {},
          linkAttempt: isObject(parsed.linkAttempt) ? parsed.linkAttempt : null,
          ended: parsed.ended === true,
        };
        saved = JSON.stringify(data);
      } catch (err) {
        if (err.code !== 'ENOENT') {
          logger.warn(`State file unreadable, starting afresh (${err.message})`);
        }
      }
    },

    get data() {
      return data;
    },

    /** Write the file when something changed since the last write. */
    async save() {
      const text = JSON.stringify(data);
      if (text === saved) {
        return;
      }
      try {
        await mkdir(dir, { recursive: true });
        // Write then rename: a crash mid-write never leaves a truncated file.
        await writeFile(`${file}.tmp`, text, { mode: 0o600 });
        await chmod(`${file}.tmp`, 0o600);
        await rename(`${file}.tmp`, file);
        saved = text;
        warned = false;
      } catch (err) {
        if (!warned) {
          warned = true;
          logger.warn(
            `State file not written, the Nintendo session will not survive a restart (${err.code ?? err.message})`,
          );
        } else {
          logger.debug(`State file still not written (${err.code ?? err.message})`);
        }
      }
    },
  };
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
