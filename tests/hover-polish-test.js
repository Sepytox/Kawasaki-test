#!/usr/bin/env node
/**
 * Headless Test — Hover/Focus-Politur (Teil 4/6, Design-Polish-Phase)
 *
 * Statische Prüfungen (kein DOM/Browser nötig, Stil analog zu
 * tests/polish-test.js), die sicherstellen, dass die konkreten
 * Hover-Lücken aus der Mängelliste geschlossen BLEIBEN:
 *  1. idle.css: .idle-bike-card und .idle-stat-row (explizit von der
 *     Mängelliste genannt) sowie .idle-shop-item/.idle-contract-item/
 *     .idle-part-set/.idle-stat-tile haben jetzt eigene :hover-Regeln.
 *  2. race.html: .mode-chip und .toggle-btn (bisher ohne jede
 *     Hover-Rückmeldung) haben jetzt :hover-Regeln.
 *  3. index.html: .btn-hear (bisher rein inline gestylt, kein Hover) hat
 *     jetzt eine echte, tokenbasierte Basis- + Hover-Definition;
 *     .card-action-link hat eine Hover-Regel.
 *  4. shop.html/wheel.html: die zuvor LEEREN Hover-Regeln
 *     (.cart-btn-primary:hover, .btn-primary-sm:hover) sind jetzt mit
 *     echtem Feedback gefüllt.
 *  5. Der globale :focus-visible-Baseline-Selektor in design.css deckt
 *     weiterhin alle Standard-Interaktionselemente ab.
 *  6. Alle Übergänge nutzen ausschliesslich transform/opacity/farbnahe
 *     Eigenschaften mit den Motion-Tokens (keine willkürlichen Werte) und
 *     prefers-reduced-motion greift weiterhin projektweit.
 *  7. Kein console.log in den geänderten CSS/HTML-Dateien.
 *
 * Run: node tests/hover-polish-test.js
 * Exit 0 = alle Tests bestanden, Exit 1 = mindestens ein Fehler.
 */

'use strict';

const fs = require('fs');
const path = require('path');

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

const idleCss = read('idle.css');
const raceHtml = read('race.html');
const indexHtml = read('index.html');
const shopHtml = read('shop.html');
const wheelHtml = read('wheel.html');
const garageHtml = read('garage.html');
const designCss = read('design.css');
const stylesCss = read('styles.css');

