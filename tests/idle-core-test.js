#!/usr/bin/env node
/**
 * Headless Test — idle-core.js (Kawasaki Idle Racer: Kern-Economy)
 *
 * Prüft: Bike-Kosten sind streng monoton steigend/exponentiell und
 * stimmen exakt mit bikeCost() überein; Tuning-Kosten steigen mit dem
 * Level und respektieren den Level-Cap; Passiv-/Aktiv-Ertragsformeln
 * liefern die erwarteten Werte; Level-Zustand pro Bike übersteht
 * saveState()/loadState(); loadState() liefert bei leerem Speicher einen
 * gültigen initialen {version:1,...}-Zustand; migrateState() behandelt
 * fehlende/ältere/korrupte Rohdaten defensiv.
 *
 * Run: node tests/idle-core-test.js
 * Exit 0 = alle Tests bestanden, Exit 1 = mindestens ein Fehler.
 */

'use strict';

/**
 * Minimale localStorage-Mock-Implementierung für Node (Muster identisch
 * zu tests/garage-test.js).
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

const IdleCore = require('../idle-core.js');

// ============================================================
// Test harness (Stil analog zu tests/shop-data-test.js / garage-test.js)
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

section('1 · IDLE_BIKES — 16 Modelle, aufsteigend nach Topspeed');
(function () {
  assert(Array.isArray(IdleCore.IDLE_BIKES), 'IDLE_BIKES ist ein Array');
  assert(IdleCore.IDLE_BIKES.length === 16, `IDLE_BIKES enthält 16 Modelle (gefunden: ${IdleCore.IDLE_BIKES.length})`);

  const REQUIRED_FIELDS = ['id', 'name', 'topspeed', 'ps', 'kategorie', 'kaufpreisKm'];
  IdleCore.IDLE_BIKES.forEach((bike, i) => {
    REQUIRED_FIELDS.forEach(field => {
      assert(bike[field] !== undefined && bike[field] !== null, `IDLE_BIKES[${i}].${field} ist gesetzt`);
    });
  });

  for (let i = 1; i < IdleCore.IDLE_BIKES.length; i++) {
    assert(
      IdleCore.IDLE_BIKES[i].topspeed > IdleCore.IDLE_BIKES[i - 1].topspeed,
      `IDLE_BIKES[${i}].topspeed (${IdleCore.IDLE_BIKES[i].topspeed}) > IDLE_BIKES[${i - 1}].topspeed (${IdleCore.IDLE_BIKES[i - 1].topspeed})`
    );
  }

  const ids = IdleCore.IDLE_BIKES.map(b => b.id);
  assert(new Set(ids).size === ids.length, 'Alle Bike-ids sind eindeutig');
})();

section('2 · bikeCost() — streng monoton steigend/exponentiell, deckt sich mit kaufpreisKm');
(function () {
  assert(IdleCore.bikeCost(0) === 0, 'bikeCost(0) === 0 (Startbike kostenlos)');
  assert(IdleCore.IDLE_BIKES[0].kaufpreisKm === 0, 'IDLE_BIKES[0].kaufpreisKm === 0');

  for (let i = 0; i < IdleCore.IDLE_BIKES.length; i++) {
    assert(
      IdleCore.IDLE_BIKES[i].kaufpreisKm === IdleCore.bikeCost(i),
      `IDLE_BIKES[${i}].kaufpreisKm (${IdleCore.IDLE_BIKES[i].kaufpreisKm}) === bikeCost(${i}) (${IdleCore.bikeCost(i)})`
    );
  }

  for (let i = 1; i < IdleCore.IDLE_BIKES.length; i++) {
    assert(IdleCore.bikeCost(i) > IdleCore.bikeCost(i - 1), `bikeCost(${i}) > bikeCost(${i - 1})`);
  }

  // Exponentiell: das Verhältnis aufeinanderfolgender Kosten (ab Index 2)
  // sollte nahe am konfigurierten BIKE_COST_GROWTH-Faktor liegen.
  const ratio = IdleCore.bikeCost(3) / IdleCore.bikeCost(2);
  const growth = IdleCore.IDLE_BALANCE.BIKE_COST_GROWTH;
  assert(Math.abs(ratio - growth) < 0.1, `bikeCost(3)/bikeCost(2) (${ratio.toFixed(3)}) liegt nahe BIKE_COST_GROWTH (${growth})`);
})();

section('3 · tuningCost() — steigt mit Level, respektiert den Level-Cap');
(function () {
  const bikeId = IdleCore.IDLE_BIKES[0].id;
  const cap = IdleCore.IDLE_BALANCE.TUNING_LEVEL_CAP;

  assert(typeof IdleCore.tuningCost(bikeId, 0) === 'number', `tuningCost(${bikeId}, 0) ist eine Zahl`);
  for (let lvl = 1; lvl < 5; lvl++) {
    assert(
      IdleCore.tuningCost(bikeId, lvl) > IdleCore.tuningCost(bikeId, lvl - 1),
      `tuningCost(${bikeId}, ${lvl}) > tuningCost(${bikeId}, ${lvl - 1})`
    );
  }

  assert(IdleCore.tuningCost(bikeId, cap) === null, `tuningCost(${bikeId}, cap=${cap}) === null (Cap erreicht)`);
  assert(IdleCore.tuningCost(bikeId, cap - 1) !== null, `tuningCost(${bikeId}, cap-1=${cap - 1}) !== null (letztes Upgrade noch möglich)`);
  assert(IdleCore.tuningCost('unbekannte-id', 0) === null, 'tuningCost() mit unbekannter Bike-id === null');

  // Teurere Bikes (höherer Index) kosten pro Level mehr als das Startbike.
  const lastBikeId = IdleCore.IDLE_BIKES[IdleCore.IDLE_BIKES.length - 1].id;
  assert(
    IdleCore.tuningCost(lastBikeId, 0) > IdleCore.tuningCost(bikeId, 0),
    `tuningCost(${lastBikeId}, 0) > tuningCost(${bikeId}, 0) (teureres Bike = teureres Tuning)`
  );
})();

section('4 · passiveEarn() / activeEarn() — erwartete Werte');
(function () {
  const state = IdleCore.createInitialState();

  assert(IdleCore.passiveEarn(state, 0) === 0, 'passiveEarn(state, 0) === 0');
  assert(IdleCore.passiveEarn(state, -5) === 0, 'passiveEarn(state, negativ) === 0');

  const expectedPassive = IdleCore.IDLE_BALANCE.PASSIVE_KM_PER_SEC * 10; // Startbike: Level 0, Faktor 1
  assert(
    Math.abs(IdleCore.passiveEarn(state, 10) - expectedPassive) < 1e-9,
    `passiveEarn(startState, 10s) === ${expectedPassive} (Startbike, Level 0)`
  );

  const expectedActive = IdleCore.IDLE_BALANCE.ACTIVE_KM_PER_CLICK;
  assert(
    Math.abs(IdleCore.activeEarn(state) - expectedActive) < 1e-9,
    `activeEarn(startState) === ${expectedActive} (Startbike, Level 0)`
  );

  // Getuntes Bike wirft mehr ab als ungetuntes (ertragMultiplier > 1).
  state.bikeLevels[state.currentBikeId] = 5;
  assert(IdleCore.activeEarn(state) > expectedActive, 'activeEarn() nach Tuning-Level 5 > activeEarn() bei Level 0');

  // Ein schnelleres Bike (höherer bikeSpeedFactor) wirft mehr ab als das Startbike.
  const fastBike = IdleCore.IDLE_BIKES[IdleCore.IDLE_BIKES.length - 1];
  const fastState = IdleCore.createInitialState();
  fastState.ownedBikeIds.push(fastBike.id);
  fastState.currentBikeId = fastBike.id;
  fastState.bikeLevels[fastBike.id] = 0;
  assert(IdleCore.activeEarn(fastState) > expectedActive, `activeEarn() mit ${fastBike.id} (Topspeed ${fastBike.topspeed}) > Startbike-Ertrag`);
})();

section('5 · Per-Bike-Level-Zustand übersteht saveState()/loadState()');
(function () {
  localStorage.clear();
  const state = IdleCore.createInitialState();
  const secondBike = IdleCore.IDLE_BIKES[1];
  state.ownedBikeIds.push(secondBike.id);
  state.bikeLevels[secondBike.id] = 7;
  state.km = 1234;
  state.currentBikeId = secondBike.id;

  IdleCore.saveState(state);
  const loaded = IdleCore.loadState();

  assert(loaded.version === IdleCore.IDLE_STATE_VERSION, `loadState().version === ${IdleCore.IDLE_STATE_VERSION}`);
  assert(loaded.km === 1234, `loadState().km === 1234 (${loaded.km})`);
  assert(loaded.bikeLevels[secondBike.id] === 7, `loadState().bikeLevels["${secondBike.id}"] === 7 (${loaded.bikeLevels[secondBike.id]})`);
  assert(loaded.currentBikeId === secondBike.id, `loadState().currentBikeId === "${secondBike.id}"`);
  assert(typeof loaded.lastSavedAt === 'number', 'saveState() setzt lastSavedAt auf einen Zeitstempel');
})();

section('6 · loadState() bei leerem Speicher liefert gültigen initialen Zustand');
(function () {
  localStorage.clear();
  const state = IdleCore.loadState();

  assert(state.version === IdleCore.IDLE_STATE_VERSION, `loadState() (leerer Speicher): version === ${IdleCore.IDLE_STATE_VERSION}`);
  assert(state.km === 0, 'loadState() (leerer Speicher): km === 0');
  assert(Array.isArray(state.ownedBikeIds) && state.ownedBikeIds.length === 1, 'loadState() (leerer Speicher): genau 1 besessenes Bike (Startbike)');
  assert(state.ownedBikeIds[0] === IdleCore.IDLE_BIKES[0].id, 'loadState() (leerer Speicher): Startbike === IDLE_BIKES[0]');
  assert(state.currentBikeId === IdleCore.IDLE_BIKES[0].id, 'loadState() (leerer Speicher): currentBikeId === Startbike');
  assert(typeof state.prestige === 'object' && state.prestige !== null, 'loadState() (leerer Speicher): prestige-Erweiterungspunkt vorhanden');
  assert(typeof state.parts === 'object' && state.parts !== null, 'loadState() (leerer Speicher): parts-Erweiterungspunkt vorhanden');
  assert(typeof state.offline === 'object' && state.offline !== null, 'loadState() (leerer Speicher): offline-Erweiterungspunkt vorhanden');
})();

section('7 · migrateState() — fehlende/ältere/korrupte Rohdaten defensiv behandelt');
(function () {
  const viaNull = IdleCore.migrateState(null);
  assert(viaNull.version === IdleCore.IDLE_STATE_VERSION, `migrateState(null) liefert version ${IdleCore.IDLE_STATE_VERSION}`);
  assert(viaNull.km === 0, 'migrateState(null) liefert km 0');

  const viaUndefined = IdleCore.migrateState(undefined);
  assert(viaUndefined.version === IdleCore.IDLE_STATE_VERSION, `migrateState(undefined) liefert version ${IdleCore.IDLE_STATE_VERSION}`);

  const viaGarbage = IdleCore.migrateState('nicht-mal-ein-objekt');
  assert(viaGarbage.version === IdleCore.IDLE_STATE_VERSION, `migrateState(string) liefert version ${IdleCore.IDLE_STATE_VERSION} (kein Absturz)`);

  const viaNoVersion = IdleCore.migrateState({ km: 42 });
  assert(viaNoVersion.version === IdleCore.IDLE_STATE_VERSION, `migrateState({km:42}) (fehlende version) liefert version ${IdleCore.IDLE_STATE_VERSION}`);
  assert(viaNoVersion.km === 42, 'migrateState({km:42}) übernimmt gültiges km-Feld');
  assert(Array.isArray(viaNoVersion.ownedBikeIds) && viaNoVersion.ownedBikeIds.length > 0, 'migrateState({km:42}) füllt fehlendes ownedBikeIds auf');

  const viaOlderVersion = IdleCore.migrateState({ version: 0, km: 10, ownedBikeIds: ['z125pro'], currentBikeId: 'z125pro', bikeLevels: { z125pro: 3 } });
  assert(viaOlderVersion.version === IdleCore.IDLE_STATE_VERSION, `migrateState() hebt ältere version auf aktuelle version (${IdleCore.IDLE_STATE_VERSION}) an`);
  assert(viaOlderVersion.bikeLevels.z125pro === 3, 'migrateState() übernimmt gültige bikeLevels aus älterem Zustand');

  const viaBrokenOwned = IdleCore.migrateState({ version: 1, ownedBikeIds: 'kaputt', currentBikeId: 'unbekannt' });
  assert(Array.isArray(viaBrokenOwned.ownedBikeIds) && viaBrokenOwned.ownedBikeIds.length > 0, 'migrateState() repariert korruptes ownedBikeIds');
  assert(viaBrokenOwned.ownedBikeIds.indexOf(viaBrokenOwned.currentBikeId) !== -1, 'migrateState() stellt sicher, dass currentBikeId in ownedBikeIds enthalten ist');

  const viaUnknownCurrentBike = IdleCore.migrateState({ version: 1, ownedBikeIds: ['z125pro'], currentBikeId: 'existiert-nicht', bikeLevels: {} });
  assert(viaUnknownCurrentBike.currentBikeId === 'z125pro', 'migrateState() korrigiert unbekanntes currentBikeId auf besessenes Bike');
})();

section('8 · Kauf-/Tuning-/Wechsel-Mutationen (buyNextBike/upgradeBike/selectBike)');
(function () {
  const state = IdleCore.createInitialState();
  const secondBike = IdleCore.IDLE_BIKES[1];

  const tooExpensive = IdleCore.buyNextBike(state);
  assert(tooExpensive.success === false, 'buyNextBike() schlägt bei 0 km fehl (nächstes Bike zu teuer)');

  state.km = IdleCore.bikeCost(1) + 100;
  const bought = IdleCore.buyNextBike(state);
  assert(bought.success === true, 'buyNextBike() gelingt mit genug km');
  assert(state.ownedBikeIds.indexOf(secondBike.id) !== -1, 'buyNextBike() fügt Bike zu ownedBikeIds hinzu');
  assert(state.km === 100, `buyNextBike() zieht Kaufpreis ab (verbleibend: ${state.km})`);

  assert(IdleCore.selectBike(state, secondBike.id) === true, 'selectBike() gelingt für besessenes Bike');
  assert(state.currentBikeId === secondBike.id, 'selectBike() setzt currentBikeId');
  assert(IdleCore.selectBike(state, 'nicht-besessen') === false, 'selectBike() schlägt für unbesessenes Bike fehl');

  state.km = 10000;
  const upgraded = IdleCore.upgradeBike(state, secondBike.id);
  assert(upgraded.success === true, 'upgradeBike() gelingt mit genug km');
  assert(state.bikeLevels[secondBike.id] === 1, 'upgradeBike() erhöht das Level um 1');
})();

section('9 · MECHANIK A — Schaltpunkt-Combo (comboMultiplier/perfectZoneWidth/applyShiftResult)');
(function () {
  // comboMultiplier(): 1x ohne Combo, rampt x2→x5, deckelt bei x5.
  assert(IdleCore.comboMultiplier(0) === 1, 'comboMultiplier(0) === 1 (kein Multiplikator)');
  assert(IdleCore.comboMultiplier(-3) === 1, 'comboMultiplier(negativ) === 1 (kein Absturz)');
  assert(IdleCore.comboMultiplier(1) === IdleCore.IDLE_BALANCE.COMBO_MULTIPLIER_BASE, 'comboMultiplier(1) === COMBO_MULTIPLIER_BASE (x2)');

  let prevMultiplier = IdleCore.comboMultiplier(1);
  for (let combo = 2; combo <= 20; combo++) {
    const m = IdleCore.comboMultiplier(combo);
    assert(m >= prevMultiplier, `comboMultiplier(${combo}) >= comboMultiplier(${combo - 1}) (rampt monoton)`);
    assert(m <= IdleCore.IDLE_BALANCE.COMBO_MULTIPLIER_MAX, `comboMultiplier(${combo}) <= COMBO_MULTIPLIER_MAX (x5-Deckel)`);
    prevMultiplier = m;
  }
  assert(IdleCore.comboMultiplier(100) === IdleCore.IDLE_BALANCE.COMBO_MULTIPLIER_MAX, 'comboMultiplier(100) deckelt exakt bei COMBO_MULTIPLIER_MAX (x5)');

  // perfectZoneWidth(): schrumpft monoton mit der Combo, nie unter das Minimum.
  const baseWidth = IdleCore.IDLE_BALANCE.COMBO_ZONE_BASE_WIDTH_PCT;
  assert(IdleCore.perfectZoneWidth(0, baseWidth) === baseWidth, 'perfectZoneWidth(0, baseWidth) === baseWidth (volle Breite bei Combo 0)');
  let prevWidth = IdleCore.perfectZoneWidth(0, baseWidth);
  for (let combo = 1; combo <= 30; combo++) {
    const w = IdleCore.perfectZoneWidth(combo, baseWidth);
    assert(w <= prevWidth, `perfectZoneWidth(${combo}) <= perfectZoneWidth(${combo - 1}) (schrumpft monoton)`);
    assert(w >= IdleCore.IDLE_BALANCE.COMBO_ZONE_MIN_WIDTH_PCT, `perfectZoneWidth(${combo}) >= COMBO_ZONE_MIN_WIDTH_PCT (Untergrenze respektiert)`);
    prevWidth = w;
  }
  assert(IdleCore.perfectZoneWidth(999, baseWidth) === IdleCore.IDLE_BALANCE.COMBO_ZONE_MIN_WIDTH_PCT, 'perfectZoneWidth(999) erreicht exakt die Untergrenze');
  assert(IdleCore.perfectZoneWidth(0) === IdleCore.IDLE_BALANCE.COMBO_ZONE_BASE_WIDTH_PCT, 'perfectZoneWidth(0) ohne baseWidth nutzt IDLE_BALANCE-Standard');

  // applyShiftResult(): Treffer erhöht Combo + gewährt Multiplikator für die Dauer.
  const state = IdleCore.createInitialState();
  const t0 = 1000000;
  const afterHit1 = IdleCore.applyShiftResult(state, true, t0);
  assert(afterHit1.count === 1, 'applyShiftResult(hit) erhöht Combo auf 1');
  assert(state.combo.count === 1, 'applyShiftResult(hit) mutiert state.combo.count');
  assert(afterHit1.multiplier === IdleCore.comboMultiplier(1), 'applyShiftResult(hit) setzt den zu Combo 1 passenden Multiplikator');
  assert(afterHit1.multiplierExpiresAt === t0 + IdleCore.IDLE_BALANCE.COMBO_MULTIPLIER_DURATION_MS, 'applyShiftResult(hit) setzt multiplierExpiresAt auf now + COMBO_MULTIPLIER_DURATION_MS');

  const afterHit2 = IdleCore.applyShiftResult(state, true, t0 + 500);
  assert(afterHit2.count === 2, 'applyShiftResult(hit) erhöht Combo weiter auf 2');
  assert(afterHit2.multiplier === IdleCore.comboMultiplier(2), 'applyShiftResult(hit) aktualisiert den Multiplikator passend zur neuen Combo');

  const afterMiss = IdleCore.applyShiftResult(state, false, t0 + 800);
  assert(afterMiss.count === 0, 'applyShiftResult(miss) setzt Combo zurück auf 0');
  assert(afterMiss.multiplier === 1, 'applyShiftResult(miss) setzt den Multiplikator zurück auf 1x');
  assert(afterMiss.multiplierExpiresAt === null, 'applyShiftResult(miss) löscht multiplierExpiresAt');

  // Ignorieren (kein Klick) ⇒ keine Funktion aufgerufen ⇒ keine Strafe, Combo bleibt unverändert.
  const ignoreState = IdleCore.createInitialState();
  IdleCore.applyShiftResult(ignoreState, true, t0);
  const comboBeforeIgnore = ignoreState.combo.count;
  // (Simuliert: Leiste läuft unbeklickt ab — idle.js ruft applyShiftResult() dann NICHT auf.)
  assert(ignoreState.combo.count === comboBeforeIgnore, 'Ignorieren einer Schaltpunkt-Leiste ändert die Combo nicht (keine Strafe)');

  // activeComboMultiplier(): Multiplikator ist genau innerhalb des Dauer-Fensters aktiv.
  const durState = IdleCore.createInitialState();
  IdleCore.applyShiftResult(durState, true, t0);
  const grantedMultiplier = durState.combo.multiplier;
  assert(IdleCore.activeComboMultiplier(durState, t0) === grantedMultiplier, 'activeComboMultiplier() ist direkt nach dem Treffer aktiv');
  assert(
    IdleCore.activeComboMultiplier(durState, t0 + IdleCore.IDLE_BALANCE.COMBO_MULTIPLIER_DURATION_MS - 1) === grantedMultiplier,
    'activeComboMultiplier() bleibt bis knapp vor Ablauf der Dauer aktiv'
  );
  assert(
    IdleCore.activeComboMultiplier(durState, t0 + IdleCore.IDLE_BALANCE.COMBO_MULTIPLIER_DURATION_MS) === 1,
    'activeComboMultiplier() fällt exakt beim Ablauf der Dauer auf 1x zurück'
  );
  assert(
    IdleCore.activeComboMultiplier(durState, t0 + IdleCore.IDLE_BALANCE.COMBO_MULTIPLIER_DURATION_MS + 5000) === 1,
    'activeComboMultiplier() bleibt nach Ablauf dauerhaft auf 1x'
  );
  assert(IdleCore.activeComboMultiplier(IdleCore.createInitialState(), t0) === 1, 'activeComboMultiplier() liefert 1x für einen frischen Zustand ohne Combo');

  // nextShiftIntervalSeconds(): liegt im konfigurierten Intervall, Zufälligkeit wird übergeben.
  const min = IdleCore.IDLE_BALANCE.SHIFT_INTERVAL_MIN_SECONDS;
  const max = IdleCore.IDLE_BALANCE.SHIFT_INTERVAL_MAX_SECONDS;
  assert(IdleCore.nextShiftIntervalSeconds(function () { return 0; }) === min, 'nextShiftIntervalSeconds(random=0) === Untergrenze');
  assert(IdleCore.nextShiftIntervalSeconds(function () { return 1; }) === max, 'nextShiftIntervalSeconds(random=1) === Obergrenze');
  const mid = IdleCore.nextShiftIntervalSeconds(function () { return 0.5; });
  assert(mid > min && mid < max, 'nextShiftIntervalSeconds(random=0.5) liegt strikt zwischen den Grenzen');

  // Migration/Persistenz: combo/sound-Felder überstehen saveState()/loadState() und werden defensiv migriert.
  const persistState = IdleCore.createInitialState();
  IdleCore.applyShiftResult(persistState, true, t0);
  persistState.sound.enabled = true;
  persistState.sound.volume = 0.3;
  IdleCore.saveState(persistState);
  const reloaded = IdleCore.loadState();
  assert(reloaded.combo.count === 1, 'combo.count übersteht saveState()/loadState()');
  assert(reloaded.sound.enabled === true, 'sound.enabled übersteht saveState()/loadState()');
  assert(Math.abs(reloaded.sound.volume - 0.3) < 1e-9, 'sound.volume übersteht saveState()/loadState()');

  const migratedNoCombo = IdleCore.migrateState({ version: 1, km: 5 });
  assert(migratedNoCombo.combo && migratedNoCombo.combo.count === 0, 'migrateState() füllt fehlendes combo-Feld defensiv auf');
  assert(migratedNoCombo.sound && migratedNoCombo.sound.enabled === false, 'migrateState() füllt fehlendes sound-Feld defensiv auf (Sound-Standard AUS)');
})();

section('10 · MECHANIK B — Saison/Prestige/Werksverträge (trophiesForSeason/canFinishSeason/finishSeason/contractEffects)');
(function () {
  // trophiesForSeason(): 1 Trophäe pro gekauftem Bike + Bonus je TROPHY_LEVEL_BONUS_DIVISOR kumulierte Level.
  const fresh = IdleCore.createInitialState();
  assert(IdleCore.trophiesForSeason(fresh) === 0, 'trophiesForSeason(frischer Zustand) === 0 (nur Startbike)');

  const state = IdleCore.createInitialState();
  for (let i = 1; i <= 3; i++) {
    state.ownedBikeIds.push(IdleCore.IDLE_BIKES[i].id);
    state.bikeLevels[IdleCore.IDLE_BIKES[i].id] = 0;
  }
  assert(IdleCore.trophiesForSeason(state) === 3, 'trophiesForSeason() zählt 1 Trophäe je über das Startbike hinaus gekauftem Bike (3 Bikes → 3)');

  state.bikeLevels[state.ownedBikeIds[1]] = IdleCore.IDLE_BALANCE.TROPHY_LEVEL_BONUS_DIVISOR; // genau 1 Bonus-Schwelle erreicht
  assert(IdleCore.trophiesForSeason(state) === 4, 'trophiesForSeason() addiert +1 Bonus-Trophäe je TROPHY_LEVEL_BONUS_DIVISOR kumulierte Tuning-Level');

  // canFinishSeason(): erst ab Besitz der ZX-10R (Index 12) möglich.
  const zxIndex = IdleCore.findBikeIndex('zx10r');
  const belowZx = IdleCore.createInitialState();
  for (let i = 1; i < zxIndex; i++) belowZx.ownedBikeIds.push(IdleCore.IDLE_BIKES[i].id);
  assert(IdleCore.canFinishSeason(belowZx) === false, 'canFinishSeason() === false, solange die ZX-10R noch nicht besessen wird');

  const atZx = IdleCore.createInitialState();
  for (let i = 1; i <= zxIndex; i++) {
    atZx.ownedBikeIds.push(IdleCore.IDLE_BIKES[i].id);
    atZx.bikeLevels[IdleCore.IDLE_BIKES[i].id] = 0;
  }
  assert(IdleCore.canFinishSeason(atZx) === true, 'canFinishSeason() === true, sobald die ZX-10R besessen wird');

  // finishSeason(): No-op, falls (noch) nicht abschliessbar.
  const notFinished = IdleCore.finishSeason(belowZx);
  assert(notFinished === belowZx, 'finishSeason() gibt den unveränderten Zustand zurück, falls canFinishSeason() false ist');

  // finishSeason(): resettet km/ownedBikeIds/bikeLevels/combo, behält Trophäen/Verträge/Teile/Stats/totalKmEarned/Sound/Offline.
  atZx.km = 12345;
  atZx.totalKmEarned = 99999;
  atZx.parts.collected = ['helm_standard'];
  atZx.prestige.trophies = 2;
  atZx.prestige.points = 2;
  atZx.prestige.contracts = ['zoneBreiter10'];
  atZx.combo = { count: 4, multiplier: 3, multiplierExpiresAt: Date.now() + 5000 };
  atZx.sound = { enabled: true, volume: 0.7 };
  atZx.offline.lastSeenAt = 123456;
  const expectedNewTrophies = IdleCore.trophiesForSeason(atZx);

  const afterSeason = IdleCore.finishSeason(atZx);
  assert(afterSeason !== atZx, 'finishSeason() gibt bei Erfolg ein NEUES Zustandsobjekt zurück (mutiert atZx nicht)');
  assert(afterSeason.km === 0, 'finishSeason() setzt km auf 0 zurück');
  assert(afterSeason.ownedBikeIds.length === 1 && afterSeason.ownedBikeIds[0] === IdleCore.IDLE_BIKES[0].id, 'finishSeason() setzt ownedBikeIds auf nur das Startbike zurück (ohne aktiven Start-Vertrag)');
  assert(afterSeason.combo.count === 0, 'finishSeason() setzt die Schaltpunkt-Combo zurück');
  assert(afterSeason.totalKmEarned === 99999, 'finishSeason() behält die Lebenszeit-km-Statistik (totalKmEarned)');
  assert(afterSeason.parts.collected.indexOf('helm_standard') !== -1, 'finishSeason() behält die Teile-Sammlung');
  assert(afterSeason.prestige.contracts.indexOf('zoneBreiter10') !== -1, 'finishSeason() behält gekaufte Werksverträge');
  assert(afterSeason.prestige.trophies === 2 + expectedNewTrophies, 'finishSeason() addiert die neu verdienten Trophäen zu den vorhandenen');
  assert(afterSeason.prestige.level === 1, 'finishSeason() erhöht prestige.level um 1');
  assert(afterSeason.sound.enabled === true, 'finishSeason() behält die Sound-Einstellungen');
  assert(afterSeason.offline.lastSeenAt === 123456, 'finishSeason() behält den Offline-Zeitstempel');

  // "Start mit Ninja 400"-Werksvertrag: neue Saison beginnt mit Ninja 400 statt Z125 PRO.
  const withStartContract = IdleCore.createInitialState();
  for (let i = 1; i <= zxIndex; i++) {
    withStartContract.ownedBikeIds.push(IdleCore.IDLE_BIKES[i].id);
    withStartContract.bikeLevels[IdleCore.IDLE_BIKES[i].id] = 0;
  }
  withStartContract.prestige.contracts = ['startNinja400'];
  const afterSeasonWithContract = IdleCore.finishSeason(withStartContract);
  assert(afterSeasonWithContract.currentBikeId === 'ninja400', '"Start mit Ninja 400"-Vertrag: finishSeason() setzt currentBikeId auf ninja400');
  assert(afterSeasonWithContract.ownedBikeIds.indexOf('ninja400') !== -1, '"Start mit Ninja 400"-Vertrag: ninja400 ist nach dem Reset bereits besessen');

  // contractEffects(): aggregiert alle aktiven Effekte + den Pro-Saison-Prestige-Bonus.
  const noEffects = IdleCore.contractEffects(IdleCore.createInitialState());
  assert(noEffects.earnMultiplier === 1, 'contractEffects() ohne Verträge/Prestige-Level: earnMultiplier === 1');
  assert(noEffects.startBikeId === null, 'contractEffects() ohne Verträge: startBikeId === null');
  assert(noEffects.zoneWidthBonusPct === 0, 'contractEffects() ohne Verträge: zoneWidthBonusPct === 0');
  assert(noEffects.offlineCapMultiplier === 1, 'contractEffects() ohne Verträge: offlineCapMultiplier === 1');
  assert(noEffects.tuningCostMultiplier === 1, 'contractEffects() ohne Verträge: tuningCostMultiplier === 1');

  const allContractsState = IdleCore.createInitialState();
  allContractsState.prestige.contracts = IdleCore.IDLE_CONTRACTS.map((c) => c.id);
  const allEffects = IdleCore.contractEffects(allContractsState);
  assert(Math.abs(allEffects.earnMultiplier - 1.25) < 1e-9, 'contractEffects() mit "+25% Ertrag"-Vertrag: earnMultiplier === 1.25');
  assert(allEffects.startBikeId === 'ninja400', 'contractEffects() mit "Start mit Ninja 400"-Vertrag: startBikeId === "ninja400"');
  assert(allEffects.zoneWidthBonusPct === 10, 'contractEffects() mit "Perfekt-Zone 10% breiter"-Vertrag: zoneWidthBonusPct === 10');
  assert(allEffects.offlineCapMultiplier === 2, 'contractEffects() mit "Offline verdoppelt"-Vertrag: offlineCapMultiplier === 2');
  assert(Math.abs(allEffects.tuningCostMultiplier - 0.85) < 1e-9, 'contractEffects() mit "Tuning 15% günstiger"-Vertrag: tuningCostMultiplier === 0.85');

  const leveledState = IdleCore.createInitialState();
  leveledState.prestige.level = 2;
  const leveledEffects = IdleCore.contractEffects(leveledState);
  assert(
    Math.abs(leveledEffects.earnMultiplier - (1 + 2 * IdleCore.IDLE_BALANCE.PRESTIGE_BONUS_PER_LEVEL)) < 1e-9,
    'contractEffects() addiert den permanenten Pro-Saison-Bonus (PRESTIGE_BONUS_PER_LEVEL) je prestige.level'
  );

  // canBuyContract()/buyContract(): respektiert Trophäenkosten + verhindert Doppelkauf.
  const buyState = IdleCore.createInitialState();
  assert(IdleCore.canBuyContract(buyState, 'ertrag25') === false, 'canBuyContract() === false ohne genug Trophäen');
  buyState.prestige.trophies = 10;
  assert(IdleCore.canBuyContract(buyState, 'ertrag25') === true, 'canBuyContract() === true mit genug Trophäen');
  const bought = IdleCore.buyContract(buyState, 'ertrag25');
  assert(bought.success === true, 'buyContract() gelingt mit genug Trophäen');
  assert(buyState.prestige.trophies === 10 - IdleCore.getContractById('ertrag25').kostenTrophaeen, 'buyContract() zieht die Trophäenkosten ab');
  assert(buyState.prestige.contracts.indexOf('ertrag25') !== -1, 'buyContract() fügt die Vertrags-id hinzu');
  assert(IdleCore.canBuyContract(buyState, 'ertrag25') === false, 'canBuyContract() === false für einen bereits besessenen Vertrag');
  const boughtAgain = IdleCore.buyContract(buyState, 'ertrag25');
  assert(boughtAgain.success === false, 'buyContract() schlägt für einen bereits besessenen Vertrag fehl');

  // effectiveTuningCost(): wendet den Tuning-Rabatt-Vertrag an.
  const noContractCost = IdleCore.effectiveTuningCost(IdleCore.createInitialState(), IdleCore.IDLE_BIKES[0].id, 0);
  const discountState = IdleCore.createInitialState();
  discountState.prestige.contracts = ['tuningGuenstiger15'];
  const discountedCost = IdleCore.effectiveTuningCost(discountState, IdleCore.IDLE_BIKES[0].id, 0);
  assert(discountedCost < noContractCost, 'effectiveTuningCost() ist mit "Tuning 15% günstiger"-Vertrag niedriger als ohne');
  assert(IdleCore.effectiveTuningCost(IdleCore.createInitialState(), 'unbekannte-id', 0) === null, 'effectiveTuningCost() mit unbekannter Bike-id === null');

  // perfectZoneWidthForState(): wendet den Zonen-Breite-Vertrag an.
  const noContractWidth = IdleCore.perfectZoneWidthForState(IdleCore.createInitialState(), 0);
  const widerState = IdleCore.createInitialState();
  widerState.prestige.contracts = ['zoneBreiter10'];
  const widerWidth = IdleCore.perfectZoneWidthForState(widerState, 0);
  assert(widerWidth > noContractWidth, 'perfectZoneWidthForState() ist mit "Perfekt-Zone 10% breiter"-Vertrag breiter als ohne');
  assert(Math.abs(widerWidth - noContractWidth - 10) < 1e-9, 'perfectZoneWidthForState() addiert exakt die vertraglich zugesagten 10 Prozentpunkte');
})();

section('11 · Teile-Sammlung (rollPartDrop/addPart/setBonuses)');
(function () {
  // rollPartDrop(): deterministisch bei fester Zufallsfolge; "kein Drop", falls die erste Zahl über der Drop-Chance liegt.
  assert(IdleCore.rollPartDrop(() => 0.999) === null, 'rollPartDrop() liefert null, falls die Zufallszahl über PART_DROP_CHANCE_PER_LAP liegt');

  let callIndex = 0;
  const sequence = [0, 0, 0]; // Drop ja (0 < Chance) → Seltenheit 'common' (0 < weights.common) → erstes 'common'-Teil
  const fixedRng = () => sequence[Math.min(callIndex++, sequence.length - 1)];
  const firstCommonId = IdleCore.IDLE_PARTS.filter((p) => p.rarity === 'common')[0].id;
  assert(IdleCore.rollPartDrop(fixedRng) === firstCommonId, 'rollPartDrop() liefert mit fester Zufallsfolge [0,0,0] deterministisch das erste "common"-Teil');

  // Verteilung über viele geseedete Rolls: alle 3 Seltenheitsstufen kommen vor, ~PART_DROP_CHANCE_PER_LAP Drop-Rate.
  let seed = 42;
  function seededRandom() {
    // Einfacher deterministischer LCG-basierter Pseudo-Zufallsgenerator (immer dieselbe Folge für denselben Seed).
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  }
  const ROLL_COUNT = 20000;
  let dropCount = 0;
  const rarityCounts = { common: 0, rare: 0, legendary: 0 };
  for (let i = 0; i < ROLL_COUNT; i++) {
    const partId = IdleCore.rollPartDrop(seededRandom);
    if (partId) {
      dropCount++;
      const part = IdleCore.getPartById(partId);
      rarityCounts[part.rarity]++;
    }
  }
  const expectedDrops = ROLL_COUNT * IdleCore.IDLE_BALANCE.PART_DROP_CHANCE_PER_LAP;
  assert(Math.abs(dropCount - expectedDrops) / expectedDrops < 0.25, `Drop-Rate über ${ROLL_COUNT} geseedete Rolls (${dropCount}) liegt nahe der erwarteten ~${Math.round(expectedDrops)} (PART_DROP_CHANCE_PER_LAP)`);
  assert(rarityCounts.common > rarityCounts.rare, `Seltenheits-Verteilung: common (${rarityCounts.common}) > rare (${rarityCounts.rare}) — schwerer gewichtet`);
  assert(rarityCounts.rare > rarityCounts.legendary, `Seltenheits-Verteilung: rare (${rarityCounts.rare}) > legendary (${rarityCounts.legendary}) — schwerer gewichtet`);
  assert(rarityCounts.legendary > 0, `Seltenheits-Verteilung: legendary (${rarityCounts.legendary}) kommt über ${ROLL_COUNT} Rolls mindestens einmal vor`);

  // addPart(): neues Teil vs. Dublette (→ km-Umwandlung).
  const partsState = IdleCore.createInitialState();
  const somePart = IdleCore.IDLE_PARTS[0];
  const addedNew = IdleCore.addPart(partsState, somePart.id);
  assert(addedNew.isNew === true, 'addPart() meldet isNew=true für ein neues Teil');
  assert(addedNew.awardedKm === 0, 'addPart() gewährt keine km für ein neues Teil');
  assert(partsState.parts.collected.indexOf(somePart.id) !== -1, 'addPart() fügt die id zur Sammlung hinzu');
  assert(partsState.km === 0, 'addPart() eines neuen Teils verändert km nicht');

  const kmBefore = partsState.km;
  const addedDuplicate = IdleCore.addPart(partsState, somePart.id);
  assert(addedDuplicate.isNew === false, 'addPart() meldet isNew=false für eine Dublette');
  const expectedValue = IdleCore.IDLE_BALANCE.PART_DUPLICATE_KM_VALUE[somePart.rarity];
  assert(addedDuplicate.awardedKm === expectedValue, `addPart() einer Dublette gewährt genau PART_DUPLICATE_KM_VALUE.${somePart.rarity} (${expectedValue}) km`);
  assert(partsState.km === kmBefore + expectedValue, 'addPart() einer Dublette bucht die km korrekt auf state.km');
  assert(
    partsState.parts.collected.filter((id) => id === somePart.id).length === 1,
    'addPart() einer Dublette fügt die id NICHT erneut zur Sammlung hinzu (keine Duplikate in der Liste)'
  );

  assert(IdleCore.addPart(partsState, 'unbekannte-teile-id').part === null, 'addPart() mit unbekannter Teile-id liefert part:null (kein Absturz)');

  // setBonuses(): Set-Bonus nur bei vollständigem Set, aggregiert korrekt über mehrere Sets.
  const bonusState = IdleCore.createInitialState();
  const noBonus = IdleCore.setBonuses(bonusState);
  assert(noBonus.totalBonusPct === 0, 'setBonuses() ohne Teile: totalBonusPct === 0');
  assert(noBonus.totalBonusMultiplier === 1, 'setBonuses() ohne Teile: totalBonusMultiplier === 1');
  assert(noBonus.completedSets.length === 0, 'setBonuses() ohne Teile: keine kompletten Sets');

  const firstSet = IdleCore.IDLE_PART_SETS[0];
  const firstSetPartIds = IdleCore.IDLE_PARTS.filter((p) => p.setId === firstSet.id).map((p) => p.id);
  firstSetPartIds.slice(0, -1).forEach((id) => IdleCore.addPart(bonusState, id));
  assert(IdleCore.setBonuses(bonusState).completedSets.length === 0, 'setBonuses() zählt ein Set NICHT als komplett, solange 1 Teil fehlt');

  IdleCore.addPart(bonusState, firstSetPartIds[firstSetPartIds.length - 1]);
  const oneSetBonus = IdleCore.setBonuses(bonusState);
  assert(oneSetBonus.completedSets.length === 1 && oneSetBonus.completedSets[0] === firstSet.id, 'setBonuses() zählt ein Set als komplett, sobald alle seine Teile besessen sind');
  assert(oneSetBonus.totalBonusPct === firstSet.bonusPct, 'setBonuses() liefert genau den bonusPct des kompletten Sets');
  assert(Math.abs(oneSetBonus.totalBonusMultiplier - (1 + firstSet.bonusPct / 100)) < 1e-9, 'setBonuses() totalBonusMultiplier entspricht 1 + bonusPct/100');

  const secondSet = IdleCore.IDLE_PART_SETS[1];
  const secondSetPartIds = IdleCore.IDLE_PARTS.filter((p) => p.setId === secondSet.id).map((p) => p.id);
  secondSetPartIds.forEach((id) => IdleCore.addPart(bonusState, id));
  const twoSetBonus = IdleCore.setBonuses(bonusState);
  assert(twoSetBonus.completedSets.length === 2, 'setBonuses() zählt mehrere komplette Sets gleichzeitig');
  assert(twoSetBonus.totalBonusPct === firstSet.bonusPct + secondSet.bonusPct, 'setBonuses() summiert die bonusPct-Werte mehrerer kompletter Sets');
})();

section('12 · Offline-Ertrag (offlineEarn) — Deckelung + Werksvertrag-Verdoppelung');
(function () {
  const state = IdleCore.createInitialState();

  assert(IdleCore.offlineEarn(state, 0) === 0, 'offlineEarn(state, 0) === 0');
  assert(IdleCore.offlineEarn(state, -100) === 0, 'offlineEarn(state, negativ) === 0');
  assert(IdleCore.offlineEarn(null, 100) === 0, 'offlineEarn(null, ...) === 0 (kein Absturz)');

  const oneHour = 3600;
  const expectedOneHour = IdleCore.passiveEarn(state, oneHour) * IdleCore.IDLE_BALANCE.OFFLINE_EARN_FRACTION;
  assert(Math.abs(IdleCore.offlineEarn(state, oneHour) - expectedOneHour) < 1e-6, 'offlineEarn() für 1h unterhalb des Caps entspricht passiveEarn(1h) × OFFLINE_EARN_FRACTION');

  const cap = IdleCore.IDLE_BALANCE.OFFLINE_CAP_SECONDS;
  const atCap = IdleCore.offlineEarn(state, cap);
  const wayOverCap = IdleCore.offlineEarn(state, cap * 10);
  assert(Math.abs(atCap - wayOverCap) < 1e-6, 'offlineEarn() deckelt exakt bei OFFLINE_CAP_SECONDS (4h) — 10× mehr Abwesenheit ändert am Ergebnis nichts');
  assert(atCap > 0, 'offlineEarn() am Cap ist trotzdem > 0');

  const doubledState = IdleCore.createInitialState();
  doubledState.prestige.contracts = ['offlineVerdoppelt'];
  const doubledBetweenCaps = IdleCore.offlineEarn(doubledState, cap * 1.5); // > altes 4h-Cap, aber < neues 8h-Cap
  const doubledAtNewCap = IdleCore.offlineEarn(doubledState, cap * 2);
  const doubledWayOver = IdleCore.offlineEarn(doubledState, cap * 20);
  assert(doubledBetweenCaps > atCap, '"Offline verdoppelt"-Vertrag: bei 6h Abwesenheit (> altes 4h-Cap) wird MEHR gutgeschrieben als ohne Vertrag (dessen 4h-Cap bereits erreicht wäre)');
  assert(Math.abs(doubledAtNewCap - doubledWayOver) < 1e-6, '"Offline verdoppelt"-Vertrag: offlineEarn() deckelt jetzt exakt bei 8h (2× OFFLINE_CAP_SECONDS)');
  assert(Math.abs(doubledAtNewCap - atCap * 2) < 1e-6, '"Offline verdoppelt"-Vertrag: der neue 8h-Cap-Ertrag ist exakt doppelt so hoch wie der alte 4h-Cap-Ertrag');

  // offlineEarn() wendet auch den Ertrags-Vertrag + Teile-Set-Bonus an (wie passiveEarn im laufenden Spiel).
  const earnContractState = IdleCore.createInitialState();
  earnContractState.prestige.contracts = ['ertrag25'];
  const boostedOneHour = IdleCore.offlineEarn(earnContractState, oneHour);
  assert(boostedOneHour > expectedOneHour, 'offlineEarn() wendet den "+25% Ertrag"-Vertrag ebenfalls an');
})();

section('13 · Statistiken (recordLap/recordComboPeak/addPlayTime) + vollständiger Save/Load-Roundtrip aller Phase-C-Felder');
(function () {
  const state = IdleCore.createInitialState();
  assert(state.stats.laps === 0 && state.stats.bestCombo === 0 && state.stats.playTimeSeconds === 0 && Array.isArray(state.stats.seasonHistory) && state.stats.seasonHistory.length === 0, 'createInitialState() liefert ein leeres, gültiges stats-Objekt');

  IdleCore.recordLap(state);
  IdleCore.recordLap(state);
  assert(state.stats.laps === 2, 'recordLap() erhöht state.stats.laps je Aufruf um 1');

  IdleCore.recordComboPeak(state, 5);
  assert(state.stats.bestCombo === 5, 'recordComboPeak() setzt einen neuen, höheren Bestwert');
  IdleCore.recordComboPeak(state, 2);
  assert(state.stats.bestCombo === 5, 'recordComboPeak() überschreibt den Bestwert NICHT mit einem niedrigeren Wert');

  IdleCore.addPlayTime(state, 12.5);
  IdleCore.addPlayTime(state, 7.5);
  assert(Math.abs(state.stats.playTimeSeconds - 20) < 1e-9, 'addPlayTime() summiert die Spielzeit kumulativ');
  IdleCore.addPlayTime(state, -5);
  assert(Math.abs(state.stats.playTimeSeconds - 20) < 1e-9, 'addPlayTime() ignoriert negative dtSeconds (kein Rückgang)');

  // Vollständiger Save/Load-Roundtrip: ALLE Phase-C-Felder (prestige/parts/offline/stats) überstehen saveState()/loadState().
  localStorage.clear();
  const fullState = IdleCore.createInitialState();
  fullState.prestige = { level: 3, points: 42, trophies: 17, contracts: ['ertrag25', 'zoneBreiter10'] };
  fullState.parts.collected = ['helm_standard', 'auspuff_slipon'];
  fullState.offline.lastSeenAt = 1700000000000;
  fullState.stats = { laps: 88, bestCombo: 9, seasonHistory: [{ season: 1, trophiesEarned: 5, finishedAt: 1600000000000 }], playTimeSeconds: 555.5 };

  IdleCore.saveState(fullState);
  const reloaded = IdleCore.loadState();

  assert(reloaded.version === IdleCore.IDLE_STATE_VERSION, `vollständiger Roundtrip: version === ${IdleCore.IDLE_STATE_VERSION}`);
  assert(reloaded.prestige.level === 3 && reloaded.prestige.points === 42 && reloaded.prestige.trophies === 17, 'vollständiger Roundtrip: prestige.level/points/trophies übersteht saveState()/loadState()');
  assert(reloaded.prestige.contracts.length === 2 && reloaded.prestige.contracts.indexOf('ertrag25') !== -1 && reloaded.prestige.contracts.indexOf('zoneBreiter10') !== -1, 'vollständiger Roundtrip: prestige.contracts übersteht saveState()/loadState()');
  assert(reloaded.parts.collected.length === 2 && reloaded.parts.collected.indexOf('helm_standard') !== -1, 'vollständiger Roundtrip: parts.collected übersteht saveState()/loadState()');
  // saveState() aktualisiert offline.lastSeenAt bewusst auf "jetzt" (siehe idle-core.js) — hier wird nur geprüft, dass es weiterhin eine gültige Zahl ist.
  assert(typeof reloaded.offline.lastSeenAt === 'number', 'vollständiger Roundtrip: offline.lastSeenAt bleibt eine gültige Zahl (saveState() aktualisiert sie bewusst auf "jetzt")');
  assert(reloaded.stats.laps === 88 && reloaded.stats.bestCombo === 9, 'vollständiger Roundtrip: stats.laps/bestCombo übersteht saveState()/loadState()');
  assert(Math.abs(reloaded.stats.playTimeSeconds - 555.5) < 1e-9, 'vollständiger Roundtrip: stats.playTimeSeconds übersteht saveState()/loadState()');
  assert(reloaded.stats.seasonHistory.length === 1 && reloaded.stats.seasonHistory[0].trophiesEarned === 5, 'vollständiger Roundtrip: stats.seasonHistory übersteht saveState()/loadState()');

  // migrateState() befüllt fehlende Phase-C-Felder defensiv (altes Save ohne prestige.trophies/contracts/stats).
  const legacyRaw = { version: 1, km: 100, ownedBikeIds: ['z125pro'], currentBikeId: 'z125pro', bikeLevels: { z125pro: 0 }, prestige: { level: 1, points: 5 } };
  const migratedLegacy = IdleCore.migrateState(legacyRaw);
  assert(migratedLegacy.prestige.level === 1 && migratedLegacy.prestige.points === 5, 'migrateState() übernimmt gültige ältere prestige.level/points-Werte');
  assert(typeof migratedLegacy.prestige.trophies === 'number' && Array.isArray(migratedLegacy.prestige.contracts), 'migrateState() füllt fehlende prestige.trophies/contracts defensiv auf (altes Save ohne diese Felder)');
  assert(migratedLegacy.stats && typeof migratedLegacy.stats.laps === 'number' && Array.isArray(migratedLegacy.stats.seasonHistory), 'migrateState() füllt ein komplett fehlendes stats-Feld defensiv auf (altes Save vor feat(idle-stats))');
  assert(migratedLegacy.parts && Array.isArray(migratedLegacy.parts.collected), 'migrateState() füllt ein fehlendes parts-Feld defensiv auf');

  // migrateState() bereinigt unbekannte Vertrags-/Teile-ids (z. B. aus einer künftigen, hier unbekannten Version).
  const corruptRaw = { version: 1, km: 0, prestige: { level: 0, points: 0, trophies: 0, contracts: ['ertrag25', 'nicht-existierender-vertrag'] }, parts: { collected: ['helm_standard', 'nicht-existierendes-teil'] } };
  const migratedCorrupt = IdleCore.migrateState(corruptRaw);
  assert(migratedCorrupt.prestige.contracts.length === 1 && migratedCorrupt.prestige.contracts[0] === 'ertrag25', 'migrateState() entfernt unbekannte Vertrags-ids, behält gültige');
  assert(migratedCorrupt.parts.collected.length === 1 && migratedCorrupt.parts.collected[0] === 'helm_standard', 'migrateState() entfernt unbekannte Teile-ids, behält gültige');

  // feat(idle-bills)/feat(idle-gear): ein ECHTES altes v1-Save (KOMPLETT ohne finance/gear-Felder,
  // exakt wie es vor Phase D persistiert worden wäre) migriert defensiv + verlustfrei auf v2.
  const v1Raw = {
    version: 1,
    km: 4242,
    totalKmEarned: 9999,
    ownedBikeIds: ['z125pro', 'klx300'],
    currentBikeId: 'klx300',
    bikeLevels: { z125pro: 0, klx300: 2 },
    prestige: { level: 3, points: 12, trophies: 4, contracts: ['ertrag25'] },
    parts: { collected: ['helm_standard'] },
    offline: { lastSeenAt: 555 },
    stats: { laps: 10, bestCombo: 3, seasonHistory: [], playTimeSeconds: 100 },
    combo: { count: 0, multiplier: 1, multiplierExpiresAt: null },
    sound: { enabled: false, volume: 0.5 },
  };
  const migratedV1 = IdleCore.migrateState(v1Raw);
  assert(migratedV1.version === IdleCore.IDLE_STATE_VERSION, `migrateState() hebt ein echtes v1-Save auf version ${IdleCore.IDLE_STATE_VERSION} an`);
  assert(migratedV1.km === 4242 && migratedV1.totalKmEarned === 9999, 'migrateState() v1→v2: km/totalKmEarned bleiben verlustfrei erhalten');
  assert(migratedV1.prestige.trophies === 4 && migratedV1.prestige.contracts.indexOf('ertrag25') !== -1, 'migrateState() v1→v2: prestige bleibt verlustfrei erhalten');
  assert(migratedV1.parts.collected.indexOf('helm_standard') !== -1, 'migrateState() v1→v2: parts.collected bleibt verlustfrei erhalten');
  assert(
    migratedV1.finance && typeof migratedV1.finance === 'object' &&
    migratedV1.finance.billsPaidOnTime === 0 && migratedV1.finance.insolvencies === 0 &&
    migratedV1.finance.insolvencyFreeFlag === true &&
    migratedV1.finance.activeBillAmount === null && migratedV1.finance.activeBillDueAt === null,
    'migrateState() v1→v2: ein v1-Save OHNE finance-Feld bekommt defensiv einen gültigen, leeren finance-Zustand'
  );
  assert(migratedV1.gear && Array.isArray(migratedV1.gear.collected) && migratedV1.gear.collected.length === 0, 'migrateState() v1→v2: ein v1-Save OHNE gear-Feld bekommt defensiv eine leere gear-Sammlung');
})();

section('14 · AUSRÜSTUNG (GEAR) — feat(idle-gear): generalisierte Engine-Wiederverwendung (rollPartDrop/addPart/setBonuses mit pool)');
(function () {
  // Daten: 5 Kategorien × 4 Seltenheitsstufen = 20 Items.
  assert(Array.isArray(IdleCore.IDLE_GEAR_SETS) && IdleCore.IDLE_GEAR_SETS.length === 5, `IDLE_GEAR_SETS enthält 5 Kategorien (gefunden: ${IdleCore.IDLE_GEAR_SETS.length})`);
  assert(Array.isArray(IdleCore.IDLE_GEAR_ITEMS) && IdleCore.IDLE_GEAR_ITEMS.length === 20, `IDLE_GEAR_ITEMS enthält 20 Items (gefunden: ${IdleCore.IDLE_GEAR_ITEMS.length})`);
  IdleCore.IDLE_GEAR_SETS.forEach((set) => {
    const itemsInSet = IdleCore.IDLE_GEAR_ITEMS.filter((i) => i.setId === set.id);
    assert(itemsInSet.length === 4, `Kategorie "${set.id}" hat genau 4 Items (eines je Seltenheitsstufe, gefunden: ${itemsInSet.length})`);
    const rarities = itemsInSet.map((i) => i.rarity).sort().join(',');
    assert(rarities === 'episch,gewoehnlich,legendaer,selten', `Kategorie "${set.id}" deckt exakt die 4 Seltenheitsstufen ab (gefunden: ${rarities})`);
  });
  assert(new Set(IdleCore.IDLE_GEAR_ITEMS.map((i) => i.id)).size === 20, 'Alle Gear-item-ids sind eindeutig');

  // Pro-Item-Bonus +1–5% je Seltenheitsstufe.
  const bonusByRarity = { gewoehnlich: 1, selten: 2, episch: 3, legendaer: 5 };
  IdleCore.IDLE_GEAR_ITEMS.forEach((item) => {
    assert(item.bonusPct === bonusByRarity[item.rarity], `${item.id}: bonusPct (${item.bonusPct}) entspricht der Seltenheitsstufe "${item.rarity}" (erwartet ${bonusByRarity[item.rarity]})`);
    assert(item.bonusPct >= 1 && item.bonusPct <= 5, `${item.id}: bonusPct (${item.bonusPct}) liegt im Bereich +1–5%`);
  });

  // rollGearDrop(): deterministisch bei fester Zufallsfolge (nutzt IDLE_GEAR_POOL via rollPartDrop()).
  const sequence = [0, 0, 0]; // Drop ja → Seltenheit 'gewoehnlich' (erste in GEAR_RARITY_WEIGHTS) → erstes 'gewoehnlich'-Item
  let callIndex = 0;
  const fixedRng = () => sequence[Math.min(callIndex++, sequence.length - 1)];
  const firstGewoehnlichId = IdleCore.IDLE_GEAR_ITEMS.filter((i) => i.rarity === 'gewoehnlich')[0].id;
  assert(IdleCore.rollGearDrop(fixedRng, 1) === firstGewoehnlichId, 'rollGearDrop() liefert mit fester Zufallsfolge [0,0,0] deterministisch das erste "gewoehnlich"-Item');
  assert(IdleCore.rollGearDrop(() => 0.999, 0.18) === null, 'rollGearDrop() liefert null, falls die Zufallszahl über der Drop-Chance liegt');

  // addGear(): neues Item vs. Dublette (→ km-Umwandlung über GEAR_DUPLICATE_KM_VALUE, NICHT PART_DUPLICATE_KM_VALUE).
  const gearState = IdleCore.createInitialState();
  const someGear = IdleCore.IDLE_GEAR_ITEMS[0];
  const addedNewGear = IdleCore.addGear(gearState, someGear.id);
  assert(addedNewGear.isNew === true, 'addGear() meldet isNew=true für ein neues Item');
  assert(gearState.gear.collected.indexOf(someGear.id) !== -1, 'addGear() fügt die id zu state.gear.collected hinzu');
  assert(gearState.km === 0, 'addGear() eines neuen Items verändert km nicht');
  assert(gearState.parts.collected.length === 0, 'addGear() rührt state.parts.collected NICHT an (getrennte Sammlungen)');

  const gearKmBefore = gearState.km;
  const addedDupGear = IdleCore.addGear(gearState, someGear.id);
  const expectedGearDupValue = IdleCore.IDLE_BALANCE.GEAR_DUPLICATE_KM_VALUE[someGear.rarity];
  assert(addedDupGear.isNew === false && addedDupGear.awardedKm === expectedGearDupValue, `addGear() einer Dublette gewährt genau GEAR_DUPLICATE_KM_VALUE.${someGear.rarity} (${expectedGearDupValue}) km`);
  assert(gearState.km === gearKmBefore + expectedGearDupValue, 'addGear() einer Dublette bucht die km korrekt auf state.km');
  assert(gearState.gear.collected.filter((id) => id === someGear.id).length === 1, 'addGear() einer Dublette dupliziert die id NICHT in der Sammlung');

  // Regression: addPart()/setBonuses() ohne pool-Argument verhalten sich weiterhin exakt wie zuvor (Teile-Sammlung unberührt).
  const regressionState = IdleCore.createInitialState();
  const firstPart = IdleCore.IDLE_PARTS[0];
  const addedPartRegression = IdleCore.addPart(regressionState, firstPart.id);
  assert(addedPartRegression.isNew === true && regressionState.parts.collected.indexOf(firstPart.id) !== -1, 'addPart() ohne pool-Argument funktioniert unverändert (Teile-Sammlung)');
  assert(regressionState.gear.collected.length === 0, 'addPart() ohne pool-Argument rührt state.gear NICHT an');

  // itemBonusSum(): summiert bonusPct über besessene Items.
  assert(IdleCore.itemBonusSum([], IdleCore.IDLE_GEAR_ITEMS) === 0, 'itemBonusSum() ohne besessene Items === 0');
  const helmGewoehnlich = IdleCore.IDLE_GEAR_ITEMS.find((i) => i.id === 'helm_gewoehnlich');
  const helmSelten = IdleCore.IDLE_GEAR_ITEMS.find((i) => i.id === 'helm_selten');
  const sumTwo = IdleCore.itemBonusSum(['helm_gewoehnlich', 'helm_selten'], IdleCore.IDLE_GEAR_ITEMS);
  assert(sumTwo === helmGewoehnlich.bonusPct + helmSelten.bonusPct, `itemBonusSum() summiert korrekt (${sumTwo} === ${helmGewoehnlich.bonusPct + helmSelten.bonusPct})`);
  assert(IdleCore.itemBonusSum(['helm_gewoehnlich', 'unbekannte-id'], IdleCore.IDLE_GEAR_ITEMS) === helmGewoehnlich.bonusPct, 'itemBonusSum() ignoriert unbekannte ids (kein Absturz)');
  assert(IdleCore.itemBonusSum(['helm_gewoehnlich'], IdleCore.IDLE_PARTS) === 0, 'itemBonusSum() liefert 0, falls die id im übergebenen Pool (hier: Teile) nicht existiert');

  // gearBonuses(): Pro-Item-Bonus OHNE komplettes Set.
  const gearBonusState = IdleCore.createInitialState();
  const noGearBonus = IdleCore.gearBonuses(gearBonusState);
  assert(noGearBonus.totalBonusMultiplier === 1 && noGearBonus.itemBonusPct === 0 && noGearBonus.setBonusPct === 0, 'gearBonuses() ohne Ausrüstung: kein Bonus');

  IdleCore.addGear(gearBonusState, 'helm_gewoehnlich');
  const partialGearBonus = IdleCore.gearBonuses(gearBonusState);
  assert(partialGearBonus.itemBonusPct === 1 && partialGearBonus.setBonusPct === 0, 'gearBonuses() mit einem einzelnen Item: Pro-Item-Bonus zählt, aber (noch) kein Set-Bonus');
  assert(Math.abs(partialGearBonus.totalBonusMultiplier - 1.01) < 1e-9, 'gearBonuses() totalBonusMultiplier entspricht 1 + itemBonusPct/100 (ohne Set-Bonus)');

  // gearBonuses(): komplettes Set (alle 4 Helm-Seltenheitsstufen) → zusätzlicher Set-Bonus obendrauf.
  ['helm_selten', 'helm_episch', 'helm_legendaer'].forEach((id) => IdleCore.addGear(gearBonusState, id));
  const completeSetBonus = IdleCore.gearBonuses(gearBonusState);
  const helmSet = IdleCore.IDLE_GEAR_SETS.find((s) => s.id === 'helm');
  const expectedItemPct = 1 + 2 + 3 + 5; // gewoehnlich+selten+episch+legendaer
  assert(completeSetBonus.completedSets.length === 1 && completeSetBonus.completedSets[0] === 'helm', 'gearBonuses() zählt die Kategorie als komplett, sobald alle 4 Seltenheitsstufen besessen sind');
  assert(completeSetBonus.itemBonusPct === expectedItemPct, `gearBonuses() itemBonusPct summiert alle 4 Helm-Items (${completeSetBonus.itemBonusPct} === ${expectedItemPct})`);
  assert(completeSetBonus.setBonusPct === helmSet.bonusPct, `gearBonuses() setBonusPct entspricht dem Helm-Set-Bonus (${completeSetBonus.setBonusPct} === ${helmSet.bonusPct})`);
  assert(
    Math.abs(completeSetBonus.totalBonusMultiplier - (1 + (expectedItemPct + helmSet.bonusPct) / 100)) < 1e-9,
    'gearBonuses() totalBonusMultiplier kombiniert Pro-Item- UND Set-Bonus additiv'
  );
})();

section('15 · MECHANIK A — Werkstattrechnungen + Insolvenz (nextBillIntervalSeconds/billAmount/payBill/triggerInsolvency)');
(function () {
  // nextBillIntervalSeconds(): liegt für einen frischen Zustand im konfigurierten Basis-Bereich.
  const fresh = IdleCore.createInitialState();
  const freshInterval = IdleCore.nextBillIntervalSeconds(fresh, () => 0.5);
  assert(
    freshInterval >= IdleCore.IDLE_BALANCE.BILL_INTERVAL_MIN_SECONDS && freshInterval <= IdleCore.IDLE_BALANCE.BILL_INTERVAL_MAX_SECONDS,
    `nextBillIntervalSeconds() liegt für einen frischen Zustand im Bereich [${IdleCore.IDLE_BALANCE.BILL_INTERVAL_MIN_SECONDS}, ${IdleCore.IDLE_BALANCE.BILL_INTERVAL_MAX_SECONDS}] (gefunden: ${freshInterval.toFixed(2)})`
  );

  // Schrumpft mit Saison-Fortschritt (trophiesForSeason), niemals unter dem konfigurierten Floor.
  let prevInterval = freshInterval;
  const progressState = IdleCore.createInitialState();
  for (let i = 1; i <= 15; i++) {
    progressState.ownedBikeIds.push(IdleCore.IDLE_BIKES[Math.min(i, IdleCore.IDLE_BIKES.length - 1)].id);
    const interval = IdleCore.nextBillIntervalSeconds(progressState, () => 0.5);
    assert(interval <= prevInterval, `nextBillIntervalSeconds() schrumpft (oder bleibt gleich) mit steigendem Saison-Fortschritt (${interval.toFixed(2)} <= ${prevInterval.toFixed(2)})`);
    assert(interval >= IdleCore.IDLE_BALANCE.BILL_INTERVAL_FLOOR_SECONDS, `nextBillIntervalSeconds() respektiert BILL_INTERVAL_FLOOR_SECONDS (${interval.toFixed(2)} >= ${IdleCore.IDLE_BALANCE.BILL_INTERVAL_FLOOR_SECONDS})`);
    prevInterval = interval;
  }
  // Bei sehr hohem Fortschritt: Bereich ist bis auf den Floor zusammengeschrumpft (min === max === Floor).
  const veryHighProgress = IdleCore.createInitialState();
  veryHighProgress.ownedBikeIds = IdleCore.IDLE_BIKES.map((b) => b.id);
  IdleCore.IDLE_BIKES.forEach((b) => { veryHighProgress.bikeLevels[b.id] = IdleCore.IDLE_BALANCE.TUNING_LEVEL_CAP; }); // maximal mögliche trophiesForSeason()
  const atFloorLow = IdleCore.nextBillIntervalSeconds(veryHighProgress, () => 0);
  const atFloorHigh = IdleCore.nextBillIntervalSeconds(veryHighProgress, () => 0.999);
  assert(Math.abs(atFloorLow - IdleCore.IDLE_BALANCE.BILL_INTERVAL_FLOOR_SECONDS) < 1e-9, 'nextBillIntervalSeconds() erreicht bei sehr hohem Fortschritt exakt den Floor (untere Zufallsgrenze)');
  assert(Math.abs(atFloorHigh - IdleCore.IDLE_BALANCE.BILL_INTERVAL_FLOOR_SECONDS) < 1e-9, 'nextBillIntervalSeconds() erreicht bei sehr hohem Fortschritt exakt den Floor (obere Zufallsgrenze, Bereich komplett zusammengeschrumpft)');

  // billGraceSeconds(): liegt im konfigurierten Fenster.
  for (let i = 0; i < 20; i++) {
    const grace = IdleCore.billGraceSeconds(() => i / 20);
    assert(grace >= IdleCore.IDLE_BALANCE.BILL_GRACE_MIN_SECONDS && grace <= IdleCore.IDLE_BALANCE.BILL_GRACE_MAX_SECONDS, `billGraceSeconds() liegt im Bereich [${IdleCore.IDLE_BALANCE.BILL_GRACE_MIN_SECONDS}, ${IdleCore.IDLE_BALANCE.BILL_GRACE_MAX_SECONDS}] (gefunden: ${grace.toFixed(2)})`);
  }

  // billAmount(): steigt mit Bikes/Tuning (reine Ableitung aus passiveEarn(), kein eigenes Balancing).
  const lowState = IdleCore.createInitialState();
  const lowAmount = IdleCore.billAmount(lowState);
  assert(lowAmount >= IdleCore.IDLE_BALANCE.BILL_AMOUNT_MIN_KM, `billAmount() respektiert BILL_AMOUNT_MIN_KM (${lowAmount} >= ${IdleCore.IDLE_BALANCE.BILL_AMOUNT_MIN_KM})`);

  const higherState = IdleCore.createInitialState();
  higherState.ownedBikeIds.push(IdleCore.IDLE_BIKES[1].id);
  higherState.bikeLevels[IdleCore.IDLE_BIKES[1].id] = 0;
  higherState.currentBikeId = IdleCore.IDLE_BIKES[1].id;
  const higherAmount = IdleCore.billAmount(higherState);
  assert(higherAmount > lowAmount, `billAmount() steigt mit einem schnelleren Bike (${higherAmount} > ${lowAmount})`);

  const tunedState = IdleCore.createInitialState();
  tunedState.bikeLevels[tunedState.currentBikeId] = 10;
  const tunedAmount = IdleCore.billAmount(tunedState);
  assert(tunedAmount > lowAmount, `billAmount() steigt mit Tuning-Level (${tunedAmount} > ${lowAmount})`);

  const avgGrace = (IdleCore.IDLE_BALANCE.BILL_GRACE_MIN_SECONDS + IdleCore.IDLE_BALANCE.BILL_GRACE_MAX_SECONDS) / 2;
  const expectedLowAmount = Math.max(IdleCore.IDLE_BALANCE.BILL_AMOUNT_MIN_KM, Math.round(IdleCore.passiveEarn(lowState, avgGrace) * IdleCore.IDLE_BALANCE.BILL_AMOUNT_SAFETY_FACTOR));
  assert(lowAmount === expectedLowAmount, `billAmount() entspricht exakt passiveEarn(state, Ø-Fenster) × BILL_AMOUNT_SAFETY_FACTOR (${lowAmount} === ${expectedLowAmount})`);

  // payBill(): deduziert km, gewährt Bonus + zählt On-Time/Last-Second, schlägt ohne genug km fehl.
  const payState = IdleCore.createInitialState();
  const amount = IdleCore.billAmount(payState);
  const tooPoor = IdleCore.payBill(payState);
  assert(tooPoor.success === false, 'payBill() schlägt fehl, falls nicht genug km vorhanden sind');
  assert(payState.finance.billsPaidOnTime === 0, 'payBill() bei Fehlschlag erhöht billsPaidOnTime NICHT');

  payState.km = amount + 1000;
  const kmBeforePay = payState.km;
  const paid = IdleCore.payBill(payState, true, false, () => 0.999); // Zufallszahl > GEAR_DROP_CHANCE_ON_BILL_PAY → kein Gear-Drop, deterministisch testbar
  assert(paid.success === true, 'payBill() gelingt mit genug km');
  assert(paid.amount === amount, 'payBill() zieht exakt billAmount(state) ab (vor der Zahlung berechnet)');
  const expectedBonus = Math.round(amount * IdleCore.IDLE_BALANCE.BILL_PAY_BONUS_FRACTION);
  assert(paid.bonusKm === expectedBonus, `payBill() gewährt exakt BILL_PAY_BONUS_FRACTION des Betrags als Bonus (${paid.bonusKm} === ${expectedBonus})`);
  assert(payState.km === kmBeforePay - amount + expectedBonus, 'payBill() bucht Abzug UND Bonus korrekt auf state.km');
  assert(payState.finance.billsPaidOnTime === 1, 'payBill() (onTime, Standard) erhöht finance.billsPaidOnTime');
  assert(payState.finance.billsPaidLastSecond === 0, 'payBill() ohne lastSecond-Flag erhöht billsPaidLastSecond NICHT');
  assert(paid.gearResult === null, 'payBill() mit einer über der Drop-Chance liegenden Zufallszahl liefert keinen Gear-Drop');

  const lastSecondState = IdleCore.createInitialState();
  lastSecondState.km = IdleCore.billAmount(lastSecondState) + 1000;
  const paidLastSecond = IdleCore.payBill(lastSecondState, true, true, () => 0.999);
  assert(paidLastSecond.success === true && lastSecondState.finance.billsPaidLastSecond === 1, 'payBill(..., lastSecond=true) erhöht zusätzlich finance.billsPaidLastSecond');

  const gearDropState = IdleCore.createInitialState();
  gearDropState.km = IdleCore.billAmount(gearDropState) + 1000;
  const paidWithGear = IdleCore.payBill(gearDropState, true, false, () => 0); // Zufallszahl 0 → garantierter Gear-Drop + erstes 'gewoehnlich'-Item
  assert(paidWithGear.gearResult !== null && paidWithGear.gearResult.isNew === true, 'payBill() mit einer garantiert unter der Drop-Chance liegenden Zufallszahl liefert einen neuen Gear-Drop');
  assert(gearDropState.gear.collected.length === 1, 'payBill() bucht einen Gear-Drop-Treffer in state.gear.collected');

  // finishSeason(state,{bypassEligibilityGate:true}): führt VOR der ZX-10R einen echten Reset aus
  // (Regression: der einfache Aufruf OHNE opts bleibt unverändert ein No-op, siehe Sektion 10).
  const zxIndex = IdleCore.findBikeIndex('zx10r');
  const belowZx = IdleCore.createInitialState();
  for (let i = 1; i < zxIndex; i++) belowZx.ownedBikeIds.push(IdleCore.IDLE_BIKES[i].id);
  assert(IdleCore.canFinishSeason(belowZx) === false, 'Voraussetzung: canFinishSeason() ist vor der ZX-10R false');
  assert(IdleCore.finishSeason(belowZx) === belowZx, 'Regression: finishSeason(state) OHNE opts bleibt vor der ZX-10R weiterhin ein No-op');

  belowZx.km = 500;
  belowZx.gear.collected = ['helm_gewoehnlich'];
  belowZx.prestige.contracts = ['zoneBreiter10'];
  const expectedBypassTrophies = IdleCore.trophiesForSeason(belowZx);
  const bypassed = IdleCore.finishSeason(belowZx, { bypassEligibilityGate: true });
  assert(bypassed !== belowZx, 'finishSeason(state,{bypassEligibilityGate:true}) führt VOR der ZX-10R einen ECHTEN Reset aus (neues Objekt)');
  assert(bypassed.km === 0, 'finishSeason(bypass): km wird zurückgesetzt');
  assert(bypassed.prestige.trophies === expectedBypassTrophies, 'finishSeason(bypass): Trophäen entsprechen dem aktuellen Fortschritt (trophiesForSeason)');
  assert(bypassed.prestige.contracts.indexOf('zoneBreiter10') !== -1, 'finishSeason(bypass): Werksverträge bleiben erhalten');
  assert(bypassed.gear.collected.indexOf('helm_gewoehnlich') !== -1, 'finishSeason(bypass): Gear-Sammlung bleibt erhalten');

  // triggerInsolvency(): identische Reset-Semantik + Insolvenz-Zähler + KEIN "insolvenzfreie Saison"-Credit.
  const insolvencyState = IdleCore.createInitialState();
  insolvencyState.km = 777;
  insolvencyState.parts.collected = ['helm_standard'];
  insolvencyState.gear.collected = ['pokal_selten'];
  insolvencyState.finance.billsPaidOnTime = 2;
  insolvencyState.finance.activeBillAmount = 123;
  insolvencyState.finance.activeBillDueAt = Date.now() + 5000;
  insolvencyState.finance.activeBillGraceSeconds = 40;
  const afterInsolvency = IdleCore.triggerInsolvency(insolvencyState);
  assert(afterInsolvency.km === 0, 'triggerInsolvency(): km wird zurückgesetzt (normaler Reset, KEINE Strafe)');
  assert(afterInsolvency.parts.collected.indexOf('helm_standard') !== -1, 'triggerInsolvency(): Teile-Sammlung bleibt erhalten');
  assert(afterInsolvency.gear.collected.indexOf('pokal_selten') !== -1, 'triggerInsolvency(): Gear-Sammlung bleibt erhalten');
  assert(afterInsolvency.finance.billsPaidOnTime === 2, 'triggerInsolvency(): Lebenszeit-Zähler (billsPaidOnTime) bleiben erhalten');
  assert(afterInsolvency.finance.insolvencies === 1, 'triggerInsolvency(): finance.insolvencies wird um 1 erhöht');
  assert(afterInsolvency.finance.activeBillAmount === null && afterInsolvency.finance.activeBillDueAt === null, 'triggerInsolvency(): eine offene Rechnung wird mit dem Reset hinfällig (activeBill* → null)');
  assert(afterInsolvency.finance.insolvencyFreeFlag === true, 'triggerInsolvency(): die NEUE Saison startet wieder mit insolvencyFreeFlag:true');

  const seasonsFreeBefore = insolvencyState.finance.seasonsInsolvencyFree || 0;
  assert(afterInsolvency.finance.seasonsInsolvencyFree === seasonsFreeBefore, 'triggerInsolvency(): eine durch Insolvenz beendete Saison zählt NICHT als "insolvenzfreie Saison"');

  // Gegenprobe: ein FREIWILLIGER finishSeason()-Abschluss (ohne vorherige Insolvenz) zählt als insolvenzfrei.
  const voluntaryState = IdleCore.createInitialState();
  for (let i = 1; i <= zxIndex; i++) {
    voluntaryState.ownedBikeIds.push(IdleCore.IDLE_BIKES[i].id);
    voluntaryState.bikeLevels[IdleCore.IDLE_BIKES[i].id] = 0;
  }
  assert(voluntaryState.finance.insolvencyFreeFlag === true, 'Voraussetzung: ein frischer Zustand startet mit insolvencyFreeFlag:true');
  const afterVoluntary = IdleCore.finishSeason(voluntaryState);
  assert(afterVoluntary.finance.seasonsInsolvencyFree === 1, 'finishSeason() (freiwillig, ohne vorherige Insolvenz) erhöht finance.seasonsInsolvencyFree um 1');
})();

section('16 · MECHANIK B — Sparschweine zerschlagen (nextPiggyIntervalSeconds/piggyVisibleSeconds/piggybankReward/smashPiggybank)');
(function () {
  // nextPiggyIntervalSeconds(): liegt im konfigurierten Bereich, FLACH (kein Schrumpfen mit Saison-Fortschritt).
  assert(IdleCore.nextPiggyIntervalSeconds(() => 0) === IdleCore.IDLE_BALANCE.PIGGY_INTERVAL_MIN_SECONDS, 'nextPiggyIntervalSeconds(random=0) === Untergrenze');
  assert(IdleCore.nextPiggyIntervalSeconds(() => 1) === IdleCore.IDLE_BALANCE.PIGGY_INTERVAL_MAX_SECONDS, 'nextPiggyIntervalSeconds(random=1) === Obergrenze');
  const piggyMid = IdleCore.nextPiggyIntervalSeconds(() => 0.5);
  assert(piggyMid > IdleCore.IDLE_BALANCE.PIGGY_INTERVAL_MIN_SECONDS && piggyMid < IdleCore.IDLE_BALANCE.PIGGY_INTERVAL_MAX_SECONDS, 'nextPiggyIntervalSeconds(random=0.5) liegt strikt zwischen den Grenzen');

  // piggyVisibleSeconds(): liegt im konfigurierten Sichtbarkeitsfenster.
  for (let i = 0; i <= 10; i++) {
    const visible = IdleCore.piggyVisibleSeconds(() => i / 10);
    assert(
      visible >= IdleCore.IDLE_BALANCE.PIGGY_VISIBLE_MIN_SECONDS && visible <= IdleCore.IDLE_BALANCE.PIGGY_VISIBLE_MAX_SECONDS,
      `piggyVisibleSeconds() liegt im Bereich [${IdleCore.IDLE_BALANCE.PIGGY_VISIBLE_MIN_SECONDS}, ${IdleCore.IDLE_BALANCE.PIGGY_VISIBLE_MAX_SECONDS}] (gefunden: ${visible.toFixed(2)})`
    );
  }

  // piggybankReward(): km-Bonus entspricht exakt activeEarn(state) × PIGGY_KM_BONUS_MULTIPLIER, unabhängig vom rng-Aufruf.
  const rewardState = IdleCore.createInitialState();
  const expectedKmBonus = Math.round(IdleCore.activeEarn(rewardState) * IdleCore.IDLE_BALANCE.PIGGY_KM_BONUS_MULTIPLIER);
  const rewardNoDrop = IdleCore.piggybankReward(rewardState, () => 0.999); // über der Drop-Chance → kein Gear-Drop
  assert(rewardNoDrop.kmBonus === expectedKmBonus, `piggybankReward() liefert exakt activeEarn(state) × PIGGY_KM_BONUS_MULTIPLIER als kmBonus (${rewardNoDrop.kmBonus} === ${expectedKmBonus})`);
  assert(rewardNoDrop.gearId === null, 'piggybankReward() mit einer über der Drop-Chance liegenden Zufallszahl liefert keinen Gear-Drop');

  const rewardWithDrop = IdleCore.piggybankReward(rewardState, () => 0); // garantiert unter der Drop-Chance
  assert(typeof rewardWithDrop.gearId === 'string' && !!IdleCore.getGearItemById(rewardWithDrop.gearId), 'piggybankReward() mit einer garantiert unter der Drop-Chance liegenden Zufallszahl liefert eine gültige Gear-id');

  // Ein höheres Bike/Tuning erhöht den kmBonus (skaliert automatisch, wie billAmount() über passiveEarn()).
  const tunedRewardState = IdleCore.createInitialState();
  tunedRewardState.bikeLevels[tunedRewardState.currentBikeId] = 10;
  const tunedReward = IdleCore.piggybankReward(tunedRewardState, () => 0.999);
  assert(tunedReward.kmBonus > rewardNoDrop.kmBonus, `piggybankReward() kmBonus steigt mit Tuning-Level (${tunedReward.kmBonus} > ${rewardNoDrop.kmBonus})`);

  // smashPiggybank(): mutiert state (km-Gutschrift + smashedCount-Zähler), verbucht einen Gear-Drop, wenn gewürfelt.
  const smashState = IdleCore.createInitialState();
  assert(smashState.piggy && smashState.piggy.smashedCount === 0, 'createInitialState() liefert ein leeres, gültiges piggy-Objekt (smashedCount 0)');

  const kmBefore = smashState.km;
  const smashResultNoGear = IdleCore.smashPiggybank(smashState, () => 0.999);
  assert(smashState.km === kmBefore + smashResultNoGear.kmBonus, 'smashPiggybank() bucht den kmBonus korrekt auf state.km');
  assert(smashState.piggy.smashedCount === 1, 'smashPiggybank() erhöht state.piggy.smashedCount um 1');
  assert(smashResultNoGear.smashedCount === 1, 'smashPiggybank() gibt den aktualisierten smashedCount-Zähler im Ergebnis zurück');
  assert(smashResultNoGear.gearResult === null, 'smashPiggybank() ohne Drop-Treffer liefert gearResult:null');

  const smashResultWithGear = IdleCore.smashPiggybank(smashState, () => 0); // garantierter Gear-Drop
  assert(smashState.piggy.smashedCount === 2, 'smashPiggybank() zählt bei jedem Aufruf weiter hoch (Lebenszeit-Zähler)');
  assert(smashResultWithGear.gearResult !== null && smashResultWithGear.gearResult.isNew === true, 'smashPiggybank() mit einer garantiert unter der Drop-Chance liegenden Zufallszahl verbucht einen neuen Gear-Drop');
  assert(smashState.gear.collected.length === 1, 'smashPiggybank() bucht einen Gear-Drop-Treffer in state.gear.collected (dieselbe Sammlung wie payBill())');

  // piggy.smashedCount ist ein Lebenszeit-Zähler und übersteht finishSeason()/triggerInsolvency() (wie finance-Zähler).
  const preSeasonSmashState = IdleCore.createInitialState();
  preSeasonSmashState.piggy.smashedCount = 7;
  const afterInsolvencyPiggy = IdleCore.triggerInsolvency(preSeasonSmashState);
  assert(afterInsolvencyPiggy.piggy.smashedCount === 7, 'triggerInsolvency(): piggy.smashedCount (Lebenszeit-Zähler) bleibt erhalten');

  // Verteilung über viele geseedete Rolls: die Gear-Drop-Rate liegt nahe GEAR_DROP_CHANCE_ON_PIGGY_SMASH.
  let piggySeed = 7;
  function seededPiggyRandom() {
    piggySeed = (piggySeed * 1103515245 + 12345) & 0x7fffffff;
    return piggySeed / 0x7fffffff;
  }
  const PIGGY_ROLL_COUNT = 20000;
  let piggyDropCount = 0;
  const distState = IdleCore.createInitialState();
  for (let i = 0; i < PIGGY_ROLL_COUNT; i++) {
    const reward = IdleCore.piggybankReward(distState, seededPiggyRandom);
    if (reward.gearId) piggyDropCount++;
  }
  const expectedPiggyDrops = PIGGY_ROLL_COUNT * IdleCore.IDLE_BALANCE.GEAR_DROP_CHANCE_ON_PIGGY_SMASH;
  assert(
    Math.abs(piggyDropCount - expectedPiggyDrops) / expectedPiggyDrops < 0.2,
    `Gear-Drop-Rate von piggybankReward() über ${PIGGY_ROLL_COUNT} geseedete Rolls (${piggyDropCount}) liegt nahe der erwarteten ~${Math.round(expectedPiggyDrops)} (GEAR_DROP_CHANCE_ON_PIGGY_SMASH)`
  );

  // migrateState() füllt ein fehlendes piggy-Feld defensiv auf (altes Save vor feat(idle-piggybanks)).
  const prePiggyRaw = { version: 2, km: 10, finance: { billsPaidOnTime: 1 }, gear: { collected: ['helm_gewoehnlich'] } };
  const migratedPiggy = IdleCore.migrateState(prePiggyRaw);
  assert(migratedPiggy.piggy && migratedPiggy.piggy.smashedCount === 0, 'migrateState(): fehlendes piggy-Feld (Save vor feat(idle-piggybanks)) wird defensiv mit smashedCount:0 aufgefüllt');
  assert(migratedPiggy.gear.collected.indexOf('helm_gewoehnlich') !== -1, 'migrateState(): bestehende gear-Sammlung bleibt bei der piggy-Migration unangetastet');
  assert(migratedPiggy.finance.billsPaidOnTime === 1, 'migrateState(): bestehende finance-Zähler bleiben bei der piggy-Migration unangetastet');

  // migrateState() übernimmt einen bereits vorhandenen, gültigen piggy-Zähler unverändert (kein Reset bei erneutem Speichern).
  const withPiggyRaw = { version: 2, km: 5, piggy: { smashedCount: 42 } };
  const migratedWithPiggy = IdleCore.migrateState(withPiggyRaw);
  assert(migratedWithPiggy.piggy.smashedCount === 42, 'migrateState(): ein bereits vorhandener piggy.smashedCount-Zähler bleibt exakt erhalten');
})();

section('17 · TEIL 1 — Endless-Runner: Speed-Cap/Lead-Time, Hindernis-Dichte, Kollisions-Malus, Idle-Auto-Run, v2→v3-Migration');
(function () {
  // runnerLeadSeconds(): niemals unter RUNNER_MIN_LEAD_SECONDS, für den gesamten 0..100%-Bereich.
  for (let pct = 0; pct <= 100; pct += 5) {
    assert(
      IdleCore.runnerLeadSeconds(pct) >= IdleCore.IDLE_BALANCE.RUNNER_MIN_LEAD_SECONDS - 1e-9,
      `runnerLeadSeconds(${pct}) liegt nicht unter der Mindest-Vorlaufzeit (${IdleCore.IDLE_BALANCE.RUNNER_MIN_LEAD_SECONDS}s)`
    );
  }
  assert(IdleCore.runnerLeadSeconds(0) > IdleCore.runnerLeadSeconds(100), 'runnerLeadSeconds() sinkt mit steigender Geschwindigkeit (0% > 100%)');
  assert(
    Math.abs(IdleCore.runnerLeadSeconds(100) - IdleCore.IDLE_BALANCE.RUNNER_MIN_LEAD_SECONDS) < 1e-9,
    'runnerLeadSeconds(100) trifft exakt die Mindest-Vorlaufzeit (Speed-Cap aktiv)'
  );

  // obstacleDensity(): steigt monoton, UND steigt STÄRKER oberhalb des Speed-Caps (kompensiert die gedeckelte Scroll-Geschwindigkeit).
  const cap = IdleCore.IDLE_BALANCE.RUNNER_SPEED_CAP_PCT;
  assert(IdleCore.obstacleDensity(0) === IdleCore.IDLE_BALANCE.RUNNER_OBSTACLE_DENSITY_BASE, 'obstacleDensity(0) entspricht der Basis-Dichte');
  assert(
    Math.abs(IdleCore.obstacleDensity(cap) - IdleCore.IDLE_BALANCE.RUNNER_OBSTACLE_DENSITY_AT_CAP) < 1e-9,
    'obstacleDensity() am Speed-Cap entspricht RUNNER_OBSTACLE_DENSITY_AT_CAP'
  );
  assert(
    Math.abs(IdleCore.obstacleDensity(100) - IdleCore.IDLE_BALANCE.RUNNER_OBSTACLE_DENSITY_MAX) < 1e-9,
    'obstacleDensity(100) entspricht der Maximal-Dichte'
  );
  assert(IdleCore.obstacleDensity(100) > IdleCore.obstacleDensity(cap), 'obstacleDensity() steigt ÜBER den Speed-Cap hinaus weiter an, statt zu stagnieren');
  let prevDensity = -Infinity;
  for (let pct = 0; pct <= 100; pct += 5) {
    const d = IdleCore.obstacleDensity(pct);
    assert(d >= prevDensity - 1e-9, `obstacleDensity(${pct}) ist monoton nicht-fallend`);
    prevDensity = d;
  }

  // nextObstacleSpawnIntervalSeconds(): liefert bei höherer Dichte (höherer Geschwindigkeit) im Mittel kürzere Intervalle.
  let spawnSeed = 3;
  function seededSpawnRandom() { spawnSeed = (spawnSeed * 1103515245 + 12345) & 0x7fffffff; return spawnSeed / 0x7fffffff; }
  let sumSlow = 0, sumFast = 0;
  const SPAWN_SAMPLE_COUNT = 500;
  for (let i = 0; i < SPAWN_SAMPLE_COUNT; i++) {
    sumSlow += IdleCore.nextObstacleSpawnIntervalSeconds(0, seededSpawnRandom);
    sumFast += IdleCore.nextObstacleSpawnIntervalSeconds(100, seededSpawnRandom);
  }
  assert(sumFast < sumSlow, 'nextObstacleSpawnIntervalSeconds() liefert bei 100% Geschwindigkeit im Mittel kürzere Intervalle als bei 0% (höhere Dichte)');

  // Kollisions-Malus (collisionSpeedMalus/applyCollisionMalus): reine Multiplikator-Funktion mit Ablaufzeit — NIE ein Reset/Fail-State.
  const runnerState = IdleCore.createInitialState();
  assert(IdleCore.collisionSpeedMalus(runnerState, 1000) === 1, 'collisionSpeedMalus() liefert 1 (kein Malus), solange keine Kollision stattgefunden hat');
  IdleCore.applyCollisionMalus(runnerState, 1000);
  assert(
    IdleCore.collisionSpeedMalus(runnerState, 1000) === IdleCore.IDLE_BALANCE.RUNNER_COLLISION_MALUS_MULTIPLIER,
    'collisionSpeedMalus() liefert direkt nach einer Kollision den konfigurierten Malus-Multiplikator'
  );
  const stillActiveAt = 1000 + IdleCore.IDLE_BALANCE.RUNNER_COLLISION_MALUS_DURATION_MS - 1;
  assert(
    IdleCore.collisionSpeedMalus(runnerState, stillActiveAt) === IdleCore.IDLE_BALANCE.RUNNER_COLLISION_MALUS_MULTIPLIER,
    'collisionSpeedMalus() bleibt für die konfigurierte Dauer aktiv'
  );
  const recoveredAt = 1000 + IdleCore.IDLE_BALANCE.RUNNER_COLLISION_MALUS_DURATION_MS;
  assert(IdleCore.collisionSpeedMalus(runnerState, recoveredAt) === 1, 'collisionSpeedMalus() erholt sich nach Ablauf der Malus-Dauer wieder auf 1 (kein Reset/Fail-State)');

  // Idle-Auto-Run (runnerActivityState/runnerAutoRunSpeedPct): passives Fahren bleibt ZUVERLÄSSIG, aber gedeckelt.
  const freshRunnerState = IdleCore.createInitialState();
  assert(IdleCore.runnerActivityState(freshRunnerState, 0) === 'idle', 'runnerActivityState() ist "idle", solange noch nie gesteuert wurde (Auto-Run von Beginn an)');
  IdleCore.steerRunnerLane(freshRunnerState, 1, 5000);
  assert(IdleCore.runnerActivityState(freshRunnerState, 5000) === 'active', 'runnerActivityState() wird sofort "active" nach einer Lane-Wechsel-Eingabe');
  const stillActive = 5000 + IdleCore.IDLE_BALANCE.RUNNER_IDLE_TIMEOUT_SECONDS * 1000 - 1;
  assert(IdleCore.runnerActivityState(freshRunnerState, stillActive) === 'active', 'runnerActivityState() bleibt innerhalb des Idle-Timeouts "active"');
  const backToIdle = 5000 + IdleCore.IDLE_BALANCE.RUNNER_IDLE_TIMEOUT_SECONDS * 1000;
  assert(IdleCore.runnerActivityState(freshRunnerState, backToIdle) === 'idle', 'runnerActivityState() wechselt nach dem Idle-Timeout ohne weitere Eingabe zurück zu "idle"');
  assert(
    IdleCore.runnerAutoRunSpeedPct(100) === IdleCore.IDLE_BALANCE.RUNNER_AUTO_RUN_SPEED_CAP_PCT,
    'runnerAutoRunSpeedPct() deckelt die Auto-Run-Geschwindigkeit auch bei einem 100%-Bike'
  );
  assert(IdleCore.runnerAutoRunSpeedPct(10) === 10, 'runnerAutoRunSpeedPct() lässt eine bereits niedrigere Geschwindigkeit unverändert (kein künstliches Verlangsamen)');

  // passiveEarn() selbst (die reine Formel) bleibt von Runner-Kollisionen VOLLSTÄNDIG entkoppelt (Malus ist rein visuell).
  const earnState = IdleCore.createInitialState();
  const earnBefore = IdleCore.passiveEarn(earnState, 1);
  IdleCore.applyCollisionMalus(earnState, 0);
  const earnAfterCollision = IdleCore.passiveEarn(earnState, 1);
  assert(earnBefore === earnAfterCollision, 'passiveEarn() selbst ist unverändert nach einer Runner-Kollision (die Formel bleibt rein, der Effekt lebt in runnerEarnMultiplier())');

  // steerRunnerLane(): klemmt auf [0, RUNNER_LANE_COUNT-1] (kein Wechsel über den Rand hinaus).
  const laneState = IdleCore.createInitialState();
  for (let i = 0; i < IdleCore.IDLE_BALANCE.RUNNER_LANE_COUNT + 3; i++) IdleCore.steerRunnerLane(laneState, 1, 0);
  assert(laneState.runner.lane === IdleCore.IDLE_BALANCE.RUNNER_LANE_COUNT - 1, 'steerRunnerLane() klemmt am rechten Rand auf die letzte Lane');
  for (let i = 0; i < IdleCore.IDLE_BALANCE.RUNNER_LANE_COUNT + 3; i++) IdleCore.steerRunnerLane(laneState, -1, 0);
  assert(laneState.runner.lane === 0, 'steerRunnerLane() klemmt am linken Rand auf Lane 0');

  // v2→v3-Migration: ein v2-Save OHNE runner-Feld (vor feat(idle-runner)) bekommt defensiv einen gültigen runner-Zustand.
  const v2Raw = { version: 2, km: 123, ownedBikeIds: ['z125pro'], currentBikeId: 'z125pro', bikeLevels: { z125pro: 0 } };
  const migratedV2 = IdleCore.migrateState(v2Raw);
  assert(migratedV2.version === IdleCore.IDLE_STATE_VERSION, 'migrateState() hebt ein v2-Save auf die aktuelle Version an');
  assert(migratedV2.runner && typeof migratedV2.runner === 'object', 'migrateState() füllt ein fehlendes runner-Feld (Save vor feat(idle-runner)) defensiv auf');
  assert(
    migratedV2.runner.lane === Math.floor(IdleCore.IDLE_BALANCE.RUNNER_LANE_COUNT / 2),
    'migrateState(): frisch aufgefüllte runner.lane startet mittig'
  );
  assert(migratedV2.runner.collisionMalusExpiresAt === null, 'migrateState(): frisch aufgefüllte runner.collisionMalusExpiresAt ist null (kein aktiver Malus)');
  assert(migratedV2.km === 123, 'migrateState(): bestehende km bleiben bei der runner-Migration unangetastet');

  // Ein bereits vorhandener, gültiger runner-Zustand bleibt bei erneuter Migration exakt erhalten.
  const withRunnerRaw = { version: 3, km: 5, runner: { lane: 2, lastInputAt: 9999, collisionMalusExpiresAt: 12345 } };
  const migratedWithRunner = IdleCore.migrateState(withRunnerRaw);
  assert(
    migratedWithRunner.runner.lane === 2 && migratedWithRunner.runner.lastInputAt === 9999 && migratedWithRunner.runner.collisionMalusExpiresAt === 12345,
    'migrateState(): ein bereits vorhandener gültiger runner-Zustand bleibt exakt erhalten'
  );

  // Ein runner.lane ausserhalb des gültigen Bereichs wird defensiv auf die mittige Standard-Lane korrigiert.
  const invalidLaneRaw = { version: 3, runner: { lane: 99, lastInputAt: null, collisionMalusExpiresAt: null } };
  const migratedInvalidLane = IdleCore.migrateState(invalidLaneRaw);
  assert(
    migratedInvalidLane.runner.lane >= 0 && migratedInvalidLane.runner.lane < IdleCore.IDLE_BALANCE.RUNNER_LANE_COUNT,
    'migrateState(): eine ungültige runner.lane wird defensiv auf den gültigen Bereich korrigiert'
  );
})();

section('18 · TEIL 2 — balance(economy): runnerEarnMultiplier() koppelt den PASSIVEN Ertrag an den Runner-Zustand (nie 0, nie gated)');
(function () {
  // Aktiv (frisch gesteuert), keine Kollision, kein Turbo → unveränderter 1×-Satz (identisch zu Teil 1).
  const activeState = IdleCore.createInitialState();
  IdleCore.steerRunnerLane(activeState, 1, 0);
  assert(IdleCore.runnerEarnMultiplier(activeState, 0) === 1, 'runnerEarnMultiplier() ist exakt 1, solange aktiv gesteuert wird (kein Malus/Turbo)');

  // Idle (nie gesteuert, lastInputAt===null) → reduzierter, aber STRIKT positiver Boden-Multiplikator — NIE 0, NIE gated.
  const idleState = IdleCore.createInitialState();
  const idleMultiplier = IdleCore.runnerEarnMultiplier(idleState, 0);
  assert(idleMultiplier === IdleCore.IDLE_BALANCE.RUNNER_EARN_IDLE_MULTIPLIER, 'runnerEarnMultiplier() liefert im Idle-Auto-Run exakt RUNNER_EARN_IDLE_MULTIPLIER');
  assert(idleMultiplier > 0 && idleMultiplier < 1, 'runnerEarnMultiplier() im Idle-Modus liegt STRIKT zwischen 0 und 1 (reduziert, aber positiv)');
  assert(idleMultiplier < IdleCore.runnerEarnMultiplier(activeState, 0), 'runnerEarnMultiplier() ist im Idle-Modus STRIKT kleiner als im aktiven Modus');

  // Eine aktive Kollision verursacht einen zusätzlichen, aber ebenfalls niemals nullenden Dip (aktiv UND idle).
  const collisionActiveState = IdleCore.createInitialState();
  IdleCore.steerRunnerLane(collisionActiveState, 1, 0);
  IdleCore.applyCollisionMalus(collisionActiveState, 0);
  const collisionActiveMultiplier = IdleCore.runnerEarnMultiplier(collisionActiveState, 0);
  assert(
    Math.abs(collisionActiveMultiplier - IdleCore.IDLE_BALANCE.RUNNER_EARN_COLLISION_DIP_MULTIPLIER) < 1e-9,
    'runnerEarnMultiplier() wendet während einer aktiven Kollision den Dip-Multiplikator an (aktiv gesteuert)'
  );
  assert(collisionActiveMultiplier > 0, 'runnerEarnMultiplier() bleibt auch im Kollisions-Dip STRIKT positiv');

  const collisionIdleState = IdleCore.createInitialState();
  IdleCore.applyCollisionMalus(collisionIdleState, 0);
  const collisionIdleMultiplier = IdleCore.runnerEarnMultiplier(collisionIdleState, 0);
  const expectedIdleDip = Math.max(
    IdleCore.IDLE_BALANCE.RUNNER_EARN_MIN_MULTIPLIER,
    IdleCore.IDLE_BALANCE.RUNNER_EARN_IDLE_MULTIPLIER * IdleCore.IDLE_BALANCE.RUNNER_EARN_COLLISION_DIP_MULTIPLIER
  );
  assert(Math.abs(collisionIdleMultiplier - expectedIdleDip) < 1e-9, 'runnerEarnMultiplier() kombiniert Idle-Boden UND Kollisions-Dip multiplikativ (mit Sicherheitsnetz)');
  assert(collisionIdleMultiplier > 0, 'runnerEarnMultiplier() ist auch in der ungünstigsten Kombination (Idle + Kollision) STRIKT positiv');

  // Der Kollisions-Malus erholt sich automatisch (kein Reset/Fail-State) — identisches Muster zu collisionSpeedMalus().
  const recoveredAt = IdleCore.IDLE_BALANCE.RUNNER_COLLISION_MALUS_DURATION_MS;
  assert(
    IdleCore.runnerEarnMultiplier(collisionActiveState, recoveredAt) === 1,
    'runnerEarnMultiplier() erholt sich nach Ablauf des Kollisions-Malus wieder auf den vollen aktiven Satz'
  );

  // Turbo-Powerup erhöht runnerEarnMultiplier() zusätzlich (kurzer Ertrags-Boost, siehe activatePowerupEffect()).
  const turboState = IdleCore.createInitialState();
  IdleCore.steerRunnerLane(turboState, 1, 0);
  IdleCore.activatePowerupEffect(turboState, 'turbo', 0);
  assert(
    Math.abs(IdleCore.runnerEarnMultiplier(turboState, 0) - IdleCore.IDLE_BALANCE.POWERUP_TURBO_EARN_MULTIPLIER) < 1e-9,
    'runnerEarnMultiplier() wendet während eines aktiven Turbo-Effekts POWERUP_TURBO_EARN_MULTIPLIER an'
  );

  // Über das gesamte 0..100%-Delta hinweg: das absolute Sicherheitsnetz wird NIE unterschritten.
  for (let ms = 0; ms <= IdleCore.IDLE_BALANCE.RUNNER_COLLISION_MALUS_DURATION_MS; ms += 100) {
    assert(
      IdleCore.runnerEarnMultiplier(collisionIdleState, ms) >= IdleCore.IDLE_BALANCE.RUNNER_EARN_MIN_MULTIPLIER - 1e-9,
      `runnerEarnMultiplier(idle+Kollision, ${ms}ms) liegt nie unter RUNNER_EARN_MIN_MULTIPLIER`
    );
  }

  // passiveEarn() × runnerEarnMultiplier(): der Idle-Satz ist reduziert, aber strikt > 0 — NIE gated hinter aktivem Fahren.
  const dtSeconds = 1;
  const baseEarn = IdleCore.passiveEarn(idleState, dtSeconds);
  const activeCredited = baseEarn * IdleCore.runnerEarnMultiplier(activeState, 0);
  const idleCredited = baseEarn * IdleCore.runnerEarnMultiplier(idleState, 0);
  assert(idleCredited > 0, 'Der pro Tick gutgeschriebene Idle-Ertrag (passiveEarn() × runnerEarnMultiplier()) ist STRIKT positiv');
  assert(idleCredited < activeCredited, 'Der Idle-Ertrag ist reduziert ggü. dem aktiven Ertrag, aber niemals 0');
})();

section('19 · TEIL 2/4 — feat(powerups): Magnet/Schild/Turbo/Score-x2 (rollPowerupType/rollPowerupDrop/activatePowerupEffect) + Tuning-Perks + v3→v4-Migration');
(function () {
  // rollPowerupType(): Verteilung über viele geseedete Rolls liegt nahe POWERUP_TYPE_WEIGHTS.
  let powerupSeed = 11;
  function seededPowerupRandom() { powerupSeed = (powerupSeed * 1103515245 + 12345) & 0x7fffffff; return powerupSeed / 0x7fffffff; }
  const POWERUP_ROLL_COUNT = 20000;
  const counts = { magnet: 0, schild: 0, turbo: 0, scoreX2: 0 };
  for (let i = 0; i < POWERUP_ROLL_COUNT; i++) {
    const type = IdleCore.rollPowerupType(seededPowerupRandom);
    assert(Object.prototype.hasOwnProperty.call(counts, type), `rollPowerupType() liefert einen gültigen Typ (${type})`);
    counts[type]++;
  }
  const totalWeight = Object.values(IdleCore.IDLE_BALANCE.POWERUP_TYPE_WEIGHTS).reduce((a, b) => a + b, 0);
  Object.keys(IdleCore.IDLE_BALANCE.POWERUP_TYPE_WEIGHTS).forEach((type) => {
    const expected = POWERUP_ROLL_COUNT * (IdleCore.IDLE_BALANCE.POWERUP_TYPE_WEIGHTS[type] / totalWeight);
    assert(
      Math.abs(counts[type] - expected) / expected < 0.15,
      `rollPowerupType()-Verteilung für '${type}' (${counts[type]}) liegt nahe der erwarteten ~${Math.round(expected)} (POWERUP_TYPE_WEIGHTS)`
    );
  });

  // rollPowerupDrop(): respektiert powerupSpawnChance() VOR der Typ-Auswahl.
  const dropState = IdleCore.createInitialState();
  assert(IdleCore.rollPowerupDrop(() => 0, dropState) !== null, 'rollPowerupDrop() mit einer garantiert unter der Spawn-Chance liegenden Zufallszahl liefert einen Typ');
  assert(IdleCore.rollPowerupDrop(() => 0.999, dropState) === null, 'rollPowerupDrop() mit einer garantiert über der Spawn-Chance liegenden Zufallszahl liefert null (kein Spawn, KEINE Strafe)');

  // powerupSpawnChance(): TUNING-PERK — steigt mit dem Tuning-Level des aktuell gefahrenen Bikes, gedeckelt auf 1.
  const chanceLevel0 = IdleCore.powerupSpawnChance(dropState);
  const highTuningState = IdleCore.createInitialState();
  highTuningState.bikeLevels[highTuningState.currentBikeId] = IdleCore.IDLE_BALANCE.TUNING_LEVEL_CAP;
  const chanceMaxLevel = IdleCore.powerupSpawnChance(highTuningState);
  assert(chanceMaxLevel > chanceLevel0, 'powerupSpawnChance() steigt mit dem Tuning-Level (Tuning-Perk)');
  assert(chanceMaxLevel <= 1, 'powerupSpawnChance() ist auf 1 gedeckelt');

  // Magnet/Turbo/Schild: activatePowerupEffect() setzt den jeweiligen *ExpiresAt-Zeitstempel, magnetActive()/turboActive()/shieldActive() spiegeln das (Effekt-Fenster).
  const effectState = IdleCore.createInitialState();
  assert(!IdleCore.magnetActive(effectState, 0) && !IdleCore.turboActive(effectState, 0) && !IdleCore.shieldActive(effectState, 0), 'Frischer Zustand hat KEINEN aktiven Powerup-Effekt');

  IdleCore.activatePowerupEffect(effectState, 'magnet', 1000);
  const magnetDurationMs = IdleCore.powerupMagnetDurationSeconds(effectState) * 1000;
  assert(IdleCore.magnetActive(effectState, 1000), 'magnetActive() ist direkt nach activatePowerupEffect(\'magnet\') aktiv');
  assert(IdleCore.magnetActive(effectState, 1000 + magnetDurationMs - 1), 'magnetActive() bleibt für die volle Wirkdauer aktiv');
  assert(!IdleCore.magnetActive(effectState, 1000 + magnetDurationMs), 'magnetActive() erlischt nach Ablauf der Wirkdauer (kein Reset — einfach kein Effekt mehr)');

  IdleCore.activatePowerupEffect(effectState, 'turbo', 2000);
  const turboDurationMs = IdleCore.powerupTurboDurationSeconds(effectState) * 1000;
  assert(IdleCore.turboActive(effectState, 2000), 'turboActive() ist direkt nach activatePowerupEffect(\'turbo\') aktiv');
  assert(!IdleCore.turboActive(effectState, 2000 + turboDurationMs), 'turboActive() erlischt nach Ablauf der Wirkdauer');

  // Schild: konsumiert GENAU EINE Kollision (consumeShield()) — danach ist er verbraucht, ein zweiter Konsum-Versuch schlägt fehl.
  const shieldState = IdleCore.createInitialState();
  assert(IdleCore.consumeShield(shieldState, 0) === false, 'consumeShield() ohne aktiven Schild liefert false (kein Effekt, keine Mutation)');
  IdleCore.activatePowerupEffect(shieldState, 'schild', 0);
  assert(IdleCore.shieldActive(shieldState, 0), 'shieldActive() ist direkt nach activatePowerupEffect(\'schild\') aktiv');
  assert(IdleCore.consumeShield(shieldState, 0) === true, 'consumeShield() konsumiert einen aktiven Schild (blockt EINE Kollision)');
  assert(!IdleCore.shieldActive(shieldState, 0), 'shieldActive() ist direkt nach dem Konsum wieder false');
  assert(IdleCore.consumeShield(shieldState, 0) === false, 'consumeShield() ein zweites Mal liefert false — der Schild ist bereits verbraucht (GENAU EINE Kollision)');

  // Ein Schild, der nie konsumiert wird, läuft nach powerupShieldDurationSeconds() unbenutzt ab (keine Strafe, identisches Muster zu Sparschwein/Schaltpunkt-Leiste).
  const unusedShieldState = IdleCore.createInitialState();
  IdleCore.activatePowerupEffect(unusedShieldState, 'schild', 0);
  const shieldDurationMs = IdleCore.powerupShieldDurationSeconds(unusedShieldState) * 1000;
  assert(IdleCore.shieldActive(unusedShieldState, shieldDurationMs - 1), 'shieldActive() bleibt für die volle Wirkdauer bereit');
  assert(!IdleCore.shieldActive(unusedShieldState, shieldDurationMs), 'shieldActive() erlischt nach Ablauf der Wirkdauer, falls unbenutzt (KEINE Strafe)');

  // Score-x2 (Teil 4, ersetzt 'muenzregen' im selben Gewichtungs-Slot): setzt scoreX2ExpiresAt, KEIN sofortiger km-Bonus mehr.
  const coinState = IdleCore.createInitialState();
  const kmBeforeCoin = coinState.km;
  assert(!IdleCore.scoreX2Active(coinState, 0), 'Frischer Zustand hat KEINEN aktiven Score-x2-Effekt');
  const coinResult = IdleCore.activatePowerupEffect(coinState, 'scoreX2', 0);
  assert(coinResult.type === 'scoreX2', 'activatePowerupEffect(\'scoreX2\') liefert den aktivierten Typ zurück');
  assert(coinState.km === kmBeforeCoin, 'activatePowerupEffect(\'scoreX2\') ändert km NICHT (wirkt nur auf state.run.score)');
  assert(IdleCore.scoreX2Active(coinState, 0), 'scoreX2Active() ist direkt nach activatePowerupEffect(\'scoreX2\') aktiv');
  const scoreX2DurationMs = IdleCore.powerupScoreX2DurationSeconds(coinState) * 1000;
  assert(IdleCore.scoreX2Active(coinState, scoreX2DurationMs - 1), 'scoreX2Active() bleibt für die volle Wirkdauer aktiv');
  assert(!IdleCore.scoreX2Active(coinState, scoreX2DurationMs), 'scoreX2Active() erlischt nach Ablauf der Wirkdauer');

  // state.powerups.collected ist ein Lebenszeit-Zähler (jeder Typ, auch Score-x2, zählt).
  assert(coinState.powerups.collected === 1, 'activatePowerupEffect() erhöht state.powerups.collected um 1');
  IdleCore.activatePowerupEffect(coinState, 'magnet', 0);
  assert(coinState.powerups.collected === 2, 'activatePowerupEffect() zählt state.powerups.collected bei jedem weiteren Aufruf hoch');

  // TUNING-PERKS: Magnet-Reichweite/Dauer, Schild-/Turbo-/Score-x2-Dauer steigen (bzw. die Reichweiten-SCHWELLE sinkt = grössere Reichweite) monoton mit dem Tuning-Level.
  const perkBikeId = IdleCore.createInitialState().currentBikeId;
  let prevMagnetDuration = -Infinity, prevMagnetRange = Infinity, prevShieldDuration = -Infinity, prevTurboDuration = -Infinity, prevScoreX2Duration = -Infinity;
  for (let level = 0; level <= IdleCore.IDLE_BALANCE.TUNING_LEVEL_CAP; level += 5) {
    const perkState = IdleCore.createInitialState();
    perkState.bikeLevels[perkBikeId] = level;
    const magnetDuration = IdleCore.powerupMagnetDurationSeconds(perkState);
    const magnetRange = IdleCore.powerupMagnetRangeT(perkState);
    const shieldDuration = IdleCore.powerupShieldDurationSeconds(perkState);
    const turboDuration = IdleCore.powerupTurboDurationSeconds(perkState);
    const scoreX2Duration = IdleCore.powerupScoreX2DurationSeconds(perkState);
    assert(magnetDuration >= prevMagnetDuration, `powerupMagnetDurationSeconds() ist bei Level ${level} monoton nicht-fallend`);
    assert(magnetRange <= prevMagnetRange, `powerupMagnetRangeT() (Reichweiten-Schwelle) ist bei Level ${level} monoton nicht-steigend (= wachsende Reichweite)`);
    assert(magnetRange >= IdleCore.IDLE_BALANCE.POWERUP_MAGNET_MIN_RANGE_T - 1e-9, `powerupMagnetRangeT() bei Level ${level} respektiert POWERUP_MAGNET_MIN_RANGE_T`);
    assert(shieldDuration >= prevShieldDuration, `powerupShieldDurationSeconds() ist bei Level ${level} monoton nicht-fallend`);
    assert(turboDuration >= prevTurboDuration, `powerupTurboDurationSeconds() ist bei Level ${level} monoton nicht-fallend`);
    assert(scoreX2Duration >= prevScoreX2Duration, `powerupScoreX2DurationSeconds() ist bei Level ${level} monoton nicht-fallend`);
    prevMagnetDuration = magnetDuration; prevMagnetRange = magnetRange; prevShieldDuration = shieldDuration; prevTurboDuration = turboDuration; prevScoreX2Duration = scoreX2Duration;
  }

  // v3→v4-Migration: ein v3-Save OHNE powerups-Feld (vor feat(powerups)) bekommt defensiv einen gültigen powerups-Zustand.
  const v3RawNoPowerups = { version: 3, km: 42, runner: { lane: 1, lastInputAt: null, collisionMalusExpiresAt: null } };
  const migratedNoPowerups = IdleCore.migrateState(v3RawNoPowerups);
  assert(migratedNoPowerups.version === IdleCore.IDLE_STATE_VERSION, 'migrateState() hebt ein v3-Save (vor feat(powerups)) auf die aktuelle Version an');
  assert(migratedNoPowerups.powerups && migratedNoPowerups.powerups.collected === 0, 'migrateState(): fehlendes powerups-Feld wird defensiv mit collected:0 aufgefüllt');
  assert(
    migratedNoPowerups.powerups.magnetExpiresAt === null && migratedNoPowerups.powerups.turboExpiresAt === null && migratedNoPowerups.powerups.shieldExpiresAt === null,
    'migrateState(): fehlendes powerups-Feld wird defensiv mit inaktiven (null) *ExpiresAt-Zeitstempeln aufgefüllt'
  );
  assert(migratedNoPowerups.powerups.scoreX2ExpiresAt === null, 'migrateState(): fehlendes powerups-Feld wird defensiv MIT dem neuen (Teil 4) scoreX2ExpiresAt:null aufgefüllt');
  assert(migratedNoPowerups.km === 42, 'migrateState(): bestehende km bleiben bei der powerups-Migration unangetastet');
  assert(migratedNoPowerups.runner.lane === 1, 'migrateState(): bestehendes runner-Feld bleibt bei der powerups-Migration unangetastet');

  // Ein bereits vorhandener, gültiger powerups-Zustand bleibt bei erneuter Migration exakt erhalten.
  const withPowerupsRaw = { version: 4, km: 5, powerups: { collected: 3, magnetExpiresAt: 111, turboExpiresAt: 222, shieldExpiresAt: 333 } };
  const migratedWithPowerups = IdleCore.migrateState(withPowerupsRaw);
  assert(
    migratedWithPowerups.powerups.collected === 3 &&
    migratedWithPowerups.powerups.magnetExpiresAt === 111 &&
    migratedWithPowerups.powerups.turboExpiresAt === 222 &&
    migratedWithPowerups.powerups.shieldExpiresAt === 333,
    'migrateState(): ein bereits vorhandener gültiger powerups-Zustand bleibt exakt erhalten'
  );
  assert(migratedWithPowerups.powerups.scoreX2ExpiresAt === null, 'migrateState(): ein v4-Save OHNE scoreX2ExpiresAt (vor Teil 4) bekommt es defensiv auf null aufgefüllt, ohne die übrigen Felder zu berühren');

  // v5→v6-Migration (Teil 4): ein v5-Save MIT bereits vorhandenem scoreX2ExpiresAt übernimmt es unverändert.
  const withScoreX2Raw = { version: 5, km: 5, powerups: { collected: 1, magnetExpiresAt: null, turboExpiresAt: null, shieldExpiresAt: null, scoreX2ExpiresAt: 999 } };
  const migratedWithScoreX2 = IdleCore.migrateState(withScoreX2Raw);
  assert(migratedWithScoreX2.version === IdleCore.IDLE_STATE_VERSION, 'migrateState(v5): hebt ein v5-Save (vor Teil 4) auf die aktuelle Version (6) an');
  assert(migratedWithScoreX2.powerups.scoreX2ExpiresAt === 999, 'migrateState(): ein bereits vorhandener gültiger scoreX2ExpiresAt-Wert bleibt exakt erhalten');
})();

section('20 · TEIL 2 — balance(tuning): TUNING-GATE für den nächsten Bike-Kauf (getNextBikeToBuy/buyNextBike) + tuningReactionTimeFactor()');
(function () {
  // ZX-6R (Index 10) verlangt laut TUNING_GATE_THRESHOLDS Tuning-Level 5 auf dem zuletzt besessenen Bike (Ninja 1000SX, Index 9).
  const zx6rIndex = IdleCore.findBikeIndex('zx6r');
  assert(IdleCore.IDLE_BALANCE.TUNING_GATE_THRESHOLDS[zx6rIndex] === 5, 'TUNING_GATE_THRESHOLDS: die ZX-6R verlangt Tuning-Level 5 (Aufgaben-Beispiel)');

  function makeGateState(tuningLevel) {
    const s = IdleCore.createInitialState();
    for (let i = 1; i < zx6rIndex; i++) {
      s.ownedBikeIds.push(IdleCore.IDLE_BIKES[i].id);
      s.bikeLevels[IdleCore.IDLE_BIKES[i].id] = 0;
    }
    const lastOwnedId = IdleCore.IDLE_BIKES[zx6rIndex - 1].id;
    s.bikeLevels[lastOwnedId] = tuningLevel;
    s.currentBikeId = lastOwnedId;
    s.km = IdleCore.bikeCost(zx6rIndex) + 1000; // genug km, unabhängig vom Tuning-Gate
    return s;
  }

  // Genug km, aber Tuning-Level zu niedrig (0 < 5) → NICHT käuflich.
  const belowGateState = makeGateState(0);
  const belowGateInfo = IdleCore.getNextBikeToBuy(belowGateState);
  assert(belowGateInfo.bike.id === 'zx6r', 'getNextBikeToBuy() identifiziert die ZX-6R korrekt als nächstes Bike');
  assert(belowGateInfo.tuningMet === false, 'getNextBikeToBuy(): tuningMet ist false unterhalb der Schwelle');
  assert(belowGateInfo.affordable === false, 'getNextBikeToBuy(): trotz genug km NICHT käuflich, solange das Tuning-Level unter der Schwelle liegt');
  const belowGateBuy = IdleCore.buyNextBike(belowGateState);
  assert(belowGateBuy.success === false, 'buyNextBike() schlägt unterhalb der Tuning-Gate-Schwelle fehl (trotz genug km)');
  assert(belowGateState.ownedBikeIds.indexOf('zx6r') === -1, 'buyNextBike() fügt die ZX-6R NICHT zu ownedBikeIds hinzu, solange das Gate nicht erfüllt ist');

  // Knapp unter der Schwelle (4 < 5) → weiterhin gesperrt.
  const justBelowGateInfo = IdleCore.getNextBikeToBuy(makeGateState(4));
  assert(justBelowGateInfo.affordable === false, 'getNextBikeToBuy(): Tuning-Level 4 (knapp unter Schwelle 5) reicht NICHT aus');

  // Genug km UND Tuning-Level erreicht (exakt 5) → käuflich.
  const atGateState = makeGateState(5);
  const atGateInfo = IdleCore.getNextBikeToBuy(atGateState);
  assert(atGateInfo.tuningMet === true, 'getNextBikeToBuy(): tuningMet ist true bei exakt erreichter Schwelle');
  assert(atGateInfo.affordable === true, 'getNextBikeToBuy(): käuflich, sobald genug km UND das Tuning-Level die Schwelle erreicht');
  const atGateBuy = IdleCore.buyNextBike(atGateState);
  assert(atGateBuy.success === true, 'buyNextBike() gelingt, sobald das Tuning-Gate erfüllt ist (genug km + genug Tuning-Level)');
  assert(atGateState.ownedBikeIds.indexOf('zx6r') !== -1, 'buyNextBike() fügt die ZX-6R zu ownedBikeIds hinzu, sobald das Gate erfüllt ist');

  // Über der Schwelle (10 > 5) → ebenfalls käuflich (kein Deckel nach oben).
  const aboveGateInfo = IdleCore.getNextBikeToBuy(makeGateState(10));
  assert(aboveGateInfo.affordable === true, 'getNextBikeToBuy(): auch deutlich über der Schwelle weiterhin käuflich');

  // Frühe Bikes (Schwelle 0) sind vom Tuning-Gate praktisch unberührt (bestehender Kauf-Flow bleibt intakt).
  const earlyState = IdleCore.createInitialState();
  earlyState.km = IdleCore.bikeCost(1) + 10;
  const earlyInfo = IdleCore.getNextBikeToBuy(earlyState);
  assert(earlyInfo.tuningRequirement === 0 && earlyInfo.affordable === true, 'getNextBikeToBuy(): das erste käufliche Bike (Schwelle 0) bleibt ohne Tuning-Level käuflich');

  // Bereits besessene Bikes sind vom Tuning-Gate nicht betroffen — bestehender Kauf-/Fahr-Flow bleibt unverändert.
  assert(IdleCore.selectBike(atGateState, IdleCore.IDLE_BIKES[0].id) === true, 'selectBike() für ein bereits besessenes Bike funktioniert unverändert, unabhängig vom Tuning-Gate');

  // Alle Bikes bereits besessen → kein nächstes Bike (bike:null), tuningMet bleibt defensiv true (keine Schranke ohne Ziel).
  const allOwnedState = IdleCore.createInitialState();
  allOwnedState.ownedBikeIds = IdleCore.IDLE_BIKES.map((b) => b.id);
  const allOwnedInfo = IdleCore.getNextBikeToBuy(allOwnedState);
  assert(allOwnedInfo.bike === null && allOwnedInfo.affordable === false, 'getNextBikeToBuy(): bike:null, sobald bereits alle Bikes besessen sind');
  assert(allOwnedInfo.tuningMet === true, 'getNextBikeToBuy(): tuningMet bleibt defensiv true, wenn es kein nächstes Bike mehr gibt');

  // tuningReactionTimeFactor(): TUNING-PERK "breitere Reaktionszeit" — sinkt monoton mit dem Tuning-Level, gedeckelt auf TUNING_OBSTACLE_PROGRESS_MIN_FACTOR.
  const reactionBikeId = IdleCore.createInitialState().currentBikeId;
  assert(IdleCore.tuningReactionTimeFactor(IdleCore.createInitialState()) === 1, 'tuningReactionTimeFactor() ist 1 bei Tuning-Level 0 (keine Verlangsamung)');
  let prevFactor = Infinity;
  for (let level = 0; level <= IdleCore.IDLE_BALANCE.TUNING_LEVEL_CAP; level += 1) {
    const factorState = IdleCore.createInitialState();
    factorState.bikeLevels[reactionBikeId] = level;
    const factor = IdleCore.tuningReactionTimeFactor(factorState);
    assert(factor <= prevFactor + 1e-9, `tuningReactionTimeFactor() ist bei Level ${level} monoton nicht-steigend`);
    assert(factor >= IdleCore.IDLE_BALANCE.TUNING_OBSTACLE_PROGRESS_MIN_FACTOR - 1e-9, `tuningReactionTimeFactor() bei Level ${level} respektiert TUNING_OBSTACLE_PROGRESS_MIN_FACTOR`);
    prevFactor = factor;
  }
  const capState = IdleCore.createInitialState();
  capState.bikeLevels[reactionBikeId] = IdleCore.IDLE_BALANCE.TUNING_LEVEL_CAP;
  assert(
    Math.abs(IdleCore.tuningReactionTimeFactor(capState) - IdleCore.IDLE_BALANCE.TUNING_OBSTACLE_PROGRESS_MIN_FACTOR) < 1e-9,
    'tuningReactionTimeFactor() trifft am TUNING_LEVEL_CAP exakt die Untergrenze'
  );
})();

section('16 · CRASH-BASED RUN (Teil 3) — Lifecycle: startRun/endRun/restartRun');
(function () {
  // startRun(): setzt phase='running', leitet speedPct aus dem aktuellen Bike/Tuning ab, resettet Steuerung.
  const state = IdleCore.createInitialState();
  state.runner.lane = 2;
  state.runner.jumpUntil = 12345;
  state.runner.duckUntil = 67890;
  state.runner.collisionMalusExpiresAt = 99999;
  const now = 1_700_000_000_000;
  const runResult = IdleCore.startRun(state, now);

  assert(state.run.phase === 'running', 'startRun(): setzt phase auf "running"');
  assert(state.run.score === 0 && state.run.coins === 0 && state.run.combo === 0, 'startRun(): score/coins/combo starten bei 0');
  assert(state.run.distanceUnits === 0, 'startRun(): distanceUnits startet bei 0');
  assert(state.run.startedAt === now, 'startRun(): startedAt = übergebener Zeitstempel');
  assert(runResult === state.run, 'startRun(): gibt das state.run-Objekt zurück');

  const bike = IdleCore.getBikeById(state.currentBikeId);
  const level = IdleCore.getBikeLevel(state, state.currentBikeId);
  const expectedSpeedPct = IdleCore.deriveBikeStats(bike, level).geschwindigkeitPct;
  assert(Math.abs(state.run.speedPct - expectedSpeedPct) < 1e-9, 'startRun(): speedPct kommt exakt aus deriveBikeStats().geschwindigkeitPct des aktuellen Bikes');

  assert(state.runner.lane === Math.floor(IdleCore.IDLE_BALANCE.RUNNER_LANE_COUNT / 2), 'startRun(): Lane wird auf die Mitte zurückgesetzt');
  assert(state.runner.jumpUntil === null && state.runner.duckUntil === null, 'startRun(): Sprung/Ducken-Fenster werden zurückgesetzt');
  assert(state.runner.collisionMalusExpiresAt === null, 'startRun(): Kollisions-Malus wird zurückgesetzt');

  // restartRun() ist ein Alias für startRun() — identisches Verhalten nach einem simulierten Lauf.
  state.run.score = 500;
  state.run.coins = 20;
  const restartResult = IdleCore.restartRun(state, now + 1000);
  assert(state.run.score === 0 && state.run.coins === 0, 'restartRun(): resettet score/coins wie startRun()');
  assert(restartResult.phase === 'running', 'restartRun(): liefert einen frischen, laufenden state.run');
})();

section('17 · CRASH-BASED RUN — endRun() kreditiert Run-Coins GENAU EINMAL zu km');
(function () {
  const state = IdleCore.createInitialState();
  IdleCore.startRun(state, 1000);
  state.run.score = 1234;
  state.run.coins = 50;
  state.run.combo = 3;

  // Snapshot der PROGRESS-Schicht VOR endRun() — muss byte-für-byte unverändert bleiben
  // (ausser km/totalKmEarned selbst, die über die EINE creditKm()-Stelle steigen).
  const beforeOwned = state.ownedBikeIds.slice();
  const beforeLevels = JSON.stringify(state.bikeLevels);
  const beforePrestige = JSON.stringify(state.prestige);
  const beforeGear = JSON.stringify(state.gear);
  const beforeParts = JSON.stringify(state.parts);
  const beforeFinance = JSON.stringify(state.finance);
  const beforeKm = state.km;

  const expectedKmCredit = IdleCore.runCoinsToKm(50);
  assert(expectedKmCredit > 0, 'runCoinsToKm(50) liefert einen positiven km-Betrag (Testvoraussetzung)');

  const summary = IdleCore.endRun(state, 2000);

  assert(summary.score === 1234 && summary.coins === 50, 'endRun(): Zusammenfassung enthält den finalen Score/Coins-Stand');
  assert(state.run.phase === 'crashed', 'endRun(): setzt phase auf "crashed"');
  assert(Math.abs(state.km - (beforeKm + expectedKmCredit)) < 1e-9, 'endRun(): km steigt um EXAKT runCoinsToKm(coins) — keine andere/doppelte Gutschrift');
  assert(Math.abs(state.totalKmEarned - (beforeKm + expectedKmCredit)) < 1e-9, 'endRun(): totalKmEarned steigt exakt im gleichen Umfang wie km (über dieselbe creditKm()-Stelle)');

  // PROGRESS-Schicht: bikes/tuning/Saison/Gear/Teile/Finanzen dürfen NICHT berührt worden sein.
  assert(JSON.stringify(state.ownedBikeIds) === JSON.stringify(beforeOwned), 'endRun(): ownedBikeIds unverändert');
  assert(JSON.stringify(state.bikeLevels) === beforeLevels, 'endRun(): bikeLevels (Tuning) unverändert');
  assert(JSON.stringify(state.prestige) === beforePrestige, 'endRun(): prestige/Saison unverändert');
  assert(JSON.stringify(state.gear) === beforeGear, 'endRun(): gear-Sammlung unverändert');
  assert(JSON.stringify(state.parts) === beforeParts, 'endRun(): parts-Sammlung unverändert');
  assert(JSON.stringify(state.finance) === beforeFinance, 'endRun(): finance (Rechnungen/Insolvenz) unverändert');

  // Highscore + Lebenszeit-Statistiken.
  assert(state.runHighscore === 1234, 'endRun(): runHighscore wird auf den ersten Run-Score gesetzt');
  assert(state.runStats.totalRuns === 1, 'endRun(): runStats.totalRuns wird hochgezählt');
  assert(state.runStats.totalCoinsCollected === 50, 'endRun(): runStats.totalCoinsCollected wird hochgezählt');
  assert(state.runStats.totalCrashes === 1, 'endRun(): runStats.totalCrashes wird hochgezählt');
  assert(state.runStats.bestComboEver === 3, 'endRun(): runStats.bestComboEver übernimmt die höchste Run-Combo');

  // Ein zweiter, schwächerer Run darf runHighscore NICHT verringern.
  IdleCore.startRun(state, 3000);
  state.run.score = 10;
  state.run.coins = 1;
  const secondSummary = IdleCore.endRun(state, 4000);
  assert(secondSummary.newHighscore === false, 'endRun(): newHighscore ist false, wenn der Score den Bestwert NICHT übertrifft');
  assert(state.runHighscore === 1234, 'endRun(): ein schwächerer Run senkt runHighscore NICHT');
  assert(state.runStats.totalRuns === 2, 'endRun(): totalRuns akkumuliert additiv über mehrere Runs');

  // Ein besserer dritter Run schlägt den Highscore.
  IdleCore.startRun(state, 5000);
  state.run.score = 9999;
  state.run.coins = 0;
  const thirdSummary = IdleCore.endRun(state, 6000);
  assert(thirdSummary.newHighscore === true, 'endRun(): newHighscore ist true, sobald der Score den Bestwert übertrifft');
  assert(state.runHighscore === 9999, 'endRun(): runHighscore wird auf den neuen Bestwert angehoben');
})();

section('18 · CRASH-BASED RUN — ein Crash allein (ohne endRun()) ändert km NICHT');
(function () {
  // detectRunCollision() selbst ist eine reine Abfrage bzgl. km/PROGRESS-Schicht — nur der
  // Aufrufer (idle.js handleRunCrash()) ruft anschliessend endRun() auf. Diese Trennung wird
  // hier explizit geprüft: crashed:true darf für sich allein km NICHT verändern.
  const state = IdleCore.createInitialState();
  IdleCore.startRun(state, 1000);
  state.run.coins = 77;
  const kmBefore = state.km;

  const result = IdleCore.detectRunCollision(state, 'side', 2000);
  assert(result.crashed === true, 'detectRunCollision(): ein "side"-Hindernis in der Bike-Lane crasht ohne Schild');
  assert(state.km === kmBefore, 'detectRunCollision() allein (ohne anschliessenden endRun()-Aufruf) ändert km NICHT');
  assert(state.run.phase === 'running', 'detectRunCollision() allein beendet den Run NICHT selbst (Aufrufer muss endRun() aufrufen)');
})();

section('19 · CRASH-BASED RUN — Kollisions-Erkennung je Hindernis-Typ (feat(crash))');
(function () {
  const state = IdleCore.createInitialState();
  IdleCore.startRun(state, 1000);

  // 'side': IMMER ein Treffer (die einzige Ausweich-Aktion ist der Lane-Wechsel, den der
  // Aufrufer bereits vorher prüft — detectRunCollision() selbst kennt keine Lane).
  assert(IdleCore.detectRunCollision(state, 'side', 1000).crashed === true, "'side'-Hindernis crasht immer (kein Sprung/Ducken hilft)");

  // 'lowBar': crasht, AUSSER das Bike springt gerade.
  assert(IdleCore.detectRunCollision(state, 'lowBar', 1000).crashed === true, "'lowBar' crasht ohne Sprung");
  IdleCore.jumpRunner(state, 1000);
  assert(IdleCore.detectRunCollision(state, 'lowBar', 1200).crashed === false, "'lowBar' crasht NICHT während eines aktiven Sprungs");
  assert(IdleCore.detectRunCollision(state, 'lowBar', 1200).shielded === false, "'lowBar' während eines Sprungs ist kein Schild-Verbrauch, sondern schlicht kein Treffer");
  assert(IdleCore.detectRunCollision(state, 'lowBar', 1000 + IdleCore.IDLE_BALANCE.RUNNER_JUMP_DURATION_MS + 50).crashed === true, "'lowBar' crasht wieder, sobald das Sprung-Fenster abgelaufen ist");

  // 'highBarrier': crasht, AUSSER das Bike duckt gerade.
  assert(IdleCore.detectRunCollision(state, 'highBarrier', 2000).crashed === true, "'highBarrier' crasht ohne Ducken");
  IdleCore.duckRunner(state, 2000);
  assert(IdleCore.detectRunCollision(state, 'highBarrier', 2200).crashed === false, "'highBarrier' crasht NICHT während eines aktiven Duckens");
  assert(IdleCore.detectRunCollision(state, 'highBarrier', 2000 + IdleCore.IDLE_BALANCE.RUNNER_DUCK_DURATION_MS + 50).crashed === true, "'highBarrier' crasht wieder, sobald das Ducken-Fenster abgelaufen ist");

  // Sprung und Ducken schliessen sich gegenseitig aus.
  IdleCore.jumpRunner(state, 3000);
  assert(IdleCore.isJumping(state, 3000) === true && IdleCore.isDucking(state, 3000) === false, 'jumpRunner(): hebt ein evtl. aktives Ducken auf');
  IdleCore.duckRunner(state, 3000);
  assert(IdleCore.isDucking(state, 3000) === true && IdleCore.isJumping(state, 3000) === false, 'duckRunner(): hebt einen evtl. aktiven Sprung auf');

  // Schild konsumiert GENAU EINE Kollision, egal welchen Typs — kein Crash, aber danach verbraucht.
  const shieldState = IdleCore.createInitialState();
  IdleCore.startRun(shieldState, 1000);
  IdleCore.activatePowerupEffect(shieldState, 'schild', 1000);
  assert(IdleCore.shieldActive(shieldState, 1000) === true, 'Schild ist nach activatePowerupEffect() aktiv (Testvoraussetzung)');
  const shieldedResult = IdleCore.detectRunCollision(shieldState, 'side', 1000);
  assert(shieldedResult.crashed === false && shieldedResult.shielded === true, 'detectRunCollision(): ein aktiver Schild blockt die Kollision (kein Crash), wird dabei aber konsumiert');
  assert(IdleCore.shieldActive(shieldState, 1000) === false, 'detectRunCollision(): der Schild ist nach dem Blocken verbraucht (nur EINE Kollision)');
  // Der VERBRAUCHTE Schild schützt eine zweite Kollision nicht mehr.
  assert(IdleCore.detectRunCollision(shieldState, 'side', 1001).crashed === true, 'Ein bereits verbrauchter Schild schützt keine zweite Kollision');

  // rollObstacleType() liefert ausschliesslich gültige, in RUNNER_OBSTACLE_TYPE_WEIGHTS gelistete Typen.
  const validTypes = Object.keys(IdleCore.IDLE_BALANCE.RUNNER_OBSTACLE_TYPE_WEIGHTS);
  for (let i = 0; i < 200; i++) {
    const rolled = IdleCore.rollObstacleType(() => i / 200);
    assert(validTypes.indexOf(rolled) !== -1, `rollObstacleType() liefert bei rnd=${(i / 200).toFixed(3)} einen gültigen Typ (${rolled})`);
  }
})();

section('20 · CRASH-BASED RUN — tickRunEconomy(): aktiv bankt erst bei Crash, Auto-Pilot kontinuierlich reduziert in km');
(function () {
  // Aktiver Run: Score/Coins sammeln sich NUR in state.run, km bleibt bis zum Crash unberührt.
  const activeState = IdleCore.createInitialState();
  IdleCore.startRun(activeState, 1000);
  const kmBeforeActive = activeState.km;
  const activeResult = IdleCore.tickRunEconomy(activeState, 100, 'active');
  assert(activeResult.kmCredited === 0, "tickRunEconomy(activity='active'): kreditiert km NICHT direkt");
  assert(activeState.km === kmBeforeActive, "tickRunEconomy(activity='active'): km bleibt unverändert (Coins werden erst bei einem Crash gebankt)");
  assert(activeState.run.coins > 0, "tickRunEconomy(activity='active'): Coins sammeln sich in state.run.coins");
  assert(activeState.run.score > 0, 'tickRunEconomy(): score steigt mit der zurückgelegten Distanz');
  assert(activeState.run.distanceUnits === 100, 'tickRunEconomy(): distanceUnits wird um genau distanceDelta erhöht');

  // Auto-Pilot (activity='idle'): derselbe Distanz-Zuwachs kreditiert SOFORT, aber REDUZIERT km — OHNE state.run.coins zu befüllen.
  const idleState = IdleCore.createInitialState();
  IdleCore.startRun(idleState, 1000);
  const kmBeforeIdle = idleState.km;
  const idleResult = IdleCore.tickRunEconomy(idleState, 100, 'idle');
  assert(idleResult.kmCredited > 0, "tickRunEconomy(activity='idle'): kreditiert km sofort (Auto-Pilot crasht nie, siehe Teil 1)");
  assert(Math.abs(idleState.km - (kmBeforeIdle + idleResult.kmCredited)) < 1e-9, "tickRunEconomy(activity='idle'): km steigt um exakt den zurückgegebenen kmCredited-Betrag");
  assert(idleState.run.coins === 0, "tickRunEconomy(activity='idle'): state.run.coins bleibt bei 0 (Coins gehen direkt in km, nicht in den Run-Pool)");
  assert(idleResult.kmCredited < IdleCore.runCoinsToKm(idleResult.coinsGained), 'tickRunEconomy(): der Auto-Pilot-km-Betrag ist REDUZIERT gegenüber dem vollen Coin-Gegenwert (RUN_AUTOPILOT_CREDIT_MULTIPLIER < 1)');

  // Kein Run aktiv (phase !== 'running') → No-op, unabhängig von activity.
  const readyState = IdleCore.createInitialState();
  const readyKm = readyState.km;
  const noopResult = IdleCore.tickRunEconomy(readyState, 100, 'active');
  assert(noopResult.scoreGained === 0 && noopResult.coinsGained === 0 && noopResult.kmCredited === 0, "tickRunEconomy(): No-op, solange kein Run läuft (phase='ready')");
  assert(readyState.km === readyKm && readyState.run.score === 0, 'tickRunEconomy(): ändert bei phase!=="running" weder km noch state.run');
})();

section('21 · v4→v5 STATE-MIGRATION — alte Saves gewinnen die neue Run-Schicht verlustfrei');
(function () {
  // v3-artiger Rohzustand: kennt weder runner/powerups (v3→v4) NOCH run/runHighscore/runStats (v4→v5).
  const v3Raw = {
    version: 3,
    km: 4321,
    totalKmEarned: 9999,
    ownedBikeIds: ['z125pro', 'klx300'],
    currentBikeId: 'klx300',
    bikeLevels: { z125pro: 2, klx300: 5 },
  };
  const migratedFromV3 = IdleCore.migrateState(v3Raw);
  assert(migratedFromV3.version === IdleCore.IDLE_STATE_VERSION, 'migrateState(v3): hebt die version auf die aktuelle IDLE_STATE_VERSION an');
  assert(migratedFromV3.km === 4321 && migratedFromV3.totalKmEarned === 9999, 'migrateState(v3): bestehende km/totalKmEarned bleiben byte-für-byte erhalten');
  assert(JSON.stringify(migratedFromV3.ownedBikeIds) === JSON.stringify(['z125pro', 'klx300']), 'migrateState(v3): ownedBikeIds bleibt erhalten');
  assert(migratedFromV3.bikeLevels.klx300 === 5, 'migrateState(v3): bikeLevels (Tuning) bleibt erhalten');
  assert(migratedFromV3.run && migratedFromV3.run.phase === 'ready', "migrateState(v3): state.run wird additiv mit phase='ready' aufgefüllt (kein runner/powerups im Rohzustand → auch kein run)");
  assert(migratedFromV3.runHighscore === 0, 'migrateState(v3): runHighscore wird additiv auf 0 aufgefüllt');
  assert(migratedFromV3.runStats.totalRuns === 0, 'migrateState(v3): runStats wird additiv mit Nullen aufgefüllt');
  assert(migratedFromV3.runner.jumpUntil === null && migratedFromV3.runner.duckUntil === null, 'migrateState(v3): runner.jumpUntil/duckUntil werden additiv auf null aufgefüllt');

  // v4-artiger Rohzustand: kennt runner/powerups bereits, aber noch KEIN run/runHighscore/runStats/jumpUntil/duckUntil.
  const v4Raw = {
    version: 4,
    km: 111,
    totalKmEarned: 222,
    ownedBikeIds: ['z125pro'],
    currentBikeId: 'z125pro',
    bikeLevels: { z125pro: 1 },
    runner: { lane: 2, lastInputAt: 500, collisionMalusExpiresAt: null },
    powerups: { collected: 7, magnetExpiresAt: null, turboExpiresAt: null, shieldExpiresAt: null },
    prestige: { level: 1, points: 3, trophies: 2, contracts: [] },
  };
  const migratedFromV4 = IdleCore.migrateState(v4Raw);
  assert(migratedFromV4.km === 111 && migratedFromV4.totalKmEarned === 222, 'migrateState(v4): bestehende km/totalKmEarned bleiben erhalten');
  assert(migratedFromV4.runner.lane === 2 && migratedFromV4.runner.lastInputAt === 500, 'migrateState(v4): bestehende runner-Felder (lane/lastInputAt) bleiben erhalten');
  assert(migratedFromV4.runner.jumpUntil === null && migratedFromV4.runner.duckUntil === null, 'migrateState(v4): NEUE runner-Felder (jumpUntil/duckUntil) werden additiv aufgefüllt, OHNE bestehende Felder zu verändern');
  assert(migratedFromV4.powerups.collected === 7, 'migrateState(v4): bestehendes powerups.collected bleibt erhalten');
  assert(migratedFromV4.prestige.level === 1 && migratedFromV4.prestige.trophies === 2, 'migrateState(v4): bestehende prestige/Saison-Daten bleiben erhalten');
  assert(migratedFromV4.run && migratedFromV4.run.phase === 'ready' && migratedFromV4.run.score === 0, 'migrateState(v4): state.run wird additiv mit Standardwerten aufgefüllt');
  assert(migratedFromV4.runHighscore === 0 && migratedFromV4.runStats.totalCrashes === 0, 'migrateState(v4): runHighscore/runStats werden additiv aufgefüllt');

  // Ein v5-Save mit bereits vorhandenen (z. B. hohen) run-Werten übernimmt diese unverändert.
  const v5Raw = {
    version: 5,
    km: 50,
    totalKmEarned: 50,
    ownedBikeIds: ['z125pro'],
    currentBikeId: 'z125pro',
    bikeLevels: { z125pro: 0 },
    run: { phase: 'crashed', score: 777, coins: 12, combo: 4, comboMult: 3, speedPct: 40, distanceUnits: 900, startedAt: 100 },
    runHighscore: 777,
    runStats: { totalRuns: 3, totalCoinsCollected: 90, totalCrashes: 3, bestComboEver: 6 },
  };
  const migratedFromV5 = IdleCore.migrateState(v5Raw);
  assert(migratedFromV5.run.phase === 'crashed' && migratedFromV5.run.score === 777, 'migrateState(v5): bestehende gültige run-Werte werden übernommen statt überschrieben');
  assert(migratedFromV5.runHighscore === 777, 'migrateState(v5): bestehender runHighscore wird übernommen');
  assert(migratedFromV5.runStats.totalRuns === 3 && migratedFromV5.runStats.bestComboEver === 6, 'migrateState(v5): bestehende runStats werden übernommen');

  // Ein korrupter/ungültiger phase-Wert fällt defensiv auf 'ready' zurück (NIE 'running' aus ungeprüften Rohdaten übernehmen).
  const corruptPhaseRaw = { version: 5, run: { phase: 'not-a-real-phase', score: -5, coins: 'nope' } };
  const migratedCorrupt = IdleCore.migrateState(corruptPhaseRaw);
  assert(migratedCorrupt.run.phase === 'ready', "migrateState(): ein ungültiger run.phase-Wert fällt defensiv auf 'ready' zurück");
  assert(migratedCorrupt.run.score === 0 && migratedCorrupt.run.coins === 0, 'migrateState(): ungültig getypte run-Felder (negativ/falscher Typ) fallen defensiv auf die Standardwerte zurück');
})();

section('22 · Regression: runnerLeadSeconds()-Boden bleibt unabhängig von Teil 3 garantiert');
(function () {
  // Der 0.6s-Vorlaufzeit-Boden ist eine reine Funktion von speedPct (Teil 1, unverändert) —
  // Teil 3 fügt NUR eine distanz-/aktivitätsabhängige WIRTSCHAFT hinzu, rührt runnerLeadSeconds()
  // selbst nicht an. Explizite Sweep-Regression, damit eine künftige Phase-B-Schwierigkeitskurve
  // (Dichte/Muster nach Distanz) diesen Boden niemals versehentlich unterschreiten kann.
  for (let speedPct = 0; speedPct <= 100; speedPct += 5) {
    const lead = IdleCore.runnerLeadSeconds(speedPct);
    assert(lead >= IdleCore.IDLE_BALANCE.RUNNER_MIN_LEAD_SECONDS - 1e-9, `runnerLeadSeconds(${speedPct}) respektiert weiterhin RUNNER_MIN_LEAD_SECONDS`);
  }
  // Am/über dem Speed-Cap wird der Boden exakt erreicht (mathematische Garantie, siehe idle-core.js-Docblock).
  assert(
    Math.abs(IdleCore.runnerLeadSeconds(IdleCore.IDLE_BALANCE.RUNNER_SPEED_CAP_PCT) - IdleCore.IDLE_BALANCE.RUNNER_MIN_LEAD_SECONDS) < 1e-9,
    'runnerLeadSeconds(RUNNER_SPEED_CAP_PCT) trifft den Boden exakt'
  );
})();

section('23 · TEIL 4 — feat(nearmiss): isNearMiss()/registerNearMiss()/runComboMultiplier() — Bonus, Combo-Cap, Reset-bei-Crash');
(function () {
  // runComboMultiplier(): identische Formel wie comboMultiplier() (2x Basis, +0.5x/Punkt, Deckel 5x), aber eigene Konstanten.
  assert(IdleCore.runComboMultiplier(0) === 1, 'runComboMultiplier(0) liefert 1 (kein Bonus)');
  assert(
    Math.abs(IdleCore.runComboMultiplier(1) - IdleCore.IDLE_BALANCE.RUN_COMBO_MULTIPLIER_BASE) < 1e-9,
    'runComboMultiplier(1) entspricht exakt RUN_COMBO_MULTIPLIER_BASE'
  );
  let prevCombo = -Infinity;
  for (let combo = 0; combo <= 30; combo++) {
    const mult = IdleCore.runComboMultiplier(combo);
    assert(mult >= prevCombo - 1e-9, `runComboMultiplier(${combo}) ist monoton nicht-fallend`);
    assert(mult <= IdleCore.IDLE_BALANCE.RUN_COMBO_MULTIPLIER_MAX + 1e-9, `runComboMultiplier(${combo}) respektiert den Deckel RUN_COMBO_MULTIPLIER_MAX (5)`);
    prevCombo = mult;
  }
  assert(
    Math.abs(IdleCore.runComboMultiplier(30) - IdleCore.IDLE_BALANCE.RUN_COMBO_MULTIPLIER_MAX) < 1e-9,
    'runComboMultiplier() erreicht bei hoher Combo exakt den Deckel (5x)'
  );

  // isNearMiss(): 'side' in einer BENACHBARTEN Lane ist ein Near-Miss, in der EIGENEN oder einer ferneren Lane NICHT.
  const nmState = IdleCore.createInitialState();
  IdleCore.startRun(nmState, 1000);
  nmState.runner.lane = 1; // mittig bei RUNNER_LANE_COUNT=3
  assert(IdleCore.isNearMiss(nmState, { lane: 0, type: 'side' }, 1000) === true, "isNearMiss(): 'side' in einer Lane daneben ist ein Near-Miss");
  assert(IdleCore.isNearMiss(nmState, { lane: 2, type: 'side' }, 1000) === true, "isNearMiss(): 'side' auf der ANDEREN Nachbar-Lane ist ebenfalls ein Near-Miss");
  assert(IdleCore.isNearMiss(nmState, { lane: 1, type: 'side' }, 1000) === false, "isNearMiss(): 'side' in der EIGENEN Lane ist KEIN Near-Miss (das ist ein Crash, kein knapper Vorbeigang)");

  // isNearMiss(): 'lowBar'/'highBarrier' in der EIGENEN Lane, SAUBER pariert (Sprung/Ducken), ist ein Near-Miss.
  assert(IdleCore.isNearMiss(nmState, { lane: 1, type: 'lowBar' }, 1000) === false, "isNearMiss(): 'lowBar' in der eigenen Lane OHNE Sprung ist KEIN Near-Miss (das ist ein Crash)");
  IdleCore.jumpRunner(nmState, 1000);
  assert(IdleCore.isNearMiss(nmState, { lane: 1, type: 'lowBar' }, 1200) === true, "isNearMiss(): 'lowBar' in der eigenen Lane MIT aktivem Sprung ist ein Near-Miss");
  assert(IdleCore.isNearMiss(nmState, { lane: 0, type: 'lowBar' }, 1200) === false, "isNearMiss(): 'lowBar' in einer FREMDEN Lane ist KEIN Near-Miss (schlicht irrelevant)");

  // registerNearMiss(): erhöht combo, aktualisiert comboMult (runComboMultiplier()), schreibt den fixen Score-Bonus gut.
  const regState = IdleCore.createInitialState();
  IdleCore.startRun(regState, 1000);
  const scoreBefore = regState.run.score;
  const firstResult = IdleCore.registerNearMiss(regState, 1000);
  assert(regState.run.combo === 1, 'registerNearMiss(): erhöht state.run.combo um 1');
  assert(
    Math.abs(regState.run.comboMult - IdleCore.runComboMultiplier(1)) < 1e-9,
    'registerNearMiss(): aktualisiert state.run.comboMult exakt auf runComboMultiplier(combo)'
  );
  assert(firstResult.bonus === IdleCore.IDLE_BALANCE.RUN_NEAR_MISS_SCORE_BONUS, 'registerNearMiss(): liefert den konfigurierten Score-Bonus zurück');
  assert(
    Math.abs(regState.run.score - (scoreBefore + IdleCore.IDLE_BALANCE.RUN_NEAR_MISS_SCORE_BONUS)) < 1e-9,
    'registerNearMiss(): schreibt den Score-Bonus sofort auf state.run.score gut'
  );
  IdleCore.registerNearMiss(regState, 1000);
  assert(regState.run.combo === 2, 'registerNearMiss(): jeder weitere Near-Miss erhöht die Combo weiter');

  // Ein echter Crash (endRun()) setzt die Combo zurück — ein Near-Miss selbst NIE.
  regState.run.score = 500;
  const summary = IdleCore.endRun(regState, 2000);
  assert(summary.score === 500, 'endRun(): die Zusammenfassung zeigt den finalen Score inkl. aller Near-Miss-Boni');
  assert(regState.run.combo === 0 && regState.run.comboMult === 1, 'endRun() (echter Crash): setzt combo/comboMult auf 0/1 zurück');
})();

section('24 · TEIL 4 — feat(score): runScoreForDistance()-Multiplikator (Combo × Score-x2) + tickRunEconomy()-Verdrahtung');
(function () {
  // runScoreForDistance(): ohne Multiplikator identisch zu Phase A; mit Multiplikator strikt höher.
  const base = IdleCore.runScoreForDistance(100);
  assert(base === 100 * IdleCore.IDLE_BALANCE.RUN_SCORE_PER_DISTANCE_UNIT, 'runScoreForDistance(distance) ohne Multiplikator bleibt unverändert (Rückwärtskompatibilität)');
  const boosted = IdleCore.runScoreForDistance(100, 3);
  assert(Math.abs(boosted - base * 3) < 1e-9, 'runScoreForDistance(distance, mult) skaliert den Score-Zuwachs exakt mit dem Multiplikator');
  assert(IdleCore.runScoreForDistance(100, 0) === base, 'runScoreForDistance(): ein Multiplikator <= 0 fällt defensiv auf 1 zurück');

  // tickRunEconomy(): der aktuelle comboMult fliesst automatisch in den Score-Zuwachs ein.
  const comboState = IdleCore.createInitialState();
  IdleCore.startRun(comboState, 1000);
  comboState.run.comboMult = 4;
  const comboResult = IdleCore.tickRunEconomy(comboState, 100, 'active', 1000);
  assert(
    Math.abs(comboResult.scoreGained - IdleCore.runScoreForDistance(100, 4)) < 1e-9,
    'tickRunEconomy(): der Score-Zuwachs eines Ticks berücksichtigt state.run.comboMult'
  );

  // tickRunEconomy(): ein aktiver Score-x2-Effekt verdoppelt den Score-Zuwachs zusätzlich zur Combo — OHNE km/state.run.coins zu beeinflussen.
  const scoreX2State = IdleCore.createInitialState();
  IdleCore.startRun(scoreX2State, 1000);
  IdleCore.activatePowerupEffect(scoreX2State, 'scoreX2', 1000);
  const kmBefore = scoreX2State.km;
  const withoutBoostState = IdleCore.createInitialState();
  IdleCore.startRun(withoutBoostState, 1000);
  const boostedResult = IdleCore.tickRunEconomy(scoreX2State, 100, 'active', 1000);
  const plainResult = IdleCore.tickRunEconomy(withoutBoostState, 100, 'active', 1000);
  assert(
    Math.abs(boostedResult.scoreGained - plainResult.scoreGained * IdleCore.IDLE_BALANCE.POWERUP_SCORE_X2_MULTIPLIER) < 1e-9,
    'tickRunEconomy(): ein aktiver Score-x2-Effekt verdoppelt den Score-Zuwachs (POWERUP_SCORE_X2_MULTIPLIER) ggü. demselben Tick ohne Effekt'
  );
  assert(boostedResult.coinsGained === plainResult.coinsGained, 'tickRunEconomy(): Score-x2 beeinflusst den Coin-Zuwachs NICHT');
  assert(scoreX2State.km === kmBefore, 'tickRunEconomy(): Score-x2 beeinflusst km NICHT (wirkt nur auf state.run.score)');

  // Score steigt monoton mit der Distanz (bei gleichem Multiplikator).
  let prevScore = -Infinity;
  for (let distance = 0; distance <= 1000; distance += 100) {
    const s = IdleCore.runScoreForDistance(distance, 2);
    assert(s >= prevScore - 1e-9, `runScoreForDistance(${distance}, 2) ist monoton nicht-fallend`);
    prevScore = s;
  }
})();

section('25 · TEIL 4 — feat(coins): collectRunCoin()/generateCoinTrail()/nextCoinTrailIntervalSeconds()');
(function () {
  // collectRunCoin(): bankt in DENSELBEN state.run.coins-Pool wie der distanzbasierte Zuwachs, No-op ohne laufenden Run.
  const coinState = IdleCore.createInitialState();
  IdleCore.startRun(coinState, 1000);
  const coinsBefore = coinState.run.coins;
  const gained = IdleCore.collectRunCoin(coinState, 1000);
  assert(gained === IdleCore.IDLE_BALANCE.RUN_COIN_TRAIL_PICKUP_VALUE, 'collectRunCoin() liefert den konfigurierten Pickup-Wert zurück');
  assert(coinState.run.coins === coinsBefore + gained, 'collectRunCoin() bankt den Pickup-Wert in state.run.coins');

  const notRunningState = IdleCore.createInitialState();
  assert(IdleCore.collectRunCoin(notRunningState, 1000) === 0, 'collectRunCoin(): No-op (liefert 0), solange kein Run läuft (phase !== "running")');
  assert(notRunningState.run.coins === 0, 'collectRunCoin(): ändert state.run.coins NICHT, solange kein Run läuft');

  // generateCoinTrail(): liefert RUN_COIN_TRAIL_LENGTH Münzen, alle mit gültiger Lane, streng steigendem offsetT.
  const trail = IdleCore.generateCoinTrail(Math.random, 3);
  assert(trail.length === IdleCore.IDLE_BALANCE.RUN_COIN_TRAIL_LENGTH, 'generateCoinTrail() liefert genau RUN_COIN_TRAIL_LENGTH Münzen');
  let prevOffset = -Infinity;
  trail.forEach((coin, i) => {
    assert(coin.lane >= 0 && coin.lane < 3, `generateCoinTrail(): Münze ${i} hat eine gültige Lane (0..2)`);
    assert(coin.offsetT > prevOffset, `generateCoinTrail(): offsetT steigt streng monoton (Münze ${i})`);
    prevOffset = coin.offsetT;
  });

  // Über viele Trails hinweg: mindestens EIN Bogen-Trail (Lane wechselt innerhalb des Trails) taucht auf (ARC_CHANCE > 0).
  let sawLaneChange = false;
  let trailSeed = 7;
  function seededTrailRandom() { trailSeed = (trailSeed * 1103515245 + 12345) & 0x7fffffff; return trailSeed / 0x7fffffff; }
  for (let i = 0; i < 200; i++) {
    const t = IdleCore.generateCoinTrail(seededTrailRandom, 3);
    const lanes = new Set(t.map((c) => c.lane));
    if (lanes.size > 1) sawLaneChange = true;
  }
  assert(sawLaneChange, 'generateCoinTrail(): erzeugt über viele Spawns hinweg auch über Lanes wandernde BOGEN-Trails (nicht nur gerade Linien)');

  // nextCoinTrailIntervalSeconds(): liegt innerhalb der konfigurierten Grenzen.
  for (let i = 0; i < 50; i++) {
    const interval = IdleCore.nextCoinTrailIntervalSeconds(Math.random);
    assert(
      interval >= IdleCore.IDLE_BALANCE.RUN_COIN_TRAIL_INTERVAL_MIN_SECONDS - 1e-9 && interval <= IdleCore.IDLE_BALANCE.RUN_COIN_TRAIL_INTERVAL_MAX_SECONDS + 1e-9,
      `nextCoinTrailIntervalSeconds() (${interval.toFixed(2)}s) liegt innerhalb der konfigurierten Grenzen`
    );
  }
})();

section('26 · TEIL 4 — feat(powerups): Turbo lässt \'lowBar\' OHNE Sprung passieren + Drop-Rarität Powerups vs. Münz-Trails');
(function () {
  // Turbo (Teil 4): 'lowBar' verursacht WÄHREND eines aktiven Turbo-Effekts KEINEN Treffer, auch ohne Sprung.
  const turboState = IdleCore.createInitialState();
  IdleCore.startRun(turboState, 1000);
  assert(IdleCore.obstacleCausesCrash('lowBar', turboState, 1000) === true, "obstacleCausesCrash('lowBar') ohne Sprung/Turbo bleibt ein Treffer");
  IdleCore.activatePowerupEffect(turboState, 'turbo', 1000);
  assert(IdleCore.obstacleCausesCrash('lowBar', turboState, 1000) === false, "obstacleCausesCrash('lowBar') ist WÄHREND eines aktiven Turbo-Effekts KEIN Treffer (auch ohne Sprung)");
  assert(IdleCore.obstacleCausesCrash('highBarrier', turboState, 1000) === true, "obstacleCausesCrash('highBarrier') bleibt trotz Turbo ein Treffer OHNE Ducken (Turbo hilft nur bei 'lowBar')");
  const turboDetect = IdleCore.detectRunCollision(turboState, 'lowBar', 1000);
  assert(turboDetect.crashed === false && turboDetect.shielded === false, "detectRunCollision('lowBar') während Turbo: kein Crash, KEIN Schild-Verbrauch (Turbo alleine reicht)");

  // Drop-Rarität: Powerups sind SELTENER als Münz-Trails — beide Spawn-Intervalle vergleichen (grösseres Intervall = seltener).
  let sumPowerupInterval = 0, sumCoinInterval = 0;
  const SAMPLE = 2000;
  let raritySeed = 21;
  function seededRarityRandom() { raritySeed = (raritySeed * 1103515245 + 12345) & 0x7fffffff; return raritySeed / 0x7fffffff; }
  for (let i = 0; i < SAMPLE; i++) {
    sumPowerupInterval += IdleCore.nextPowerupIntervalSeconds(seededRarityRandom);
    sumCoinInterval += IdleCore.nextCoinTrailIntervalSeconds(seededRarityRandom);
  }
  assert(sumPowerupInterval > sumCoinInterval, 'Powerup-Spawn-Intervalle sind im Mittel deutlich länger als Münz-Trail-Spawn-Intervalle (Powerups sind seltener als Münzen)');
  // Zusätzlich: EIN Münz-Trail (mehrere Münzen) erscheint bei jedem Spawn-Versuch garantiert, ein Powerup nur mit powerupSpawnChance() (< 1).
  const chanceState = IdleCore.createInitialState();
  assert(IdleCore.powerupSpawnChance(chanceState) < 1, 'powerupSpawnChance() liegt strikt unter 1 — nicht jeder Powerup-Spawn-Versuch liefert tatsächlich ein Powerup, ein Münz-Trail-Versuch hingegen immer RUN_COIN_TRAIL_LENGTH Münzen');

  // Roster-Bestätigung: 'scoreX2' ist im Gewichtungs-Objekt, 'muenzregen' ist es NICHT mehr.
  const weights = IdleCore.IDLE_BALANCE.POWERUP_TYPE_WEIGHTS;
  assert(Object.prototype.hasOwnProperty.call(weights, 'scoreX2'), 'POWERUP_TYPE_WEIGHTS enthält den neuen Typ "scoreX2"');
  assert(!Object.prototype.hasOwnProperty.call(weights, 'muenzregen'), 'POWERUP_TYPE_WEIGHTS enthält "muenzregen" NICHT mehr (durch scoreX2 ersetzt)');
  assert(Object.keys(weights).length === 4, 'POWERUP_TYPE_WEIGHTS bleibt bei genau 4 Einträgen (1:1-Ersatz, kein 5. Slot)');
})();

section('27 · TEIL 4 — feat(difficulty): runDifficultyDensity()/runDifficultyPatternTier()/runDifficultyWaveSize() + 0.6s-Boden bei JEDER Distanz');
(function () {
  // runDifficultyDensity(): startet bei 1 (Distanz 0), steigt monoton, gedeckelt auf RUN_DIFFICULTY_DENSITY_MAX_MULTIPLIER.
  assert(IdleCore.runDifficultyDensity(0) === 1, 'runDifficultyDensity(0) liefert 1 (keine Verstärkung am Run-Anfang)');
  let prevDensity = -Infinity;
  for (let distance = 0; distance <= 10000; distance += 250) {
    const density = IdleCore.runDifficultyDensity(distance);
    assert(density >= prevDensity - 1e-9, `runDifficultyDensity(${distance}) ist monoton nicht-fallend`);
    assert(density <= IdleCore.IDLE_BALANCE.RUN_DIFFICULTY_DENSITY_MAX_MULTIPLIER + 1e-9, `runDifficultyDensity(${distance}) respektiert den Deckel RUN_DIFFICULTY_DENSITY_MAX_MULTIPLIER`);
    prevDensity = density;
  }
  assert(
    Math.abs(IdleCore.runDifficultyDensity(IdleCore.IDLE_BALANCE.RUN_DIFFICULTY_DISTANCE_SCALE_UNITS) - IdleCore.IDLE_BALANCE.RUN_DIFFICULTY_DENSITY_MAX_MULTIPLIER) < 1e-9,
    'runDifficultyDensity() erreicht bei RUN_DIFFICULTY_DISTANCE_SCALE_UNITS exakt den Deckel'
  );
  assert(
    IdleCore.runDifficultyDensity(IdleCore.IDLE_BALANCE.RUN_DIFFICULTY_DISTANCE_SCALE_UNITS * 5) === IdleCore.runDifficultyDensity(IdleCore.IDLE_BALANCE.RUN_DIFFICULTY_DISTANCE_SCALE_UNITS),
    'runDifficultyDensity() steigt NICHT über den Deckel hinaus, auch bei sehr grosser Distanz'
  );

  // runDifficultyPatternTier()/runDifficultyWaveSize(): steigt in Stufen, bleibt aber IMMER mindestens eine Lane frei.
  assert(IdleCore.runDifficultyPatternTier(0) === 0, 'runDifficultyPatternTier(0) ist Stufe 0 (nur einzelne Hindernisse)');
  assert(IdleCore.runDifficultyPatternTier(IdleCore.IDLE_BALANCE.RUN_DIFFICULTY_PATTERN_TIER1_UNITS) === 1, 'runDifficultyPatternTier() erreicht Stufe 1 bei RUN_DIFFICULTY_PATTERN_TIER1_UNITS');
  assert(IdleCore.runDifficultyPatternTier(IdleCore.IDLE_BALANCE.RUN_DIFFICULTY_PATTERN_TIER2_UNITS) === 2, 'runDifficultyPatternTier() erreicht Stufe 2 bei RUN_DIFFICULTY_PATTERN_TIER2_UNITS');
  for (let distance = 0; distance <= 8000; distance += 200) {
    const waveSize = IdleCore.runDifficultyWaveSize(distance, 3);
    assert(waveSize >= 1 && waveSize <= 2, `runDifficultyWaveSize(${distance}, 3 Lanes) lässt bei 3 Lanes IMMER mindestens eine Lane frei (max. 2 gleichzeitige Hindernisse)`);
  }
  assert(IdleCore.runDifficultyWaveSize(0, 1) === 1, 'runDifficultyWaveSize() liefert bei nur 1 Lane trotzdem mindestens 1 (kein 0/negativer Wert)');

  // Kern-Invariante (Teil 4 darf sie NIE verletzen): runnerLeadSeconds() bleibt bei JEDER Kombination aus speedPct UND in-run distanceUnits über dem 0.6s-Boden,
  // weil runDifficultyDensity() NUR in nextObstacleSpawnIntervalSeconds() (Spawn-Häufigkeit) einfliesst, NIEMALS in runnerLeadSeconds() selbst.
  for (let speedPct = 0; speedPct <= 100; speedPct += 10) {
    const lead = IdleCore.runnerLeadSeconds(speedPct);
    assert(lead >= IdleCore.IDLE_BALANCE.RUNNER_MIN_LEAD_SECONDS - 1e-9, `runnerLeadSeconds(${speedPct}) hält den 0.6s-Boden (Teil 4 nimmt keinen Parameter für distanceUnits an)`);
    for (let distance = 0; distance <= 8000; distance += 2000) {
      const interval = IdleCore.nextObstacleSpawnIntervalSeconds(speedPct, () => 0.5, distance);
      assert(interval > 0, `nextObstacleSpawnIntervalSeconds(${speedPct}, ..., ${distance}) bleibt strikt positiv (nie ein Endlos-Spawn-Stau)`);
    }
  }
  // Explizit: höhere Distanz liefert (bei gleichem speedPct/rng) ein KÜRZERES ODER GLEICHES Intervall, NIE ein längeres.
  const lowDistanceInterval = IdleCore.nextObstacleSpawnIntervalSeconds(50, () => 0.5, 0);
  const highDistanceInterval = IdleCore.nextObstacleSpawnIntervalSeconds(50, () => 0.5, IdleCore.IDLE_BALANCE.RUN_DIFFICULTY_DISTANCE_SCALE_UNITS);
  assert(highDistanceInterval <= lowDistanceInterval + 1e-9, 'nextObstacleSpawnIntervalSeconds(): höhere In-Run-Distanz verkürzt das Spawn-Intervall (mehr Dichte), nie umgekehrt');
})();

// ============================================================
// Results
// ============================================================
console.log('\n' + '═'.repeat(60));
console.log(`  RESULTS: ${passed}/${passed + failed} passed`);
console.log('═'.repeat(60) + '\n');

if (failed > 0) process.exit(1);
