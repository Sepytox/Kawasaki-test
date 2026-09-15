#!/usr/bin/env node
/**
 * Headless Test — achievements.js (Gamification Achievement-Engine)
 *
 * Treibt jede einzelne Achievement-Bedingung über gezielt konstruierte
 * ctx-Zustände (locked → unlocked) und prüft zusätzlich Idempotenz/
 * Permanenz der Engine (evaluateAchievements/unlock) gegen eine
 * gemockte localStorage-Umgebung.
 *
 * Run: node tests/achievements-test.js
 * Exit 0 = alle Tests bestanden, Exit 1 = mindestens ein Fehler.
 */

'use strict';

/**
 * Minimale localStorage-Mock-Implementierung für Node.
 */
function makeMockLocalStorage() {
  var store = {};
  return {
    getItem: function (key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
    setItem: function (key, value) { store[key] = String(value); },
    removeItem: function (key) { delete store[key]; },
    clear: function () { store = {}; }
  };
}

global.localStorage = makeMockLocalStorage();

const Achievements = require('../achievements.js');

// ============================================================
// Test harness (Stil analog zu tests/stats-test.js)
// ============================================================
let passed = 0, failed = 0;

/**
 * Prüft eine Bedingung und protokolliert das Ergebnis.
 * @param {boolean} cond - Zu prüfende Bedingung.
 * @param {string} msg - Beschreibung des Testfalls.
 */
function assert(cond, msg) {
  if (cond) {
    console.log(`  ✅  ${msg}`);
    passed++;
  } else {
    console.log(`  ❌  FAIL: ${msg}`);
    failed++;
  }
}

/**
 * Gibt eine Abschnittsüberschrift in der Testausgabe aus.
 * @param {string} title - Titel des Abschnitts.
 */
function section(title) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('═'.repeat(60));
}

/**
 * Baut ein minimales, "leeres" ctx-Objekt mit allen erwarteten Feldern
 * auf 0/null, das per overrides gezielt für einen Testfall angepasst wird.
 * @param {Object} [overrides] - Zu überschreibende Felder.
 * @returns {Object} ctx für check()/evaluateAchievements().
 */
function emptyCtx(overrides) {
  var base = {
    raceFinishes: 0,
    raceBestT100: null,
    raceEndlessRuns: 0,
    raceBestEndlessTime: 0,
    quizCompletions: 0,
    quizBestMatchPct: 0,
    wheelSpins: 0,
    bikeViewCount: 0,
    maxSingleBikeViews: 0,
    shopConfigsSaved: 0,
    shopConfigPartsCount: 0,
    reviewsWritten: 0,
    favoritesCount: 0,
    visitedPageCount: 0,
    billsPaidOnTime: 0,
    billsPaidLastSecond: 0,
    insolvenciesSurvived: 0,
    piggybanksSmashed: 0,
    gearCompletedSets: 0,
    seasonsInsolvencyFree: 0
  };
  return Object.assign(base, overrides || {});
}

/**
 * Sucht ein Achievement-Objekt anhand seiner ID aus der ACHIEVEMENTS-Liste.
 * @param {string} id - Achievement-ID.
 * @returns {Object} Gefundenes Achievement.
 */
function findAch(id) {
  var found = Achievements.ACHIEVEMENTS.find(function (a) { return a.id === id; });
  if (!found) throw new Error('Unbekannte Achievement-ID im Test: ' + id);
  return found;
}

