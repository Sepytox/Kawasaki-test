#!/usr/bin/env node
/**
 * Headless Test — Schaltpunkt-Combo per Leertaste (Phase C, TEIL 3,
 * feat(shiftpoint-key)).
 *
 * idle.js selbst (DOM/Canvas-Layer) hat KEINE eigene Testinfrastruktur
 * (kein jsdom im Repo verfügbar) — daher zwei sich ergänzende Ansätze:
 *
 *  1. Die reine ENTSCHEIDUNGS-Logik ("liegt der Marker-Fortschritt
 *     innerhalb der perfekten Zone?") wurde nach idle-core.js in
 *     `IdleCore.evaluateShiftHit()` extrahiert (aus dem vormals inline in
 *     idle.js' evaluateShiftClick() berechneten Ausdruck) — DIESE Logik
 *     wird hier ganz normal unit-getestet (kein DOM nötig).
 *  2. Die restliche, rein DOM-/Event-bezogene Verdrahtung in idle.js
 *     (welche Taste löst was aus, click-Listener entfernt?) wird
 *     STRUKTURELL gegen den idle.js-Quelltext geprüft (Stil analog zu
 *     dark-mode.test.js' CSS-/HTML-Struktur-Tests): Datei einlesen,
 *     relevante Funktionskörper extrahieren, auf die erwarteten
 *     Muster/Abwesenheiten prüfen.
 *
 * Geprüft wird konkret:
 *  - evaluateShiftHit(): Treffer/Fehlversuch/Multiplikator-Zonen-Grenzen
 *    (inklusive Rand, ausserhalb Rand, Default-Zonenmitte).
 *  - wireRunnerControls(): Sprung liegt jetzt auf ArrowUp/W (NICHT mehr
 *    auf Space), Leertaste löst AUSSCHLIESSLICH evaluateShiftAttempt()
 *    aus (kein jumpRunner() im Space-Zweig, kein evaluateShiftAttempt()
 *    im ArrowUp-Zweig).
 *  - wireShiftInteraction(): KEIN click-Listener mehr auf #idleShiftTrack
 *    (ein Klick löst also nichts aus), KEIN Leertaste-Zweig im lokalen
 *    keydown-Handler mehr (verhindert Doppel-Auswertung pro Tastendruck),
 *    Enter bleibt für Tab-Fokus-Zugänglichkeit erhalten. Ausserdem: kein
 *    Pointer-Cursor mehr auf der (nicht mehr klickbaren) Leiste (idle.css).
 *  - wireShiftMobileButton(): existiert, ruft dieselbe
 *    evaluateShiftAttempt()-Auswertung wie die Leertaste auf, wird beim
 *    Start verdrahtet. idle.html/idle.css enthalten den Mobile-Button
 *    strukturell (deutsches aria-label, ausserhalb von #idleTrackWrap).
 *  - RUNNER_CONTROL_EXEMPT_IDS enthält #idleShiftTrack NICHT mehr (die
 *    Leertaste soll dort GENAUSO wie überall sonst die Schaltpunkt-
 *    Auswertung auslösen).
 *
 * Run: node tests/shiftpoint-key-test.js
 * Exit 0 = alle Tests bestanden, Exit 1 = mindestens ein Fehler.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const IdleCore = require('../idle-core.js');

// ============================================================
// Test harness (Stil analog zu tests/runner-fairness-test.js)
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
 * Extrahiert den vollständigen Körper (inkl. verschachtelter Klammern)
 * einer benannten `function name() { ... }`-Deklaration aus Quelltext.
 * @param {string} source - Quelltext einer JS-Datei.
 * @param {string} fnName - Name der zu extrahierenden Funktion.
 * @returns {string|null} Kompletter Funktionstext, oder null falls nicht gefunden.
 */
function extractFunctionBody(source, fnName) {
  const marker = 'function ' + fnName + '(';
  const startIdx = source.indexOf(marker);
  if (startIdx === -1) return null;
  const braceStart = source.indexOf('{', startIdx);
  if (braceStart === -1) return null;
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(startIdx, i + 1);
    }
  }
  return null;
}

