#!/usr/bin/env node
/**
 * Headless Test — Live-km-Gutschrift während der aktiven Fahrt (idle-core.js)
 *
 * Prüft die Fairness/Integration TEIL 2 Erweiterung (feat(live-km)):
 *
 *  1. Die LIVE-km-Rate (aktiver Modus) folgt EXAKT der bestehenden
 *     runCoinsForDistance()/runCoinsToKm()-Formel, skaliert mit
 *     IDLE_BALANCE.RUN_ACTIVE_KM_CREDIT_MULTIPLIER — keine neu erfundene
 *     Ökonomie, sondern Wiederverwendung der bereits existierenden
 *     Distanz→Coin→km-Umrechnung.
 *  2. Die aktive Rate ist über viele Ticks/Distanzen hinweg IMMER klar
 *     höher als die Auto-Pilot-Fallback-Rate (RUN_AUTOPILOT_CREDIT_
 *     MULTIPLIER) — aktives Fahren lohnt sich sichtbar mehr.
 *  3. Die Gutschrift ist auf RUN_LIVE_KM_CREDIT_INTERVAL_SECONDS gedrosselt
 *     (Kadenz): innerhalb des Intervalls bankt kein Tick etwas, exakt beim/
 *     nach Ablauf wird die seit dem letzten Flush akkumulierte Distanz in
 *     EINEM Schritt gebankt — über eine lange Tick-Sequenz hinweg bleibt
 *     die GESAMTSUMME der gebankten Live-km trotzdem exakt gleich der
 *     Summe ohne Drosselung (reine Anzeige-Glättung, kein Wirtschafts-
 *     Verlust).
 *  4. Ein Crash NACH mehreren Live-km-Flushes bankt den Coin→km-BONUS aus
 *     endRun() weiterhin GENAU EINMAL, ZUSÄTZLICH zum bereits gebankten
 *     Live-km (zwei additive, unabhängige Quellen — kein Doppel-Zählen,
 *     kein Verlust durch den Crash).
 *
 * Run: node tests/live-km-test.js
 * Exit 0 = alle Tests bestanden, Exit 1 = mindestens ein Fehler.
 */

'use strict';

const IdleCore = require('../idle-core.js');
const B = IdleCore.IDLE_BALANCE;

// ============================================================
// Test harness (Stil analog zu tests/idle-core-test.js / tests/runner-fairness-test.js)
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

const FLUSH_MS = B.RUN_LIVE_KM_CREDIT_INTERVAL_SECONDS * 1000;

// ============================================================
section('1 · Live-km-Rate folgt EXAKT der bestehenden runCoinsForDistance()/runCoinsToKm()-Formel × RUN_ACTIVE_KM_CREDIT_MULTIPLIER');
// ============================================================
(function () {
  const state = IdleCore.createInitialState();
  IdleCore.startRun(state, 1000);

  // Erster Tick etabliert nur die Zeitbasis (kein Banking).
  IdleCore.tickRunEconomy(state, 40, 'active', 1000);
  // Zweiter Tick NACH Ablauf des Drossel-Intervalls: akkumulierte Distanz (40+60=100) wird gebankt.
  const km0 = state.km;
  const result = IdleCore.tickRunEconomy(state, 60, 'active', 1000 + FLUSH_MS + 1);
  const expected = IdleCore.runCoinsToKm(IdleCore.runCoinsForDistance(100)) * B.RUN_ACTIVE_KM_CREDIT_MULTIPLIER;

  assert(result.kmCredited > 0, 'Nach Ablauf des Drossel-Intervalls wird tatsächlich Live-km gebankt');
  assert(Math.abs(result.kmCredited - expected) < 1e-9, 'Der gebankte Betrag entspricht EXAKT runCoinsToKm(runCoinsForDistance(distanz)) × RUN_ACTIVE_KM_CREDIT_MULTIPLIER');
  assert(Math.abs(state.km - (km0 + expected)) < 1e-9, 'state.km steigt um exakt den gebankten Betrag');

  // Reine Distanz-Rate (km pro Distanz-Einheit) entspricht RUN_COIN_PER_DISTANCE_UNIT × RUN_COIN_KM_VALUE × RUN_ACTIVE_KM_CREDIT_MULTIPLIER.
  const ratePerUnit = result.kmCredited / 100;
  const expectedRatePerUnit = B.RUN_COIN_PER_DISTANCE_UNIT * B.RUN_COIN_KM_VALUE * B.RUN_ACTIVE_KM_CREDIT_MULTIPLIER;
  assert(Math.abs(ratePerUnit - expectedRatePerUnit) < 1e-9, 'Die effektive Live-km-Rate pro Distanz-Einheit ist RUN_COIN_PER_DISTANCE_UNIT × RUN_COIN_KM_VALUE × RUN_ACTIVE_KM_CREDIT_MULTIPLIER — keine neu erfundene Ökonomie');
})();

