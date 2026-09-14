#!/usr/bin/env node
/**
 * Headless Test — Geteiltes Bild-System (bike-image.js)
 *
 * Prüft die reinen Helper-Funktionen: Foto-Pfad-Konvention
 * (images/bikes/<id>.jpg), Kategorie-Normalisierung auf die sechs
 * Silhouette-Buckets, dass die generierte Kategorie-SVG ein gültiges
 * data:-URI ist und je Kategorie unterschiedlich aussieht, sowie dass
 * markup() sauberes, in sich geschlossenes HTML liefert (kein Bruch von
 * Quotes durch den eingebetteten SVG-Fallback).
 *
 * Run: node tests/bike-image-test.js
 * Exit 0 = alle Tests bestanden, Exit 1 = mindestens ein Fehler.
 */

'use strict';

const BikeImage = require('../bike-image.js');

// ============================================================
// Test harness (Stil analog zu tests/physics-test.js)
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

section('1 · photoPath() folgt der images/bikes/<id>.jpg-Konvention');
(function() {
  assert(BikeImage.photoPath('z900') === 'images/bikes/z900.jpg', 'photoPath("z900") ist korrekt');
  assert(BikeImage.photoPath('versys650') === 'images/bikes/versys650.jpg', 'photoPath("versys650") ist korrekt');
})();

section('2 · categoryKey() normalisiert bekannte Kategorien auf die 6 Buckets');
(function() {
  const expected = {
    'Hypersportler': 'sport', 'Supersportler': 'sport', 'Sportler': 'sport',
    'Sport Tourer': 'touring', 'Adventure': 'touring',
    'Naked': 'naked',
    'Klassiker': 'retro',
    'Off-Road': 'offroad',
    'Cruiser': 'cruiser'
  };
  Object.entries(expected).forEach(([cat, bucket]) => {
    assert(BikeImage.categoryKey(cat) === bucket, `categoryKey("${cat}") === "${bucket}"`);
  });
  assert(BikeImage.categoryKey('Unbekannt') === 'naked', 'Unbekannte Kategorie fällt auf "naked" zurück (kein Crash)');
  const buckets = new Set(Object.values(expected));
  assert(buckets.size === 6, `Alle 6 Silhouette-Buckets sind erreichbar (gefunden: ${buckets.size})`);
})();

section('3 · buildCategorySvg() liefert ein gültiges, kategorie-unterschiedliches data:-URI');
(function() {
  const bucketNames = ['sport', 'naked', 'touring', 'retro', 'offroad', 'cruiser'];
  const svgs = {};
  bucketNames.forEach(function(bucket) {
    // Reverse-map ein Kategorie-String, der auf diesen Bucket zeigt.
    const catForBucket = { sport: 'Sportler', naked: 'Naked', touring: 'Adventure', retro: 'Klassiker', offroad: 'Off-Road', cruiser: 'Cruiser' }[bucket];
    const uri = BikeImage.buildCategorySvg({ name: 'Test Bike', category: catForBucket });
    svgs[bucket] = uri;
    assert(uri.indexOf('data:image/svg+xml,') === 0, `${bucket}: gültiges SVG-data-URI-Präfix`);
    assert(uri.indexOf('Test%20Bike') !== -1 || decodeURIComponent(uri).indexOf('Test Bike') !== -1, `${bucket}: Modellname im SVG enthalten`);
    assert(uri.indexOf("'") === -1, `${bucket}: SVG-data-URI enthält kein einzelnes Anführungszeichen (sicher für Inline-HTML-Attribute)`);
    assert(uri.indexOf('"') === -1, `${bucket}: SVG-data-URI enthält kein doppeltes Anführungszeichen (bricht kein HTML-Attribut auf)`);
  });
  const uniqueSvgs = new Set(Object.values(svgs).map(function(u) { return decodeURIComponent(u).replace(/Test Bike/g, ''); }));
  assert(uniqueSvgs.size === bucketNames.length, `Jede der ${bucketNames.length} Kategorien erzeugt eine optisch unterschiedliche Silhouette`);
})();

