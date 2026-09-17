#!/usr/bin/env node
/**
 * Headless Test — Runner-Hindernis-Fairness (idle-core.js)
 *
 * Prüft die Fairness-Garantien der Endless-Runner-Hindernis-Erzeugung
 * (Phase A, TEIL 1 — fix(spawning)):
 *
 *  1. `IdleCore.pickSolvableWaveLanes()` wählt NIE eine Lane, die bereits
 *     durch ein noch nicht resolvtes Hindernis belegt ist, und lässt aus
 *     den aktuell freien Lanes IMMER mindestens eine ungewählt — dadurch
 *     bleibt über beliebig viele, zeitlich überlappende Wellen hinweg
 *     (die eigentliche, vom Recon gefundene CROSS-WAVE-Lücke) IMMER
 *     mindestens eine Lane vollständig frei/passierbar.
 *  2. Eine lange, realistische SIMULATION (hunderte Wellen, seeded RNG,
 *     Hindernisse "resolven" nach einer zufälligen Anzahl Ticks wie im
 *     echten Spiel) verletzt diese Garantie zu KEINEM Zeitpunkt.
 *  3. Ein WORST-CASE-Stresstest (Hindernisse resolven NIE) zeigt, dass die
 *     Funktion in diesem Grenzfall einfach aufhört, neue Hindernisse zu
 *     platzieren, statt die Garantie zu brechen.
 *  4. Strukturelle Prüfung von Nebenbedingung (b) der Aufgabe: da pro
 *     Lane nie zwei Hindernisse gleichzeitig unresolved sein können
 *     (Punkt 1), und die Kollisionsprüfung im Spiel ausschliesslich das
 *     Hindernis auf der AKTUELLEN Spieler-Lane auswertet (siehe
 *     idle.js:1155 `sameLane`), kann eine Spielerin NIE gleichzeitig
 *     Lane wechseln UND springen UND ducken müssen.
 *
 * Run: node tests/runner-fairness-test.js
 * Exit 0 = alle Tests bestanden, Exit 1 = mindestens ein Fehler.
 */

'use strict';

const IdleCore = require('../idle-core.js');

// ============================================================
// Test harness (Stil analog zu tests/idle-core-test.js)
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
 * Erzeugt eine deterministische, seedbare Pseudo-Zufallsfunktion
 * (identisches Muster zu tests/idle-core-test.js' seededSpawnRandom) —
 * liefert Werte in [0,1), reproduzierbar über denselben Seed.
 * @param {number} seed - Start-Seed (> 0).
 * @returns {Function} Zufallsfunktion ohne Argumente, liefert [0,1).
 */
function makeSeededRandom(seed) {
  let value = seed;
  return function () {
    value = (value * 1103515245 + 12345) & 0x7fffffff;
    return value / 0x7fffffff;
  };
}

// ============================================================
section('1 · pickSolvableWaveLanes() — Kern-Invariante bei EINZELNEN Aufrufen');
// ============================================================
(function () {
  const rng = makeSeededRandom(11);
  const SAMPLE_COUNT = 500;
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const laneCount = 2 + Math.floor(rng() * 4); // 2..5 Lanes
    const occupiedCount = Math.floor(rng() * laneCount); // 0..laneCount-1, respektiert die Garantie induktiv
    const occupied = [];
    const occupiedSet = {};
    while (occupied.length < occupiedCount) {
      const lane = Math.floor(rng() * laneCount);
      if (!occupiedSet[lane]) {
        occupiedSet[lane] = true;
        occupied.push(lane);
      }
    }
    const waveSize = Math.floor(rng() * (laneCount + 1)); // darf bewusst zu gross angefordert werden
    const picked = IdleCore.pickSolvableWaveLanes(occupied, waveSize, laneCount, rng);

    // Keine gewählte Lane darf bereits belegt sein.
    picked.forEach(function (lane) {
      assert(!occupiedSet[lane], `pickSolvableWaveLanes() wählt niemals eine bereits belegte Lane (Sample ${i}, Lane ${lane})`);
    });
    // Keine Lane wird innerhalb einer Welle doppelt gewählt.
    assert(new Set(picked).size === picked.length, `pickSolvableWaveLanes() wählt jede Lane höchstens einmal (Sample ${i})`);
    // Kern-Garantie: (belegt ∪ neu-gewählt) lässt IMMER mindestens eine Lane vollständig frei.
    const union = new Set(occupied.concat(picked));
    assert(union.size < laneCount, `pickSolvableWaveLanes() lässt mindestens eine Lane vollständig frei (Sample ${i}: ${union.size}/${laneCount} belegt)`);
  }
})();