// ============================================================
section('2 · Aktive Rate ist IMMER klar höher als die Auto-Pilot-Fallback-Rate');
// ============================================================
(function () {
  const distances = [10, 33, 77, 150, 500];
  distances.forEach(function (distance) {
    // Aktiver Run: zwei Ticks, damit garantiert ein Flush über die Gesamtdistanz erfolgt.
    const activeState = IdleCore.createInitialState();
    IdleCore.startRun(activeState, 1000);
    IdleCore.tickRunEconomy(activeState, distance, 'active', 1000);
    const activeResult = IdleCore.tickRunEconomy(activeState, 0.0001, 'active', 1000 + FLUSH_MS + 1);
    const activeRate = activeResult.kmCredited / distance;

    // Auto-Pilot: identische Distanz, EIN Tick (bankt sofort, siehe tickRunEconomy()).
    const idleState = IdleCore.createInitialState();
    IdleCore.startRun(idleState, 1000);
    const idleResult = IdleCore.tickRunEconomy(idleState, distance, 'idle', 1000);
    const idleRate = idleResult.kmCredited / distance;

    assert(activeRate > idleRate, `Bei Distanz ${distance}: aktive Live-km-Rate (${activeRate.toFixed(5)}) ist klar höher als die Auto-Pilot-Rate (${idleRate.toFixed(5)})`);
  });

  assert(B.RUN_ACTIVE_KM_CREDIT_MULTIPLIER > B.RUN_AUTOPILOT_CREDIT_MULTIPLIER, 'RUN_ACTIVE_KM_CREDIT_MULTIPLIER > RUN_AUTOPILOT_CREDIT_MULTIPLIER — strukturell garantiert, nicht nur zufällig bei diesen Beispielen');
})();

// ============================================================
section('3 · Gutschrift-Kadenz: gedrosselt, aber verlustfrei über viele Ticks hinweg');
// ============================================================
(function () {
  const state = IdleCore.createInitialState();
  IdleCore.startRun(state, 1000);

  const TICK_MS = 100; // simuliert ~10 Ticks/Sekunde (deutlich häufiger als das Drossel-Intervall)
  const TICK_COUNT = 100; // 10 Sekunden Fahrt
  const DISTANCE_PER_TICK = 7;

  let flushedTicks = 0;
  let totalCredited = 0;
  for (let i = 1; i <= TICK_COUNT; i++) {
    const now = 1000 + i * TICK_MS;
    const result = IdleCore.tickRunEconomy(state, DISTANCE_PER_TICK, 'active', now);
    if (result.kmCredited > 0) {
      flushedTicks++;
      totalCredited += result.kmCredited;
    }
  }

  assert(flushedTicks > 0, 'Über 10 Sekunden Fahrt hinweg erfolgt mindestens ein Live-km-Flush');
  assert(flushedTicks < TICK_COUNT, 'NICHT jeder einzelne Tick bankt (Drosselung verhindert zittrige Mini-Beträge) — nur ein Bruchteil der Ticks flusht tatsächlich');

  const totalDistance = TICK_COUNT * DISTANCE_PER_TICK;
  const expectedTotal = IdleCore.runCoinsToKm(IdleCore.runCoinsForDistance(totalDistance)) * B.RUN_ACTIVE_KM_CREDIT_MULTIPLIER;
  // Die letzte, noch nicht geflushte Rest-Distanz (state.run.liveKmPendingDistance) zählt NICHT zur bereits gebankten Summe.
  const pendingKm = IdleCore.runCoinsToKm(IdleCore.runCoinsForDistance(state.run.liveKmPendingDistance)) * B.RUN_ACTIVE_KM_CREDIT_MULTIPLIER;
  assert(Math.abs((totalCredited + pendingKm) - expectedTotal) < 1e-9, 'Gebankte Summe + noch ausstehender Rest ergibt EXAKT den theoretischen Gesamtbetrag ohne Drosselung — die Drosselung verzögert nur die Anzeige, verändert NICHT die Gesamt-Einnahme');
  assert(Math.abs(state.run.liveKmCredited - totalCredited) < 1e-9, 'state.run.liveKmCredited (HUD-Anzeige-Basis) summiert exakt alle in diesem Run tatsächlich gebankten Live-km-Beträge');
})();

// ============================================================
section('4 · Crash nach Live-km-Flushes: Coin→km-Bonus bankt weiterhin GENAU EINMAL zusätzlich');
// ============================================================
(function () {
  const state = IdleCore.createInitialState();
  IdleCore.startRun(state, 1000);

  IdleCore.tickRunEconomy(state, 100, 'active', 1000);
  IdleCore.tickRunEconomy(state, 100, 'active', 1000 + FLUSH_MS + 1);
  IdleCore.tickRunEconomy(state, 100, 'active', 1000 + 2 * (FLUSH_MS + 1));

  const kmBeforeCrash = state.km;
  const coinsAtCrash = state.run.coins;
  assert(coinsAtCrash > 0, 'Testvoraussetzung: state.run.coins hat sich über die Ticks hinweg angesammelt');
  assert(kmBeforeCrash > 0, 'Testvoraussetzung: state.km wurde bereits durch mindestens einen Live-km-Flush erhöht, bevor der Run crasht');

  const expectedBonus = IdleCore.runCoinsToKm(coinsAtCrash);
  const summary = IdleCore.endRun(state, 5000);

  assert(summary.coins === coinsAtCrash, 'endRun(): die Zusammenfassung meldet den vollen, im Run gesammelten Coin-Stand');
  assert(Math.abs(state.km - (kmBeforeCrash + expectedBonus)) < 1e-9, 'endRun(): der Coin→km-BONUS wird GENAU EINMAL, additiv zum bereits gebankten Live-km, gutgeschrieben — kein Verlust, kein Doppel-Zählen');
  assert(state.run.phase === 'crashed', 'endRun(): der Run gilt nach dem Crash als beendet');
})();

// ============================================================
// Results
// ============================================================
console.log('\n' + '═'.repeat(60));
console.log(`  RESULTS: ${passed}/${passed + failed} passed`);
console.log('═'.repeat(60) + '\n');

if (failed > 0) process.exit(1);