section('0 · ACHIEVEMENTS-Grundstruktur');
(function () {
  assert(Array.isArray(Achievements.ACHIEVEMENTS) && Achievements.ACHIEVEMENTS.length >= 6, `Mindestens 6 Achievements definiert (${Achievements.ACHIEVEMENTS.length})`);
  var ids = Achievements.ACHIEVEMENTS.map(function (a) { return a.id; });
  var uniqueIds = new Set(ids);
  assert(uniqueIds.size === ids.length, 'Alle Achievement-IDs sind eindeutig');
  Achievements.ACHIEVEMENTS.forEach(function (a) {
    assert(typeof a.titel === 'string' && a.titel.length > 0, `${a.id}: titel ist gesetzt`);
    assert(typeof a.beschreibung === 'string' && a.beschreibung.length > 0, `${a.id}: beschreibung ist gesetzt`);
    assert(typeof a.icon === 'string' && a.icon.length > 0, `${a.id}: icon ist gesetzt`);
    assert(typeof a.check === 'function', `${a.id}: check ist eine Funktion`);
  });

  var requiredTitles = [
    'Erstes Rennen gefahren',
    'Quiz mit voller Punktzahl',
    '5 Bikes favorisiert',
    'Erstes Review geschrieben',
    'Alle Mini-Apps besucht',
    'Endlos-Modus 60 Sekunden überlebt'
  ];
  var titles = Achievements.ACHIEVEMENTS.map(function (a) { return a.titel; });
  requiredTitles.forEach(function (t) {
    assert(titles.indexOf(t) !== -1, `Pflicht-Achievement vorhanden: "${t}"`);
  });
})();

section('1 · ERSTES_RENNEN — locked → unlocked');
(function () {
  var a = findAch('ERSTES_RENNEN');
  assert(a.check(emptyCtx({ raceFinishes: 0 })) === false, 'Kein Rennen beendet → locked');
  assert(a.check(emptyCtx({ raceFinishes: 1 })) === true, '1 Rennen beendet → unlocked');
})();

section('2 · QUIZ_VOLLE_PUNKTZAHL — nur bei genau 100% erreichbar');
(function () {
  var a = findAch('QUIZ_VOLLE_PUNKTZAHL');
  assert(a.check(emptyCtx({ quizBestMatchPct: 90 })) === false, '90% Match → locked');
  assert(a.check(emptyCtx({ quizBestMatchPct: 99 })) === false, '99% Match → locked');
  assert(a.check(emptyCtx({ quizBestMatchPct: 100 })) === true, '100% Match → unlocked (tatsächlich erreichbar: maxPossible=50 Punkte über 10 Fragen)');
})();

section('3 · FUENF_FAVORITEN — 5 gleichzeitige Favoriten');
(function () {
  var a = findAch('FUENF_FAVORITEN');
  assert(a.check(emptyCtx({ favoritesCount: 4 })) === false, '4 Favoriten → locked');
  assert(a.check(emptyCtx({ favoritesCount: 5 })) === true, '5 Favoriten → unlocked');
})();

section('4 · ERSTES_REVIEW');
(function () {
  var a = findAch('ERSTES_REVIEW');
  assert(a.check(emptyCtx({ reviewsWritten: 0 })) === false, 'Keine Reviews → locked');
  assert(a.check(emptyCtx({ reviewsWritten: 1 })) === true, '1 Review → unlocked');
})();

section('5 · ALLE_MINI_APPS — alle 6 Seiten besucht');
(function () {
  var a = findAch('ALLE_MINI_APPS');
  assert(a.check(emptyCtx({ visitedPageCount: 5 })) === false, '5 von 6 Seiten → locked');
  assert(a.check(emptyCtx({ visitedPageCount: 6 })) === true, '6 von 6 Seiten → unlocked');
})();

section('6 · ENDLOS_60S — Endlos-Modus mindestens 60s überlebt');
(function () {
  var a = findAch('ENDLOS_60S');
  assert(a.check(emptyCtx({ raceBestEndlessTime: 59.9 })) === false, '59.9s → locked');
  assert(a.check(emptyCtx({ raceBestEndlessTime: 60 })) === true, '60s → unlocked');
})();

