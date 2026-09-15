/**
 * achievements.js — Zentrale Achievement-Definitionen + Engine + Toast.
 *
 * Enthält die kanonische ACHIEVEMENTS-Liste (id, titel, beschreibung, icon,
 * reine check(ctx)-Bedingung), eine kleine Engine zum Auswerten/Freischalten
 * sowie eine dezente Toast-UI für neu freigeschaltete Achievements.
 *
 * Freischaltungen sind PERMANENT: sobald ein Achievement einmal freigeschaltet
 * wurde, bleibt es freigeschaltet, auch wenn der zugrunde liegende Zustand
 * (z. B. Anzahl Favoriten) später wieder sinkt. Persistiert unter dem
 * einzigen neuen Key "vroooom_achievements".
 *
 * Die Engine (evaluateAchievements) und alle check()-Prädikate sind bewusst
 * DOM-frei und in Node per require() nutzbar — nur showAchievementToast()
 * fasst das DOM an und ist per typeof-Guard abgesichert. Liest lediglich
 * aus vroooom_favorites/vroooom_reviews (nie schreibend!), sowie aus den
 * vroooom_stats_*-Keys von stats.js.
 *
 * Bereitgestellt sowohl im Browser (window/globalThis) als auch in Node
 * (module.exports), analog zum Muster in bikes-data.js/stats.js.
 */
'use strict';

/** localStorage-Key für die freigeschalteten Achievements. */
var ACHIEVEMENTS_KEY = 'vroooom_achievements';

/**
 * Kanonische Liste aller Achievements. Neue Achievements können hier
 * einfach ergänzt werden (id muss eindeutig + stabil bleiben, da sie als
 * Schlüssel in vroooom_achievements verwendet wird).
 *
 * ctx-Felder, die von check() gelesen werden (siehe buildContext()):
 *   raceFinishes, raceBestT100, raceEndlessRuns, raceBestEndlessTime,
 *   quizCompletions, quizBestMatchPct, wheelSpins, bikeViewCount,
 *   maxSingleBikeViews, reviewsWritten, favoritesCount, shopConfigsSaved,
 *   shopConfigPartsCount, visitedPageCount, billsPaidOnTime,
 *   billsPaidLastSecond, insolvenciesSurvived, piggybanksSmashed,
 *   gearCompletedSets, seasonsInsolvencyFree (die letzten 6 stammen aus dem
 *   Idle Racer/idle.js, siehe dessen checkIdleAchievements()-Overrides —
 *   buildContext() selbst bleibt bewusst idle-frei und liefert dafür nur
 *   0-Standardwerte).
 */
