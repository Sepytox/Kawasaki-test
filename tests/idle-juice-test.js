#!/usr/bin/env node
/**
 * Headless Test — juice.js (Runner-Game-Feel-Bausteine, Teil 5, feat(juice-overlay))
 *
 * Statische Prüfungen + echte Unit-Tests der DOM-freien Kernfunktionen
 * (Stil analog zu tests/count-up-test.js/tests/idle-core-test.js), die
 * sicherstellen, dass:
 *  1. juice.js existiert, ist syntaktisch gültiges JavaScript, enthält
 *     JSDoc, kein console.log, und respektiert prefers-reduced-motion.
 *  2. canvasPointToOverlayPoint() Canvas-CSS-Pixel-Koordinaten korrekt in
 *     zum Overlay relative Pixel-Koordinaten umrechnet (reine Mathematik,
 *     ohne echtes DOM).
 *  3. createParticlePool()/acquireParticleNode() Knoten bis zur
 *     Maximalgrösse neu anlegen und danach zuverlässig Round-Robin
 *     wiederverwenden (gedeckeltes DOM-Wachstum, kein Leck).
 *  4. prefersReducedMotion() ohne Browser-Umgebung sicher false liefert
 *     und bei window.matchMedia().matches === true entsprechend true.
 *  5. idle.html bindet juice.js ein (NICHT jedoch soundcheck.html —
 *     geschützte Datei) und idle.js verdrahtet den Overlay-Container.
 *
 * Run: node tests/idle-juice-test.js
 * Exit 0 = alle Tests bestanden, Exit 1 = mindestens ein Fehler.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

/**
 * Liest eine Datei aus dem Projekt-Root als UTF-8-String.
 * @param {string} file - Dateiname relativ zum Projekt-Root.
 * @returns {string} Dateiinhalt.
 */
function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

let passed = 0, failed = 0;

/**
 * Prüft eine Bedingung und protokolliert das Ergebnis.
 * @param {boolean} cond - Zu prüfende Bedingung.
 * @param {string} msg - Beschreibung des Tests.
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
 * Druckt eine Abschnittsüberschrift für die Konsolenausgabe.
 * @param {string} title - Abschnittstitel.
 */
function section(title) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('═'.repeat(60));
}

// ============================================================
section('1. juice.js existiert und erfüllt die Grundregeln');
// ============================================================
{
  const juicePath = path.join(ROOT, 'juice.js');
  assert(fs.existsSync(juicePath), 'juice.js existiert im Projekt-Root');

  const js = fs.readFileSync(juicePath, 'utf8');
  assert(!js.includes('console.log'), 'juice.js enthält kein console.log');
  assert(js.includes('/**'), 'juice.js enthält JSDoc-Kommentare');
  assert(js.includes('prefersReducedMotion'), 'juice.js prüft prefers-reduced-motion');
  assert(js.includes('JUICE_PARTICLE_POOL_MAX'), 'juice.js definiert eine gedeckelte Partikel-Pool-Grösse (SCREAMING_SNAKE_CASE-Konstante)');

  try {
    execSync(`node --check "${juicePath}"`, { cwd: ROOT, stdio: 'pipe' });
    assert(true, 'juice.js ist syntaktisch gültiges JavaScript (node --check)');
  } catch (e) {
    assert(false, 'juice.js ist syntaktisch gültiges JavaScript (node --check)');
  }
}

// ============================================================
section('2. canvasPointToOverlayPoint() rechnet Canvas- in Overlay-Koordinaten um');
// ============================================================
{
  const Juice = require(path.join(ROOT, 'juice.js'));
  assert(typeof Juice.canvasPointToOverlayPoint === 'function', 'canvasPointToOverlayPoint() ist exportiert (Node-Testbarkeit)');

  // Canvas und Overlay füllen exakt dieselbe Box (Normalfall) → Identität.
  const sameRect = { left: 40, top: 20, width: 300, height: 168 };
  const identical = Juice.canvasPointToOverlayPoint(sameRect, sameRect, 123, 77);
  assert(identical.x === 123 && identical.y === 77, 'Bei identischer Canvas-/Overlay-Box bleibt der Punkt unverändert');

  // Overlay um (10, 5) verschoben (z.B. leicht abweichendes Layout) → Versatz wird korrekt ausgeglichen.
  const canvasRect = { left: 50, top: 30 };
  const overlayRect = { left: 40, top: 25 };
  const shifted = Juice.canvasPointToOverlayPoint(canvasRect, overlayRect, 100, 60);
  assert(shifted.x === 110, 'x-Versatz zwischen Canvas- und Overlay-Box wird korrekt aufaddiert (50-40+100=110)');
  assert(shifted.y === 65, 'y-Versatz zwischen Canvas- und Overlay-Box wird korrekt aufaddiert (30-25+60=65)');
}