const idleJsSource = fs.readFileSync(path.join(__dirname, '..', 'idle.js'), 'utf8');
const idleHtmlSource = fs.readFileSync(path.join(__dirname, '..', 'idle.html'), 'utf8');
const idleCssSource = fs.readFileSync(path.join(__dirname, '..', 'idle.css'), 'utf8');

// ============================================================
section('1 · IdleCore.evaluateShiftHit() — reine Treffer-Entscheidung');
// ============================================================
(function () {
  assert(typeof IdleCore.evaluateShiftHit === 'function', 'IdleCore.evaluateShiftHit ist exportiert und eine Funktion');

  // Zone: Mitte 50%, Breite 34% -> [33, 67].
  assert(IdleCore.evaluateShiftHit(50, 34, 50) === true, 'Genau in der Zonen-Mitte ist ein Treffer');
  assert(IdleCore.evaluateShiftHit(33, 34, 50) === true, 'Linker Zonen-Rand (inklusive) ist ein Treffer');
  assert(IdleCore.evaluateShiftHit(67, 34, 50) === true, 'Rechter Zonen-Rand (inklusive) ist ein Treffer');
  assert(IdleCore.evaluateShiftHit(32.9, 34, 50) === false, 'Knapp links der Zone ist ein Fehlversuch');
  assert(IdleCore.evaluateShiftHit(67.1, 34, 50) === false, 'Knapp rechts der Zone ist ein Fehlversuch');
  assert(IdleCore.evaluateShiftHit(0, 34, 50) === false, 'Sweep-Start (0%) ist weit ausserhalb der Zone -> Fehlversuch');
  assert(IdleCore.evaluateShiftHit(100, 34, 50) === false, 'Sweep-Ende (100%) ist weit ausserhalb der Zone -> Fehlversuch');

  // Default-Zonenmitte (50), falls zoneCenterPct ausgelassen wird.
  assert(IdleCore.evaluateShiftHit(50, 34) === true, 'zoneCenterPct ist optional, Standard ist 50');
  assert(IdleCore.evaluateShiftHit(90, 34) === false, '90% liegt weit ausserhalb einer 34%-Zone um die Standard-Mitte 50');

  // Schrumpfende Zone bei steigender Combo (perfectZoneWidthForState-Muster):
  // engere Zone -> vormals gültige Randwerte werden zu Fehlversuchen.
  const narrowWidth = IdleCore.perfectZoneWidth(10, 34); // hohe Combo -> deutlich schmaler als 34
  assert(narrowWidth < 34, 'perfectZoneWidth() liefert bei hoher Combo eine schmalere Zone (Testvoraussetzung)');
  assert(IdleCore.evaluateShiftHit(50, narrowWidth, 50) === true, 'Zonen-Mitte bleibt auch bei einer schmaleren Zone immer ein Treffer');
  assert(IdleCore.evaluateShiftHit(50 + narrowWidth / 2 + 0.5, narrowWidth, 50) === false, 'Ausserhalb der schmaleren Zone ist es ein Fehlversuch');

  // Verschobene Zonen-Mitte (asymmetrischer zoneCenterPct) wird korrekt berücksichtigt.
  assert(IdleCore.evaluateShiftHit(70, 10, 70) === true, 'Eine verschobene Zonen-Mitte wird korrekt als Zentrum verwendet');
  assert(IdleCore.evaluateShiftHit(50, 10, 70) === false, '50% liegt ausserhalb einer auf 70% zentrierten, schmalen Zone');

  // Äquivalenz zur ehemals in idle.js INLINE berechneten Formel
  // (progressPct >= center-half && progressPct <= center+half) über einen
  // Zufalls-Sample-Raum, damit die Extraktion nach idle-core.js nachweislich
  // KEIN Verhalten verändert hat.
  let seed = 777;
  function rng() {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  }
  for (let i = 0; i < 200; i++) {
    const center = rng() * 100;
    const width = rng() * 60;
    const progress = rng() * 100;
    const half = width / 2;
    const expected = progress >= (center - half) && progress <= (center + half);
    assert(IdleCore.evaluateShiftHit(progress, width, center) === expected, `evaluateShiftHit() entspricht der ehemaligen Inline-Formel (Sample ${i})`);
  }
})();