var ACHIEVEMENTS = [
  {
    id: 'ERSTES_RENNEN',
    titel: 'Erstes Rennen gefahren',
    beschreibung: 'Du hast dein erstes Distanz-Rennen im Racing Sim beendet.',
    icon: '🏁',
    check: function (ctx) { return ctx.raceFinishes >= 1; }
  },
  {
    id: 'QUIZ_VOLLE_PUNKTZAHL',
    titel: 'Quiz mit voller Punktzahl',
    beschreibung: 'Du hast im Kawasaki-Quiz eine 100%-Übereinstimmung erreicht.',
    icon: '🎯',
    check: function (ctx) { return ctx.quizBestMatchPct >= 100; }
  },
  {
    id: 'FUENF_FAVORITEN',
    titel: '5 Bikes favorisiert',
    beschreibung: 'Du hast 5 Motorräder gleichzeitig als Favorit markiert.',
    icon: '❤️',
    check: function (ctx) { return ctx.favoritesCount >= 5; }
  },
  {
    id: 'ERSTES_REVIEW',
    titel: 'Erstes Review geschrieben',
    beschreibung: 'Du hast deine erste Bewertung zu einem Motorrad verfasst.',
    icon: '📝',
    check: function (ctx) { return ctx.reviewsWritten >= 1; }
  },
  {
    id: 'ALLE_MINI_APPS',
    titel: 'Alle Mini-Apps besucht',
    beschreibung: 'Du warst auf allen 6 Seiten von Vrooooom — Übersicht, SoundCheck, Racing Sim, Aftermarket, Quiz und Wheel.',
    icon: '🗺️',
    check: function (ctx) { return ctx.visitedPageCount >= 6; }
  },
  {
    id: 'ENDLOS_60S',
    titel: 'Endlos-Modus 60 Sekunden überlebt',
    beschreibung: 'Du hast im Endlos-Modus mindestens 60 Sekunden durchgehalten.',
    icon: '⏱️',
    check: function (ctx) { return ctx.raceBestEndlessTime >= 60; }
  },
  {
    id: 'ERSTE_LIEBE',
    titel: 'Erste Liebe',
    beschreibung: 'Du hast dein erstes Lieblingsmotorrad markiert.',
    icon: '💛',
    check: function (ctx) { return ctx.favoritesCount >= 1; }
  },
  {
    id: 'VIELSCHREIBER',
    titel: 'Vielschreiber',
    beschreibung: 'Du hast 5 Bewertungen geschrieben.',
    icon: '✍️',
    check: function (ctx) { return ctx.reviewsWritten >= 5; }
  },
  {
    id: 'SCHAUFENSTERBUMMEL',
    titel: 'Schaufensterbummel',
    beschreibung: 'Du hast dir insgesamt 10 Motorrad-Detailansichten angesehen.',
    icon: '🔍',
    check: function (ctx) { return ctx.bikeViewCount >= 10; }
  },
  {
    id: 'STAMMKUNDE',
    titel: 'Stammkunde',
    beschreibung: 'Du hast dir dasselbe Motorrad 5-mal im Detail angesehen.',
    icon: '🤝',
    check: function (ctx) { return ctx.maxSingleBikeViews >= 5; }
  },
  {
    id: 'TRAUMBIKE_GEFUNDEN',
    titel: 'Traumbike gefunden',
    beschreibung: 'Du hast das Kawasaki-Quiz einmal abgeschlossen.',
    icon: '🧭',
    check: function (ctx) { return ctx.quizCompletions >= 1; }
  },
  {
    id: 'GLUECKSPILZ',
    titel: 'Glückspilz',
    beschreibung: 'Du hast das Glücksrad zum ersten Mal gedreht.',
    icon: '🍀',
    check: function (ctx) { return ctx.wheelSpins >= 1; }
  },
  {
    id: 'RAD_DES_SCHICKSALS',
    titel: 'Rad des Schicksals',
    beschreibung: 'Du hast das Glücksrad 10-mal gedreht.',
    icon: '🎡',
    check: function (ctx) { return ctx.wheelSpins >= 10; }
  },
  {
    id: 'TUNING_PROFI',
    titel: 'Tuning-Profi',
    beschreibung: 'Du hast deine erste Aftermarket-Konfiguration gespeichert.',
    icon: '🔧',
    check: function (ctx) { return ctx.shopConfigsSaved >= 1; }
  },
  {
    id: 'VOLLAUSSTATTUNG',
    titel: 'Vollausstattung',
    beschreibung: 'Du hast eine Konfiguration mit mindestens 5 Tuning-Teilen gespeichert.',
    icon: '🏆',
    check: function (ctx) { return ctx.shopConfigPartsCount >= 5; }
  },
  {
    id: 'RECHNUNG_PUENKTLICH',
    titel: 'Erste Rechnung pünktlich bezahlt',
    beschreibung: 'Du hast im Idle Racer deine erste Werkstattrechnung fristgerecht bezahlt.',
    icon: '🧾',
    check: function (ctx) { return ctx.billsPaidOnTime >= 1; }
  },
  {
    id: 'RECHNUNG_LETZTE_SEKUNDE',
    titel: 'Rechnung in letzter Sekunde bezahlt',
    beschreibung: 'Du hast im Idle Racer eine Werkstattrechnung erst in den letzten Sekunden vor Ablauf bezahlt.',
    icon: '⏳',
    check: function (ctx) { return ctx.billsPaidLastSecond >= 1; }
  },
  {
    id: 'ERSTE_INSOLVENZ_UEBERSTANDEN',
    titel: 'Erste Insolvenz überstanden',
    beschreibung: 'Du hast im Idle Racer deine erste Insolvenz überstanden — ein frischer Neustart der Saison.',
    icon: '🔁',
    check: function (ctx) { return ctx.insolvenciesSurvived >= 1; }
  },
  {
    id: 'ZEHN_SPARSCHWEINE',
    titel: '10 Sparschweine zerschlagen',
    beschreibung: 'Du hast im Idle Racer 10 Sparschweine zerschlagen.',
    icon: '🐷',
    check: function (ctx) { return ctx.piggybanksSmashed >= 10; }
  },
  {
    id: 'KOMPLETTES_AUSRUESTUNGS_SET',
    titel: 'Komplettes Ausrüstungs-Set',
    beschreibung: 'Du hast im Idle Racer ein komplettes Ausrüstungs-Set gesammelt.',
    icon: '🎽',
    check: function (ctx) { return ctx.gearCompletedSets >= 1; }
  },
  {
    id: 'SAISON_OHNE_INSOLVENZ',
    titel: 'Ganze Saison ohne Insolvenz',
    beschreibung: 'Du hast im Idle Racer eine ganze Saison freiwillig abgeschlossen, ohne zwischenzeitlich insolvent zu gehen.',
    icon: '🏅',
    check: function (ctx) { return ctx.seasonsInsolvencyFree >= 1; }
  }
];