section('7 · Extra-Achievements — je 1 Positiv-/Negativfall');
(function () {
  assert(findAch('ERSTE_LIEBE').check(emptyCtx({ favoritesCount: 0 })) === false, 'ERSTE_LIEBE: 0 Favoriten → locked');
  assert(findAch('ERSTE_LIEBE').check(emptyCtx({ favoritesCount: 1 })) === true, 'ERSTE_LIEBE: 1 Favorit → unlocked');

  assert(findAch('VIELSCHREIBER').check(emptyCtx({ reviewsWritten: 4 })) === false, 'VIELSCHREIBER: 4 Reviews → locked');
  assert(findAch('VIELSCHREIBER').check(emptyCtx({ reviewsWritten: 5 })) === true, 'VIELSCHREIBER: 5 Reviews → unlocked');

  assert(findAch('SCHAUFENSTERBUMMEL').check(emptyCtx({ bikeViewCount: 9 })) === false, 'SCHAUFENSTERBUMMEL: 9 Ansichten → locked');
  assert(findAch('SCHAUFENSTERBUMMEL').check(emptyCtx({ bikeViewCount: 10 })) === true, 'SCHAUFENSTERBUMMEL: 10 Ansichten → unlocked');

  assert(findAch('STAMMKUNDE').check(emptyCtx({ maxSingleBikeViews: 4 })) === false, 'STAMMKUNDE: 4× ein Bike → locked');
  assert(findAch('STAMMKUNDE').check(emptyCtx({ maxSingleBikeViews: 5 })) === true, 'STAMMKUNDE: 5× ein Bike → unlocked');

  assert(findAch('TRAUMBIKE_GEFUNDEN').check(emptyCtx({ quizCompletions: 0 })) === false, 'TRAUMBIKE_GEFUNDEN: 0 Abschlüsse → locked');
  assert(findAch('TRAUMBIKE_GEFUNDEN').check(emptyCtx({ quizCompletions: 1 })) === true, 'TRAUMBIKE_GEFUNDEN: 1 Abschluss → unlocked');

  assert(findAch('GLUECKSPILZ').check(emptyCtx({ wheelSpins: 0 })) === false, 'GLUECKSPILZ: 0 Spins → locked');
  assert(findAch('GLUECKSPILZ').check(emptyCtx({ wheelSpins: 1 })) === true, 'GLUECKSPILZ: 1 Spin → unlocked');

  assert(findAch('RAD_DES_SCHICKSALS').check(emptyCtx({ wheelSpins: 9 })) === false, 'RAD_DES_SCHICKSALS: 9 Spins → locked');
  assert(findAch('RAD_DES_SCHICKSALS').check(emptyCtx({ wheelSpins: 10 })) === true, 'RAD_DES_SCHICKSALS: 10 Spins → unlocked');

  assert(findAch('TUNING_PROFI').check(emptyCtx({ shopConfigsSaved: 0 })) === false, 'TUNING_PROFI: 0 Configs → locked');
  assert(findAch('TUNING_PROFI').check(emptyCtx({ shopConfigsSaved: 1 })) === true, 'TUNING_PROFI: 1 Config → unlocked');

  assert(findAch('VOLLAUSSTATTUNG').check(emptyCtx({ shopConfigPartsCount: 4 })) === false, 'VOLLAUSSTATTUNG: 4 Teile → locked');
  assert(findAch('VOLLAUSSTATTUNG').check(emptyCtx({ shopConfigPartsCount: 5 })) === true, 'VOLLAUSSTATTUNG: 5 Teile → unlocked');
})();

section('8 · Engine — unlock() ist idempotent');
(function () {
  global.localStorage.clear();
  assert(Achievements.isUnlocked('ERSTES_RENNEN') === false, 'Vor unlock(): noch nicht freigeschaltet');
  assert(Achievements.unlock('ERSTES_RENNEN') === true, 'Erster unlock()-Aufruf: liefert true (neu freigeschaltet)');
  assert(Achievements.isUnlocked('ERSTES_RENNEN') === true, 'Nach unlock(): freigeschaltet');
  assert(Achievements.unlock('ERSTES_RENNEN') === false, 'Zweiter unlock()-Aufruf: liefert false (bereits freigeschaltet, kein Fehler)');
  assert(Achievements.unlock('UNBEKANNTE_ID') === false, 'Unbekannte ID: unlock() liefert false statt zu werfen');
})();

