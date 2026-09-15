/**
 * api-client.js — Zugriffs-Bridge ("Seam") fuer bestehenden localStorage-
 * Zustand.
 *
 * Buendelt ALLEN localStorage-Zugriff fuer Favoriten, Warenkorb/Shop-
 * Konfiguration, Reviews, Idle-Save, Garage, Stats, Achievements, Race und
 * Wartungsrechner hinter benannten Funktionen. Reiner Zugriffs-Layer, KEIN
 * Migrations-Tool: alle Funktionen lesen/schreiben exakt dieselben,
 * UNVERAENDERTEN localStorage-Keys wie vorher (siehe GOLDEN_PRINCIPLES_KE.md
 * Regel 7) und liefern exakt dieselben Datenformen wie die bisherigen,
 * direkten Aufrufer — kein Verhaltenswechsel.
 *
 * Dies ist genau die Stelle, die ein zukuenftiges Backend ersetzen wuerde
 * (siehe docs/API-CONTRACT.md — "Entwurf, noch nicht implementiert"): jede
 * Funktion hier entspricht 1:1 einem dort skizzierten Endpoint. Eine
 * Migration muesste nur die Funktionskoerper hier auf fetch() umstellen;
 * Aufrufer (index.html, shop.html, idle.js, garage.js, race.html, stats.js,
 * achievements.js, ...) blieben unveraendert, solange die Signaturen gleich
 * bleiben.
 *
 * Bewusst NICHT abgedeckt (siehe jeweilige Datei-Kommentare fuer die
 * Begruendung): settings.js (Theme/Helligkeit/A11y — synchroner
 * Bootstrap-kritischer Pfad vor dem ersten Render, siehe dort), soundcheck.js
 * (an die per GOLDEN_PRINCIPLES_KE.md Regel 6 geschuetzte soundcheck.html
 * gekoppelt), theme-toggle.js, openclaw-test/* (separates, nicht
 * verlinktes Altsystem).
 *
 * Idle-Save (loadIdleState/saveIdleState) delegiert bewusst an die
 * bestehenden IdleCore.loadState()/IdleCore.saveState() (window.IdleCore),
 * WENN idle-core.js auf der Seite geladen ist — dort steckt die
 * eigentliche Versions-Migrations-/Validierungslogik
 * (IDLE_STATE_VERSION), die hier NICHT dupliziert wird, um
 * tests/idle-core-test.js nicht zu gefaehrden. Ist IdleCore nicht
 * verfuegbar (z. B. reiner Node-Kontext ohne idle-core.js), wird auf einen
 * einfachen, migrationsfreien JSON-Zugriff auf denselben Key
 * zurueckgefallen (siehe JSDoc dort).
 *
 * Bereitgestellt sowohl im Browser (window.ApiClient / globalThis.ApiClient)
 * als auch in Node (module.exports), analog zum Muster in bikes-data.js /
 * bike-image.js / stats.js / achievements.js / garage.js.
 */
