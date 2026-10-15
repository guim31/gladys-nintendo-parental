// -----------------------------------------------------------------------------
// Every text the container produces, in the four languages of the Gladys
// interface. German says "du", Spanish "usted" (test/i18n.test.js checks it).
// Feature names, states and the labels of the daily limit list follow the
// `language` of the configuration (a device integration does not receive the
// user's language); widget contents follow the language of the dashboard.
// -----------------------------------------------------------------------------

/** Feature names, fixed by Gladys when the device is created. */
export const NAMES = {
  en: {
    playing_time: 'Play time today',
    time_remaining: 'Time remaining',
    daily_limit: 'Daily limit',
    bonus_time: 'Bonus time today',
    game: 'Current or last game',
    playing: 'Playing',
    online: 'Online',
    suspend_software: 'Suspend software at limit',
  },
  fr: {
    playing_time: "Temps de jeu aujourd'hui",
    time_remaining: 'Temps restant',
    daily_limit: 'Limite du jour',
    bonus_time: "Temps bonus aujourd'hui",
    game: 'Jeu en cours ou dernier jeu',
    playing: 'En jeu',
    online: 'En ligne',
    suspend_software: 'Suspendre le logiciel à la limite',
  },
  de: {
    playing_time: 'Spielzeit heute',
    time_remaining: 'Verbleibende Zeit',
    daily_limit: 'Tageslimit',
    bonus_time: 'Bonuszeit heute',
    game: 'Aktuelles oder letztes Spiel',
    playing: 'Spielt',
    online: 'Online',
    suspend_software: 'Software beim Limit unterbrechen',
  },
  es: {
    playing_time: 'Tiempo de juego hoy',
    time_remaining: 'Tiempo restante',
    daily_limit: 'Límite diario',
    bonus_time: 'Tiempo extra hoy',
    game: 'Juego actual o último juego',
    playing: 'Jugando',
    online: 'En línea',
    suspend_software: 'Suspender el programa en el límite',
  },
};

/** Short texts: states, labels of the limit list, widget parts. */
export const TEXT = {
  noLimit: { en: 'No limit', fr: 'Sans limite', de: 'Kein Limit', es: 'Sin límite' },
  noGame: { en: 'None', fr: 'Aucun', de: 'Keins', es: 'Ninguno' },
  minutes: { en: 'min', fr: 'min', de: 'Min.', es: 'min' },
  played: { en: 'Played', fr: 'Joué', de: 'Gespielt', es: 'Jugado' },
  remaining: { en: 'Remaining', fr: 'Restant', de: 'Übrig', es: 'Restante' },
  limit: { en: 'Limit', fr: 'Limite', de: 'Limit', es: 'Límite' },
  bonus: { en: 'Bonus', fr: 'Bonus', de: 'Bonus', es: 'Extra' },
  game: { en: 'Game', fr: 'Jeu', de: 'Spiel', es: 'Juego' },
  mode: { en: 'At the limit', fr: 'À la limite', de: 'Beim Limit', es: 'En el límite' },
  modeAlarm: { en: 'Alarm only', fr: 'Alarme seule', de: 'Nur Alarm', es: 'Solo alarma' },
  modeSuspend: {
    en: 'Software suspended',
    fr: 'Logiciel suspendu',
    de: 'Software unterbrochen',
    es: 'Programa suspendido',
  },
  playingNow: { en: 'Playing', fr: 'En jeu', de: 'Spielt', es: 'Jugando' },
  idle: { en: 'Not playing', fr: 'Ne joue pas', de: 'Spielt nicht', es: 'No juega' },
  unlimited: { en: 'Unlimited', fr: 'Illimité', de: 'Unbegrenzt', es: 'Ilimitado' },
  buttonBonus: { en: '+15 min', fr: '+15 min', de: '+15 Min.', es: '+15 min' },
  buttonAlarm: { en: 'Alarm only', fr: 'Alarme seule', de: 'Nur Alarm', es: 'Solo alarma' },
  buttonSuspend: { en: 'Suspend', fr: 'Suspendre', de: 'Unterbrechen', es: 'Suspender' },
  notLinked: {
    en: 'Connect your Nintendo account in the configuration of the integration.',
    fr: "Connectez votre compte Nintendo dans la configuration de l'intégration.",
    de: 'Verbinde dein Nintendo-Konto in der Konfiguration der Integration.',
    es: 'Conecte su cuenta Nintendo en la configuración de la integración.',
  },
  waiting: {
    en: 'Waiting for the first answer from Nintendo…',
    fr: 'En attente de la première réponse de Nintendo…',
    de: 'Warte auf die erste Antwort von Nintendo…',
    es: 'Esperando la primera respuesta de Nintendo…',
  },
  noConsole: {
    en: 'No console is linked to this Nintendo account.',
    fr: "Aucune console n'est liée à ce compte Nintendo.",
    de: 'Mit diesem Nintendo-Konto ist keine Konsole verknüpft.',
    es: 'No hay ninguna consola vinculada a esta cuenta Nintendo.',
  },
  unknownConsole: {
    en: 'This console is no longer on the Nintendo account.',
    fr: "Cette console n'est plus sur le compte Nintendo.",
    de: 'Diese Konsole ist nicht mehr im Nintendo-Konto.',
    es: 'Esta consola ya no está en la cuenta Nintendo.',
  },
  nintendoDown: {
    en: 'Nintendo does not answer, last known values shown.',
    fr: 'Nintendo ne répond pas, dernières valeurs connues affichées.',
    de: 'Nintendo antwortet nicht, letzte bekannte Werte angezeigt.',
    es: 'Nintendo no responde, se muestran los últimos valores conocidos.',
  },
  bonusActive: {
    en: 'Bonus granted today: the limit and the mode cannot change until tomorrow.',
    fr: "Bonus accordé aujourd'hui : la limite et le mode ne changent plus avant demain.",
    de: 'Heute Bonus gewährt: Limit und Modus lassen sich erst morgen ändern.',
    es: 'Tiempo extra concedido hoy: el límite y el modo no cambian hasta mañana.',
  },
};

