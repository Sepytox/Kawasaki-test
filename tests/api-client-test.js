#!/usr/bin/env node
/**
 * Headless Test — api-client.js (Zugriffs-Bridge fuer localStorage-Zustand)
 *
 * Prueft fuer jede Domaene (Favoriten, Reviews, Shop-Konfiguration,
 * Konfigurator-Zustand, Idle-Save, Garage, Stats, Achievements, Race,
 * Wartungsrechner): Round-Trip (schreiben → lesen liefert denselben Wert),
 * leere/fehlende Standardwerte (kein Crash bei leerem Mock-Storage) sowie
 * dass die exakt erwarteten, UNVERAENDERTEN localStorage-Keys verwendet
 * werden (GOLDEN_PRINCIPLES_KE.md Regel 7).
 *
 * Run: node tests/api-client-test.js
 * Exit 0 = alle Tests bestanden, Exit 1 = mindestens ein Fehler.
 */

'use strict';

/**
 * Minimale localStorage-Mock-Implementierung fuer Node (kein DOM/jsdom
 * noetig), analog zum Mock-Stil in tests/stats-test.js/tests/garage-test.js.
 */
function makeMockLocalStorage() {
  var store = {};
  return {
    getItem: function (key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
    setItem: function (key, value) { store[key] = String(value); },
    removeItem: function (key) { delete store[key]; },
    clear: function () { store = {}; },
    _dump: function () { return store; }
  };
}

global.localStorage = makeMockLocalStorage();

// api-client.js liest/schreibt `localStorage` als globale Variable (wie im
// Browser) — daher erst NACH dem Setzen von global.localStorage laden.
const ApiClient = require('../api-client.js');

// ============================================================
// Test harness (Stil analog zu tests/stats-test.js)
// ============================================================
let passed = 0, failed = 0;

function assert(cond, msg) {
  if (cond) {
    console.log(`  ✅  ${msg}`);
    passed++;
  } else {
    console.log(`  ❌  FAIL: ${msg}`);
    failed++;
  }
}

function section(title) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('═'.repeat(60));
}

function resetStorage() { global.localStorage.clear(); }

section('0 · Modul-Grundgeruest');
(function () {
  assert(typeof ApiClient === 'object' && ApiClient !== null, 'ApiClient ist requirebar und ein Objekt');
  [
    'getFavorites', 'setFavorites', 'toggleFavorite',
    'getAllReviews', 'getReviews', 'addReview',
    'getShopConfig', 'setShopConfig', 'getConfiguratorState', 'setConfiguratorState',
    'loadIdleState', 'saveIdleState',
    'getRecentlyViewed', 'addRecentlyViewed', 'getDreamBike', 'setDreamBike',
    'getStats', 'recordStat', 'getVisitedPages',
    'getAchievements', 'unlockAchievement',
    'getRaceRecords', 'saveRaceRecord', 'getRaceHighscore', 'saveRaceHighscore',
    'getMaintenanceState', 'setMaintenanceState'
  ].forEach(function (fn) {
    assert(typeof ApiClient[fn] === 'function', `ApiClient.${fn} ist eine Funktion`);
  });
})();

section('1 · Favoriten (vroooom_favorites)');
(function () {
  resetStorage();
  assert(Array.isArray(ApiClient.getFavorites()) && ApiClient.getFavorites().length === 0, 'getFavorites() liefert leeres Array ohne gespeicherte Daten');
  ApiClient.setFavorites(['z900', 'h2']);
  assert(JSON.stringify(ApiClient.getFavorites()) === JSON.stringify(['z900', 'h2']), 'setFavorites() → getFavorites() Round-Trip');
  assert(global.localStorage.getItem('vroooom_favorites') === JSON.stringify(['z900', 'h2']), 'Schreibt exakt auf den Key "vroooom_favorites"');

  var afterToggleAdd = ApiClient.toggleFavorite('versys650');
  assert(afterToggleAdd.indexOf('versys650') !== -1, 'toggleFavorite() fuegt ein neues Bike hinzu');
  var afterToggleRemove = ApiClient.toggleFavorite('z900');
  assert(afterToggleRemove.indexOf('z900') === -1, 'toggleFavorite() entfernt ein bereits vorhandenes Bike');
})();

