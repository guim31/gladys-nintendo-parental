// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the user in Gladys from the `config_schema` of the manifest,
// fetched by the SDK (`gladys.getConfig()`) and pushed again on every change
// (`gladys.onConfigUpdated()`). This module provides the defaults and
// normalizes the received object, so the rest of the code never deals with
// `undefined`, pasted spaces or out-of-range values.
//
// The `nintendo_account` field (type `account_link`) stores no value: it is
// the "Connect" button. The session token obtained from the pasted link lives
// in /data, never in the configuration.
// -----------------------------------------------------------------------------

/** The languages of the Gladys interface, for the texts the container produces. */
export const LANGUAGES = ['en', 'fr', 'de', 'es'];

/** Refresh intervals offered in the configuration, in seconds (select values are strings). */
export const REFRESH_INTERVALS = ['60', '120', '300'];

/** Key of the `account_link` field of the manifest (the "Connect" button). */
export const ACCOUNT_FIELD = 'nintendo_account';

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest (test/manifest.test.js checks it).
export const DEFAULT_CONFIG = {
  redirect_link: '',
  refresh_interval: '60',
  language: 'fr',
};

/**
 * Merge the user config with the defaults and clean every value.
 * @param {Record<string, unknown>} [raw] config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const language = String(raw.language ?? DEFAULT_CONFIG.language);
  const interval = String(raw.refresh_interval ?? DEFAULT_CONFIG.refresh_interval);
  return {
    // A link copied from a browser often carries a space or a line break.
    redirect_link: String(raw.redirect_link ?? '').trim(),
    refresh_interval: REFRESH_INTERVALS.includes(interval)
      ? interval
      : DEFAULT_CONFIG.refresh_interval,
    language: LANGUAGES.includes(language) ? language : DEFAULT_CONFIG.language,
  };
}

/** @param {{ refresh_interval: string }} config */
export function refreshPeriodMs(config) {
  return Number(config.refresh_interval) * 1000;
}

/**
 * The language Nintendo is asked to answer in (game titles), from the
 * language of the configuration.
 * @param {string} language
 */
export function nintendoLanguage(language) {
  return { en: 'en-US', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' }[language] ?? 'en-US';
}
