#!/usr/bin/env node
/**
 * Headless Test — Geteiltes Bild-System (bike-image.js)
 *
 * Prüft die reinen Helper-Funktionen: Foto-Pfad-Konvention
 * (images/bikes/<id>.png), Kategorie-Normalisierung auf die sechs
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

section('1 · photoPath() folgt der images/bikes/<id>.png-Konvention');
(function() {
  assert(BikeImage.photoPath('z900') === 'images/bikes/z900.png', 'photoPath("z900") ist korrekt');
  assert(BikeImage.photoPath('versys650') === 'images/bikes/versys650.png', 'photoPath("versys650") ist korrekt');
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

section('5 · markup() lädt kein lokales Foto ohne BIKE_PHOTO_MANIFEST-Eintrag — Tier 2 (Unsplash) statt Tier 3 (SVG)');
(function() {
  // images/bikes/ ist aktuell absichtlich leer — z900 ist NICHT im Manifest,
  // markup() darf daher keinen Ladeversuch für images/bikes/z900.png machen.
  //
  // GEÄNDERTES VERHALTEN (3-Stufen-Kette, ersetzt die alte 2-Stufen-Logik):
  // vorher zeigte `src` hier direkt auf die generierte SVG (`data:image/
  // svg+xml,...`) — jetzt zeigt `src` zuerst auf die kategorie-passende
  // Unsplash-Platzhalter-URL (Tier 2); die SVG (Tier 3) ist nur noch das
  // onerror-Ziel, falls die Unsplash-URL nicht lädt (z. B. offline). Die
  // ursprüngliche Assertion "src zeigt direkt auf die generierte
  // SVG-Illustration" ist daher durch die folgende Tier-2-Assertion
  // ersetzt; die Absicht des Tests (kein 404 fürs lokale Foto, sauberes
  // HTML) bleibt erhalten.
  const html = BikeImage.markup({ id: 'z900', name: 'Kawasaki Z900', category: 'Naked' }, { className: 'fact-card-image' });
  assert(html.indexOf('bike-photo-wrap fact-card-image') !== -1, 'Custom className wird angehängt');
  assert(html.indexOf('src="images/bikes/z900.png"') === -1, 'Ohne Manifest-Eintrag wird KEIN Foto-Pfad referenziert (kein 404-Request)');
  assert(html.indexOf('src="' + BikeImage.unsplashUrlFor({ category: 'Naked' }).replace(/&/g, '&amp;') + '"') !== -1, 'src zeigt auf die kategorie-passende Unsplash-Platzhalter-URL (Tier 2), da kein lokales Foto vorliegt (GEÄNDERT: vorher direkt SVG)');
  assert(html.indexOf('bike-photo-placeholder') !== -1, 'bike-photo-placeholder-Klasse ist von Anfang an gesetzt (markiert "nicht lokal", ersetzt die alte bike-photo-fallback-Klasse für diesen Ausgangszustand)');
  assert(html.indexOf('onload=') !== -1, 'onload-Handler ist gesetzt');
  assert(html.indexOf('onerror=') !== -1, 'onerror-Handler ist gesetzt (Rückfall auf Tier 3)');
  assert(html.indexOf('data:image/svg+xml,') !== -1, 'Der onerror-Handler referenziert weiterhin die generierte SVG-Illustration als letzten Rückfall (Tier 3, falls auch Unsplash nicht lädt)');
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
    assert(html.indexOf('src="images/bikes/z900.png"') !== -1, 'Mit Manifest-Eintrag wird das Foto zuerst referenziert (Tier 1)');
    assert(html.indexOf('onerror=') !== -1, 'Mit Manifest-Eintrag bleibt ein onerror-Fallback erhalten');
    // Nur das class-Attribut selbst prüfen (nicht den onerror-Handler-Text,
    // der die Klassen "bike-photo-fallback"/"bike-photo-placeholder" als
    // String-Literale enthält).
    const classAttr = (html.match(/class="([^"]*)"/) || [])[1] || '';
    assert(classAttr.indexOf('bike-photo-fallback') === -1, 'Ohne vorherigen Ladefehler ist die Fallback-Klasse im class-Attribut noch NICHT gesetzt');
    assert(classAttr.indexOf('bike-photo-placeholder') === -1, 'Ohne vorherigen Ladefehler ist die Platzhalter-Klasse im class-Attribut noch NICHT gesetzt (Tier 1 ist aktiv)');

    // NEU: die volle 3-Stufen-Kette muss im onerror-Handler statisch nachweisbar
    // sein — Tier 1 (lokal) fehlschlägt zuerst zu Tier 2 (Unsplash), und erst
    // ein ZWEITER, simulierter Ladefehler (auf der Unsplash-URL) fällt
    // endgültig auf Tier 3 (SVG) zurück.
    const unsplashUrl = BikeImage.unsplashUrlFor({ category: 'Naked' }).replace(/&/g, '&amp;');
    assert(html.indexOf(unsplashUrl) !== -1, 'onerror-Handler enthält die Tier-2-Unsplash-URL als Zwischen-Fallback-Ziel, falls das lokale Foto (Tier 1) nicht lädt');
    assert(html.indexOf('bike-photo-placeholder') !== -1, 'onerror-Handler setzt beim Rückfall auf Tier 2 die "nicht lokal"-Klasse (bike-photo-placeholder), die als Badge-Hook für den Folge-Commit dient');
    assert(html.indexOf('data:image/svg+xml,') !== -1, 'onerror-Handler enthält verschachtelt weiterhin die generierte SVG (Tier 3) als letzten Rückfall, falls auch die Unsplash-URL (Tier 2) nicht lädt (simulierter Netzwerkfehler-Pfad)');
  } finally {
    delete BikeImage.photoManifest.z900; // aufräumen, damit andere Tests/Consumer unberührt bleiben
  }
})();

section('7 · "Platzhalter"-Badge — nur sichtbar, solange KEIN lokales Foto aktiv ist');
(function() {
  // Kein lokales Foto (z900 nicht im Manifest) → Badge muss von Anfang an
  // im Markup enthalten sein (deckungsgleich mit der Tier-2-Assertion aus
  // Abschnitt 5, hier isoliert für das Badge-Feature getestet).
  const htmlNoLocal = BikeImage.markup({ id: 'z900', name: 'Kawasaki Z900', category: 'Naked' });
  assert(htmlNoLocal.indexOf('placeholder-badge') !== -1, 'Badge-Span ist im Markup enthalten, wenn kein lokales Foto vorliegt');
  assert(htmlNoLocal.indexOf('>Platzhalter<') !== -1, 'Badge-Text ist auf Deutsch ("Platzhalter")');

  // Simuliertes lokales Foto (via Manifest, siehe hasPhoto()) → Badge darf
  // initial NICHT im Markup stehen (verschwindet automatisch, sobald ein
  // lokales Foto lädt — der Badge wird für diesen Zustand nie eingefügt).
  BikeImage.photoManifest.z900 = true;
  try {
    const htmlWithLocal = BikeImage.markup({ id: 'z900', name: 'Kawasaki Z900', category: 'Naked' });
    assert(htmlWithLocal.indexOf('src="images/bikes/z900.png"') !== -1, 'Vorbedingung: lokales Foto ist aktiv (Tier 1)');
    // Badge-Span darf nicht als eigenständiges Element im initialen Markup
    // stehen — "ensurePlaceholderBadge" (der Funktionsname) taucht zwar als
    // String-Literal im onerror-Handler auf, ein "<span class=\"placeholder-badge\">"-
    // Element jedoch nicht.
    assert(htmlWithLocal.indexOf('<span class="placeholder-badge">') === -1, 'Badge-Span fehlt initial komplett, solange das lokale Foto (Tier 1) aktiv ist');
    assert(htmlWithLocal.indexOf('ensurePlaceholderBadge') !== -1, 'onerror-Handler kann den Badge zur Laufzeit nachträglich einfügen, falls Tier 1 doch fehlschlägt');
  } finally {
    delete BikeImage.photoManifest.z900;
  }
})();

// ============================================================
// Results
// ============================================================
console.log('\n' + '═'.repeat(60));
console.log(`  RESULTS: ${passed}/${passed + failed} passed`);
console.log('═'.repeat(60) + '\n');

if (failed > 0) process.exit(1);