section('2 · Reviews (vroooom_reviews)');
(function () {
  resetStorage();
  assert(JSON.stringify(ApiClient.getAllReviews()) === '{}', 'getAllReviews() liefert leeres Objekt ohne gespeicherte Daten');
  assert(Array.isArray(ApiClient.getReviews('z900')) && ApiClient.getReviews('z900').length === 0, 'getReviews() fuer unbekanntes Bike liefert leeres Array');

  var entry = ApiClient.addReview('z900', 5, 'Klasse Bike!');
  assert(entry.rating === 5 && entry.text === 'Klasse Bike!', 'addReview() liefert die neu angelegte Review zurueck');
  assert(typeof entry.date === 'string' && entry.date.length > 0, 'addReview() setzt ein Datum (de-DE-Format)');
  var reviews = ApiClient.getReviews('z900');
  assert(reviews.length === 1 && reviews[0].rating === 5, 'getReviews() liest die soeben gespeicherte Review');
  assert(global.localStorage.getItem('vroooom_reviews') !== null, 'Schreibt exakt auf den Key "vroooom_reviews"');

  ApiClient.addReview('z900', 3, 'Ok.');
  assert(ApiClient.getReviews('z900').length === 2, 'Zweite Review wird angehaengt, nicht ueberschrieben');
  assert(ApiClient.getReviews('h2').length === 0, 'Andere Bike-ID bleibt unberuehrt');
})();

section('3 · Shop-Konfiguration (kawasaki_shop_config, vroooom_config_state)');
(function () {
  resetStorage();
  assert(ApiClient.getShopConfig() === null, 'getShopConfig() liefert null ohne gespeicherte Daten');
  var config = { bike: 'zx10r', parts: ['ecu-remap'], savedAt: '2026-09-15T00:00:00.000Z', summary: { parts: 1, totalPS: 15, totalCost: 300 } };
  ApiClient.setShopConfig(config);
  assert(JSON.stringify(ApiClient.getShopConfig()) === JSON.stringify(config), 'setShopConfig() → getShopConfig() Round-Trip');
  assert(global.localStorage.getItem('kawasaki_shop_config') !== null, 'Schreibt exakt auf den Key "kawasaki_shop_config"');

  assert(ApiClient.getConfiguratorState() === null, 'getConfiguratorState() liefert null ohne gespeicherte Daten');
  var mcState = { bike: 'zx10r', color: 'Metallic Blue', addons: ['abs'], total: 12200 };
  ApiClient.setConfiguratorState(mcState);
  assert(JSON.stringify(ApiClient.getConfiguratorState()) === JSON.stringify(mcState), 'setConfiguratorState() → getConfiguratorState() Round-Trip');
  assert(global.localStorage.getItem('vroooom_config_state') !== null, 'Schreibt exakt auf den Key "vroooom_config_state"');
})();

section('4 · Idle-Save (vroooom_idle_state) — Fallback ohne IdleCore');
(function () {
  resetStorage();
  assert(ApiClient.loadIdleState() === null, 'loadIdleState() liefert null ohne gespeicherte Daten (kein IdleCore geladen)');
  var idleState = { version: 2, money: 1000, ownedBikeIds: ['h2'], currentBikeId: 'h2' };
  ApiClient.saveIdleState(idleState);
  assert(JSON.stringify(ApiClient.loadIdleState()) === JSON.stringify(idleState), 'saveIdleState() → loadIdleState() Round-Trip (roher JSON-Fallback)');
  assert(global.localStorage.getItem('vroooom_idle_state') !== null, 'Schreibt exakt auf den Key "vroooom_idle_state"');
})();

