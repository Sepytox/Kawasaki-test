#!/usr/bin/env node
/**
 * Polish-Regressionstests — Projekt-Politur (Mängelliste vom 2026-09-07)
 *
 * Statische Prüfungen (keine DOM-Simulation nötig), die sicherstellen,
 * dass die im Polish-PR behobenen Mängel behoben BLEIBEN:
 *  1. index.html ruft MaintenanceCalc.init() nicht mehr vor dessen
 *     Definition auf (ReferenceError-Bugfix, Mängelliste 1.1).
 *  2. index.html nutzt data-theme als alleinige Quelle der Wahrheit für
 *     toggleDarkMode() (Theme-Toggle-Bugfix, Mängelliste 1.2).
 *  3. index.html lädt bikes-data.js nicht mehr (ungenutzter Import,
 *     Mängelliste 3.2).
 *  4. Die gemeinsame theme-toggle.js existiert und wird von
 *     quiz/race/wheel/shop eingebunden, nicht aber von index/soundcheck
 *     (Mängelliste 3.1).
 *  5. race.html enthält [data-theme="light"]-Overrides (Mängelliste 5.1).
 *  6. quiz/race/wheel/shop haben deutsche <title>/<h1>-Texte
 *     (Mängelliste 6.1–6.5).
 *  7. wheel.html hat eine Mobile-Fix-Regel für .wheel-pointer
 *     (Mängelliste 8.).
 *  8. Alle 5 App-Seiten (nicht soundcheck.html) haben ein Favicon-Link
 *     (Mängelliste 9.1).
 *  9. soundcheck.html bleibt unverändert (GOLDEN_PRINCIPLES_KE.md Regel 6).
 *
 * Run: node tests/polish-test.js
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

// ============================================================
// Test harness (Stil an tests/physics-test.js angelehnt)
// ============================================================
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
// Tests
// ============================================================

section('1. MaintenanceCalc-ReferenceError (Mängelliste 1.1)');
{
  const html = read('index.html');
  const firstInit = html.indexOf('(function init() {');
  const firstInitEnd = html.indexOf('})();', firstInit);
  const firstInitBody = html.slice(firstInit, firstInitEnd);
  assert(
    !firstInitBody.includes('MaintenanceCalc.init();'),
    'Der frühe init()-Block ruft MaintenanceCalc.init() NICHT mehr auf'
  );
  assert(
    html.includes('MaintenanceCalc.init();'),
    'Der spätere, korrekt platzierte MaintenanceCalc.init()-Aufruf bleibt bestehen'
  );
  const maintenanceCalcDefIndex = html.indexOf('var MaintenanceCalc = (function()');
  assert(maintenanceCalcDefIndex > -1, 'MaintenanceCalc-Modul ist weiterhin definiert');
}

section('2. Theme-Toggle-Bugfix auf index.html (Mängelliste 1.2)');
{
  const html = read('index.html');
  assert(html.includes('id="themeToggle"'), 'Button mit id="themeToggle" ist vorhanden (dark-mode.test.js-Marker)');
  assert(html.includes('function toggleDarkMode'), 'Funktion toggleDarkMode existiert (dark-mode.test.js-Marker)');
  assert(
    html.includes("localStorage.getItem('darkMode')"),
    "localStorage.getItem('darkMode') wird gelesen (dark-mode.test.js-Marker)"
  );
  assert(html.includes('aria-label'), 'aria-label ist vorhanden (dark-mode.test.js-Marker)');
  // Die eigentliche Bugfix-Bedingung: toggleDarkMode() ermittelt den
  // aktuellen Zustand über data-theme, NICHT mehr über die Legacy-Klasse.
  const toggleFnIdx = html.indexOf('function toggleDarkMode');
  const toggleFnEnd = html.indexOf('\n        }', toggleFnIdx);
  const toggleFnBody = html.slice(toggleFnIdx, toggleFnEnd);
  assert(
    toggleFnBody.includes("getAttribute('data-theme')"),
    'toggleDarkMode() liest den aktuellen Zustand über data-theme statt über die Klasse'
  );
  assert(
    !toggleFnBody.includes("classList.toggle('dark-mode')"),
    'toggleDarkMode() togglet die Legacy-Klasse nicht mehr blind (Ursache des Erst-Klick-Bugs)'
  );
}

section('3. Ungenutzter bikes-data.js-Import entfernt (Mängelliste 3.2)');
{
  const html = read('index.html');
  assert(
    !html.includes('<script src="bikes-data.js">'),
    'index.html lädt bikes-data.js nicht mehr (SHARED_BIKES wurde dort nie verwendet)'
  );
  // Andere Seiten nutzen SHARED_BIKES weiterhin aktiv — deren Import bleibt.
  ['quiz.html', 'wheel.html', 'shop.html'].forEach((file) => {
    const otherHtml = read(file);
    assert(
      otherHtml.includes('<script src="bikes-data.js">'),
      `${file} bindet bikes-data.js weiterhin ein (aktiv genutzt)`
    );
  });
}

section('4. Gemeinsame theme-toggle.js (Mängelliste 3.1)');
{
  assert(fs.existsSync(path.join(ROOT, 'theme-toggle.js')), 'theme-toggle.js existiert im Projekt-Root');
  const shared = read('theme-toggle.js');
  assert(shared.includes('function initThemeToggle'), 'theme-toggle.js exportiert initThemeToggle()');
  assert(!shared.includes('console.log'), 'theme-toggle.js enthält kein console.log');

  ['quiz.html', 'race.html', 'wheel.html', 'shop.html'].forEach((file) => {
    const html = read(file);
    assert(
      html.includes('<script src="theme-toggle.js">'),
      `${file} bindet die gemeinsame theme-toggle.js ein`
    );
  });

  const indexHtml = read('index.html');
  assert(
    !indexHtml.includes('theme-toggle.js'),
    'index.html bindet theme-toggle.js bewusst NICHT ein (eigene, testabhängige Logik)'
  );
  const soundcheckHtml = read('soundcheck.html');
  assert(
    !soundcheckHtml.includes('theme-toggle.js'),
    'soundcheck.html bindet theme-toggle.js bewusst NICHT ein (geschützte Datei)'
  );
}

section('5. Light-Mode-Overrides in race.html (Mängelliste 5.1)');
{
  const html = read('race.html');
  assert(html.includes('[data-theme="light"]'), 'race.html enthält [data-theme="light"]-Overrides');
  assert(
    (html.match(/\[data-theme="light"\]/g) || []).length >= 10,
    'race.html enthält eine substanzielle Anzahl an Light-Mode-Overrides (nicht nur ein Placebo-Eintrag)'
  );
}

section('6. Deutsche Titel & Überschriften (Mängelliste 6.1–6.5)');
{
  const cases = [
    ['quiz.html', 'WHICH KAWASAKI ARE YOU?', 'WELCHE KAWASAKI BIST DU?'],
    ['race.html', 'RACING SIMULATOR', 'RENNSIMULATOR'],
    ['wheel.html', 'SPIN THE WHEEL', 'GLÜCKSRAD'],
    ['shop.html', 'AFTERMARKET SHOP', 'TUNING-SHOP'],
  ];
  cases.forEach(([file, oldText, newText]) => {
    const html = read(file);
    assert(!html.includes(oldText), `${file} enthält die alte englische Überschrift "${oldText}" nicht mehr`);
    assert(html.includes(newText), `${file} enthält die deutsche Überschrift "${newText}"`);
    assert(/<title>[^<]*\|\s*Kawasaki<\/title>/.test(html), `${file} hat einen Titel mit Kawasaki-Suffix`);
  });
}

section('7. Wheel-Mobile-Overflow-Fix (Mängelliste 8.)');
{
  const html = read('wheel.html');
  assert(
    /@media\s*\(max-width:\s*480px\)\s*\{\s*\.wheel-pointer/.test(html),
    'wheel.html enthält eine Mobile-Media-Query, die .wheel-pointer neu positioniert'
  );
}

section('8. Favicon auf allen App-Seiten außer soundcheck.html (Mängelliste 9.1)');
{
  ['index.html', 'quiz.html', 'race.html', 'wheel.html', 'shop.html'].forEach((file) => {
    const html = read(file);
    assert(html.includes('<link rel="icon"'), `${file} hat ein <link rel="icon">`);
  });
}

section('9. soundcheck.html bleibt unverändert (GOLDEN_PRINCIPLES_KE.md Regel 6)');
{
  try {
    const diff = execSync('git diff origin/main -- soundcheck.html', { cwd: ROOT, encoding: 'utf8' });
    assert(diff.trim() === '', 'git diff origin/main -- soundcheck.html ist leer (Datei unverändert)');
  } catch (e) {
    // Kein origin/main verfügbar (z. B. isolierte CI ohne Remote) — Test wird
    // dann nicht als Fehlschlag gewertet, sondern als Hinweis geloggt.
    console.log('  ⚠️  Konnte git diff gegen origin/main nicht ausführen (', e.message.split('\n')[0], ') — überspringe.');
  }
}

// ============================================================
// Ergebnis
// ============================================================
console.log(`\n${'═'.repeat(60)}`);
console.log(`  RESULTS: ${passed}/${passed + failed} passed`);
console.log('═'.repeat(60));

if (failed > 0) process.exit(1);