// ============================================================
section('2 · pickSolvableWaveLanes() — Degenerierter Grenzfall (nur 1 Lane)');
// ============================================================
(function () {
  const rng = makeSeededRandom(23);
  for (let i = 0; i < 20; i++) {
    const picked = IdleCore.pickSolvableWaveLanes([], 1, 1, rng);
    assert(picked.length === 0, 'pickSolvableWaveLanes() spawnt bei nur 1 Lane NIE ein Hindernis (sonst wäre die einzige Lane nie frei) — bewusst konservativ statt unfair');
  }
})();

// ============================================================
section('3 · Simulation — hunderte überlappende Wellen (CROSS-WAVE-Lücke aus dem Recon)');
// ============================================================
(function () {
  const LANE_COUNT = IdleCore.IDLE_BALANCE.RUNNER_LANE_COUNT; // echte Spiel-Konfiguration (3)
  const WAVE_COUNT = 400;
  const rng = makeSeededRandom(777);

  /**
   * Simuliert eine lange Sequenz von Hindernis-Wellen wie im echten Spiel
   * (spawnRunnerObstacle() in idle.js): pro "Welle" werden zunächst alle
   * noch nicht resolvten Hindernisse aus früheren Wellen ermittelt
   * (occupiedLanes), dann IdleCore.pickSolvableWaveLanes() befragt, dann
   * werden zufällig viele der aktuell offenen Hindernisse als "resolvt"
   * markiert (simuliert das Erreichen der Hit-Zone nach einer
   * variablen Anzahl Ticks) — NACH jeder Welle wird die Fairness-
   * Invariante geprüft.
   * @param {Function} resolveModel - Entscheidet pro offenem Hindernis, ob es in diesem Schritt resolvt (true) oder weiterhin "in Flug" (false) bleibt.
   * @returns {void}
   */
  function runWaveSimulation(resolveModel) {
    let obstacles = []; // { lane, resolved }
    for (let w = 0; w < WAVE_COUNT; w++) {
      const occupied = obstacles.filter(function (o) { return !o.resolved; }).map(function (o) { return o.lane; });
      const desiredWaveSize = 1 + Math.floor(rng() * LANE_COUNT); // darf bewusst > laneCount-1 anfordern
      const picked = IdleCore.pickSolvableWaveLanes(occupied, desiredWaveSize, LANE_COUNT, rng);
      picked.forEach(function (lane) { obstacles.push({ lane: lane, resolved: false }); });

      // Fairness-Invariante NACH dem Spawn: mindestens eine Lane ist frei von JEDEM unresolvten Hindernis.
      const stillUnresolvedLanes = new Set(obstacles.filter(function (o) { return !o.resolved; }).map(function (o) { return o.lane; }));
      assert(stillUnresolvedLanes.size < LANE_COUNT, `Welle ${w}: mindestens eine Lane bleibt vollständig frei (${stillUnresolvedLanes.size}/${LANE_COUNT} belegt)`);

      // Nebenbedingung (b): pro Lane existiert höchstens EIN unresolvtes Hindernis
      // (sonst könnte dieselbe Lane gleichzeitig z. B. 'lowBar' UND 'highBarrier' tragen).
      const laneCounts = {};
      obstacles.filter(function (o) { return !o.resolved; }).forEach(function (o) {
        laneCounts[o.lane] = (laneCounts[o.lane] || 0) + 1;
      });
      Object.keys(laneCounts).forEach(function (lane) {
        assert(laneCounts[lane] <= 1, `Welle ${w}: Lane ${lane} trägt nie mehr als ein unresolvtes Hindernis gleichzeitig (kombinierte Aktionen unmöglich)`);
      });

      // Resolve-Modell anwenden (simuliert das Erreichen der Hit-Zone) + entfernte/aufgelöste Hindernisse säubern.
      obstacles = obstacles.filter(function (o) {
        if (o.resolved) return false; // bereits in einer früheren Welle entfernt
        if (resolveModel(rng)) { o.resolved = true; return true; } // resolvt, aber noch kurz "sichtbar"
        return true;
      });
    }
  }

  // Realistisches Modell: jedes Hindernis hat pro Welle eine Chance, die Hit-Zone zu erreichen.
  runWaveSimulation(function (rnd) { return rnd() < 0.35; });

  // Worst-Case: KEIN Hindernis resolvt jemals — die Funktion muss trotzdem safe bleiben
  // (indem sie irgendwann aufhört, neue Hindernisse zu platzieren).
  runWaveSimulation(function () { return false; });
})();

