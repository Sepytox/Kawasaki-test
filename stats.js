/**
 * stats.js — Geteiltes Statistik-Modul für die Gamification-Features.
 *
 * Liest/schreibt ausschließlich neue, mit "vroooom_stats_" geprefixte
 * localStorage-Keys (siehe GOLDEN_PRINCIPLES_KE.md Regel 7 — bestehende
 * Keys wie vroooom_favorites/vroooom_reviews werden hier NICHT verändert).
 * Bereitgestellt sowohl im Browser (window/globalThis) als auch in Node
 * (module.exports), analog zum Muster in bikes-data.js.
 *
 * Alle Funktionen sind defensiv: fehlendes/korruptes localStorage führt
 * NIE zu einem Fehler, sondern fällt auf sinnvolle Standardwerte zurück.
 */
'use strict';

/** Haupt-Statistik-Key (ein JSON-Objekt mit allen Zählern). */
var STATS_KEY = 'vroooom_stats_v1';
/** Key für die Menge der besuchten Seiten (wird separat von settings.js gepflegt). */
var VISITED_PAGES_KEY = 'vroooom_stats_visitedPages';

/**
 * Liefert die Standardwerte für das Statistik-Objekt.
 * @returns {Object} Frisches Statistik-Objekt mit allen Feldern auf 0/null.
 */
function getDefaultStats() {
  return {
    raceFinishes: 0,
    raceEndlessRuns: 0,
    raceBestEndlessTime: 0,
    raceBestT100: null,
    quizCompletions: 0,
    quizBestMatchPct: 0,
    wheelSpins: 0,
    wheelResultCounts: {},
    bikesViewed: {},
    bikeViewCount: 0,
    reviewsWritten: 0,
    favoritesMaxCount: 0,
    shopConfigsSaved: 0,
    lastUpdated: null
  };
}

/**
 * Liest ein JSON-Objekt sicher aus localStorage. Gibt bei fehlendem Key,
 * korruptem JSON oder fehlender localStorage-Umgebung den Fallback zurück.
 * @param {string} key - localStorage-Key.
 * @param {*} fallback - Rückgabewert bei Fehler/Fehlen.
 * @returns {*} Geparster Wert oder fallback.
 */
function safeReadJSON(key, fallback) {
  try {
    if (typeof localStorage === 'undefined' || localStorage === null) return fallback;
    var raw = localStorage.getItem(key);
    if (!raw) return fallback;
    var parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') return fallback;
    return parsed;
  } catch (e) {
    return fallback;
  }
}

/**
 * Schreibt einen Wert als JSON sicher in localStorage. Schlägt niemals
 * mit einer Exception nach außen durch (z. B. bei vollem Speicher).
 * @param {string} key - localStorage-Key.
 * @param {*} value - Zu speichernder Wert (wird JSON-serialisiert).
 * @returns {void}
 */
function safeWriteJSON(key, value) {
  try {
    if (typeof localStorage === 'undefined' || localStorage === null) return;
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    /* Speicher voll o. Ä. — bewusst ignoriert, darf App nie blockieren */
  }
}

/**
 * Liefert die api-client.js-Bridge, falls verfügbar (window.ApiClient im
 * Browser, sonst per require() im Node-Testkontext) — siehe api-client.js
 * für die Begründung dieser Bridge. Liefert null, falls beides fehlschlägt
 * (dann greift der rohe safeReadJSON/safeWriteJSON-Fallback).
 * @returns {Object|null} ApiClient-API oder null.
 */
function getApiClient() {
  if (typeof window !== 'undefined' && window.ApiClient) return window.ApiClient;
  if (typeof globalThis !== 'undefined' && globalThis.ApiClient) return globalThis.ApiClient;
  try {
    if (typeof require === 'function') return require('./api-client.js');
  } catch (e) { /* kein api-client.js verfügbar — Fallback greift */ }
  return null;
}

/**
 * Liest das aktuelle Statistik-Objekt aus localStorage, ergänzt um
 * fehlende Standardfelder (robust gegen ältere/teilweise Datensätze).
 * @returns {Object} Vollständiges Statistik-Objekt.
 */