section('5 · Idle-Save — delegiert an IdleCore, falls vorhanden');
(function () {
  resetStorage();
  var loadCalls = 0, saveCalls = 0, savedArg = null;
  global.window = global.window || {};
  global.window.IdleCore = {
    loadState: function () { loadCalls++; return { fromIdleCore: true }; },
    saveState: function (s) { saveCalls++; savedArg = s; }
  };
  assert(JSON.stringify(ApiClient.loadIdleState()) === JSON.stringify({ fromIdleCore: true }), 'loadIdleState() delegiert an window.IdleCore.loadState()');
  assert(loadCalls === 1, 'IdleCore.loadState() wurde genau einmal aufgerufen');
  ApiClient.saveIdleState({ money: 42 });
  assert(saveCalls === 1 && savedArg.money === 42, 'saveIdleState() delegiert an window.IdleCore.saveState()');
  delete global.window.IdleCore;
})();

section('6 · Garage (vroooom_garage_recentlyViewed, vroooom_garage_dreamBike)');
(function () {
  resetStorage();
  assert(Array.isArray(ApiClient.getRecentlyViewed()) && ApiClient.getRecentlyViewed().length === 0, 'getRecentlyViewed() liefert leeres Array ohne gespeicherte Daten');

  var list = ApiClient.addRecentlyViewed('z900');
  assert(list.length === 1 && list[0].bikeKey === 'z900', 'addRecentlyViewed() fuegt einen Eintrag hinzu (neuester zuerst)');
  assert(typeof list[0].viewedAt === 'string', 'Eintrag hat einen ISO-Zeitstempel');
  ApiClient.addRecentlyViewed('h2');
  var list2 = ApiClient.addRecentlyViewed('z900');
  assert(list2.length === 2 && list2[0].bikeKey === 'z900', 'Erneutes Ansehen deduplizierst (kein Doppel-Eintrag), verschiebt an Position 0');

  for (var i = 0; i < 10; i++) ApiClient.addRecentlyViewed('bike' + i);
  assert(ApiClient.getRecentlyViewed().length === 8, 'Liste wird auf maximal 8 Eintraege gekappt (Standard MAX_RECENTLY_VIEWED)');
  assert(global.localStorage.getItem('vroooom_garage_recentlyViewed') !== null, 'Schreibt exakt auf den Key "vroooom_garage_recentlyViewed"');

  assert(ApiClient.getDreamBike() === null, 'getDreamBike() liefert null ohne gespeicherte Daten');
  assert(ApiClient.setDreamBike('h2') === 'h2', 'setDreamBike() liefert den normalisierten Wert zurueck');
  assert(ApiClient.getDreamBike() === 'h2', 'getDreamBike() liest den soeben gespeicherten Wert');
  assert(ApiClient.setDreamBike('') === null, 'setDreamBike() mit leerem String normalisiert auf null (Loeschen)');
  assert(ApiClient.getDreamBike() === null, 'getDreamBike() liest den geloeschten Zustand korrekt als null');
  assert(global.localStorage.getItem('vroooom_garage_dreamBike') !== null, 'Schreibt exakt auf den Key "vroooom_garage_dreamBike"');
})();

section('7 · Stats (vroooom_stats_v1, vroooom_stats_visitedPages)');
(function () {
  resetStorage();
  assert(JSON.stringify(ApiClient.getStats()) === '{}', 'getStats() liefert leeres Objekt ohne gespeicherte Daten');
  var stats = { raceFinishes: 3, bikeViewCount: 5 };
  ApiClient.recordStat(stats);
  assert(JSON.stringify(ApiClient.getStats()) === JSON.stringify(stats), 'recordStat() → getStats() Round-Trip');
  assert(global.localStorage.getItem('vroooom_stats_v1') !== null, 'Schreibt exakt auf den Key "vroooom_stats_v1"');

  assert(JSON.stringify(ApiClient.getVisitedPages()) === '{}', 'getVisitedPages() liefert leeres Objekt ohne gespeicherte Daten');
  global.localStorage.setItem('vroooom_stats_visitedPages', JSON.stringify({ index: '2026-09-15T00:00:00.000Z' }));
  assert(Object.keys(ApiClient.getVisitedPages()).length === 1, 'getVisitedPages() liest extern (settings.js) gespeicherte Daten korrekt');
})();