// ============================================================
section('2 · idle.js — Sprung liegt jetzt auf ArrowUp/W, NICHT mehr auf Space');
// ============================================================
(function () {
  const body = extractFunctionBody(idleJsSource, 'wireRunnerControls');
  assert(body !== null, 'wireRunnerControls() ist in idle.js auffindbar');

  assert(body.includes("event.key === 'ArrowUp' || event.key === 'w' || event.key === 'W'"), 'Der Sprung-Zweig prüft jetzt ArrowUp ODER w/W');
  assert(!body.includes("event.key === 'ArrowUp' || event.key === ' '"), 'Der alte Sprung-Zweig (ArrowUp ODER Leertaste) ist entfernt');

  const arrowUpIdx = body.indexOf("event.key === 'ArrowUp'");
  const afterArrowUp = body.slice(arrowUpIdx, arrowUpIdx + 300);
  assert(afterArrowUp.includes('IdleCore.jumpRunner('), 'Der ArrowUp/W-Zweig ruft weiterhin IdleCore.jumpRunner() auf — Sprung bleibt erhalten');
  assert(!afterArrowUp.includes('evaluateShiftAttempt'), 'Der ArrowUp/W-Zweig löst NICHT die Schaltpunkt-Auswertung aus');
})();

// ============================================================
section('3 · idle.js — Leertaste löst AUSSCHLIESSLICH die Schaltpunkt-Auswertung aus');
// ============================================================
(function () {
  const body = extractFunctionBody(idleJsSource, 'wireRunnerControls');
  assert(body !== null, 'wireRunnerControls() ist in idle.js auffindbar');

  const spaceIdx = body.indexOf("event.key === ' ' || event.key === 'Spacebar'");
  assert(spaceIdx !== -1, 'Es gibt einen eigenen Leertaste-Zweig (getrennt vom ArrowUp/W-Sprung-Zweig)');
  const afterSpace = body.slice(spaceIdx, spaceIdx + 500);
  assert(afterSpace.includes('evaluateShiftAttempt()'), 'Der Leertaste-Zweig ruft evaluateShiftAttempt() auf');
  assert(!afterSpace.includes('jumpRunner'), 'Der Leertaste-Zweig ruft NICHT (mehr) jumpRunner() auf — kein Doppel-Verhalten');
  assert(afterSpace.includes('event.preventDefault()'), 'Der Leertaste-Zweig verhindert das Standard-Scroll-Verhalten der Seite');

  // RUNNER_CONTROL_EXEMPT_IDS: #idleShiftTrack braucht keine Sonderbehandlung
  // mehr (Space wirkt jetzt global immer als Schaltpunkt-Auswertung),
  // die übrigen Buttons bleiben weiterhin exemptiert.
  const exemptMatch = idleJsSource.match(/var RUNNER_CONTROL_EXEMPT_IDS = \{[^}]*\};/);
  assert(exemptMatch !== null, 'RUNNER_CONTROL_EXEMPT_IDS ist als Objekt-Literal auffindbar');
  if (exemptMatch) {
    assert(!exemptMatch[0].includes('idleShiftTrack'), '#idleShiftTrack ist NICHT mehr in RUNNER_CONTROL_EXEMPT_IDS gelistet');
    assert(exemptMatch[0].includes('idlePiggy'), '#idlePiggy bleibt weiterhin exemptiert (eigenes Space-Verhalten)');
    assert(exemptMatch[0].includes('idlePowerup'), '#idlePowerup bleibt weiterhin exemptiert (eigenes Space-Verhalten)');
  }
})();

// ============================================================
section('4 · idle.js — Klick auf die Schaltpunkt-Leiste löst NICHTS mehr aus');
// ============================================================
(function () {
  const body = extractFunctionBody(idleJsSource, 'wireShiftInteraction');
  assert(body !== null, 'wireShiftInteraction() ist in idle.js auffindbar');

  assert(!body.includes(".addEventListener('click'"), 'wireShiftInteraction() registriert KEINEN click-Listener mehr auf #idleShiftTrack');
  assert(!/event\.key === ' '/.test(body), 'Der lokale keydown-Handler von #idleShiftTrack fängt Leertaste NICHT mehr ab (verhindert Doppel-Auswertung)');
  assert(body.includes("event.key === 'Enter'"), 'Enter bleibt für Tab-Fokus-/Screenreader-Zugänglichkeit im lokalen Handler erhalten');
  assert(body.includes('evaluateShiftAttempt()'), 'Enter löst weiterhin evaluateShiftAttempt() aus');
  assert(!/\.idle-shift-track\s*\{[^}]*cursor:\s*pointer/.test(idleCssSource), '.idle-shift-track hat keinen Pointer-Cursor mehr (nicht mehr klickbar)');
})();