function getStats() {
  var api = getApiClient();
  var stored = (api && typeof api.getStats === 'function') ? api.getStats() : safeReadJSON(STATS_KEY, {});
  var defaults = getDefaultStats();
  var merged = Object.assign({}, defaults, stored);
  merged.wheelResultCounts = Object.assign({}, defaults.wheelResultCounts, stored.wheelResultCounts || {});
  merged.bikesViewed = Object.assign({}, defaults.bikesViewed, stored.bikesViewed || {});
  return merged;
}

/**
 * Persistiert das übergebene Statistik-Objekt (setzt lastUpdated).
 * @param {Object} stats - Vollständiges Statistik-Objekt.
 * @returns {Object} Das gespeicherte Statistik-Objekt (mit aktualisiertem lastUpdated).
 */
function saveStats(stats) {
  stats.lastUpdated = new Date().toISOString();
  var api = getApiClient();
  if (api && typeof api.recordStat === 'function') api.recordStat(stats);
  else safeWriteJSON(STATS_KEY, stats);
  return stats;
}

/**
 * Erfasst ein beendetes Distanz-Rennen: erhöht raceFinishes und aktualisiert
 * die beste (kleinste) 0–100-km/h-Zeit, falls eine gültige Zeit übergeben wird.
 * @param {number|null|undefined} t100Seconds - Gemessene 0–100-km/h-Zeit in Sekunden.
 * @returns {Object} Aktualisiertes Statistik-Objekt.
 */
function recordRaceFinish(t100Seconds) {
  var stats = getStats();
  stats.raceFinishes += 1;
  if (typeof t100Seconds === 'number' && isFinite(t100Seconds) && t100Seconds > 0) {
    if (stats.raceBestT100 === null || t100Seconds < stats.raceBestT100) {
      stats.raceBestT100 = t100Seconds;
    }
  }
  return saveStats(stats);
}

/**
 * Erfasst einen beendeten Endlos-Modus-Lauf: erhöht raceEndlessRuns und
 * aktualisiert die beste (längste) Überlebenszeit.
 * @param {number|null|undefined} survivalSeconds - Überlebenszeit in Sekunden.
 * @returns {Object} Aktualisiertes Statistik-Objekt.
 */
function recordEndlessRun(survivalSeconds) {
  var stats = getStats();
  stats.raceEndlessRuns += 1;
  if (typeof survivalSeconds === 'number' && isFinite(survivalSeconds) && survivalSeconds > stats.raceBestEndlessTime) {
    stats.raceBestEndlessTime = survivalSeconds;
  }
  return saveStats(stats);
}

/**
 * Erfasst einen abgeschlossenen Quiz-Durchlauf: erhöht quizCompletions und
 * aktualisiert den besten erreichten Match-Prozentsatz.
 * @param {number|null|undefined} matchPct - Match-Prozentsatz der Top-Kategorie (0–100).
 * @returns {Object} Aktualisiertes Statistik-Objekt.
 */
function recordQuizCompletion(matchPct) {
  var stats = getStats();
  stats.quizCompletions += 1;
  if (typeof matchPct === 'number' && isFinite(matchPct) && matchPct > stats.quizBestMatchPct) {
    stats.quizBestMatchPct = matchPct;
  }
  return saveStats(stats);
}

/**
 * Erfasst einen Glücksrad-Spin: erhöht wheelSpins sowie den Zähler für
 * das konkret erlost Bike.
 * @param {string|null|undefined} bikeKey - Bike-ID des Spin-Ergebnisses.
 * @returns {Object} Aktualisiertes Statistik-Objekt.
 */
function recordWheelSpin(bikeKey) {
  var stats = getStats();
  stats.wheelSpins += 1;
  if (typeof bikeKey === 'string' && bikeKey) {
    stats.wheelResultCounts[bikeKey] = (stats.wheelResultCounts[bikeKey] || 0) + 1;
  }
  return saveStats(stats);
}

/**
 * Erfasst das Öffnen einer Bike-Detailansicht: erhöht sowohl den
 * Gesamtzähler als auch den Zähler für das konkrete Bike.
 * @param {string|null|undefined} bikeKey - Bike-ID der geöffneten Ansicht.
 * @returns {Object} Aktualisiertes Statistik-Objekt.
 */