/**
 * Liest ein JSON-Objekt sicher aus localStorage.
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
 * Schreibt einen Wert als JSON sicher in localStorage.
 * @param {string} key - localStorage-Key.
 * @param {*} value - Zu speichernder Wert.
 * @returns {void}
 */
function safeWriteJSON(key, value) {
  try {
    if (typeof localStorage === 'undefined' || localStorage === null) return;
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    /* bewusst ignoriert — darf App nie blockieren */
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
    if (typeof require === 'function') return require('./js/api-client.js');
  } catch (e) { /* kein api-client.js verfügbar — Fallback greift */ }
  return null;
}

/**
 * Liest die aktuelle Menge freigeschalteter Achievements.
 * @returns {Object<string, {at: string}>} Map Achievement-ID → Freischalt-Info.
 */
function getUnlocked() {
  var api = getApiClient();
  if (api && typeof api.getAchievements === 'function') return api.getAchievements();
  return safeReadJSON(ACHIEVEMENTS_KEY, {});
}

/**
 * Prüft, ob ein Achievement bereits freigeschaltet ist.
 * @param {string} id - Achievement-ID.
 * @returns {boolean} true, wenn bereits freigeschaltet.
 */
function isUnlocked(id) {
  var unlocked = getUnlocked();
  return Object.prototype.hasOwnProperty.call(unlocked, id);
}

/**
 * Schaltet ein Achievement idempotent frei (schreibt nur, wenn noch nicht
 * freigeschaltet). Freischaltungen sind permanent.
 * @param {string} id - Achievement-ID (muss in ACHIEVEMENTS existieren).
 * @returns {boolean} true, wenn dieser Aufruf das Achievement NEU freigeschaltet hat.
 */
function unlock(id) {
  var exists = ACHIEVEMENTS.some(function (a) { return a.id === id; });
  if (!exists) return false;
  var api = getApiClient();
  if (api && typeof api.unlockAchievement === 'function') return api.unlockAchievement(id);
  var unlocked = getUnlocked();
  if (Object.prototype.hasOwnProperty.call(unlocked, id)) return false;
  unlocked[id] = { at: new Date().toISOString() };
  safeWriteJSON(ACHIEVEMENTS_KEY, unlocked);
  return true;
}

/**
 * Liefert alle Achievements zusammen mit ihrem Freischalt-Status, für die
 * Übersichtsdarstellung in der Garage (erreicht/offen).
 * @returns {Array<Object>} ACHIEVEMENTS, jeweils ergänzt um { unlocked, unlockedAt }.
 */