// ============================================================
section('5 · idle.js — evaluateShiftAttempt() delegiert an IdleCore.evaluateShiftHit()');
// ============================================================
(function () {
  const body = extractFunctionBody(idleJsSource, 'evaluateShiftAttempt');
  assert(body !== null, 'evaluateShiftAttempt() ist in idle.js auffindbar (Umbenennung von evaluateShiftClick())');
  assert(body.includes('IdleCore.evaluateShiftHit('), 'evaluateShiftAttempt() delegiert die Zonen-Entscheidung an die reine IdleCore.evaluateShiftHit()-Funktion');
  assert(!idleJsSource.includes('function evaluateShiftClick'), 'Die alte Funktion evaluateShiftClick() existiert nicht mehr (umbenannt, da nicht mehr Klick-spezifisch)');
})();

// ============================================================
section('6 · idle.js/idle.html/idle.css — dedizierter Mobile-Button für die Schaltpunkt-Combo');
// ============================================================
(function () {
  const body = extractFunctionBody(idleJsSource, 'wireShiftMobileButton');
  assert(body !== null, 'wireShiftMobileButton() ist in idle.js auffindbar');
  assert(body.includes("getElementById('idleShiftMobileBtn')"), 'wireShiftMobileButton() greift auf #idleShiftMobileBtn zu');
  assert(body.includes('evaluateShiftAttempt()'), 'Der Mobile-Button ruft dieselbe evaluateShiftAttempt()-Auswertung wie die Leertaste auf');

  assert(idleJsSource.includes('wireShiftInteraction();\n    wireShiftMobileButton();'), 'wireShiftMobileButton() wird beim Start direkt nach wireShiftInteraction() verdrahtet');

  assert(idleHtmlSource.includes('id="idleShiftMobileBtn"'), 'idle.html enthält den Mobile-Button mit der erwarteten id');
  assert(/id="idleShiftMobileBtn"[^>]*aria-label="[^"]+"/.test(idleHtmlSource), 'Der Mobile-Button hat ein deutsches aria-label');
  // Der Mobile-Button muss ausserhalb von #idleTrackWrap liegen (Swipe-Zone
  // für den Lane-Wechsel), aber innerhalb desselben #idleShift-Wrappers wie
  // die Schaltpunkt-Leiste (idleShiftTrack) — NICHT vor #idleTrackWrap.
  const trackWrapCloseIdx = idleHtmlSource.indexOf('id="idleShiftTrack"');
  const mobileBtnIdx = idleHtmlSource.indexOf('id="idleShiftMobileBtn"');
  assert(trackWrapCloseIdx !== -1 && mobileBtnIdx !== -1, 'Sowohl #idleShiftTrack als auch #idleShiftMobileBtn sind im HTML auffindbar');
  assert(mobileBtnIdx > trackWrapCloseIdx, 'Der Mobile-Button steht im Markup NACH der Schaltpunkt-Leiste, also klar ausserhalb von #idleTrackWrap (keine Swipe-Zonen-Überlappung)');

  assert(idleCssSource.includes('.idle-shift-mobile-btn'), 'idle.css enthält Styling für .idle-shift-mobile-btn');
  assert(/@media \(max-width: 600px\) \{\s*\.idle-shift-mobile-btn \{ display: block; \}/.test(idleCssSource), 'Der Mobile-Button ist per default ausgeblendet und wird nur auf schmalen Viewports eingeblendet');
})();

// ============================================================
// Results
// ============================================================
console.log('\n' + '═'.repeat(60));
console.log(`  RESULTS: ${passed}/${passed + failed} passed`);
console.log('═'.repeat(60) + '\n');

if (failed > 0) process.exit(1);
