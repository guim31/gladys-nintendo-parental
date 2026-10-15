// -----------------------------------------------------------------------------
// The integration: wires the Nintendo session and client, the consoles, the
// play tracker, the widget and the scene declarations to a Gladys client (the
// real one in index.js, the SDK's fake Gladys in the tests).
//
// Refresh: the container polls Nintendo by itself on a timer (the core does
// not reliably poll external devices, Gladys#3198); onPoll stays as a fallback
// and is skipped when the timer has just run. Each refresh reads, per
// console, the daily summaries and the settings (2 requests); the list of
// consoles is read every 30 minutes, on a scan and at start.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { ACCOUNT_FIELD, nintendoLanguage, normalizeConfig, refreshPeriodMs } from './config.js';
import {
  FEATURE,
  buildDevice,
  consoleIds,
  consoleName,
  consoleStates,
  deviceIdOf,
  featureKeyOf,
} from './devices.js';
import { MESSAGES, format, pick } from './i18n.js';
import { createIssueLog } from './issues.js';
import { EXTRA_TIME_ERRORS, NintendoApiError, createNintendoClient } from './nintendo/client.js';
import {
  BONUS_CHOICES,
  buildSnapshot,
  localTime,
  parseLimit,
  parseOwnedDevice,
  withDailyLimit,
  withRestrictionMode,
} from './nintendo/model.js';
import { createSession } from './session.js';
import { createStore } from './store.js';
import { PLAYING_GRACE_MS, isOnline, isPlaying, observe } from './tracker.js';
import { WIDGET, WIDGET_ACTION, buildConsolesContent } from './widgets.js';

/** Scene trigger keys fired by the integration (declared in the manifest). */
export const SCENE_TRIGGER_KEYS = ['started_playing', 'limit_approaching', 'limit_exceeded'];

/** Manifest action keys handled here. */
export const ACTION_KEYS = ['check_connection', 'sign_out'];

/** Scene action keys handled here. */
export const SCENE_ACTION_KEYS = ['add_bonus_time', 'set_daily_limit'];

/** The list of consoles is read this often. */
export const CONSOLES_PERIOD_MS = 30 * 60 * 1000;

/** An unchanged state is sent again this often, so Gladys keeps it recent. */
export const HEARTBEAT_MS = 6 * 60 * 60 * 1000;

/** After a 429, Nintendo is left alone this long. */
export const RATE_LIMIT_PAUSE_MS = 5 * 60 * 1000;

/** After a change, the settings are read again until it shows (Nintendo lags a few seconds). */
export const CHANGE_CHECKS = 3;
export const CHANGE_CHECK_DELAY_MS = 2000;

/** What the Configuration screen says, by status. */
const STATUS_MESSAGES = {
  not_linked: MESSAGES.notLinked,
  invalid_link: MESSAGES.invalidLink,
  other_login: MESSAGES.otherLogin,
  refused: MESSAGES.linkRefused,
  session_ended: MESSAGES.sessionEnded,
  no_console: MESSAGES.noConsole,
  update_required: MESSAGES.updateRequired,
  unreachable: MESSAGES.unreachable,
};

/** A user-facing error: its multi-language message reaches Gladys. */
class UserError extends Error {
  constructor(message) {
    super(message.en);
    this.messages = message;
  }
}

/**
 * @param {object} options
 * @param {object} options.gladys GladysIntegration or the SDK's fake Gladys
 * @param {typeof fetch} [options.fetch]
 * @param {string} [options.dataDir]
 * @param {() => number} [options.now]
 * @param {string} [options.timeZone] IANA zone of Gladys (TZ, set by the supervisor)
 * @param {boolean} [options.timers] run the refresh timer (the tests drive cycles by hand)
 * @param {(ms: number) => Promise<void>} [options.sleep]
 */