function getAllWithStatus() {
  var unlocked = getUnlocked();
  return ACHIEVEMENTS.map(function (a) {
    var info = unlocked[a.id];
    return Object.assign({}, a, {
      unlocked: !!info,
      unlockedAt: info ? info.at : null
    });
  });
}

/**
 * Ermittelt die höchste Einzel-Ansichtszahl eines Bikes aus bikesViewed.
 * @param {Object<string, number>} bikesViewed - Map Bike-ID → Ansichtszahl.
 * @returns {number} Höchste Ansichtszahl eines einzelnen Bikes (0, falls leer).
 */
function maxOf(bikesViewed) {
  var max = 0;
  if (!bikesViewed) return max;
  Object.keys(bikesViewed).forEach(function (k) {
    if (bikesViewed[k] > max) max = bikesViewed[k];
  });
  return max;
}

/**
 * Baut den Auswertungs-Kontext (ctx) für evaluateAchievements() aus dem
 * aktuellen, live gelesenen Zustand: stats.js-Statistiken sowie den
 * bestehenden Keys vroooom_favorites/vroooom_reviews (NUR lesend, wird
 * nie verändert). Zusätzliche, aufrufspezifische Felder (z. B. die
 * Teile-Anzahl einer gerade gespeicherten Shop-Konfiguration) können per
 * overrides ergänzt werden.
 * @param {Object} [overrides] - Zusätzliche/überschreibende ctx-Felder.
 * @returns {Object} Vollständiger ctx für evaluateAchievements()/check().
 */
function buildContext(overrides) {
  var stats = {};
  if (typeof window !== 'undefined' && window.VroooomStats && typeof window.VroooomStats.getStats === 'function') {
    stats = window.VroooomStats.getStats();
  } else if (typeof globalThis !== 'undefined' && globalThis.VroooomStats && typeof globalThis.VroooomStats.getStats === 'function') {
    stats = globalThis.VroooomStats.getStats();
  }
  var visitedPageCount = 0;
  if (typeof window !== 'undefined' && window.VroooomStats && typeof window.VroooomStats.getVisitedPageCount === 'function') {
    visitedPageCount = window.VroooomStats.getVisitedPageCount();
  } else if (typeof globalThis !== 'undefined' && globalThis.VroooomStats && typeof globalThis.VroooomStats.getVisitedPageCount === 'function') {
    visitedPageCount = globalThis.VroooomStats.getVisitedPageCount();
  }

  var api = getApiClient();

  var favorites = [];
  try {
    favorites = (api && typeof api.getFavorites === 'function')
      ? api.getFavorites()
      : ((typeof localStorage !== 'undefined' && localStorage) ? JSON.parse(localStorage.getItem('vroooom_favorites') || '[]') : []);
    if (!Array.isArray(favorites)) favorites = [];
  } catch (e) { favorites = []; }

  var reviews = {};
  try {
    reviews = (api && typeof api.getAllReviews === 'function')
      ? api.getAllReviews()
      : ((typeof localStorage !== 'undefined' && localStorage) ? JSON.parse(localStorage.getItem('vroooom_reviews') || '{}') : {});
    if (!reviews || typeof reviews !== 'object') reviews = {};
  } catch (e) { reviews = {}; }
  var reviewsWritten = 0;
  Object.keys(reviews).forEach(function (k) {
    if (Array.isArray(reviews[k])) reviewsWritten += reviews[k].length;
  });

  var ctx = {
    raceFinishes: stats.raceFinishes || 0,
    raceBestT100: (typeof stats.raceBestT100 === 'number') ? stats.raceBestT100 : null,
    raceEndlessRuns: stats.raceEndlessRuns || 0,
    raceBestEndlessTime: stats.raceBestEndlessTime || 0,
    quizCompletions: stats.quizCompletions || 0,
    quizBestMatchPct: stats.quizBestMatchPct || 0,
    wheelSpins: stats.wheelSpins || 0,
    bikeViewCount: stats.bikeViewCount || 0,
    maxSingleBikeViews: maxOf(stats.bikesViewed),
    shopConfigsSaved: stats.shopConfigsSaved || 0,
    shopConfigPartsCount: 0,
    reviewsWritten: reviewsWritten,
    favoritesCount: favorites.length,
    visitedPageCount: visitedPageCount,
    // Idle-Racer-Felder (siehe Docblock oben): buildContext() selbst liest
    // dafür NICHTS Idle-Spezifisches — Standardwert 0, vom Aufrufer
    // (idle.js checkIdleAchievements()) per overrides überschrieben.
    billsPaidOnTime: 0,
    billsPaidLastSecond: 0,
    insolvenciesSurvived: 0,
    piggybanksSmashed: 0,
    gearCompletedSets: 0,
    seasonsInsolvencyFree: 0
  };
  return Object.assign(ctx, overrides || {});
}

