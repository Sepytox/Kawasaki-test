#!/usr/bin/env node
/**
 * Headless Test — Zentrales Modal-System (modal.js, feat(modal-system))
 *
 * Statische Prüfungen (kein DOM/Browser nötig, Stil analog zu
 * tests/polish-test.js und tests/hover-polish-test.js), die sicherstellen,
 * dass das neue geteilte Modal-Modul die geforderten Eigenschaften hat
 * und BLEIBT:
 *  1. modal.js existiert, ist syntaktisch gültig und enthält kein
 *     console.log (GOLDEN_PRINCIPLES_KE.md Regel 2).
 *  2. Öffentliche API Modal.openModal()/Modal.closeModal() ist vorhanden,
 *     inkl. JSDoc-Kommentaren (Regel 1).
 *  3. Es werden ausschliesslich die bestehenden CSS-Klassen
 *     ".modal-overlay"/".modal-content"/".modal-visible"/".modal-closing"
 *     wiederverwendet (keine konkurrierende neue Kern-Klasse erfunden).
 *  4. variant "forced-choice" deaktiviert Escape UND Backdrop-Klick
 *     (kritisch für die Idle-Racer-Crash-Zusammenfassung).
 *  5. Ein Fokus-Trap (Tab/Shift+Tab-Zyklus) sowie eine Fokus-Rückgabe an
 *     das Trigger-Element sind implementiert.
 *  6. role="dialog"/aria-modal="true" werden gesetzt.
 *  7. prefers-reduced-motion wird geprüft (schaltet die Schliessen-
 *     Verzögerung/Animation ab, wie scroll-reveal.js es fürs Öffnen tut).
 *  8. design.css erweitert die Glassmorphism-Optik für .modal-overlay/
 *     .modal-content rein additiv (neue @supports-Regel, keine bestehende
 *     Deklaration verändert) und lässt soundcheck.html unangetastet.
 *  9. soundcheck.html/soundcheck.js bleiben unverändert bis auf die von Miro
 *     direkt freigegebene, eng begrenzte Ausnahme (Entfernen des doppelten
 *     Lautstärke-Reglers #playerVolume/initVolumeControl() + Favicon;
 *     GOLDEN_PRINCIPLES_KE.md Regel 6).
 *
 * Run: node tests/modal-system-test.js
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

// ============================================================
// Tests
// ============================================================

section('1. modal.js existiert, ist syntaktisch gültig, kein console.log');
{
  const modalPath = path.join(ROOT, 'modal.js');
  assert(fs.existsSync(modalPath), 'modal.js existiert im Projekt-Root');
  const src = read('modal.js');
  assert(!src.includes('console.log'), 'modal.js enthält kein console.log');
  let syntaxOk = true;
  try {
    execSync(`node --check ${JSON.stringify(modalPath)}`, { cwd: ROOT });
  } catch (e) {
    syntaxOk = false;
  }
  assert(syntaxOk, 'modal.js ist syntaktisch gültiges JavaScript (node --check)');
}

section('2. Öffentliche API + JSDoc');
{
  const src = read('modal.js');
  assert(/global\.Modal\s*=\s*\{/.test(src), 'modal.js exportiert ein globales Modal-Objekt');
  assert(/openModal\s*:\s*openModal/.test(src), 'Modal.openModal ist Teil der öffentlichen API');
  assert(/closeModal\s*:\s*closeModal/.test(src), 'Modal.closeModal ist Teil der öffentlichen API');
  assert(/function openModal\s*\(/.test(src), 'openModal() ist definiert');
  assert(/function closeModal\s*\(/.test(src), 'closeModal() ist definiert');

  const openDocIdx = src.indexOf('function openModal');
  const openDocBefore = src.slice(Math.max(0, openDocIdx - 700), openDocIdx);
  assert(/\/\*\*[\s\S]*@param[\s\S]*\*\//.test(openDocBefore), 'openModal() hat einen JSDoc-Kommentar mit @param');

  const closeDocIdx = src.indexOf('function closeModal');
  const closeDocBefore = src.slice(Math.max(0, closeDocIdx - 700), closeDocIdx);
  assert(/\/\*\*[\s\S]*@param[\s\S]*\*\//.test(closeDocBefore), 'closeModal() hat einen JSDoc-Kommentar mit @param');
}

section('3. Wiederverwendung der bestehenden .modal-overlay/.modal-content-Klassen');
{
  const src = read('modal.js');
  assert(src.includes("'modal-overlay'"), "modal.js nutzt die bestehende Klasse 'modal-overlay'");
  assert(src.includes("'modal-content'"), "modal.js nutzt die bestehende Klasse 'modal-content'");
  assert(src.includes("'modal-visible'"), "modal.js nutzt die bestehende Klasse 'modal-visible'");
  assert(src.includes("'modal-closing'"), "modal.js nutzt die bestehende Klasse 'modal-closing'");
  assert(src.includes("'modal-content-wide'"), "modal.js nutzt die bestehende Breiten-Variante 'modal-content-wide'");
}

section('4. variant "forced-choice" deaktiviert Escape + Backdrop-Klick');
{
  const src = read('modal.js');
  assert(src.includes("'forced-choice'"), 'modal.js kennt die Variante "forced-choice"');

  const keydownIdx = src.indexOf('function onGlobalKeydown');
  const keydownBody = src.slice(keydownIdx, src.indexOf('}', src.indexOf('{', keydownIdx) + 1) + 400);
  assert(
    /variant\s*!==\s*'forced-choice'/.test(keydownBody),
    'Der globale Escape-Handler prüft variant !== "forced-choice", bevor er schliesst'
  );

  const wireIdx = src.indexOf('function wireOverlayOnce');
  const wireBody = src.slice(wireIdx, wireIdx + 1200);
  assert(
    /variant\s*!==\s*'forced-choice'/.test(wireBody),
    'Der Backdrop-Klick-Handler prüft variant !== "forced-choice", bevor er schliesst'
  );
}

section('5. Fokus-Trap (Tab-Zyklus) + Fokus-Rückgabe an den Trigger');
{
  const src = read('modal.js');
  assert(src.includes("e.key !== 'Tab'") || src.includes('e.key === \'Tab\''), 'modal.js behandelt die Tab-Taste für einen Fokus-Trap');
  assert(src.includes('shiftKey'), 'Der Fokus-Trap unterscheidet Tab/Shift+Tab (Vorwärts/Rückwärts-Zyklus)');
  assert(/entry\.trigger[\s\S]{0,80}\.focus\(\)/.test(src), 'closeModal() gibt den Fokus an das gemerkte Trigger-Element zurück');
}

section('6. role="dialog" + aria-modal="true"');
{
  const src = read('modal.js');
  assert(src.includes("setAttribute('role', 'dialog')"), 'modal.js setzt role="dialog" auf neu erzeugte Overlays');
  assert(src.includes("setAttribute('aria-modal', 'true')"), 'modal.js setzt aria-modal="true" auf neu erzeugte Overlays');
}

section('7. prefers-reduced-motion wird beim Schliessen respektiert');
{
  const src = read('modal.js');
  assert(
    src.includes("matchMedia('(prefers-reduced-motion: reduce)')"),
    'modal.js prüft prefers-reduced-motion via matchMedia (analog scroll-reveal.js)'
  );
  assert(
    /prefersReducedMotion\(\)/.test(src) && /function prefersReducedMotion/.test(src),
    'prefersReducedMotion() ist als eigene, wiederverwendbare Funktion implementiert'
  );
}

section('8. design.css: additive Glassmorphism für .modal-overlay/.modal-content');
{
  const css = read('design.css');
  assert(
    /@supports[^{]*backdrop-filter[\s\S]*?\.modal-overlay[\s\S]*?backdrop-filter:\s*blur\(var\(--glass-blur-sm\)\)/.test(css),
    'design.css ergänzt .modal-overlay additiv um backdrop-filter (Token-basiert)'
  );
  assert(
    /\.modal-content\s*\{[^}]*background:\s*var\(--glass-bg-strong\)/.test(css),
    'design.css ergänzt .modal-content additiv um --glass-bg-strong als Hintergrund'
  );
  assert(css.includes('--glass-blur-sm:'), 'design.css definiert --glass-blur-sm');
  assert(css.includes('--glass-blur-md:'), 'design.css definiert --glass-blur-md');
  assert(css.includes('--glass-bg-strong:'), 'design.css definiert --glass-bg-strong (pro Theme)');
  assert(!css.includes('.sc-modal'), 'design.css definiert keine soundcheck-spezifischen .sc-modal-Selektoren (bleibt unangetastet)');
}

section('9. soundcheck.html/soundcheck.js bleiben unverändert, ausser der von Miro freigegebenen Ausnahme (GOLDEN_PRINCIPLES_KE.md Regel 6)');
{
  // Miro hat direkt und persönlich genau EINE eng begrenzte Ausnahme freigegeben:
  // Entfernen des doppelten Lautstärke-Reglers (#playerVolume/initVolumeControl())
  // sowie Ergänzen eines Favicons. Statt eines leeren Diffs prüfen wir daher
  // gezielt, dass GENAU dieser freigegebene Zustand vorliegt und der einzige
  // verbleibende Regler #volumeSlider unangetastet funktionsfähig ist.
  const soundcheckHtml = read('soundcheck.html');
  const soundcheckJs = read('soundcheck.js');

  assert(!/id=["']playerVolume["']/.test(soundcheckHtml), 'soundcheck.html enthält kein #playerVolume mehr (freigegebene Ausnahme)');
  assert(/id=["']volumeSlider["']/.test(soundcheckHtml), 'soundcheck.html enthält weiterhin den einzigen Lautstärke-Regler #volumeSlider');
  assert(soundcheckHtml.includes('<link rel="icon"'), 'soundcheck.html hat ein <link rel="icon"> (freigegebene Ausnahme)');

  assert(!soundcheckJs.includes('initVolumeControl'), 'soundcheck.js enthält initVolumeControl() nicht mehr (freigegebene Ausnahme)');
  assert(!soundcheckJs.includes('playerVolume'), 'soundcheck.js referenziert #playerVolume nicht mehr (freigegebene Ausnahme)');
  assert(/function initPersistentVolume/.test(soundcheckJs), 'soundcheck.js: initPersistentVolume() (verdrahtet #volumeSlider) bleibt vorhanden');
}

// ============================================================
// Ergebnis
// ============================================================
console.log(`\n${'═'.repeat(60)}`);
console.log(`  RESULTS: ${passed}/${passed + failed} passed`);
console.log('═'.repeat(60));

if (failed > 0) process.exit(1);