section('9 · Engine — evaluateAchievements() schaltet nur neu erfüllte Achievements frei');
(function () {
  global.localStorage.clear();
  var ctx1 = emptyCtx({ raceFinishes: 1, favoritesCount: 1 });
  var newly1 = Achievements.evaluateAchievements(ctx1);
  var newly1Ids = newly1.map(function (a) { return a.id; });
  assert(newly1Ids.indexOf('ERSTES_RENNEN') !== -1, 'Erster Durchlauf schaltet ERSTES_RENNEN frei');
  assert(newly1Ids.indexOf('ERSTE_LIEBE') !== -1, 'Erster Durchlauf schaltet ERSTE_LIEBE frei');
  assert(newly1Ids.indexOf('FUENF_FAVORITEN') === -1, 'FUENF_FAVORITEN bleibt bei nur 1 Favorit locked');

  var newly2 = Achievements.evaluateAchievements(ctx1);
  assert(newly2.length === 0, 'Zweiter Durchlauf mit identischem ctx schaltet nichts erneut frei (idempotent)');

  var ctxRegress = emptyCtx({ raceFinishes: 0, favoritesCount: 0 });
  var newly3 = Achievements.evaluateAchievements(ctxRegress);
  assert(newly3.length === 0, 'Dritter Durchlauf mit "zurückgesetztem" ctx schaltet nichts frei');
  assert(Achievements.isUnlocked('ERSTES_RENNEN') === true, 'ERSTES_RENNEN bleibt permanent freigeschaltet, obwohl ctx wieder 0 Rennen zeigt');
  assert(Achievements.isUnlocked('ERSTE_LIEBE') === true, 'ERSTE_LIEBE bleibt permanent freigeschaltet, obwohl ctx wieder 0 Favoriten zeigt');
})();

section('10 · buildContext() liest bestehende Keys nur lesend (nie Mutation)');
(function () {
  global.localStorage.clear();
  global.localStorage.setItem('vroooom_favorites', JSON.stringify(['h2', 'z900', 'zx10r']));
  global.localStorage.setItem('vroooom_reviews', JSON.stringify({ h2: [{ rating: 5, text: 'top', date: '01.01.2026' }] }));
  var before = global.localStorage.getItem('vroooom_favorites');
  var ctx = Achievements.buildContext();
  assert(ctx.favoritesCount === 3, `buildContext() liest 3 Favoriten aus vroooom_favorites (${ctx.favoritesCount})`);
  assert(ctx.reviewsWritten === 1, `buildContext() liest 1 Review aus vroooom_reviews (${ctx.reviewsWritten})`);
  assert(global.localStorage.getItem('vroooom_favorites') === before, 'vroooom_favorites wurde durch buildContext() NICHT verändert');
})();

section('12 · RECHNUNG_PUENKTLICH (Idle Racer) — locked → unlocked');
(function () {
  var a = findAch('RECHNUNG_PUENKTLICH');
  assert(a.check(emptyCtx({ billsPaidOnTime: 0 })) === false, 'Keine pünktlich bezahlte Rechnung → locked');
  assert(a.check(emptyCtx({ billsPaidOnTime: 1 })) === true, '1 pünktlich bezahlte Rechnung → unlocked');
})();

section('13 · RECHNUNG_LETZTE_SEKUNDE (Idle Racer) — locked → unlocked');
(function () {
  var a = findAch('RECHNUNG_LETZTE_SEKUNDE');
  assert(a.check(emptyCtx({ billsPaidLastSecond: 0 })) === false, 'Keine Last-Second-Zahlung → locked');
  assert(a.check(emptyCtx({ billsPaidLastSecond: 1 })) === true, '1 Last-Second-Zahlung → unlocked');
})();

section('14 · ERSTE_INSOLVENZ_UEBERSTANDEN (Idle Racer) — locked → unlocked');
(function () {
  var a = findAch('ERSTE_INSOLVENZ_UEBERSTANDEN');
  assert(a.check(emptyCtx({ insolvenciesSurvived: 0 })) === false, 'Keine Insolvenz überstanden → locked');
  assert(a.check(emptyCtx({ insolvenciesSurvived: 1 })) === true, '1 Insolvenz überstanden → unlocked');
})();

section('15 · ZEHN_SPARSCHWEINE (Idle Racer) — locked → unlocked');
(function () {
  var a = findAch('ZEHN_SPARSCHWEINE');
  assert(a.check(emptyCtx({ piggybanksSmashed: 9 })) === false, '9 zerschlagene Sparschweine → locked');
  assert(a.check(emptyCtx({ piggybanksSmashed: 10 })) === true, '10 zerschlagene Sparschweine → unlocked');
})();

