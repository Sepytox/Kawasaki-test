#!/usr/bin/env node
/**
 * Headless Test — tilt.js (Cursor-Tilt für Bike-Karten, Phase B)
 *
 * Statische Prüfungen + echte Unit-Tests der DOM-freien Kernfunktionen
 * (Stil analog zu tests/count-up-test.js/tests/idle-core-test.js), die
 * sicherstellen, dass:
 *  1. tilt.js existiert, ist syntaktisch gültiges JavaScript, enthält
 *     JSDoc, kein console.log, und prüft prefers-reduced-motion
 *     eigenständig (rAF/Event-Listener werden sonst nicht von der
 *     globalen CSS-Media-Query gestoppt).
 *  2. Die Tokens --tilt-max-deg/--tilt-perspective (design.css, Phase A)
 *     tatsächlich in tilt.js bzw. der komponierenden CSS-Regel
 *     verwendet werden.
 *  3. Tilt NICHT auf ".idle-bike-card" angewendet wird (explizite
 *     No-Transform-Ausnahme laut Mängelliste/idle.css-Kommentar).
 *  4. applyTilt()/resetTilt() nur transform-relevante Custom-Properties
 *     setzen (keine Layout-Eigenschaften) und bei zentrierter
 *     Mausposition ~0deg liefern (DOM-frei, mit Mock-Objekten).
 *  5. index.html bindet tilt.js ein, nicht aber soundcheck.html
 *     (geschützte Datei).
 *
 * Run: node tests/tilt-test.js
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
section('1. tilt.js existiert und erfüllt die Grundregeln');
// ============================================================
{
  const tiltPath = path.join(ROOT, 'tilt.js');
  assert(fs.existsSync(tiltPath), 'tilt.js existiert im Projekt-Root');

  const js = fs.readFileSync(tiltPath, 'utf8');
  assert(!js.includes('console.log'), 'tilt.js enthält kein console.log');
  assert(js.includes('/**'), 'tilt.js enthält JSDoc-Kommentare');
  assert(js.includes('prefersReducedMotion'), 'tilt.js prüft prefers-reduced-motion eigenständig');
  assert(/mousemove/.test(js), 'tilt.js reagiert auf mousemove');

  try {
    execSync(`node --check "${tiltPath}"`, { cwd: ROOT, stdio: 'pipe' });
    assert(true, 'tilt.js ist syntaktisch gültiges JavaScript (node --check)');
  } catch (e) {
    assert(false, 'tilt.js ist syntaktisch gültiges JavaScript (node --check)');
  }
}

// ============================================================
section('2. --tilt-max-deg/--tilt-perspective (Phase-A-Tokens) werden genutzt');
// ============================================================
{
  const designCss = read('design.css');
  assert(designCss.includes('--tilt-max-deg:'), 'design.css definiert --tilt-max-deg (Phase A)');
  assert(designCss.includes('--tilt-perspective:'), 'design.css definiert --tilt-perspective (Phase A)');

  const tiltJs = read('tilt.js');
  assert(tiltJs.includes('--tilt-max-deg'), 'tilt.js liest --tilt-max-deg aus');

  const stylesCss = read('styles.css');
  assert(/rotateX\(var\(--tilt-rx/.test(stylesCss), 'styles.css komponiert die Tilt-Rotation via --tilt-rx');
  assert(/rotateY\(var\(--tilt-ry/.test(stylesCss), 'styles.css komponiert die Tilt-Rotation via --tilt-ry');
  assert(/var\(--tilt-perspective/.test(stylesCss), 'styles.css nutzt --tilt-perspective für die perspective()');
}

// ============================================================
section('3. .idle-bike-card bleibt transform-frei (keine Tilt-Ausnahme verletzt)');
// ============================================================
{
  const tiltJs = read('tilt.js');
  assert(!/idle-bike-card/.test(tiltJs), 'tilt.js referenziert .idle-bike-card nirgends');

  const idleCss = read('idle.css');
  const bikeCardHoverBlock = idleCss.match(/\.idle-bike-card:hover\s*\{([^}]*)\}/);
  assert(bikeCardHoverBlock !== null, '.idle-bike-card:hover-Regel weiterhin vorhanden');
  assert(bikeCardHoverBlock && !/transform\s*:/.test(bikeCardHoverBlock[1]),
    '.idle-bike-card:hover setzt weiterhin KEIN transform (dokumentierte Ausnahme)');
}

// ============================================================
section('4. applyTilt()/resetTilt() — reine transform-Custom-Properties (Mock-DOM)');
// ============================================================
{
  const Tilt = require(path.join(ROOT, 'tilt.js'));
  assert(typeof Tilt.applyTilt === 'function', 'applyTilt() ist exportiert (Node-Testbarkeit)');
  assert(typeof Tilt.resetTilt === 'function', 'resetTilt() ist exportiert (Node-Testbarkeit)');

  function makeMockCard(rect) {
    return {
      style: {
        props: {},
        setProperty: function (key, value) { this.props[key] = value; }
      },
      getBoundingClientRect: function () { return rect; }
    };
  }

  const centerCard = makeMockCard({ left: 0, top: 0, width: 200, height: 100 });
  Tilt.applyTilt(centerCard, { clientX: 100, clientY: 50 }, 6);
  assert(Object.keys(centerCard.style.props).every((k) => k === '--tilt-rx' || k === '--tilt-ry'),
    'applyTilt() setzt ausschliesslich --tilt-rx/--tilt-ry (keine Layout-Eigenschaften)');
  assert(parseFloat(centerCard.style.props['--tilt-rx']) === 0 && parseFloat(centerCard.style.props['--tilt-ry']) === 0,
    'Zentrierte Mausposition ergibt ~0deg Tilt in beide Achsen');

  const cornerCard = makeMockCard({ left: 0, top: 0, width: 200, height: 100 });
  Tilt.applyTilt(cornerCard, { clientX: 200, clientY: 0 }, 6);
  assert(parseFloat(cornerCard.style.props['--tilt-rx']) === 6 && parseFloat(cornerCard.style.props['--tilt-ry']) === 6,
    'Ecke der Karte ergibt den vollen --tilt-max-deg-Winkel (hier 6deg)');

  Tilt.resetTilt(cornerCard);
  assert(cornerCard.style.props['--tilt-rx'] === '0deg' && cornerCard.style.props['--tilt-ry'] === '0deg',
    'resetTilt() setzt beide Achsen zurück auf 0deg');
}

// ============================================================
section('5. prefersReducedMotion() deaktiviert den Effekt vollständig (Mock-window)');
// ============================================================
{
  const Tilt = require(path.join(ROOT, 'tilt.js'));
  assert(Tilt.prefersReducedMotion() === false, 'Ohne globales "window" liefert prefersReducedMotion() sicher false (kein Crash)');

  const originalWindow = global.window;
  global.window = { matchMedia: function () { return { matches: true }; } };
  assert(Tilt.prefersReducedMotion() === true, 'Mit prefers-reduced-motion:reduce liefert prefersReducedMotion() true');
  global.window = originalWindow;
}

// ============================================================
section('6. index.html bindet tilt.js ein (soundcheck.html nicht)');
// ============================================================
{
  const indexHtml = read('index.html');
  assert(indexHtml.includes('<script src="tilt.js">'), 'index.html bindet tilt.js ein');

  const soundcheckHtml = read('soundcheck.html');
  assert(!soundcheckHtml.includes('tilt.js'), 'soundcheck.html bindet tilt.js NICHT ein (geschützte Datei)');
}

// ============================================================
// Ergebnis
// ============================================================
console.log(`\n${'═'.repeat(60)}`);
console.log(`  RESULTS: ${passed}/${passed + failed} passed`);
console.log('═'.repeat(60));

if (failed > 0) process.exit(1);
