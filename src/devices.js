// -----------------------------------------------------------------------------
// One Gladys device per console linked to the Nintendo account.
//
// External ids: `gladys.externalIds('console', <deviceId>)`. The deviceId is
// the identifier Nintendo gives the console when it is paired with the
// Parental Controls app; the label changes at will. The feature keys below are
// forever too.
//
// The devices are published with `should_poll: true` and a poll frequency of
// the core's list, so that onPoll stays a fallback; the container refreshes
// them by itself (src/app.js, Gladys#3198).
// -----------------------------------------------------------------------------

import { DEVICE_POLL_FREQUENCIES } from '@gladysassistant/integration-sdk';
import { NAMES, TEXT, limitLabel, pick } from './i18n.js';
import { limitValues } from './nintendo/model.js';

export const DEVICE_TYPE = 'console';

/** Feature keys (part of the external ids: never rename one). */
export const FEATURE = {
  PLAYING_TIME: 'playing_time',
  TIME_REMAINING: 'time_remaining',
  DAILY_LIMIT: 'daily_limit',
  BONUS_TIME: 'bonus_time',
  GAME: 'game',
  PLAYING: 'playing',
  ONLINE: 'online',
  SUSPEND_SOFTWARE: 'suspend_software',
};

// Durations: display bounds of a day (Gladys never enforces them).
const FEATURES = [
  {
    key: FEATURE.PLAYING_TIME,
    category: 'duration',
    type: 'integer',
    unit: 'minutes',
    min: 0,
    max: 1440,
  },
  {
    key: FEATURE.TIME_REMAINING,
    category: 'duration',
    type: 'integer',
    unit: 'minutes',
    min: 0,
    max: 1440,
  },
  // A list of the limits the app offers: the command sends the chosen value.
  { key: FEATURE.DAILY_LIMIT, category: 'text', type: 'select', min: 0, max: 0, command: true },
  {
    key: FEATURE.BONUS_TIME,
    category: 'duration',
    type: 'integer',
    unit: 'minutes',
    min: 0,
    max: 1440,
  },
  { key: FEATURE.GAME, category: 'text', type: 'text', min: 0, max: 0 },
  { key: FEATURE.PLAYING, category: 'input', type: 'binary', min: 0, max: 1 },
  { key: FEATURE.ONLINE, category: 'input', type: 'binary', min: 0, max: 1 },
  // 1: the software is suspended at the limit; 0: an alarm only.
  {
    key: FEATURE.SUSPEND_SOFTWARE,
    category: 'switch',
    type: 'binary',
    min: 0,
    max: 1,
    command: true,
  },
];

/**
 * @param {object} gladys
 * @param {string} deviceId Nintendo id of the console
 */
export function consoleIds(gladys, deviceId) {
  return gladys.externalIds(DEVICE_TYPE, deviceId);
}

/**
 * The Nintendo id of one of the integration's device or feature external ids, or null.
 * @param {object} gladys
 * @param {string} externalId
 */
export function deviceIdOf(gladys, externalId) {
  const prefix = gladys.externalId(`${DEVICE_TYPE}:`);
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  const id = externalId.slice(prefix.length).split(':')[0];
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}

/** The feature key of a feature external id, or null. */
export function featureKeyOf(externalId) {
  const key = String(externalId ?? '')
    .split(':')
    .pop();
  return Object.values(FEATURE).includes(key) ? key : null;
}

/** "Living room (Nintendo Switch 2)". */
export function consoleName({ label, model }) {
  const product = `Nintendo ${model ?? 'Switch'}`;
  return label ? `${label} (${product})` : product;
}

/**
 * @param {object} gladys
 * @param {{ id: string, label: string|null, model: string|null }} info
 * @param {string} language
 */
export function buildDevice(gladys, info, language) {
  const ids = consoleIds(gladys, info.id);
  const names = pick(NAMES, language);
  return {
    name: consoleName(info),
    external_id: ids.device,
    should_poll: true,
    poll_frequency: DEVICE_POLL_FREQUENCIES.EVERY_MINUTES,
    params: [{ name: 'model', value: info.model ?? 'Switch' }],
    features: FEATURES.map(({ key, command, ...feature }) => ({
      name: names[key],
      external_id: ids.feature(key),
      read_only: !command,
      has_feedback: Boolean(command),
      ...feature,
      ...(key === FEATURE.DAILY_LIMIT ? { supported_options: limitOptions(language) } : {}),
    })),
  };
}

/** The choices of the daily limit list. */
export function limitOptions(language) {
  return limitValues().map((value, index) => ({
    value,
    label: limitLabel(value, language),
    sort_order: index,
  }));
}

/**
 * The states of one console.
 * @param {object} gladys
 * @param {ReturnType<import('./nintendo/model.js').buildSnapshot>} snapshot
 * @param {{ playing: boolean, online: boolean, game: { title: string }|null }} live
 * @param {string} language
 */
export function consoleStates(gladys, snapshot, live, language) {
  const ids = consoleIds(gladys, snapshot.id);
  return [
    number(ids.feature(FEATURE.PLAYING_TIME), snapshot.played),
    number(ids.feature(FEATURE.TIME_REMAINING), snapshot.remaining),
    text(ids.feature(FEATURE.DAILY_LIMIT), snapshot.limit === null ? 'none' : snapshot.limit),
    // "No limit today" has no duration: a full day stands for it.
    number(ids.feature(FEATURE.BONUS_TIME), snapshot.bonus === -1 ? 1440 : (snapshot.bonus ?? 0)),
    text(ids.feature(FEATURE.GAME), live.game?.title ?? pick(TEXT.noGame, language)),
    number(ids.feature(FEATURE.PLAYING), live.playing ? 1 : 0),
    number(ids.feature(FEATURE.ONLINE), live.online ? 1 : 0),
    number(ids.feature(FEATURE.SUSPEND_SOFTWARE), snapshot.suspend ? 1 : 0),
  ];
}

function text(id, value) {
  // A text state is never empty: Gladys ignores it.
  return { device_feature_external_id: id, text: String(value).slice(0, 255) || '-' };
}

function number(id, value) {
  return { device_feature_external_id: id, state: value };
}