// ============================================================
section('3. Partikel-Pool: gedeckeltes Wachstum + Round-Robin-Wiederverwendung');
// ============================================================
{
  const Juice = require(path.join(ROOT, 'juice.js'));
  assert(typeof Juice.createParticlePool === 'function', 'createParticlePool() ist exportiert');
  assert(typeof Juice.acquireParticleNode === 'function', 'acquireParticleNode() ist exportiert');

  const originalDocument = global.document;
  const createdNodes = [];
  const appended = [];
  global.document = {
    createElement: function () {
      const node = { className: '' };
      createdNodes.push(node);
      return node;
    }
  };
  const fakeOverlay = { appendChild: function (node) { appended.push(node); } };

  const pool = Juice.createParticlePool(3);
  const n1 = Juice.acquireParticleNode(pool, fakeOverlay, 'a');
  const n2 = Juice.acquireParticleNode(pool, fakeOverlay, 'b');
  const n3 = Juice.acquireParticleNode(pool, fakeOverlay, 'c');
  assert(createdNodes.length === 3, 'Pool legt bis zur Maximalgrösse (3) neue Knoten an');
  assert(appended.length === 3, 'Jeder neu angelegte Knoten wird an den Overlay-Container angehängt');

  const n4 = Juice.acquireParticleNode(pool, fakeOverlay, 'd');
  assert(createdNodes.length === 3, 'Ein 4. Aufruf legt KEINEN weiteren Knoten an (Deckel greift)');
  assert(n4 === n1, 'Der 4. Aufruf verwendet Round-Robin den ERSTEN Knoten erneut');
  assert(n4.className === 'd', 'Wiederverwendeter Knoten bekommt die neue className gesetzt');

  const n5 = Juice.acquireParticleNode(pool, fakeOverlay, 'e');
  assert(n5 === n2, 'Der 5. Aufruf verwendet den ZWEITEN Knoten (Round-Robin läuft weiter)');

  global.document = originalDocument;
}

// ============================================================
section('4. prefersReducedMotion() — mit/ohne Browser-Umgebung');
// ============================================================
{
  const Juice = require(path.join(ROOT, 'juice.js'));

  const originalWindow = global.window;
  global.window = undefined;
  assert(Juice.prefersReducedMotion() === false, 'Ohne window (reines Node) liefert prefersReducedMotion() sicher false');

  global.window = { matchMedia: function () { return { matches: true }; } };
  assert(Juice.prefersReducedMotion() === true, 'Mit window.matchMedia().matches === true liefert prefersReducedMotion() true');

  global.window = { matchMedia: function () { return { matches: false }; } };
  assert(Juice.prefersReducedMotion() === false, 'Mit window.matchMedia().matches === false liefert prefersReducedMotion() false');

  global.window = originalWindow;
}

// ============================================================
section('5. Einbindung: idle.html bindet juice.js ein, soundcheck.html nicht');
// ============================================================
{
  const idleHtml = read('idle.html');
  assert(idleHtml.includes('<script src="juice.js">'), 'idle.html bindet juice.js ein');

  const soundcheckHtml = read('soundcheck.html');
  assert(!soundcheckHtml.includes('juice.js'), 'soundcheck.html bindet juice.js NICHT ein (geschützte Datei)');

  const idleJs = read('idle.js');
  assert(/window\.Juice/.test(idleJs), 'idle.js prüft/nutzt window.Juice (Overlay-Verdrahtung)');
  assert(/Juice\.ensureOverlay\s*\(/.test(idleJs), 'idle.js ruft Juice.ensureOverlay() auf, um den Overlay-Container anzulegen');
}

// ============================================================
// Ergebnis
// ============================================================
console.log(`\n${'═'.repeat(60)}`);
console.log(`  RESULTS: ${passed}/${passed + failed} passed`);
console.log('═'.repeat(60));

if (failed > 0) process.exit(1);
