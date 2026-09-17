#!/usr/bin/env node
/**
 * Headless Test — count-up.js (Zahlen-Eintritts-Animation, Phase B)
 *
 * Statische Prüfungen + echte Unit-Tests der DOM-freien Kernfunktionen
 * (Stil analog zu tests/idle-core-test.js/tests/polish-test.js), die
 * sicherstellen, dass:
 *  1. count-up.js existiert, ist syntaktisch gültig, enthält JSDoc, kein
 *     console.log, und respektiert prefers-reduced-motion.
 *  2. parseLeadingNumber() Zahlen inkl. deutscher Tausenderpunkte, Vorzeichen
 *     und Dezimal-Kommata korrekt erkennt und bei Text ohne Zahl null liefert.
 *  3. easeOutCubic() eine plausible Easing-Kurve liefert (0→0, 1→1, monoton).
 *  4. countUpTo() unter prefers-reduced-motion sofort den Zielwert setzt
 *     (kein rAF-Aufruf), ohne DOM/Browser (Mock-Objekte).
 *  5. Die betroffenen Seiten (index/idle/shop) binden count-up.js ein,
 *     nicht aber soundcheck.html (geschützte Datei).
 *  6. idle.html/shop.html/index.html markieren die im Plan genannten
 *     Zahlen-Ziele mit "data-count-up".
 *
 * Run: node tests/count-up-test.js
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
section('1. count-up.js existiert und erfüllt die Grundregeln');
// ============================================================
{
  const countUpPath = path.join(ROOT, 'count-up.js');
  assert(fs.existsSync(countUpPath), 'count-up.js existiert im Projekt-Root');

  const js = fs.readFileSync(countUpPath, 'utf8');
  assert(!js.includes('console.log'), 'count-up.js enthält kein console.log');
  assert(js.includes('/**'), 'count-up.js enthält JSDoc-Kommentare');
  assert(js.includes('prefersReducedMotion'), 'count-up.js prüft prefers-reduced-motion');
  assert(js.includes('IntersectionObserver'), 'count-up.js nutzt IntersectionObserver für Scroll-in-View');
  assert(js.includes('MutationObserver'), 'count-up.js beobachtet auch nachträglich eingefügte Elemente (Modals)');

  try {
    execSync(`node --check "${countUpPath}"`, { cwd: ROOT, stdio: 'pipe' });
    assert(true, 'count-up.js ist syntaktisch gültiges JavaScript (node --check)');
  } catch (e) {
    assert(false, 'count-up.js ist syntaktisch gültiges JavaScript (node --check)');
  }
}

// ============================================================
section('2. parseLeadingNumber() erkennt Zahlen zuverlässig');
// ============================================================
{
  const CountUp = require(path.join(ROOT, 'count-up.js'));
  assert(typeof CountUp.parseLeadingNumber === 'function', 'parseLeadingNumber() ist exportiert (Node-Testbarkeit)');

  assert(CountUp.parseLeadingNumber('12.345 km') === 12345, '"12.345 km" → 12345 (deutscher Tausenderpunkt entfernt)');
  assert(CountUp.parseLeadingNumber('€1.234') === 1234, '"€1.234" → 1234 (Präfix ignoriert)');
  assert(CountUp.parseLeadingNumber('+0 🏆') === 0, '"+0 🏆" → 0 (Emoji-Suffix ignoriert)');
  assert(CountUp.parseLeadingNumber('150 PS') === 150, '"150 PS" → 150 (Einheiten-Suffix ignoriert)');
  assert(CountUp.parseLeadingNumber('±0.0s') === 0, '"±0.0s" → 0 (Dezimalzahl korrekt erkannt)');
  assert(CountUp.parseLeadingNumber('-5 kg') === -5, '"-5 kg" → -5 (negatives Vorzeichen erhalten)');
  assert(CountUp.parseLeadingNumber('Wassergekühlt') === null, '"Wassergekühlt" → null (keine Zahl vorhanden, sicherer Fallback)');
  assert(CountUp.parseLeadingNumber('') === null, 'Leerer String → null');
  assert(CountUp.parseLeadingNumber(null) === null, 'null als Eingabe → null (kein Crash)');
}

// ============================================================
section('3. easeOutCubic() liefert eine plausible Easing-Kurve');
// ============================================================
{
  const CountUp = require(path.join(ROOT, 'count-up.js'));
  assert(CountUp.easeOutCubic(0) === 0, 'easeOutCubic(0) === 0 (Start)');
  assert(Math.abs(CountUp.easeOutCubic(1) - 1) < 1e-9, 'easeOutCubic(1) === 1 (Ziel exakt erreicht)');
  const mid = CountUp.easeOutCubic(0.5);
  assert(mid > 0 && mid < 1, 'easeOutCubic(0.5) liegt zwischen 0 und 1');
  assert(CountUp.easeOutCubic(0.25) < CountUp.easeOutCubic(0.75), 'easeOutCubic() ist monoton steigend');
}

// ============================================================
section('4. countUpTo() respektiert prefers-reduced-motion (ohne Browser/DOM)');
// ============================================================
{
  const CountUp = require(path.join(ROOT, 'count-up.js'));

  const originalWindow = global.window;
  global.window = {
    matchMedia: function () { return { matches: true }; },
    requestAnimationFrame: function () {
      throw new Error('requestAnimationFrame darf bei reduzierter Bewegung NICHT aufgerufen werden');
    }
  };

  const mockEl = { textContent: '' };
  CountUp.countUpTo(mockEl, 1234, {
    formatter: function (n) { return 'Ziel:' + n; }
  });
  assert(mockEl.textContent === 'Ziel:1234', 'countUpTo() setzt bei prefers-reduced-motion sofort den Zielwert, ohne rAF-Schleife');

  global.window = originalWindow;
}

// ============================================================
section('5. Betroffene Seiten binden count-up.js ein (soundcheck.html nicht)');
// ============================================================
{
  ['index.html', 'idle.html', 'shop.html'].forEach((file) => {
    const html = read(file);
    assert(html.includes('<script src="count-up.js">'), `${file} bindet count-up.js ein`);
  });

  const soundcheckHtml = read('soundcheck.html');
  assert(!soundcheckHtml.includes('count-up.js'), 'soundcheck.html bindet count-up.js NICHT ein (geschützte Datei)');
}

// ============================================================
section('6. Ziel-Elemente aus dem Plan tragen "data-count-up"');
// ============================================================
{
  const idleHtml = read('idle.html');
  ['idleKmValue', 'idleSeasonNumber', 'idleSeasonTrophies', 'idleSeasonProjected'].forEach((id) => {
    const re = new RegExp('id="' + id + '"[^>]*data-count-up');
    assert(re.test(idleHtml), `idle.html: #${id} trägt data-count-up`);
  });

  const idleJs = read('idle.js');
  ['idleRunSummaryScore', 'idleRunSummaryCoins'].forEach((id) => {
    const re = new RegExp('id="' + id + '"[^\']*data-count-up|data-count-up[^\']*id="' + id + '"');
    assert(re.test(idleJs), `idle.js: Crash-Zusammenfassung #${id} trägt data-count-up`);
  });

  const shopHtml = read('shop.html');
  ['cartTotal', 'savPS', 'savWeight', 'savAccel'].forEach((id) => {
    const re = new RegExp('id="' + id + '"[^>]*data-count-up');
    assert(re.test(shopHtml), `shop.html: #${id} trägt data-count-up`);
  });

  const indexHtml = read('index.html');
  assert(/data-count-up/.test(indexHtml), 'index.html: Spec-Werte im Bike-Detail-Modal tragen data-count-up');
}

// ============================================================
// Ergebnis
// ============================================================
console.log(`\n${'═'.repeat(60)}`);
console.log(`  RESULTS: ${passed}/${passed + failed} passed`);
console.log('═'.repeat(60));

if (failed > 0) process.exit(1);