section('8 · Achievements (vroooom_achievements)');
(function () {
  resetStorage();
  assert(JSON.stringify(ApiClient.getAchievements()) === '{}', 'getAchievements() liefert leeres Objekt ohne gespeicherte Daten');
  var didUnlock = ApiClient.unlockAchievement('first-favorite');
  assert(didUnlock === true, 'unlockAchievement() liefert true bei neuer Freischaltung');
  assert(Object.prototype.hasOwnProperty.call(ApiClient.getAchievements(), 'first-favorite'), 'Achievement ist danach in getAchievements() vorhanden');
  var didUnlockAgain = ApiClient.unlockAchievement('first-favorite');
  assert(didUnlockAgain === false, 'unlockAchievement() ist idempotent (liefert false, wenn bereits freigeschaltet)');
  assert(global.localStorage.getItem('vroooom_achievements') !== null, 'Schreibt exakt auf den Key "vroooom_achievements"');
})();

section('9 · Race (kawasaki_records, raceHighscore)');
(function () {
  resetStorage();
  assert(JSON.stringify(ApiClient.getRaceRecords()) === '{}', 'getRaceRecords() liefert leeres Objekt ohne gespeicherte Daten');
  var records = { zx10r: 5.42, h2: 4.98 };
  ApiClient.saveRaceRecord(records);
  assert(JSON.stringify(ApiClient.getRaceRecords()) === JSON.stringify(records), 'saveRaceRecord() → getRaceRecords() Round-Trip');
  assert(global.localStorage.getItem('kawasaki_records') !== null, 'Schreibt exakt auf den Key "kawasaki_records"');

  assert(ApiClient.getRaceHighscore() === null, 'getRaceHighscore() liefert null ohne gespeicherte Daten');
  var hs = { time: 12.34, bike: 'Kawasaki ZX-10R', dist: '402 m' };
  ApiClient.saveRaceHighscore(hs);
  assert(JSON.stringify(ApiClient.getRaceHighscore()) === JSON.stringify(hs), 'saveRaceHighscore() → getRaceHighscore() Round-Trip');
  assert(global.localStorage.getItem('raceHighscore') !== null, 'Schreibt exakt auf den Key "raceHighscore"');
})();

section('10 · Wartungsrechner (vroooom_maint_state)');
(function () {
  resetStorage();
  assert(ApiClient.getMaintenanceState() === null, 'getMaintenanceState() liefert null ohne gespeicherte Daten');
  var state = { bikeKey: 'z900', year: 2022, km: 15000 };
  ApiClient.setMaintenanceState(state);
  assert(JSON.stringify(ApiClient.getMaintenanceState()) === JSON.stringify(state), 'setMaintenanceState() → getMaintenanceState() Round-Trip');
  assert(global.localStorage.getItem('vroooom_maint_state') !== null, 'Schreibt exakt auf den Key "vroooom_maint_state"');
})();

section('11 · Robustheit gegen korrupte Daten (kein Crash)');
(function () {
  resetStorage();
  global.localStorage.setItem('vroooom_favorites', 'DAS IST KEIN JSON {{{');
  assert(JSON.stringify(ApiClient.getFavorites()) === '[]', 'getFavorites() faellt bei korruptem JSON auf leeres Array zurueck (kein Crash)');

  global.localStorage.setItem('vroooom_reviews', '42');
  assert(JSON.stringify(ApiClient.getAllReviews()) === '{}', 'getAllReviews() faellt bei falschem Typ auf leeres Objekt zurueck (kein Crash)');
})();

section('RESULTS');
console.log(`\n${'═'.repeat(60)}`);
console.log(`  RESULTS: ${passed}/${passed + failed} passed`);
console.log('═'.repeat(60));
if (failed > 0) process.exit(1);