// ============================================================
section('4 · nextObstacleSpawnIntervalSeconds() — Mindestabstand zwischen Wellen (RUNNER_MIN_WAVE_SPACING_SECONDS)');
// ============================================================
(function () {
  const rng = makeSeededRandom(555);
  const floor = IdleCore.IDLE_BALANCE.RUNNER_MIN_WAVE_SPACING_SECONDS;

  // Selbst am Speed-Cap MIT maximaler In-Run-Schwierigkeit (worst case für kurze Intervalle)
  // unterschreitet das Spawn-Intervall den konfigurierten Mindest-Wellen-Abstand NIE.
  const maxDistance = IdleCore.IDLE_BALANCE.RUN_DIFFICULTY_DISTANCE_SCALE_UNITS;
  for (let i = 0; i < 300; i++) {
    const interval = IdleCore.nextObstacleSpawnIntervalSeconds(100, rng, maxDistance);
    assert(interval >= floor - 1e-9, `nextObstacleSpawnIntervalSeconds(100%, distance=${maxDistance}) unterschreitet den Mindest-Wellen-Abstand (${floor}s) nie (Sample ${i}: ${interval.toFixed(4)}s)`);
  }
  // Auch über den gesamten Geschwindigkeits-/Distanz-Bereich hinweg (kein Sonderfall irgendwo dazwischen).
  for (let speedPct = 0; speedPct <= 100; speedPct += 10) {
    for (let distance = 0; distance <= maxDistance; distance += 500) {
      const interval = IdleCore.nextObstacleSpawnIntervalSeconds(speedPct, rng, distance);
      assert(interval >= floor - 1e-9, `nextObstacleSpawnIntervalSeconds(${speedPct}%, distance=${distance}) respektiert den Mindest-Wellen-Abstand`);
    }
  }
  // Der Boden ist bewusst identisch zur Mindest-Vorlaufzeit gewählt (Konsistenz mit Schritt 2 der Aufgabe).
  assert(floor === IdleCore.IDLE_BALANCE.RUNNER_MIN_LEAD_SECONDS, 'RUNNER_MIN_WAVE_SPACING_SECONDS ist bewusst identisch zu RUNNER_MIN_LEAD_SECONDS (konsistente Reaktionszeit-Garantie)');
})();

// ============================================================
// Results
// ============================================================
console.log('\n' + '═'.repeat(60));
console.log(`  RESULTS: ${passed}/${passed + failed} passed`);
console.log('═'.repeat(60) + '\n');

if (failed > 0) process.exit(1);