section('4 · buildCategorySvg() nutzt bike-eigenes g1/g2, falls vorhanden');
(function() {
  const withOwnGradient = BikeImage.buildCategorySvg({ name: 'X', category: 'Naked', g1: 'abcdef', g2: '123456' });
  assert(decodeURIComponent(withOwnGradient).indexOf('#abcdef') !== -1, 'Eigenes g1 wird statt Kategorie-Standardfarbe verwendet');
  assert(decodeURIComponent(withOwnGradient).indexOf('#123456') !== -1, 'Eigenes g2 wird statt Kategorie-Standardfarbe verwendet');
})();

section('5 · markup() lädt kein Foto ohne BIKE_PHOTO_MANIFEST-Eintrag (kein 404)');
(function() {
  // images/bikes/ ist aktuell absichtlich leer — z900 ist NICHT im Manifest,
  // markup() darf daher keinen Ladeversuch für images/bikes/z900.jpg machen.
  const html = BikeImage.markup({ id: 'z900', name: 'Kawasaki Z900', category: 'Naked' }, { className: 'fact-card-image' });
  assert(html.indexOf('bike-photo-wrap fact-card-image') !== -1, 'Custom className wird angehängt');
  assert(html.indexOf('src="images/bikes/z900.jpg"') === -1, 'Ohne Manifest-Eintrag wird KEIN Foto-Pfad referenziert (kein 404-Request)');
  assert(html.indexOf('src="data:image/svg+xml,') === 0 || html.indexOf('src="data:image/svg+xml,') > -1, 'src zeigt direkt auf die generierte SVG-Illustration');
  assert(html.indexOf('bike-photo-fallback') !== -1, 'bike-photo-fallback-Klasse ist von Anfang an gesetzt (identisches Endergebnis wie beim alten onerror-Pfad)');
  assert(html.indexOf('onload=') !== -1, 'onload-Handler ist gesetzt');
  // Grobe Balance-Prüfung: gleiche Anzahl " wie erwartet (kein Attribut durch den SVG-Fallback aufgebrochen).
  const quoteCount = (html.match(/"/g) || []).length;
  assert(quoteCount % 2 === 0, `Doppelte Anführungszeichen sind paarig (${quoteCount}) — kein aufgebrochenes Attribut`);
})();

section('6 · markup() referenziert das echte Foto, sobald eine ID im BIKE_PHOTO_MANIFEST steht');
(function() {
  assert(typeof BikeImage.hasPhoto === 'function', 'hasPhoto() ist exportiert');
  assert(typeof BikeImage.photoManifest === 'object' && BikeImage.photoManifest !== null, 'photoManifest ist exportiert');
  assert(BikeImage.hasPhoto('z900') === false, 'z900 hat aktuell keinen Manifest-Eintrag (images/bikes/ ist leer)');

  // Test-only: simuliert einen künftigen echten Foto-Eintrag, ohne die
  // reale (leere) images/bikes/README.md-Konvention zu verletzen.
  BikeImage.photoManifest.z900 = true;
  try {
    assert(BikeImage.hasPhoto('z900') === true, 'hasPhoto() erkennt den simulierten Manifest-Eintrag');
    const html = BikeImage.markup({ id: 'z900', name: 'Kawasaki Z900', category: 'Naked' });
    assert(html.indexOf('src="images/bikes/z900.jpg"') !== -1, 'Mit Manifest-Eintrag wird das Foto zuerst referenziert');
    assert(html.indexOf('onerror=') !== -1, 'Mit Manifest-Eintrag bleibt der onerror-Fallback auf die SVG erhalten');
    // Nur das class-Attribut selbst prüfen (nicht den onerror-Handler-Text,
    // der die Klasse "bike-photo-fallback" als String-Literal enthält).
    const classAttr = (html.match(/class="([^"]*)"/) || [])[1] || '';
    assert(classAttr.indexOf('bike-photo-fallback') === -1, 'Ohne vorherigen Ladefehler ist die Fallback-Klasse im class-Attribut noch NICHT gesetzt');
  } finally {
    delete BikeImage.photoManifest.z900; // aufräumen, damit andere Tests/Consumer unberührt bleiben
  }
})();

// ============================================================
// Results
// ============================================================
console.log('\n' + '═'.repeat(60));
console.log(`  RESULTS: ${passed}/${passed + failed} passed`);
console.log('═'.repeat(60) + '\n');

if (failed > 0) process.exit(1);
