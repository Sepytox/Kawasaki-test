#!/usr/bin/env node
/**
 * Headless Test — Navbar "Erlebnisse"-Dropdown (navbar.js/design.css)
 *
 * Statische Prüfungen (kein DOM/Browser nötig, da navbar.js `window` bereits
 * beim Parsen referenziert und daher nicht direkt in Node `require`-bar ist —
 * Stil analog zu tests/polish-test.js/tests/soundcheck-data-test.js):
 *  1. Die Top-Level-Navigation bleibt schlank (Home, Aftermarket) — Garage
 *     wird weiterhin separat als eigenes Badge-Widget gerendert.
 *  2. Die fünf "Erlebnis"-Seiten (Quiz, Glücksrad, Racing Sim, SoundCheck,
 *     Idle Racer) sind im EXPERIENCE_LINKS-Array gruppiert, inkl. der
 *     deutschen Beschriftung "Glücksrad" statt des bisherigen "Wheel".
 *  3. buildMarkup() rendert den Dropdown-Trigger a11y-konform
 *     (aria-haspopup, aria-expanded, aria-controls, role="menu"/"menuitem")
 *     und markiert ihn als "active", wenn die aktuelle Seite eine der
 *     Erlebnis-Seiten ist.
 *  4. wireDropdown() existiert und deckt Öffnen/Schließen per Klick,
 *     Escape und Klick ausserhalb ab.
 *  5. Bestehende Mechanismen bleiben erhalten: Garage-Badge
 *     (garageNavFavCount), externe Theme-Toggle-Unterscheidung
 *     (data-theme-toggle="external"), Burger-Menü (Escape schließt),
 *     synchrones mount() ohne DOMContentLoaded-Wait.
 *  6. design.css definiert das Dropdown-Popover (Fade + leichtes
 *     Herunterschieben, KEIN abruptes Erscheinen) sowie die mobile
 *     aufklappbare Variante (@media max-width:768px, max-height statt
 *     Popover) und respektiert prefers-reduced-motion.
 *  7. Kein console.log in navbar.js.
 *
 * Run: node tests/navbar-test.js
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

// ============================================================
// Test harness (Stil an tests/polish-test.js angelehnt)
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

const navJs = read('navbar.js');
const css = read('design.css');

// ============================================================
section('1. Schlanke Top-Level-Navigation');
// ============================================================
{
  const topBlock = navJs.match(/var TOP_LINKS = \[([\s\S]*?)\];/);
  assert(topBlock !== null, 'TOP_LINKS-Array gefunden');
  const top = topBlock ? topBlock[1] : '';
  assert(/index\.html/.test(top), "TOP_LINKS enthält index.html (Übersicht)");
  assert(/shop\.html/.test(top), "TOP_LINKS enthält shop.html (Aftermarket)");
  assert(!/quiz\.html|wheel\.html|race\.html|soundcheck\.html|idle\.html/.test(top),
    'TOP_LINKS enthält keine der 5 Erlebnis-Seiten mehr (jetzt im Dropdown)');
  assert(/garage-nav-link/.test(navJs), 'Garage bleibt als eigenes Badge-Widget (nicht im TOP_LINKS-Array)');
}

// ============================================================
section('2. "Erlebnisse"-Dropdown-Gruppe (EXPERIENCE_LINKS)');
// ============================================================
{
  const expBlock = navJs.match(/var EXPERIENCE_LINKS = \[([\s\S]*?)\];/);
  assert(expBlock !== null, 'EXPERIENCE_LINKS-Array gefunden');
  const exp = expBlock ? expBlock[1] : '';
  ['quiz.html', 'wheel.html', 'race.html', 'soundcheck.html', 'idle.html'].forEach(function (href) {
    assert(exp.indexOf(href) !== -1, `EXPERIENCE_LINKS enthält ${href}`);
  });
  assert(/wheel\.html',\s*label:\s*'Glücksrad'/.test(exp),
    'wheel.html trägt jetzt das deutsche Label "Glücksrad" (statt "Wheel")');
}

// ============================================================
section('3. Dropdown-Markup ist a11y-konform + markiert aktive Sektion');
// ============================================================
{
  assert(/aria-haspopup="true"/.test(navJs), 'Trigger trägt aria-haspopup="true"');
  assert(/aria-expanded="false"/.test(navJs) && /navExperiencesTrigger/.test(navJs),
    'Trigger startet mit aria-expanded="false"');
  assert(/aria-controls="navExperiencesMenu"/.test(navJs), 'Trigger referenziert das Menü via aria-controls');
  assert(/role="menu"/.test(navJs), 'Dropdown-Menü trägt role="menu"');
  assert(/role="menuitem"/.test(navJs), 'Dropdown-Einträge tragen role="menuitem"');
  assert(/experienceActive[\s\S]*?EXPERIENCE_LINKS\.some/.test(navJs),
    'buildMarkup() berechnet, ob die aktuelle Seite eine Erlebnis-Seite ist');
  assert(/nav-dropdown-trigger' \+ \(experienceActive \? ' active' : ''\)/.test(navJs),
    'Trigger wird als "active" markiert, wenn eine Erlebnis-Seite aktiv ist (analog garageActiveClass)');
}

// ============================================================
section('4. wireDropdown() — Öffnen/Schliessen/Tastatur');
// ============================================================
{
  const fnMatch = navJs.match(/function wireDropdown\(nav\) \{([\s\S]*?)\n    \}/);
  assert(fnMatch !== null, 'wireDropdown(nav) ist definiert');
  const body = fnMatch ? fnMatch[1] : '';
  const jsdocIdx = navJs.indexOf('Verdrahtet das "Erlebnisse"-Dropdown');
  const fnIdx = navJs.indexOf('function wireDropdown(nav)');
  assert(jsdocIdx !== -1 && fnIdx !== -1 && jsdocIdx < fnIdx && fnIdx - jsdocIdx < 2000,
    'wireDropdown() ist per JSDoc-Kommentar direkt davor dokumentiert');
  assert(/'Escape'/.test(body), 'wireDropdown() reagiert auf die Escape-Taste');
  assert(/document\.addEventListener\('click'/.test(body) || /global\.document\.addEventListener\('click'/.test(body),
    'wireDropdown() schliesst bei Klick ausserhalb (globaler click-Listener)');
  assert(/!dropdown\.contains\(e\.target\)/.test(body), 'Der Ausserhalb-Klick-Check prüft dropdown.contains(e.target)');
  assert(/ArrowDown/.test(body) && /ArrowUp/.test(body), 'Pfeiltasten navigieren innerhalb des geöffneten Menüs');
  assert(/wireDropdown\(nav\);/.test(navJs), 'wireDropdown(nav) wird in renderInto() aufgerufen');
}

// ============================================================
section('5. Bestehende Mechanismen bleiben erhalten');
// ============================================================
{
  assert(/garageNavFavCount/.test(navJs), 'Garage-Favoriten-Badge (garageNavFavCount) bleibt erhalten');
  assert(/FAVORITES_KEY = 'vroooom_favorites'/.test(navJs),
    'localStorage-Key vroooom_favorites bleibt unverändert (GOLDEN_PRINCIPLES_KE.md Regel 7)');
  assert(/data-theme-toggle'\) !== 'external'/.test(navJs),
    'data-theme-toggle="external"-Unterscheidung bleibt erhalten (kein Doppel-Wiring)');
  assert(/function wireBurger\(nav\)/.test(navJs), 'Mobiles Burger-Menü bleibt erhalten');
  assert(/e\.key === 'Escape' && links\.classList\.contains\('is-open'\)/.test(navJs),
    'Burger-Menü schliesst weiterhin bei Escape');
  assert(/^\s*mount\(\);/m.test(navJs), 'Synchrones mount() beim Skript-Parsen bleibt erhalten (kein DOMContentLoaded-Wait)');
  assert(/topLinks: TOP_LINKS\.slice\(\)/.test(navJs) && /experienceLinks: EXPERIENCE_LINKS\.slice\(\)/.test(navJs),
    'VroooomNavbar exportiert topLinks/experienceLinks (read-only Kopien) für Tests/Diagnose');
}

// ============================================================
section('6. Dropdown-CSS: sanftes Öffnen/Schliessen + Mobile-Variante');
// ============================================================
{
  assert(/\.nav-dropdown-menu \{/.test(css), '.nav-dropdown-menu ist in design.css definiert');
  const menuBlock = css.match(/\.nav-dropdown-menu \{([\s\S]*?)\n\}/);
  assert(menuBlock !== null, '.nav-dropdown-menu Regelblock gefunden');
  const menuRule = menuBlock ? menuBlock[1] : '';
  assert(/opacity:\s*0/.test(menuRule) && /visibility:\s*hidden/.test(menuRule),
    'Menü startet unsichtbar (opacity:0 + visibility:hidden) — kein abruptes Erscheinen');
  assert(/transition:[\s\S]*var\(--dur-base/.test(menuRule), 'Öffnen/Schliessen nutzt das --dur-base-Timing-Token (200-300ms-Bereich)');
  assert(/var\(--ease-standard/.test(menuRule), 'Transition nutzt eine cubic-bezier-Easing-Kurve (--ease-standard)');
  assert(/transform:\s*translateY\(-6px\)/.test(menuRule), 'Startzustand ist leicht nach oben verschoben (slide-in-Effekt)');

  assert(/\.nav-dropdown\.is-open \.nav-dropdown-menu \{/.test(css), 'Ein .is-open-Zustand schaltet das Menü sichtbar');

  const mobileBlock = css.match(/Mobile: das Popover wird zur aufklappbaren[\s\S]*?\.nav-dropdown-menu \{([\s\S]*?)\}/);
  assert(mobileBlock !== null, 'Mobile Variante (@media max-width:768px) für .nav-dropdown-menu vorhanden');
  assert(mobileBlock && /position:\s*static/.test(mobileBlock[1]),
    'Auf Mobile wird aus dem Popover eine statische, aufklappbare Sektion (kein Hover-Overlay)');
  assert(mobileBlock && /max-height:\s*0/.test(mobileBlock[1]),
    'Mobile Variante klappt über max-height auf (gleiches Muster wie .site-nav-links.is-open)');

  assert(/prefers-reduced-motion:\s*reduce\)\s*\{\s*\.nav-dropdown-menu/.test(css),
    'Dropdown respektiert zusätzlich prefers-reduced-motion (kein Slide-Transform)');
}

// ============================================================
section('7. Kein console.log in navbar.js');
// ============================================================
{
  assert(!/console\.log/.test(navJs), 'navbar.js enthält kein console.log');
}

// ============================================================
// Ergebnis
// ============================================================
console.log(`\n${'═'.repeat(60)}`);
console.log(`  RESULTS: ${passed}/${passed + failed} passed`);
console.log('═'.repeat(60));

if (failed > 0) process.exit(1);