section('16 · KOMPLETTES_AUSRUESTUNGS_SET (Idle Racer) — locked → unlocked');
(function () {
  var a = findAch('KOMPLETTES_AUSRUESTUNGS_SET');
  assert(a.check(emptyCtx({ gearCompletedSets: 0 })) === false, 'Kein komplettes Set → locked');
  assert(a.check(emptyCtx({ gearCompletedSets: 1 })) === true, '1 komplettes Set → unlocked');
})();

section('17 · SAISON_OHNE_INSOLVENZ (Idle Racer) — locked → unlocked');
(function () {
  var a = findAch('SAISON_OHNE_INSOLVENZ');
  assert(a.check(emptyCtx({ seasonsInsolvencyFree: 0 })) === false, 'Noch keine insolvenzfreie Saison → locked');
  assert(a.check(emptyCtx({ seasonsInsolvencyFree: 1 })) === true, '1 insolvenzfreie Saison → unlocked');
})();

section('18 · Idle-Racer-Achievements — Engine: idempotent + permanent (evaluateAchievements())');
(function () {
  global.localStorage.clear();
  var idleIds = [
    'RECHNUNG_PUENKTLICH', 'RECHNUNG_LETZTE_SEKUNDE', 'ERSTE_INSOLVENZ_UEBERSTANDEN',
    'ZEHN_SPARSCHWEINE', 'KOMPLETTES_AUSRUESTUNGS_SET', 'SAISON_OHNE_INSOLVENZ'
  ];
  var ctxAllUnlocked = emptyCtx({
    billsPaidOnTime: 1, billsPaidLastSecond: 1, insolvenciesSurvived: 1,
    piggybanksSmashed: 10, gearCompletedSets: 1, seasonsInsolvencyFree: 1
  });

  var newly1 = Achievements.evaluateAchievements(ctxAllUnlocked);
  var newly1Ids = newly1.map(function (a) { return a.id; });
  idleIds.forEach(function (id) {
    assert(newly1Ids.indexOf(id) !== -1, `Erster Durchlauf schaltet ${id} frei`);
  });

  var newly2 = Achievements.evaluateAchievements(ctxAllUnlocked);
  assert(newly2.length === 0, 'Zweiter Durchlauf mit identischem ctx schaltet nichts erneut frei (idempotent)');

  var ctxRegress = emptyCtx(); // alle Idle-Felder wieder auf 0
  var newly3 = Achievements.evaluateAchievements(ctxRegress);
  assert(newly3.length === 0, 'Dritter Durchlauf mit auf 0 "zurückgesetztem" ctx schaltet nichts frei');
  idleIds.forEach(function (id) {
    assert(Achievements.isUnlocked(id) === true, `${id} bleibt permanent freigeschaltet, obwohl ctx wieder 0 zeigt`);
  });
})();

section('19 · getAllWithStatus() liefert erreicht/offen für die Garage-Übersicht');
(function () {
  global.localStorage.clear();
  Achievements.unlock('GLUECKSPILZ');
  var list = Achievements.getAllWithStatus();
  assert(list.length === Achievements.ACHIEVEMENTS.length, 'getAllWithStatus() liefert alle Achievements');
  var glp = list.find(function (a) { return a.id === 'GLUECKSPILZ'; });
  var rft = list.find(function (a) { return a.id === 'ERSTES_RENNEN'; });
  assert(glp.unlocked === true && typeof glp.unlockedAt === 'string', 'GLUECKSPILZ ist als freigeschaltet markiert (mit Zeitstempel)');
  assert(rft.unlocked === false && rft.unlockedAt === null, 'ERSTES_RENNEN ist als offen markiert');
})();

// ============================================================
// Results
// ============================================================
console.log('\n' + '═'.repeat(60));
console.log(`  RESULTS: ${passed}/${passed + failed} passed`);
console.log('═'.repeat(60) + '\n');

if (failed > 0) process.exit(1);
