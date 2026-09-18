#!/usr/bin/env node
/**
 * Headless Test — Geteiltes Bild-System für Auspuff-Teile (exhaust-image.js)
 *
 * Analog zu tests/bike-image-test.js: prüft die Foto-Pfad-Konvention
 * (images/exhausts/<part-id>.png), dass buildExhaustSvg() ein gültiges
 * data:-URI liefert, und dass markup() die volle 3-Stufen-Kette (lokal →
 * Unsplash → SVG) korrekt abbildet — inkl. des simulierten
 * Netzwerkfehler-Pfads zur SVG.
 *
 * Run: node tests/exhaust-image-test.js
 * Exit 0 = alle Tests bestanden, Exit 1 = mindestens ein Fehler.
 */

'use strict';

const ExhaustImage = require('../exhaust-image.js');

// ============================================================
// Test harness (Stil analog zu tests/bike-image-test.js)
// ============================================================
let passed = 0, failed = 0;

function assert(cond, msg) {
  if (cond) {
    console.log(`  ✅  ${msg}`);
    passed++;
  } else {
    console.log(`  ❌  FAIL: ${msg}`);
    failed++;
  }
}

function section(title) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('═'.repeat(60));
}

section('1 · photoPath() folgt der images/exhausts/<part-id>.png-Konvention');
(function() {
  assert(ExhaustImage.photoPath('akrapovic-slip') === 'images/exhausts/akrapovic-slip.png', 'photoPath("akrapovic-slip") ist korrekt');
  assert(ExhaustImage.photoPath('sc-project') === 'images/exhausts/sc-project.png', 'photoPath("sc-project") ist korrekt');
})();

section('2 · buildExhaustSvg() liefert ein gültiges data:-URI mit Marken-/Teilename');
(function() {
  const uri = ExhaustImage.buildExhaustSvg({ name: 'Slip-On', brand: 'Akrapovic' });
  assert(uri.indexOf('data:image/svg+xml,') === 0, 'gültiges SVG-data-URI-Präfix');
  assert(decodeURIComponent(uri).indexOf('Akrapovic Slip-On') !== -1, 'Marke + Teilename im SVG enthalten');
  assert(uri.indexOf("'") === -1, 'SVG-data-URI enthält kein einzelnes Anführungszeichen (sicher für Inline-HTML-Attribute)');
  assert(uri.indexOf('"') === -1, 'SVG-data-URI enthält kein doppeltes Anführungszeichen (bricht kein HTML-Attribut auf)');
})();