function recordBikeView(bikeKey) {
  var stats = getStats();
  if (typeof bikeKey === 'string' && bikeKey) {
    stats.bikesViewed[bikeKey] = (stats.bikesViewed[bikeKey] || 0) + 1;
    stats.bikeViewCount += 1;
  }
  return saveStats(stats);
}

/**
 * Erfasst eine neu geschriebene Bewertung: erhöht reviewsWritten.
 * @returns {Object} Aktualisiertes Statistik-Objekt.
 */
function recordReview() {
  var stats = getStats();
  stats.reviewsWritten += 1;
  return saveStats(stats);
}

/**
 * Aktualisiert den monoton steigenden Höchststand der Favoriten-Anzahl.
 * Da vroooom_favorites schrumpfen kann, bleibt favoritesMaxCount als
 * separater Zähler erhalten (Achievements sollen permanent bleiben).
 * @param {number} currentCount - Aktuelle Anzahl an Favoriten.
 * @returns {Object} Aktualisiertes Statistik-Objekt.
 */
function recordFavoritesCount(currentCount) {
  var stats = getStats();
  if (typeof currentCount === 'number' && isFinite(currentCount) && currentCount > stats.favoritesMaxCount) {
    stats.favoritesMaxCount = currentCount;
  }
  return saveStats(stats);
}

/**
 * Erfasst eine gespeicherte Shop-Konfiguration: erhöht shopConfigsSaved.
 * @returns {Object} Aktualisiertes Statistik-Objekt.
 */
function recordShopConfigSaved() {
  var stats = getStats();
  stats.shopConfigsSaved += 1;
  return saveStats(stats);
}

/**
 * Ermittelt das meistgesehene Bike anhand von bikesViewed.
 * @returns {{bikeKey: string, count: number}|null} Meistgesehenes Bike oder null, wenn noch keins angesehen wurde.
 */
function getMostViewedBike() {
  var stats = getStats();
  var keys = Object.keys(stats.bikesViewed);
  if (keys.length === 0) return null;
  var best = keys[0];
  for (var i = 1; i < keys.length; i++) {
    if (stats.bikesViewed[keys[i]] > stats.bikesViewed[best]) best = keys[i];
  }
  return { bikeKey: best, count: stats.bikesViewed[best] };
}

/**
 * Liest die Menge der bereits besuchten Seiten (wird von settings.js
 * eigenständig geschrieben, siehe dortigen recordPageVisit-Block).
 * @returns {Object<string, string>} Map Seiten-Schlüssel → ISO-Zeitstempel.
 */
function getVisitedPages() {
  var api = getApiClient();
  if (api && typeof api.getVisitedPages === 'function') return api.getVisitedPages();
  return safeReadJSON(VISITED_PAGES_KEY, {});
}

/**
 * Liefert die Anzahl der bislang mindestens einmal besuchten Seiten.
 * @returns {number} Anzahl unterschiedlicher besuchter Seiten.
 */
function getVisitedPageCount() {
  return Object.keys(getVisitedPages()).length;
}

var VroooomStats = {
  STATS_KEY: STATS_KEY,
  VISITED_PAGES_KEY: VISITED_PAGES_KEY,
  getStats: getStats,
  getDefaultStats: getDefaultStats,
  recordRaceFinish: recordRaceFinish,
  recordEndlessRun: recordEndlessRun,
  recordQuizCompletion: recordQuizCompletion,
  recordWheelSpin: recordWheelSpin,
  recordBikeView: recordBikeView,
  recordReview: recordReview,
  recordFavoritesCount: recordFavoritesCount,
  recordShopConfigSaved: recordShopConfigSaved,
  getMostViewedBike: getMostViewedBike,
  getVisitedPages: getVisitedPages,
  getVisitedPageCount: getVisitedPageCount
};

if (typeof window !== 'undefined') {
  window.VroooomStats = VroooomStats;
} else if (typeof globalThis !== 'undefined') {
  globalThis.VroooomStats = VroooomStats;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VroooomStats;
}
