// -----------------------------------------------------------------------------
// The "Nintendo Switch consoles" dashboard widget. Pure builder: the data
// comes from the last refresh (no Nintendo request per dashboard), the
// content is localized from the language of the dashboard request.
//
// - one console (chosen in the widget settings, or the only one of the
//   account): played / remaining / limit tiles, the game and the mode, and
//   the buttons "+15 min", "Alarm only" and "Suspend";
// - several consoles and none chosen: one status row per console.
//
// Core budget: 8 components, 2 texts, 1 status list, 4 buttons. The current
// mode is shown by the check-circle icon, never by the `primary` style
// (invisible in dark mode). Every button asks for a confirmation: it changes
// the console.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { TEXT, formatMinutes, pick } from './i18n.js';

export const WIDGET = { CONSOLES: 'consoles' };

/** Keys of the widget buttons (onWidgetAction). */
export const WIDGET_ACTION = { BONUS: 'bonus', ALARM: 'alarm', SUSPEND: 'suspend' };

/** Minutes added by the bonus button. */
export const WIDGET_BONUS_MINUTES = 15;

/** Remaining minutes under which a console shows in orange. */
const LOW_MINUTES = 15;
const MAX_ROWS = 10;

/**
 * @param {object} input
 * @param {'not_linked'|'waiting'|'no_console'|'ok'} input.status
 * @param {Array<{ id: string, name: string, snapshot: object, live: object, externalId: string }>} input.consoles
 * @param {string|null} input.selected device external id chosen in the settings
 * @param {boolean} input.nintendoDown the last refresh failed
 * @param {string} input.language
 * @param {number} input.ttlSeconds
 */
export function buildConsolesContent({
  status,
  consoles,
  selected,
  nintendoDown,
  language,
  ttlSeconds,
}) {
  const ttl = Math.min(3600, Math.max(10, Math.round(ttlSeconds)));
  const only = (key) => ({ ttl_seconds: ttl, components: [body(pick(TEXT[key], language))] });
  if (status === 'not_linked') {
    return only('notLinked');
  }
  if (consoles.length === 0) {
    if (status === 'no_console') return only('noConsole');
    return only(nintendoDown ? 'nintendoDown' : 'waiting');
  }

  let shown = consoles;
  if (selected) {
    shown = consoles.filter((entry) => entry.externalId === selected);
    if (shown.length === 0) {
      return only('unknownConsole');
    }
  }
  const components = shown.length === 1 ? single(shown[0], language) : overview(shown, language);
  // At most two texts per widget: the outage note goes first.
  if (nintendoDown) {
    const texts = components.filter((component) => component.type === 'text');
    if (texts.length >= 2) {
      components.splice(components.indexOf(texts.at(-1)), 1);
    }
    components.push(caption(pick(TEXT.nintendoDown, language)));
  }
  return { ttl_seconds: ttl, components };
}

function single({ id, name, snapshot, live }, language) {
  const bonusActive = snapshot.bonus !== null && snapshot.bonus !== 0;
  const components = [
    { type: 'text', variant: 'heading', text: truncate(name, 40) },
    {
      type: 'value',
      label: pick(TEXT.played, language),
      value: snapshot.played,
      unit: pick(TEXT.minutes, language),
      icon: 'clock',
      color: snapshot.limitReached ? WIDGET_COLORS.DANGER : WIDGET_COLORS.NEUTRAL,
    },
    {
      type: 'value',
      label: pick(TEXT.remaining, language),
      value: snapshot.remaining,
      unit: pick(TEXT.minutes, language),
      icon: 'watch',
      color: remainingColor(snapshot),
    },
    {
      type: 'value',
      label: pick(TEXT.limit, language),
      value: truncate(limitText(snapshot, language), 12),
      icon: 'sliders',
    },
  ];

  const items = [
    {
      label: pick(TEXT.game, language),
      value: truncate(live.game?.title ?? pick(TEXT.noGame, language), 40),
      icon: live.playing ? 'play' : 'pause',
      color: live.playing ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
    },
    {
      label: pick(TEXT.mode, language),
      value: pick(snapshot.suspend ? TEXT.modeSuspend : TEXT.modeAlarm, language),
      icon: snapshot.suspend ? 'pause-circle' : 'bell',
      color: WIDGET_COLORS.INFO,
    },
  ];
  if (bonusActive) {
    items.push({
      label: pick(TEXT.bonus, language),
      value:
        snapshot.bonus === -1
          ? pick(TEXT.unlimited, language)
          : formatMinutes(snapshot.bonus, language),
      icon: 'gift',
      color: WIDGET_COLORS.INFO,
    });
  }
  components.push({ type: 'status', items });

  components.push({
    type: 'button',
    label: pick(TEXT.buttonBonus, language),
    icon: 'plus-circle',
    style: 'secondary',
    action: {
      key: WIDGET_ACTION.BONUS,
      params: { console: id, minutes: WIDGET_BONUS_MINUTES },
      confirm: true,
    },
  });
  if (bonusActive) {
    // Nintendo refuses a mode change once a bonus is granted for the day.
    components.push(caption(pick(TEXT.bonusActive, language)));
  } else {
    components.push(
      modeButton(id, WIDGET_ACTION.ALARM, TEXT.buttonAlarm, !snapshot.suspend, 'bell', language),
      modeButton(
        id,
        WIDGET_ACTION.SUSPEND,
        TEXT.buttonSuspend,
        snapshot.suspend,
        'pause-circle',
        language,
      ),
    );
  }
  return components;
}

function modeButton(id, key, label, current, icon, language) {
  return {
    type: 'button',
    label: pick(label, language),
    icon: current ? 'check-circle' : icon,
    style: 'secondary',
    action: { key, params: { console: id }, confirm: true },
  };
}

function overview(consoles, language) {
  const playing = consoles.filter((entry) => entry.live.playing).length;
  const components = [
    {
      type: 'value',
      label: pick(TEXT.playingNow, language),
      value: `${playing}/${consoles.length}`,
      icon: 'play',
      color: playing > 0 ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
    },
    {
      type: 'status',
      items: consoles.slice(0, MAX_ROWS).map(({ name, snapshot, live }) => ({
        label: truncate(name, 40),
        value: truncate(
          snapshot.limit === null
            ? formatMinutes(snapshot.played, language)
            : `${formatMinutes(snapshot.played, language)} / ${limitText(snapshot, language)}`,
          40,
        ),
        icon: live.playing ? 'play' : 'pause',
        color: snapshot.limitReached
          ? WIDGET_COLORS.DANGER
          : live.playing
            ? remainingColor(snapshot, WIDGET_COLORS.SUCCESS)
            : WIDGET_COLORS.NEUTRAL,
      })),
    },
  ];
  return components;
}

function limitText(snapshot, language) {
  return snapshot.limit === null
    ? pick(TEXT.noLimit, language)
    : formatMinutes(snapshot.limit, language);
}

function remainingColor(snapshot, otherwise = WIDGET_COLORS.NEUTRAL) {
  if (!snapshot.constrained) return otherwise;
  if (snapshot.remaining === 0) return WIDGET_COLORS.DANGER;
  if (snapshot.remaining <= LOW_MINUTES) return WIDGET_COLORS.WARNING;
  return otherwise;
}

function body(text) {
  return { type: 'text', variant: 'body', text };
}

function caption(text) {
  return { type: 'text', variant: 'caption', text: truncate(text, 80) };
}

function truncate(text, max) {
  const value = String(text);
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