section('3 · markup() lädt kein lokales Foto ohne EXHAUST_PHOTO_MANIFEST-Eintrag — Tier 2 (Unsplash) statt Tier 3 (SVG)');
(function() {
  // images/exhausts/ ist aktuell absichtlich leer — akrapovic-slip ist NICHT
  // im Manifest, markup() darf daher keinen Ladeversuch für
  // images/exhausts/akrapovic-slip.png machen.
  const part = { id: 'akrapovic-slip', name: 'Akrapovic Slip-On', brand: 'Akrapovic' };
  const html = ExhaustImage.markup(part, { className: 'part-card-image' });
  assert(html.indexOf('exhaust-photo-wrap part-card-image') !== -1, 'Custom className wird angehängt');
  assert(html.indexOf('src="images/exhausts/akrapovic-slip.png"') === -1, 'Ohne Manifest-Eintrag wird KEIN Foto-Pfad referenziert (kein 404-Request)');
  assert(html.indexOf('src="' + ExhaustImage.unsplashExhaustUrl.replace(/&/g, '&amp;') + '"') !== -1, 'src zeigt auf die Unsplash-Platzhalter-URL (Tier 2), da kein lokales Foto vorliegt');
  assert(html.indexOf('exhaust-photo-placeholder') !== -1, 'exhaust-photo-placeholder-Klasse ist von Anfang an gesetzt (markiert "nicht lokal")');
  assert(html.indexOf('onload=') !== -1, 'onload-Handler ist gesetzt');
  assert(html.indexOf('onerror=') !== -1, 'onerror-Handler ist gesetzt (Rückfall auf Tier 3)');
  assert(html.indexOf('data:image/svg+xml,') !== -1, 'onerror-Handler referenziert weiterhin die generierte Auspuff-SVG als letzten Rückfall (Tier 3)');
  const quoteCount = (html.match(/"/g) || []).length;
  assert(quoteCount % 2 === 0, `Doppelte Anführungszeichen sind paarig (${quoteCount}) — kein aufgebrochenes Attribut`);
})();

section('4 · markup() referenziert das echte Foto, sobald eine ID im EXHAUST_PHOTO_MANIFEST steht');
(function() {
  assert(typeof ExhaustImage.hasPhoto === 'function', 'hasPhoto() ist exportiert');
  assert(typeof ExhaustImage.photoManifest === 'object' && ExhaustImage.photoManifest !== null, 'photoManifest ist exportiert');
  assert(ExhaustImage.hasPhoto('akrapovic-slip') === false, 'akrapovic-slip hat aktuell keinen Manifest-Eintrag (images/exhausts/ ist leer)');

  // Test-only: simuliert einen künftigen echten Foto-Eintrag, ohne die
  // reale (leere) images/exhausts/README.md-Konvention zu verletzen.
  ExhaustImage.photoManifest['akrapovic-slip'] = true;
  try {
    assert(ExhaustImage.hasPhoto('akrapovic-slip') === true, 'hasPhoto() erkennt den simulierten Manifest-Eintrag');
    const html = ExhaustImage.markup({ id: 'akrapovic-slip', name: 'Akrapovic Slip-On', brand: 'Akrapovic' });
    assert(html.indexOf('src="images/exhausts/akrapovic-slip.png"') !== -1, 'Mit Manifest-Eintrag wird das Foto zuerst referenziert (Tier 1)');
    assert(html.indexOf('onerror=') !== -1, 'Mit Manifest-Eintrag bleibt ein onerror-Fallback erhalten');
    const classAttr = (html.match(/class="([^"]*)"/) || [])[1] || '';
    assert(classAttr.indexOf('exhaust-photo-fallback') === -1, 'Ohne vorherigen Ladefehler ist die Fallback-Klasse im class-Attribut noch NICHT gesetzt');
    assert(classAttr.indexOf('exhaust-photo-placeholder') === -1, 'Ohne vorherigen Ladefehler ist die Platzhalter-Klasse im class-Attribut noch NICHT gesetzt (Tier 1 ist aktiv)');

    // Die volle 3-Stufen-Kette muss im onerror-Handler statisch nachweisbar
    // sein — Tier 1 (lokal) fehlschlägt zuerst zu Tier 2 (Unsplash), und
    // erst ein ZWEITER, simulierter Ladefehler fällt auf Tier 3 (SVG) zurück.
    const unsplashUrl = ExhaustImage.unsplashExhaustUrl.replace(/&/g, '&amp;');
    assert(html.indexOf(unsplashUrl) !== -1, 'onerror-Handler enthält die Tier-2-Unsplash-URL als Zwischen-Fallback-Ziel, falls das lokale Foto (Tier 1) nicht lädt');
    assert(html.indexOf('exhaust-photo-placeholder') !== -1, 'onerror-Handler setzt beim Rückfall auf Tier 2 die "nicht lokal"-Klasse (exhaust-photo-placeholder)');
    assert(html.indexOf('data:image/svg+xml,') !== -1, 'onerror-Handler enthält verschachtelt weiterhin die generierte SVG (Tier 3) als letzten Rückfall (simulierter Netzwerkfehler-Pfad)');
  } finally {
    delete ExhaustImage.photoManifest['akrapovic-slip']; // aufräumen, damit andere Tests/Consumer unberührt bleiben
  }
})();

section('5 · "Platzhalter"-Badge — nur sichtbar, solange KEIN lokales Foto aktiv ist');
(function() {
  const htmlNoLocal = ExhaustImage.markup({ id: 'akrapovic-slip', name: 'Akrapovic Slip-On', brand: 'Akrapovic' });
  assert(htmlNoLocal.indexOf('placeholder-badge') !== -1, 'Badge-Span ist im Markup enthalten, wenn kein lokales Foto vorliegt');
  assert(htmlNoLocal.indexOf('>Platzhalter<') !== -1, 'Badge-Text ist auf Deutsch ("Platzhalter")');

  ExhaustImage.photoManifest['akrapovic-slip'] = true;
  try {
    const htmlWithLocal = ExhaustImage.markup({ id: 'akrapovic-slip', name: 'Akrapovic Slip-On', brand: 'Akrapovic' });
    assert(htmlWithLocal.indexOf('src="images/exhausts/akrapovic-slip.png"') !== -1, 'Vorbedingung: lokales Foto ist aktiv (Tier 1)');
    assert(htmlWithLocal.indexOf('<span class="placeholder-badge">') === -1, 'Badge-Span fehlt initial komplett, solange das lokale Foto (Tier 1) aktiv ist');
    assert(htmlWithLocal.indexOf('ensurePlaceholderBadge') !== -1, 'onerror-Handler kann den Badge zur Laufzeit nachträglich einfügen, falls Tier 1 doch fehlschlägt');
  } finally {
    delete ExhaustImage.photoManifest['akrapovic-slip'];
  }
})();

// ============================================================
// Results
// ============================================================
console.log('\n' + '═'.repeat(60));
console.log(`  RESULTS: ${passed}/${passed + failed} passed`);
console.log('═'.repeat(60) + '\n');

if (failed > 0) process.exit(1);