/** Connection statuses, action and widget messages (≤ 200 characters). */
export const MESSAGES = {
  initFailed: {
    en: 'Initialization failed, check the integration logs.',
    fr: "L'initialisation a échoué, consultez les journaux de l'intégration.",
    de: 'Die Initialisierung ist fehlgeschlagen, sieh in den Protokollen der Integration nach.',
    es: 'La inicialización ha fallado, consulte los registros de la integración.',
  },
  notLinked: {
    en: 'Not connected: click Connect, sign in, then paste the link of "Select this person".',
    fr: 'Non connecté : cliquez sur Connecter, identifiez-vous, puis collez le lien de « Choisir cette personne ».',
    de: 'Nicht verbunden: klicke auf Verbinden, melde dich an und füge den Link von „Diese Person auswählen“ ein.',
    es: 'No conectado: haga clic en Conectar, inicie sesión y pegue el enlace de «Seleccionar a esta persona».',
  },
  invalidLink: {
    en: 'The pasted text is not the link of "Select this person": it starts with npf54789befb391a838://auth.',
    fr: "Le texte collé n'est pas le lien de « Choisir cette personne » : il commence par npf54789befb391a838://auth.",
    de: 'Der eingefügte Text ist nicht der Link von „Diese Person auswählen“: er beginnt mit npf54789befb391a838://auth.',
    es: 'El texto pegado no es el enlace de «Seleccionar a esta persona»: empieza por npf54789befb391a838://auth.',
  },
  otherLogin: {
    en: 'This link comes from another sign-in: click Connect again and paste the new link.',
    fr: 'Ce lien vient d’une autre connexion : cliquez à nouveau sur Connecter et collez le nouveau lien.',
    de: 'Dieser Link stammt von einer anderen Anmeldung: klicke erneut auf Verbinden und füge den neuen Link ein.',
    es: 'Este enlace viene de otro inicio de sesión: haga clic de nuevo en Conectar y pegue el nuevo enlace.',
  },
  linkRefused: {
    en: 'Nintendo refused the link (already used or expired): click Connect again and paste the new link quickly.',
    fr: 'Nintendo a refusé le lien (déjà utilisé ou expiré) : cliquez à nouveau sur Connecter et collez vite le nouveau lien.',
    de: 'Nintendo hat den Link abgelehnt (schon benutzt oder abgelaufen): klicke erneut auf Verbinden und füge den neuen Link zügig ein.',
    es: 'Nintendo ha rechazado el enlace (ya usado o caducado): haga clic de nuevo en Conectar y pegue pronto el nuevo enlace.',
  },
  sessionEnded: {
    en: 'Nintendo ended the session (password changed or signed out): connect the account again.',
    fr: 'Nintendo a mis fin à la session (mot de passe changé ou déconnexion) : reconnectez le compte.',
    de: 'Nintendo hat die Sitzung beendet (Passwort geändert oder abgemeldet): verbinde das Konto erneut.',
    es: 'Nintendo ha cerrado la sesión (contraseña cambiada o cierre de sesión): conecte de nuevo la cuenta.',
  },
  noConsole: {
    en: 'No console is linked to this Nintendo account: pair one in the Nintendo Switch Parental Controls app.',
    fr: "Aucune console n'est liée à ce compte Nintendo : associez-en une dans l'appli Nintendo Switch Parental Controls.",
    de: 'Mit diesem Nintendo-Konto ist keine Konsole verknüpft: kopple eine in der App Nintendo Switch Parental Controls.',
    es: 'No hay ninguna consola vinculada a esta cuenta Nintendo: vincule una en la aplicación Nintendo Switch Parental Controls.',
  },
  updateRequired: {
    en: 'Nintendo now requires a newer app version: update the integration.',
    fr: "Nintendo exige désormais une version plus récente de l'appli : mettez l'intégration à jour.",
    de: 'Nintendo verlangt jetzt eine neuere App-Version: aktualisiere die Integration.',
    es: 'Nintendo exige ahora una versión más reciente de la aplicación: actualice la integración.',
  },
  unreachable: {
    en: 'Nintendo does not answer for now: the integration keeps trying.',
    fr: "Nintendo ne répond pas pour l'instant : l'intégration réessaie.",
    de: 'Nintendo antwortet gerade nicht: die Integration versucht es weiter.',
    es: 'Nintendo no responde por ahora: la integración sigue intentándolo.',
  },
  signedOut: {
    en: 'Signed out: the Nintendo session was deleted from the integration.',
    fr: "Déconnecté : la session Nintendo a été supprimée de l'intégration.",
    de: 'Abgemeldet: die Nintendo-Sitzung wurde aus der Integration gelöscht.',
    es: 'Sesión cerrada: la sesión de Nintendo se ha borrado de la integración.',
  },
  notSignedIn: {
    en: 'No Nintendo session to delete.',
    fr: 'Aucune session Nintendo à supprimer.',
    de: 'Keine Nintendo-Sitzung zum Löschen.',
    es: 'No hay ninguna sesión de Nintendo que borrar.',
  },
  bonusRefused: {
    en: 'Nintendo did not add the time: it cannot be extended past bedtime or any more today.',
    fr: "Nintendo n'a pas ajouté le temps : impossible au-delà du coucher ou de nouveau aujourd'hui.",
    de: 'Nintendo hat die Zeit nicht hinzugefügt: nicht über die Schlafenszeit hinaus oder heute nicht mehr möglich.',
    es: 'Nintendo no ha añadido el tiempo: no se puede pasar de la hora de dormir ni ampliar más hoy.',
  },
  bonusActive: TEXT.bonusActive,
  unknownConsole: TEXT.unknownConsole,
};