(function () {
  'use strict';

  /** Maximale Anzahl an Eintraegen in der Garage-"Zuletzt angesehen"-Liste (siehe garage.js MAX_RECENTLY_VIEWED). */
  var MAX_RECENTLY_VIEWED = 8;

  /**
   * Liest ein JSON-Wert sicher aus localStorage. Faellt bei fehlendem
   * localStorage, fehlendem Key oder korruptem JSON auf fallback zurueck
   * (nie ein Fehler nach aussen).
   * @param {string} key - localStorage-Key.
   * @param {*} fallback - Rueckgabewert bei Fehler/Fehlen.
   * @returns {*} Geparster Wert oder fallback.
   */
  function readJSON(key, fallback) {
    try {
      if (typeof localStorage === 'undefined' || localStorage === null) return fallback;
      var raw = localStorage.getItem(key);
      if (raw === null || raw === undefined) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  /**
   * Schreibt einen Wert als JSON sicher in localStorage. Schlaegt nie mit
   * einer Exception nach aussen durch (z. B. bei vollem Speicher).
   * @param {string} key - localStorage-Key.
   * @param {*} value - Zu speichernder Wert (wird JSON-serialisiert).
   * @returns {void}
   */
  function writeJSON(key, value) {
    try {
      if (typeof localStorage === 'undefined' || localStorage === null) return;
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      /* bewusst ignoriert — darf App nie blockieren */
    }
  }

  // ============================================================
  // Favoriten — Key 'vroooom_favorites' (Array<string> Bike-IDs)
  // ============================================================

  /**
   * Liest die aktuelle Favoritenliste.
   * @returns {Array<string>} Bike-IDs (leer, falls keine/korrupte Daten).
   */
  function getFavorites() {
    var favs = readJSON('vroooom_favorites', []);
    return Array.isArray(favs) ? favs : [];
  }

  /**
   * Ersetzt die komplette Favoritenliste (identisch zum bisherigen
   * Store.set()-Verhalten in index.html — kein Merge, ganze Liste wird
   * ueberschrieben).
   * @param {Array<string>} list - Neue, vollstaendige Favoritenliste.
   * @returns {void}
   */
  function setFavorites(list) {
    writeJSON('vroooom_favorites', Array.isArray(list) ? list : []);
  }

  /**
   * Schaltet einen Favoriten um (vorhanden → entfernen, sonst → hinzufuegen).
   * @param {string} bikeKey - Bike-ID.
   * @returns {Array<string>} Aktualisierte Favoritenliste.
   */
  function toggleFavorite(bikeKey) {
    var favs = getFavorites();
    var idx = favs.indexOf(bikeKey);
    if (idx === -1) favs.push(bikeKey);
    else favs.splice(idx, 1);
    setFavorites(favs);
    return favs;
  }

  // ============================================================
  // Reviews — Key 'vroooom_reviews' (Object<bikeKey, Array<{rating,text,date}>>)
  // ============================================================

  /**
   * Liest das komplette Reviews-Objekt (alle Bikes).
   * @returns {Object<string, Array<{rating: number, text: string, date: string}>>} Rohdaten (leer, falls keine/korrupte Daten).
   */
  function getAllReviews() {
    var data = readJSON('vroooom_reviews', {});
    return (data && typeof data === 'object') ? data : {};
  }

  /**
   * Liest die Reviews fuer ein einzelnes Bike.
   * @param {string} bikeKey - Bike-ID.
   * @returns {Array<{rating: number, text: string, date: string}>} Reviews (leer, falls keine).
   */
  function getReviews(bikeKey) {
    var all = getAllReviews();
    return Array.isArray(all[bikeKey]) ? all[bikeKey].slice() : [];
  }

  /**
   * Fuegt eine neue Review fuer ein Bike hinzu (Datumsformat identisch zum
   * bisherigen index.html-Verhalten: toLocaleDateString('de-DE')).
   * @param {string} bikeKey - Bike-ID.
   * @param {number} rating - Sterne-Bewertung (1-5).
   * @param {string} text - Freitext.
   * @returns {{rating: number, text: string, date: string}} Die neu angelegte Review.
   */
  function addReview(bikeKey, rating, text) {
    var all = getAllReviews();
    if (!Array.isArray(all[bikeKey])) all[bikeKey] = [];
    var entry = { rating: rating, text: text, date: new Date().toLocaleDateString('de-DE') };
    all[bikeKey].push(entry);
    writeJSON('vroooom_reviews', all);
    return entry;
  }

  // ============================================================
  // Warenkorb/Shop-Konfiguration — zwei unabhaengige, opake Keys in shop.html
  // ============================================================

  /**
   * Liest die gespeicherte Tuning-Teile-Konfiguration
   * (Key 'kawasaki_shop_config', geschrieben von shop.html saveConfig()).
   * Reiner opaquer Pass-Through — die Form des Objekts ({bike, parts,
   * savedAt, summary}) wird hier NICHT vorgeschrieben/validiert, analog
   * zum bisherigen Verhalten.
   * @returns {Object|null} Gespeicherte Konfiguration oder null, falls keine vorhanden ist.
   */
  function getShopConfig() {
    return readJSON('kawasaki_shop_config', null);
  }

  /**
   * Speichert die Tuning-Teile-Konfiguration (ueberschreibt vollstaendig).
   * @param {Object} config - Zu speichernde Konfiguration.
   * @returns {void}
   */
  function setShopConfig(config) {
    writeJSON('kawasaki_shop_config', config);
  }

  /**
   * Liest den Farbe/Addon-Konfigurator-Zustand
   * (Key 'vroooom_config_state', geschrieben von shop.html mcUpdatePrice()/
   * gelesen von mcInit()). Reiner opaquer Pass-Through.
   * @returns {Object|null} Gespeicherter Zustand oder null, falls keiner vorhanden ist.
   */
  function getConfiguratorState() {
    return readJSON('vroooom_config_state', null);
  }

  /**
   * Speichert den Farbe/Addon-Konfigurator-Zustand (ueberschreibt vollstaendig).
   * @param {Object} state - Zu speichernder Zustand.
   * @returns {void}
   */
  function setConfiguratorState(state) {
    writeJSON('vroooom_config_state', state);
  }

  // ============================================================
  // Idle-Save — Key 'vroooom_idle_state' (zentraler, versionierter State-Blob)
  // ============================================================

  /**
   * Liefert die IdleCore-Referenz, falls idle-core.js auf der Seite
   * geladen ist (window.IdleCore bzw. globalThis.IdleCore).
   * @returns {Object|null} IdleCore-API oder null.
   */
  function getIdleCore() {
    if (typeof window !== 'undefined' && window.IdleCore) return window.IdleCore;
    if (typeof globalThis !== 'undefined' && globalThis.IdleCore) return globalThis.IdleCore;
    return null;
  }

  /**
   * Laedt den zentralen Idle-Zustand. Delegiert an IdleCore.loadState()
   * (Migration/Validierung/IDLE_STATE_VERSION bleibt dort), falls
   * idle-core.js geladen ist. Fallback (kein IdleCore verfuegbar): liest
   * denselben Key roh per JSON, OHNE Migration — nur fuer Kontexte ohne
   * idle-core.js gedacht.
   * @returns {Object|null} Idle-Zustand (Form haengt vom Aufrufkontext ab, siehe oben).
   */
  function loadIdleState() {
    var core = getIdleCore();
    if (core && typeof core.loadState === 'function') return core.loadState();
    return readJSON('vroooom_idle_state', null);
  }

  /**
   * Speichert den zentralen Idle-Zustand. Delegiert an IdleCore.saveState()
   * (setzt lastSavedAt/offline.lastSeenAt dort), falls idle-core.js
   * geladen ist. Fallback: schreibt denselben Key roh per JSON.
   * @param {Object} state - Zu speichernder Idle-Zustand.
   * @returns {void}
   */
  function saveIdleState(state) {
    var core = getIdleCore();
    if (core && typeof core.saveState === 'function') { core.saveState(state); return; }
    writeJSON('vroooom_idle_state', state);
  }

  // ============================================================
  // Garage — Keys 'vroooom_garage_recentlyViewed', 'vroooom_garage_dreamBike'
  // ============================================================

  /**
   * Liest die "Zuletzt angesehen"-Liste (neueste zuerst, max. 8 Eintraege).
   * @returns {Array<{bikeKey: string, viewedAt: string}>} Liste (leer, falls keine/korrupte Daten).
   */
  function getRecentlyViewed() {
    var list = readJSON('vroooom_garage_recentlyViewed', []);
    return Array.isArray(list) ? list : [];
  }

  /**
   * Traegt ein Bike als "zuletzt angesehen" ein: dedupliziert (bestehender
   * Eintrag desselben Bikes wird nach vorne verschoben statt verdoppelt),
   * neuester Eintrag zuerst, auf maxLen Eintraege gekappt (Standard: 8).
   * Identische Logik zu garage.js addToRecentlyViewed()/index.html
   * recordGarageRecentlyView() — beide Stellen schreiben auf denselben Key.
   * @param {string} bikeKey - Bike-ID des angesehenen Motorrads.
   * @param {number} [maxLen] - Maximale Listenlaenge (Standard: 8).
   * @returns {Array<{bikeKey: string, viewedAt: string}>} Aktualisierte Liste.
   */
  function addRecentlyViewed(bikeKey, maxLen) {
    var cap = (typeof maxLen === 'number' && maxLen > 0) ? maxLen : MAX_RECENTLY_VIEWED;
    var list = getRecentlyViewed();
    var filtered = list.filter(function (entry) { return entry && entry.bikeKey !== bikeKey; });
    filtered.unshift({ bikeKey: bikeKey, viewedAt: new Date().toISOString() });
    var updated = filtered.slice(0, cap);
    writeJSON('vroooom_garage_recentlyViewed', updated);
    return updated;
  }

  /**
   * Liest die aktuell gewaehlte Traum-Bike-ID.
   * @returns {string|null} Bike-ID oder null, falls keins gewaehlt ist.
   */
  function getDreamBike() {
    var v = readJSON('vroooom_garage_dreamBike', null);
    return (typeof v === 'string' && v) ? v : null;
  }

  /**
   * Setzt (oder loescht) das Traum-Bike.
   * @param {string|null} bikeKey - Neue Bike-ID, oder null/leer zum Loeschen.
   * @returns {string|null} Der gespeicherte, normalisierte Wert.
   */
  function setDreamBike(bikeKey) {
    var normalized = (typeof bikeKey === 'string' && bikeKey) ? bikeKey : null;
    writeJSON('vroooom_garage_dreamBike', normalized);
    return normalized;
  }

  // ============================================================
  // Stats — Keys 'vroooom_stats_v1', 'vroooom_stats_visitedPages'
  // ============================================================

  /**
   * Liest das rohe Statistik-Objekt (OHNE Standardwerte-Merge — das bleibt
   * Aufgabe von stats.js getStats(), das diese Funktion intern nutzen kann).
   * @returns {Object} Rohes Statistik-Objekt (leer, falls keine/korrupte Daten).
   */
  function getStats() {
    var stats = readJSON('vroooom_stats_v1', {});
    return (stats && typeof stats === 'object') ? stats : {};
  }

  /**
   * Speichert das komplette Statistik-Objekt (ueberschreibt vollstaendig).
   * @param {Object} stats - Zu speicherndes Statistik-Objekt.
   * @returns {void}
   */
  function recordStat(stats) {
    writeJSON('vroooom_stats_v1', stats);
  }

  /**
   * Liest die Menge der bereits besuchten Seiten (Map Seiten-Schluessel →
   * ISO-Zeitstempel). Wird aktuell weiterhin direkt von settings.js
   * geschrieben (siehe dortige recordPageVisit() — settings.js bleibt
   * bewusst unangetastet, siehe Datei-Header oben); diese Funktion ist fuer
   * LESENDE Aufrufer (z. B. stats.js getVisitedPageCount()) gedacht.
   * @returns {Object<string, string>} Map Seiten-Schluessel → ISO-Zeitstempel.
   */
  function getVisitedPages() {
    var pages = readJSON('vroooom_stats_visitedPages', {});
    return (pages && typeof pages === 'object') ? pages : {};
  }

  // ============================================================
  // Achievements — Key 'vroooom_achievements' (Object<id, {at: string}>)
  // ============================================================

  /**
   * Liest die Menge freigeschalteter Achievements.
   * @returns {Object<string, {at: string}>} Map Achievement-ID → Freischalt-Info.
   */
  function getAchievements() {
    var unlocked = readJSON('vroooom_achievements', {});
    return (unlocked && typeof unlocked === 'object') ? unlocked : {};
  }

  /**
   * Schaltet ein Achievement idempotent frei (schreibt nur, wenn noch nicht
   * freigeschaltet). Prueft NICHT gegen eine ACHIEVEMENTS-Definitionsliste
   * (das bleibt Aufgabe von achievements.js unlock(), das diese Funktion
   * intern nutzen kann) — reiner Speicher-Layer.
   * @param {string} id - Achievement-ID.
   * @returns {boolean} true, wenn dieser Aufruf das Achievement NEU freigeschaltet hat.
   */
  function unlockAchievement(id) {
    var unlocked = getAchievements();
    if (Object.prototype.hasOwnProperty.call(unlocked, id)) return false;
    unlocked[id] = { at: new Date().toISOString() };
    writeJSON('vroooom_achievements', unlocked);
    return true;
  }

  // ============================================================
  // Race — Keys 'kawasaki_records', 'raceHighscore'
  // ============================================================

  /**
   * Liest die Bestzeiten-Map je Bike (t100 in Sekunden).
   * @returns {Object<string, number>} Map Bike-ID → Bestzeit (leer, falls keine Daten).
   */
  function getRaceRecords() {
    var records = readJSON('kawasaki_records', {});
    return (records && typeof records === 'object') ? records : {};
  }

  /**
   * Speichert die komplette Bestzeiten-Map (ueberschreibt vollstaendig).
   * @param {Object<string, number>} records - Map Bike-ID → Bestzeit.
   * @returns {void}
   */
  function saveRaceRecord(records) {
    writeJSON('kawasaki_records', records);
  }

  /**
   * Liest den globalen Highscore (schnellste Zielzeit ueber alle Bikes).
   * @returns {{time: number, bike: string, dist: string}|null} Highscore oder null.
   */
  function getRaceHighscore() {
    return readJSON('raceHighscore', null);
  }

  /**
   * Speichert den globalen Highscore (ueberschreibt vollstaendig).
   * @param {{time: number, bike: string, dist: string}} highscore - Neuer Highscore.
   * @returns {void}
   */
  function saveRaceHighscore(highscore) {
    writeJSON('raceHighscore', highscore);
  }

  // ============================================================
  // Wartungsrechner — Key 'vroooom_maint_state'
  // ============================================================

  /**
   * Liest den letzten Wartungsrechner-Zustand.
   * @returns {{bikeKey: string, year: number, km: number}|null} Zustand oder null, falls keiner vorhanden ist.
   */
  function getMaintenanceState() {
    return readJSON('vroooom_maint_state', null);
  }

  /**
   * Speichert den Wartungsrechner-Zustand (ueberschreibt vollstaendig).
   * @param {{bikeKey: string, year: number, km: number}} state - Zu speichernder Zustand.
   * @returns {void}
   */
  function setMaintenanceState(state) {
    writeJSON('vroooom_maint_state', state);
  }

  var api = {
    // Favoriten
    getFavorites: getFavorites,
    setFavorites: setFavorites,
    toggleFavorite: toggleFavorite,
    // Reviews
    getAllReviews: getAllReviews,
    getReviews: getReviews,
    addReview: addReview,
    // Warenkorb/Shop-Konfiguration
    getShopConfig: getShopConfig,
    setShopConfig: setShopConfig,
    getConfiguratorState: getConfiguratorState,
    setConfiguratorState: setConfiguratorState,
    // Idle-Save
    loadIdleState: loadIdleState,
    saveIdleState: saveIdleState,
    // Garage
    getRecentlyViewed: getRecentlyViewed,
    addRecentlyViewed: addRecentlyViewed,
    getDreamBike: getDreamBike,
    setDreamBike: setDreamBike,
    // Stats
    getStats: getStats,
    recordStat: recordStat,
    getVisitedPages: getVisitedPages,
    // Achievements
    getAchievements: getAchievements,
    unlockAchievement: unlockAchievement,
    // Race
    getRaceRecords: getRaceRecords,
    saveRaceRecord: saveRaceRecord,
    getRaceHighscore: getRaceHighscore,
    saveRaceHighscore: saveRaceHighscore,
    // Wartungsrechner
    getMaintenanceState: getMaintenanceState,
    setMaintenanceState: setMaintenanceState
  };

  if (typeof window !== 'undefined') {
    window.ApiClient = api;
  } else if (typeof globalThis !== 'undefined') {
    globalThis.ApiClient = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