/**
 * Wertet ALLE Achievements gegen den übergebenen Kontext aus und schaltet
 * neu erfüllte, bisher nicht freigeschaltete Achievements frei. Rein
 * DOM-frei — löst KEIN Toast aus (siehe checkNow() für die UI-Variante).
 * Idempotent: mehrfaches Aufrufen mit demselben/ähnlichem ctx schaltet
 * bereits freigeschaltete Achievements nicht erneut frei.
 * @param {Object} ctx - Auswertungs-Kontext (siehe buildContext()).
 * @returns {Array<Object>} Liste der in diesem Aufruf neu freigeschalteten Achievements.
 */
function evaluateAchievements(ctx) {
  var newlyUnlocked = [];
  ACHIEVEMENTS.forEach(function (a) {
    if (isUnlocked(a.id)) return;
    var conditionMet = false;
    try { conditionMet = !!a.check(ctx); } catch (e) { conditionMet = false; }
    if (conditionMet && unlock(a.id)) {
      newlyUnlocked.push(a);
    }
  });
  return newlyUnlocked;
}

/**
 * Prüft, ob prefers-reduced-motion aktiv ist (Systemeinstellung).
 * @returns {boolean} true, wenn reduzierte Bewegung bevorzugt wird.
 */
function prefersReducedMotion() {
  return !!(typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

/**
 * Stellt sicher, dass die (einmaligen) Toast-Styles im Dokument vorhanden
 * sind. Nutzt bestehende Design-Tokens (--card-bg, --border, --accent,
 * --text etc. aus design.css), damit der Toast automatisch zu Dark-/
 * Light-Mode passt, ohne eigene Farblogik.
 *
 * Position bewusst OBEN rechts (statt unten rechts): mehrere Seiten
 * (u. a. idle.html mit .idle-toast-container UND global settings.js mit
 * .settings-trigger) belegen bereits unten rechts eigene fixierte
 * UI-Elemente. Da achievements.js absichtlich seitenagnostisch bleibt
 * (keine Kenntnis von idle-spezifischem Markup), ist eine grundsätzlich
 * andere Ecke die robustere, generische Lösung gegenüber einer
 * seitenspezifischen Verschiebung.
 * @returns {void}
 */
function ensureToastStyles() {
  if (document.getElementById('vroooom-achievement-toast-style')) return;
  var style = document.createElement('style');
  style.id = 'vroooom-achievement-toast-style';
  style.textContent =
    '.vroooom-ach-toast{position:fixed;right:18px;top:18px;z-index:9999;' +
    'display:flex;align-items:center;gap:12px;max-width:320px;padding:12px 16px;' +
    'background:var(--card-bg,#111);border:1px solid var(--border,#333);' +
    'border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,0.35);' +
    'color:var(--text,#eee);font-family:inherit;' +
    'opacity:0;transform:translateY(-12px);' +
    'transition:opacity .35s ease,transform .35s ease;}' +
    '.vroooom-ach-toast.vroooom-ach-toast-visible{opacity:1;transform:translateY(0);}' +
    '.vroooom-ach-toast-icon{font-size:1.6em;line-height:1;flex-shrink:0;}' +
    '.vroooom-ach-toast-body{min-width:0;}' +
    '.vroooom-ach-toast-eyebrow{font-size:0.72em;text-transform:uppercase;letter-spacing:.04em;' +
    'opacity:.7;margin:0 0 2px;}' +
    '.vroooom-ach-toast-title{font-size:0.92em;font-weight:700;margin:0;}' +
    '@media (prefers-reduced-motion: reduce){.vroooom-ach-toast{transition:none;}}';
  document.head.appendChild(style);
}

/**
 * Zeigt einen dezenten, deutschsprachigen Toast für ein neu
 * freigeschaltetes Achievement an. Dark-Mode-tauglich (nutzt CSS-Variablen),
 * respektiert prefers-reduced-motion (kein Slide/Fade, sofort sichtbar) und
 * blendet sich nach einigen Sekunden selbst wieder aus. DOM-Zugriff ist
 * per typeof-Guard abgesichert und darf nie fehlschlagen/werfen.
 * @param {Object} ach - Achievement-Objekt aus ACHIEVEMENTS (mit titel/icon).
 * @returns {void}
 */
function showAchievementToast(ach) {
  try {
    if (typeof document === 'undefined' || !document.body || !ach) return;
    ensureToastStyles();
    var reduceMotion = prefersReducedMotion();
    var toast = document.createElement('div');
    toast.className = 'vroooom-ach-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.innerHTML =
      '<span class="vroooom-ach-toast-icon" aria-hidden="true">' + ach.icon + '</span>' +
      '<span class="vroooom-ach-toast-body">' +
      '<p class="vroooom-ach-toast-eyebrow">🏅 Achievement freigeschaltet</p>' +
      '<p class="vroooom-ach-toast-title">' + ach.titel + '</p>' +
      '</span>';
    document.body.appendChild(toast);

    if (reduceMotion) {
      toast.classList.add('vroooom-ach-toast-visible');
    } else {
      requestAnimationFrame(function () { toast.classList.add('vroooom-ach-toast-visible'); });
    }

    setTimeout(function () {
      toast.classList.remove('vroooom-ach-toast-visible');
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, reduceMotion ? 0 : 400);
    }, 4200);
  } catch (e) {
    /* Toast-Anzeige darf nie eine Seite blockieren */
  }
}

/**
 * Komfort-Funktion für Hook-Aufrufe: baut den Kontext aus dem aktuellen
 * Zustand (+ optionale overrides), wertet alle Achievements aus und zeigt
 * für jedes neu freigeschaltete Achievement (falls DOM verfügbar) einen
 * Toast an.
 * @param {Object} [overrides] - Zusätzliche/überschreibende ctx-Felder für buildContext().
 * @returns {Array<Object>} Liste der neu freigeschalteten Achievements.
 */
function checkNow(overrides) {
  var ctx = buildContext(overrides);
  var newlyUnlocked = evaluateAchievements(ctx);
  if (typeof document !== 'undefined') {
    newlyUnlocked.forEach(function (a) { showAchievementToast(a); });
  }
  return newlyUnlocked;
}

/**
 * Wird von settings.js auf jeder Seite (inkl. soundcheck.html, dort per
 * typeof-Guard übersprungen) nach dem Vermerken eines Seitenbesuchs
 * aufgerufen, um "Alle Mini-Apps besucht" zeitnah nachzuprüfen.
 * @returns {Array<Object>} Liste der neu freigeschalteten Achievements.
 */
function checkAllAppsVisited() {
  return checkNow();
}

var VroooomAchievements = {
  ACHIEVEMENTS_KEY: ACHIEVEMENTS_KEY,
  ACHIEVEMENTS: ACHIEVEMENTS,
  isUnlocked: isUnlocked,
  getUnlocked: getUnlocked,
  unlock: unlock,
  getAllWithStatus: getAllWithStatus,
  buildContext: buildContext,
  evaluateAchievements: evaluateAchievements,
  checkNow: checkNow,
  checkAllAppsVisited: checkAllAppsVisited,
  showAchievementToast: showAchievementToast
};

if (typeof window !== 'undefined') {
  window.VroooomAchievements = VroooomAchievements;
} else if (typeof globalThis !== 'undefined') {
  globalThis.VroooomAchievements = VroooomAchievements;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VroooomAchievements;
}