/** Messages built with a value. */
export const FORMAT = {
  en: {
    bonusAdded: (minutes, name) => `${minutes} min added for ${name}.`,
    modeSet: (suspend, name) =>
      suspend ? `${name}: software suspended at the limit.` : `${name}: alarm only at the limit.`,
    consoles: (list) => `Connected. Consoles: ${list}.`,
  },
  fr: {
    bonusAdded: (minutes, name) => `${minutes} min ajoutées pour ${name}.`,
    modeSet: (suspend, name) =>
      suspend ? `${name} : logiciel suspendu à la limite.` : `${name} : alarme seule à la limite.`,
    consoles: (list) => `Connecté. Consoles : ${list}.`,
  },
  de: {
    bonusAdded: (minutes, name) => `${minutes} Min. für ${name} hinzugefügt.`,
    modeSet: (suspend, name) =>
      suspend
        ? `${name}: Software wird beim Limit unterbrochen.`
        : `${name}: beim Limit nur Alarm.`,
    consoles: (list) => `Verbunden. Konsolen: ${list}.`,
  },
  es: {
    bonusAdded: (minutes, name) => `${minutes} min añadidos para ${name}.`,
    modeSet: (suspend, name) =>
      suspend ? `${name}: programa suspendido en el límite.` : `${name}: solo alarma en el límite.`,
    consoles: (list) => `Conectado. Consolas: ${list}.`,
  },
};

/**
 * @param {Record<string, any>} texts a multi-language object
 * @param {string} language
 */
export function pick(texts, language) {
  return texts[language] ?? texts.en;
}

/**
 * A multi-language object built by a FORMAT function.
 * @param {string} key
 * @param  {...any} args
 */
export function format(key, ...args) {
  return Object.fromEntries(
    Object.entries(FORMAT).map(([language, table]) => [language, table[key](...args)]),
  );
}

/** "45 min", "2 h", "2 h 05". */
export function formatMinutes(minutes, language) {
  if (minutes < 60) {
    return `${minutes} ${pick(TEXT.minutes, language)}`;
  }
  const rest = minutes % 60;
  return rest === 0
    ? `${minutes / 60} h`
    : `${Math.floor(minutes / 60)} h ${String(rest).padStart(2, '0')}`;
}

/** Label of a value of the daily limit list. */
export function limitLabel(value, language) {
  return value === 'none' ? pick(TEXT.noLimit, language) : formatMinutes(Number(value), language);
}