export function createApp({
  gladys,
  fetch = globalThis.fetch,
  dataDir,
  now = () => Date.now(),
  timeZone = validTimeZone(process.env.TZ),
  timers = true,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const logger = createLogger({ name: 'nintendo' });
  const issues = createIssueLog(logger);
  const store = createStore({ dir: dataDir, logger });
  const session = createSession({ store, fetch, now });

  let config = normalizeConfig();
  let client = null;
  /** Consoles of the account, by Nintendo id: `{ owned, settings, snapshot }`. */
  const consoles = new Map();
  let consolesReadAt = null;
  /** What Gladys was last told (see STATUS_MESSAGES, plus 'ok'). */
  let status = null;
  let nintendoDown = false;
  let lastCycleAt = null;
  let pausedUntil = 0;
  let inFlight = null;
  let timer = null;
  let stopped = false;
  let loaded = false;

  const created = () => new Set((gladys.devices ?? []).map((device) => device.external_id));

  function makeClient() {
    client = createNintendoClient({
      fetch,
      getIdToken: (options) => session.getIdToken(options),
      timeZone,
      language: nintendoLanguage(config.language),
    });
  }

  // --- Connection status shown in the Configuration screen ------------------

  async function setStatus(next) {
    if (next === status) {
      return;
    }
    status = next;
    await gladys.setConnectionStatus(next === 'ok', STATUS_MESSAGES[next]).catch((err) => {
      logger.debug(`Connection status not sent (${err.message})`);
    });
  }

  /** The status to show while no session is known. */
  function unlinkedStatus() {
    if (session.ended) return 'session_ended';
    const outcome = session.linkOutcome;
    return config.redirect_link && STATUS_MESSAGES[outcome] ? outcome : 'not_linked';
  }

  // --- Sign-in --------------------------------------------------------------

  /** Use the pasted link, once. Never throws: the outcome goes to the status. */
  async function useLink() {
    if (!config.redirect_link) {
      return;
    }
    try {
      const result = await session.finishLogin(config.redirect_link);
      if (result === 'linked') {
        logger.info('Nintendo account connected');
        issues.ok('sign-in', 'Nintendo accounts answer again');
      }
    } catch (err) {
      if (err.kind === 'unreachable') {
        issues.fail('sign-in', `Sign-in not finished for now (${err.message})`);
      } else if (session.linked) {
        logger.debug(`Pasted link not used (${err.message}), the current session stays`);
      } else {
        logger.debug(`Pasted link not used (${err.message})`);
      }
    } finally {
      await store.save();
    }
  }

  // --- Devices --------------------------------------------------------------

  function discoveredDevices() {
    return [...consoles.values()].map(({ owned }) =>
      buildDevice(gladys, parseOwnedDevice(owned), config.language),
    );
  }

  async function publishDevices() {
    await gladys.publishDiscoveredDevices(discoveredDevices());
  }

  async function readConsoles() {
    const owned = await client.getOwnedDevices();
    consolesReadAt = now();
    const seen = new Set();
    let changed = false;
    for (const entry of owned) {
      if (!entry?.deviceId) continue;
      const id = String(entry.deviceId);
      seen.add(id);
      const known = consoles.get(id);
      if (!known) {
        consoles.set(id, { owned: entry, settings: null, snapshot: null });
        changed = true;
      } else {
        changed ||=
          consoleName(parseOwnedDevice(known.owned)) !== consoleName(parseOwnedDevice(entry));
        known.owned = entry;
      }
    }
    for (const id of [...consoles.keys()]) {
      if (!seen.has(id)) {
        consoles.delete(id);
        changed = true;
      }
    }
    if (consoles.size === 0) {
      throw new NintendoApiError('not_found', 'No console on the Nintendo account');
    }
    return changed;
  }

  // --- Refresh cycle --------------------------------------------------------

  /**
   * One refresh: consoles when due, then every console. Errors are logged
   * (once while they last), never thrown.
   * @param {{ listConsoles?: boolean }} [options]
   */
  function cycle(options = {}) {
    if (inFlight) {
      return options.listConsoles ? inFlight.then(() => cycle(options)) : inFlight;
    }
    inFlight = runCycle(options).finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  async function runCycle({ listConsoles = false } = {}) {
    if (gladys.connected === false || !client) {
      logger.debug('Refresh skipped (Gladys not connected)');
      return;
    }
    if (!session.linked) {
      await useLink();
      if (!session.linked) {
        logger.debug('Refresh skipped (no Nintendo account connected)');
        await setStatus(unlinkedStatus());
        return;
      }
      listConsoles = true;
    }
    if (now() < pausedUntil) {
      logger.debug('Refresh skipped (Nintendo rate limit pause)');
      return;
    }
    lastCycleAt = now();

    try {
      if (listConsoles || consolesReadAt === null || now() - consolesReadAt >= CONSOLES_PERIOD_MS) {
        const firstTime = consolesReadAt === null;
        if ((await readConsoles()) && !firstTime) {
          await publishDevices();
        }
      }
      for (const [id, entry] of consoles) {
        const [daily, settings] = await Promise.all([
          client.getDailySummaries(id),
          client.getParentalControlSetting(id),
        ]);
        entry.settings = settings;
        entry.daily = daily;
      }
    } catch (err) {
      await handleError(err);
      await store.save();
      return;
    }
    if (nintendoDown || status !== 'ok') {
      issues.ok('nintendo', 'Nintendo Parental Controls answers again');
    }
    nintendoDown = false;
    await setStatus('ok');
    await refreshStates({ fire: true });
    await store.save();
    logger.debug(`Refresh done: ${consoles.size} console(s)`);
  }

  /**
   * Rebuild the snapshots from the last answers, publish the states of the
   * added consoles, fire the scene events.
   * @param {{ fire: boolean }} options fire: a new reading (not a replay after a command)
   */
  async function refreshStates({ fire }) {
    const at = now();
    const createdSet = created();
    const states = [];
    const events = [];
    let changed = false;
    for (const [id, entry] of consoles) {
      if (!entry.settings || !entry.daily) continue;
      const snapshot = buildSnapshot({
        owned: entry.owned,
        daily: entry.daily,
        settings: entry.settings,
        now: at,
        timeZone,
      });
      const ids = consoleIds(gladys, id);
      if (fire) {
        const observed = observe(store.data.tracks[id], snapshot, at, graceMs());
        store.data.tracks[id] = observed.track;
        for (const event of observed.events) {
          events.push({
            key: event.key,
            data: { console: ids.device, console_name: consoleName(snapshot), ...event.data },
          });
        }
      }
      const live = liveOf(id, snapshot, at);
      if (
        JSON.stringify(widgetView(entry.snapshot, entry.live)) !==
        JSON.stringify(widgetView(snapshot, live))
      ) {
        changed = true;
      }
      entry.snapshot = snapshot;
      entry.live = live;
      if (createdSet.has(ids.device)) {
        states.push(...consoleStates(gladys, snapshot, live, config.language));
      }
    }
    await publish(states);
    for (const event of events) {
      logger.debug(`Scene event ${event.key} for ${event.data.console_name}`);
      await gladys.publishSceneEvent(event.key, event.data).catch((err) => {
        issues.fail('scene-event', `Scene event not accepted by Gladys (${err.message})`);
      });
    }
    if (changed) {
      gladys.requestWidgetRefresh(WIDGET.CONSOLES);
    }
  }

  function liveOf(id, snapshot, at) {
    const track = store.data.tracks[id];
    return {
      playing: isPlaying(track, at, graceMs()),
      online: isOnline(snapshot, track, at, graceMs()),
      game: track?.game ?? snapshot.lastGame ?? null,
    };
  }

  async function publish(states) {
    if (states.length === 0) {
      return;
    }
    try {
      await gladys.publishChangedStates(states, { heartbeat: HEARTBEAT_MS });
      issues.ok('publish', 'States accepted by Gladys again');
    } catch (err) {
      issues.fail('publish', `States not accepted by Gladys (${err.message})`);
    }
  }

  async function handleError(err) {
    nintendoDown = true;
    if (err.name === 'NintendoAuthError' && (err.kind === 'refused' || err.kind === 'not_linked')) {
      consoles.clear();
      consolesReadAt = null;
      issues.fail('nintendo', `Nintendo session: ${err.message}, a new sign-in is needed`);
      await setStatus(unlinkedStatus());
      gladys.requestWidgetRefresh(WIDGET.CONSOLES);
      return;
    }
    if (err.kind === 'rate_limit') {
      pausedUntil = now() + RATE_LIMIT_PAUSE_MS;
      issues.fail('nintendo', `${err.message}, pausing 5 minutes`);
      return;
    }
    if (err.kind === 'update_required') {
      issues.fail('nintendo', err.message);
      await setStatus('update_required');
      return;
    }
    if (err.kind === 'not_found' && consoles.size === 0) {
      issues.fail('nintendo', 'No console is linked to the Nintendo account');
      await setStatus('no_console');
      gladys.requestWidgetRefresh(WIDGET.CONSOLES);
      return;
    }
    issues.fail('nintendo', `Nintendo Parental Controls: ${err.message}`);
    await setStatus('unreachable');
    gladys.requestWidgetRefresh(WIDGET.CONSOLES);
  }

  function graceMs() {
    return Math.max(PLAYING_GRACE_MS, 3 * refreshPeriodMs(config));
  }

  // --- Commands -------------------------------------------------------------

  /** The console of a device or feature external id, with its settings read. */
  function consoleOf(externalId) {
    const id = deviceIdOf(gladys, externalId);
    const entry = id ? consoles.get(id) : undefined;
    if (!entry?.settings || !entry.snapshot) {
      throw new UserError(MESSAGES.unknownConsole);
    }
    return { id, entry };
  }

  function refuseWhenBonusActive(entry) {
    // Nintendo (and the app) refuse a timer change once extra time is granted.
    if (entry.snapshot.bonus !== null && entry.snapshot.bonus !== 0) {
      throw new UserError(MESSAGES.bonusActive);
    }
  }

  function guard(err) {
    if (err instanceof UserError) throw err;
    if (err.kind === 'rejected' && EXTRA_TIME_ERRORS.includes(err.code)) {
      throw new UserError(MESSAGES.bonusRefused);
    }
    if (err.name === 'NintendoAuthError') throw new UserError(MESSAGES.notLinked);
    if (err.kind === 'update_required') throw new UserError(MESSAGES.updateRequired);
    if (err.kind === 'unreachable' || err.kind === 'rate_limit') {
      throw new UserError(MESSAGES.unreachable);
    }
    throw err;
  }

  /** Keep the answer of an update: the settings, the extra time where known. */
  async function applySettings(entry, answer) {
    if (answer?.parentalControlSetting) {
      entry.settings = {
        ...answer,
        ownedDevice: answer.ownedDevice ?? entry.settings.ownedDevice,
      };
    }
    await refreshStates({ fire: false });
  }

  async function setDailyLimit(externalId, minutes) {
    const { id, entry } = consoleOf(externalId);
    refuseWhenBonusActive(entry);
    logger.info(
      `Command: daily limit of ${consoleName(entry.snapshot)} set to ${minutes === null ? 'none' : `${minutes} min`}`,
    );
    const weekday = localTime(now(), timeZone).weekday;
    const regulations = entry.settings.parentalControlSetting?.playTimerRegulations ?? {};
    try {
      const answer = await client.updatePlayTimer(
        id,
        withDailyLimit(regulations, minutes, weekday),
      );
      await applySettings(entry, answer);
    } catch (err) {
      guard(err);
    }
  }

  async function setSuspend(externalId, suspend) {
    const { id, entry } = consoleOf(externalId);
    refuseWhenBonusActive(entry);
    logger.info(
      `Command: ${consoleName(entry.snapshot)} ${suspend ? 'suspends the software' : 'sounds an alarm only'} at the limit`,
    );
    const regulations = entry.settings.parentalControlSetting?.playTimerRegulations ?? {};
    try {
      const answer = await client.updatePlayTimer(id, withRestrictionMode(regulations, suspend));
      await applySettings(entry, answer);
    } catch (err) {
      guard(err);
    }
    return format('modeSet', suspend, consoleName(entry.snapshot));
  }

  async function addBonus(externalId, minutes) {
    const { id, entry } = consoleOf(externalId);
    if (!BONUS_CHOICES.includes(minutes)) {
      throw new Error(`Bonus of ${minutes} minutes refused: ${BONUS_CHOICES.join(', ')}`);
    }
    logger.info(`Command: ${minutes} min of bonus for ${consoleName(entry.snapshot)}`);
    const before = entry.snapshot.bonus;
    try {
      await client.addExtraPlayingTime(id, minutes);
      // The settings show the new bonus a few seconds later.
      for (let check = 1; check <= CHANGE_CHECKS; check += 1) {
        await applySettings(entry, await client.getParentalControlSetting(id));
        if (entry.snapshot.bonus !== before || check === CHANGE_CHECKS) break;
        await sleep(CHANGE_CHECK_DELAY_MS);
      }
    } catch (err) {
      guard(err);
    }
    return { id, entry };
  }

  // --- Timer ----------------------------------------------------------------

  function schedule() {
    clearTimeout(timer);
    timer = null;
    if (!timers || stopped) {
      return;
    }
    timer = setTimeout(async () => {
      timer = null;
      try {
        await cycle();
      } finally {
        schedule();
      }
    }, refreshPeriodMs(config));
    timer.unref?.();
  }

  // --- Start / restart ------------------------------------------------------

  /** (Re)start with the current config: sign in, read Nintendo, publish the consoles. */
  async function start() {
    stopped = false;
    clearTimeout(timer);
    if (!loaded) {
      await store.load();
      loaded = true;
    }
    makeClient();
    consolesReadAt = null;
    status = null;
    await useLink();
    if (!session.linked) {
      consoles.clear();
      logger.info('Waiting for the Nintendo account: Connect, then paste the link');
      await setStatus(unlinkedStatus());
      await gladys.publishDiscoveredDevices([]);
      gladys.requestWidgetRefresh(WIDGET.CONSOLES);
      schedule();
      return;
    }
    await cycle({ listConsoles: true });
    if (status === 'ok') {
      logger.info(`Nintendo Parental Controls reachable: ${consoles.size} console(s)`);
    }
    await publishDevices();
    gladys.requestWidgetRefresh(WIDGET.CONSOLES);
    schedule();
  }

  // --- Handlers -------------------------------------------------------------

  function messageOf(err) {
    if (err instanceof UserError) return err.messages;
    return { en: err.message, fr: err.message, de: err.message, es: err.message };
  }

  const handlers = {
    async connected() {
      try {
        config = normalizeConfig(await gladys.getConfig());
        await start();
      } catch (err) {
        logger.error(`Post-connection initialization failed: ${err.message}`);
        status = null;
        await gladys.setConnectionStatus(false, MESSAGES.initFailed).catch(() => {});
      }
    },

    async configUpdated(newConfig) {
      logger.info('Configuration updated');
      config = normalizeConfig(newConfig);
      await start();
    },

    /** "Connect": a new sign-in, whose link the user pastes in the configuration. */
    async oauthAuthorizeUrl(key) {
      if (key !== ACCOUNT_FIELD) {
        throw new Error(`Unknown account field ${key}`);
      }
      if (!loaded) {
        await store.load();
        loaded = true;
      }
      const url = session.startLogin();
      await store.save();
      logger.info('Action: Nintendo sign-in started');
      return url;
    },

    async scanRequest() {
      logger.info('Scan requested: reading the consoles of the Nintendo account');
      if (session.linked) {
        await cycle({ listConsoles: true });
      }
      await publishDevices();
    },

    /** The core's onPoll, a fallback: skipped when the timer has just refreshed. */
    async poll(device) {
      if (lastCycleAt !== null && now() - lastCycleAt < refreshPeriodMs(config) / 2) {
        logger.debug(
          `onPoll skipped for ${device.external_id} (refreshed ${now() - lastCycleAt} ms ago)`,
        );
        return;
      }
      await cycle();
    },

    /**
     * A device just added (or updated) in Gladys: the SDK forgot its states,
     * everything is published again now (Gladys drops states sent before the
     * feature exists), and the widget may now offer it.
     */
    async deviceCreated(device) {
      if (!deviceIdOf(gladys, device.external_id)) {
        return;
      }
      gladys.forgetPublishedStates(device.external_id);
      await refreshStates({ fire: false });
      gladys.requestWidgetRefresh(WIDGET.CONSOLES);
    },

    async setValue(device, feature, value) {
      const key = featureKeyOf(feature.external_id);
      if (key === FEATURE.DAILY_LIMIT) {
        await setDailyLimit(device.external_id, parseLimit(value));
      } else if (key === FEATURE.SUSPEND_SOFTWARE) {
        await setSuspend(device.external_id, Number(value) === 1);
      } else {
        throw new Error(`${feature.external_id} is read only`);
      }
    },

    async checkConnection() {
      logger.info('Action: check the connection');
      if (!session.linked) {
        return STATUS_MESSAGES[unlinkedStatus()];
      }
      await cycle({ listConsoles: true });
      if (status !== 'ok') {
        return STATUS_MESSAGES[status] ?? MESSAGES.unreachable;
      }
      const list = [...consoles.values()]
        .map(({ owned }) => consoleName(parseOwnedDevice(owned)))
        .join(', ');
      return format('consoles', list);
    },

    async signOut() {
      logger.info('Action: sign out of Nintendo');
      const had = session.signOut();
      consoles.clear();
      consolesReadAt = null;
      await store.save();
      await setStatus('not_linked');
      gladys.requestWidgetRefresh(WIDGET.CONSOLES);
      return had ? MESSAGES.signedOut : MESSAGES.notSignedIn;
    },

    /** Scene action: extra time for today. */
    async addBonusTime(fields) {
      const { entry } = await addBonus(fields.console, Number(fields.minutes));
      return {
        bonus_minutes: entry.snapshot.bonus === -1 ? 1440 : (entry.snapshot.bonus ?? 0),
        remaining_minutes: entry.snapshot.remaining,
      };
    },

    /** Scene action: the daily limit. */
    async setDailyLimit(fields) {
      await setDailyLimit(fields.console, parseLimit(fields.limit));
    },

    async widgetGet({ settings, language }) {
      const lang = ['en', 'fr', 'de', 'es'].includes(language) ? language : config.language;
      const createdSet = created();
      return buildConsolesContent({
        status: !session.linked ? 'not_linked' : status === 'no_console' ? 'no_console' : 'ok',
        consoles: [...consoles.entries()]
          .filter(([, entry]) => entry.snapshot)
          .map(([id, entry]) => ({
            id,
            name: consoleName(entry.snapshot),
            snapshot: entry.snapshot,
            live: entry.live,
            externalId: consoleIds(gladys, id).device,
          }))
          // A console added to Gladys first: those are the ones the parents follow.
          .sort(
            (a, b) => Number(createdSet.has(b.externalId)) - Number(createdSet.has(a.externalId)),
          ),
        selected: settings?.console || null,
        nintendoDown,
        language: lang,
        ttlSeconds: refreshPeriodMs(config) / 1000,
      });
    },

    async widgetAction(actionKey, params) {
      try {
        const externalId = consoleIds(gladys, String(params?.console ?? '')).device;
        if (actionKey === WIDGET_ACTION.BONUS) {
          const { entry } = await addBonus(externalId, Number(params.minutes));
          return format('bonusAdded', Number(params.minutes), consoleName(entry.snapshot));
        }
        if (actionKey === WIDGET_ACTION.ALARM || actionKey === WIDGET_ACTION.SUSPEND) {
          return await setSuspend(externalId, actionKey === WIDGET_ACTION.SUSPEND);
        }
      } catch (err) {
        // The toast tells the user why nothing happened.
        logger.warn(`Widget action ${actionKey} failed: ${err.message}`);
        return messageOf(err);
      }
      throw new Error(`Unknown widget action ${actionKey}`);
    },
  };

  // Actions and commands answer the user: a UserError becomes its message.
  const userFacing =
    (fn) =>
    async (...args) => {
      try {
        return await fn(...args);
      } catch (err) {
        if (err instanceof UserError) {
          throw new Error(pick(err.messages, config.language), { cause: err });
        }
        throw err;
      }
    };

  return {
    handlers,
    cycle,
    get config() {
      return config;
    },
    get consoles() {
      return consoles;
    },

    /** Register every handler on the Gladys client, before connect(). */
    register() {
      gladys.on('connected', handlers.connected);
      gladys.onConfigUpdated(handlers.configUpdated);
      gladys.onOAuthAuthorizeUrl(handlers.oauthAuthorizeUrl);
      gladys.onScanRequest(handlers.scanRequest);
      gladys.onPoll(handlers.poll);
      gladys.onDeviceCreated(handlers.deviceCreated);
      gladys.onDeviceUpdated(handlers.deviceCreated);
      gladys.onSetValue(userFacing(handlers.setValue));
      gladys.onAction('check_connection', handlers.checkConnection);
      gladys.onAction('sign_out', handlers.signOut);
      gladys.onSceneAction('add_bonus_time', userFacing(handlers.addBonusTime));
      gladys.onSceneAction('set_daily_limit', userFacing(handlers.setDailyLimit));
      gladys.onWidgetGet(WIDGET.CONSOLES, handlers.widgetGet);
      gladys.onWidgetAction(WIDGET.CONSOLES, handlers.widgetAction);
    },

    async stop() {
      stopped = true;
      clearTimeout(timer);
      timer = null;
      await inFlight?.catch(() => {});
      await store.save();
    },
  };
}

/** The parts of a console the widget shows: a change asks the dashboards to re-pull. */
function widgetView(snapshot, live) {
  if (!snapshot) return null;
  const { label, model, played, remaining, limit, bonus, suspend, limitReached, constrained } =
    snapshot;
  return {
    label,
    model,
    played,
    remaining,
    limit,
    bonus,
    suspend,
    limitReached,
    constrained,
    playing: live?.playing,
    game: live?.game?.title,
  };
}

function validTimeZone(zone) {
  const candidate = zone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate });
    return candidate;
  } catch {
    return 'UTC';
  }
}