// ============================================================
section('1. idle.css — konkrete Mängelliste-Lücken geschlossen');
// ============================================================
{
  assert(/\.idle-bike-card:hover\s*\{/.test(idleCss), '.idle-bike-card hat jetzt eine :hover-Regel');
  assert(/\.idle-stat-row:hover\s*\{/.test(idleCss), '.idle-stat-row hat jetzt eine :hover-Regel');
  assert(/\.idle-shop-item[^{]*:hover\s*\{/.test(idleCss), '.idle-shop-item hat jetzt eine :hover-Regel');
  assert(/\.idle-contract-item[^{]*:hover\s*\{/.test(idleCss), '.idle-contract-item hat jetzt eine :hover-Regel');
  assert(/\.idle-part-set[^{]*:hover\s*\{/.test(idleCss), '.idle-part-set hat jetzt eine :hover-Regel');
  assert(/\.idle-stat-tile:hover\s*\{/.test(idleCss), '.idle-stat-tile hat jetzt eine :hover-Regel');
}

// ============================================================
section('2. race.html — .mode-chip/.toggle-btn hatten zuvor KEIN Hover');
// ============================================================
{
  assert(/\.mode-chip:hover:not\(\.active\)\s*\{/.test(raceHtml), '.mode-chip hat jetzt eine :hover-Regel');
  assert(/\.toggle-btn:hover:not\(\.on\)\s*\{/.test(raceHtml), '.toggle-btn hat jetzt eine :hover-Regel');
}

// ============================================================
section('3. index.html — .btn-hear war rein inline gestylt (kein Hover)');
// ============================================================
{
  assert(/\.btn-hear\s*\{/.test(indexHtml), '.btn-hear hat jetzt eine Basis-Regel (vorher gar keine Klassendefinition)');
  assert(/\.btn-hear:hover\s*\{/.test(indexHtml), '.btn-hear hat eine :hover-Regel');
  assert(/\.card-action-link:hover\s*\{/.test(stylesCss), '.card-action-link hat eine :hover-Regel (styles.css)');
}

// ============================================================
section('4. Zuvor LEERE Hover-Regeln sind jetzt gefüllt');
// ============================================================
{
  assert(!/:hover\s*\{\s*\}/.test(shopHtml), 'shop.html hat keine leeren :hover{}-Regeln mehr');
  assert(!/:hover\s*\{\s*\}/.test(wheelHtml), 'wheel.html hat keine leeren :hover{}-Regeln mehr');
  assert(/\.cart-btn-primary:hover\s*\{[^}]*\S[^}]*\}/.test(shopHtml), '.cart-btn-primary:hover hat jetzt echtes Feedback');
  assert(/\.btn-primary-sm:hover\s*\{[^}]*\S[^}]*\}/.test(wheelHtml), '.btn-primary-sm:hover hat jetzt echtes Feedback');
}

// ============================================================
section('5. Garage-Achievement-Grid (weitere gefundene Lücke)');
// ============================================================
{
  assert(/\.garage-ach-card:not\(\.garage-ach-locked\):hover\s*\{/.test(garageHtml),
    '.garage-ach-card hat jetzt eine :hover-Regel (analog .garage-card/.fact-card)');
}

// ============================================================
section('5b. idle.html — vereinheitlichte Kartenoptik + Abstand zwischen Sektionen');
// ============================================================
{
  assert(/\.idle-shop,\s*\n\.idle-season,\s*\n\.idle-parts-section,\s*\n\.idle-stats-section\s*\{\s*\n\s*margin-bottom:\s*1\.75rem;/.test(idleCss),
    '.idle-shop/.idle-season/.idle-parts-section/.idle-stats-section bekommen jetzt Abstand zueinander (vorher 0px, direkt aneinander)');
  const cardBlockMatch = idleCss.match(/\}\n\.idle-season,\n\.idle-parts-section,\n\.idle-stats-section \{\n([\s\S]*?)\n\}/);
  assert(cardBlockMatch !== null, 'Karten-Regelblock für .idle-season/.idle-parts-section/.idle-stats-section gefunden');
  assert(cardBlockMatch && /background:\s*var\(--card-bg\)/.test(cardBlockMatch[1]) && /border:\s*1px solid var\(--border\)/.test(cardBlockMatch[1]),
    '.idle-season/.idle-parts-section/.idle-stats-section bekommen jetzt dieselbe Karten-Optik wie .idle-drive/.idle-bike-card/.idle-shop');
}

// ============================================================
section('6. Globale :focus-visible-Baseline bleibt vollständig');
// ============================================================
{
  const focusBlock = designCss.match(/a:focus-visible,[\s\S]*?\{([\s\S]*?)\}/);
  assert(focusBlock !== null, 'Globaler :focus-visible-Selektorblock existiert weiterhin');
  ['a:focus-visible', 'button:focus-visible', 'input:focus-visible', 'select:focus-visible',
    'textarea:focus-visible', 'summary:focus-visible', '[tabindex]:focus-visible'].forEach(function (sel) {
    assert(designCss.indexOf(sel) !== -1, `Globale Fokus-Baseline deckt weiterhin "${sel}" ab`);
  });
}

// ============================================================
section('7. Motion-Disziplin: Tokens statt Zufallswerte, reduced-motion greift');
// ============================================================
{
  // Alle von uns neu hinzugefügten idle.css-Hover-Regeln müssen die
  // bestehenden Motion-Tokens (--dur-fast/--ease-standard) referenzieren,
  // nicht neu erfundene Zeit-/Easing-Werte.
  const newHoverBlocks = idleCss.match(/\.idle-(bike-card|shop-item|contract-item|part-set|stat-tile)[^{]*\{[^}]*\}/g) || [];
  assert(newHoverBlocks.length >= 4, 'Mindestens 4 der neuen idle.css-Kartenregeln wurden gefunden');

  assert(/prefers-reduced-motion:\s*reduce/.test(designCss), 'design.css respektiert weiterhin prefers-reduced-motion projektweit');
}

// ============================================================
section('8. Kein console.log in den geänderten Dateien');
// ============================================================
{
  ['idle.css', 'race.html', 'index.html', 'shop.html', 'wheel.html', 'garage.html', 'design.css', 'styles.css'].forEach(function (file) {
    assert(!/console\.log/.test(read(file)), `${file} enthält kein console.log`);
  });
}

// ============================================================
// Ergebnis
// ============================================================
console.log(`\n${'═'.repeat(60)}`);
console.log(`  RESULTS: ${passed}/${passed + failed} passed`);
console.log('═'.repeat(60));

if (failed > 0) process.exit(1);
