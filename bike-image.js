/**
 * bike-image.js — Geteiltes Bild-System für Motorrad-Visuals.
 *
 * Konvention: für jedes Motorrad wird zuerst ein echtes Foto unter
 * `images/bikes/<id>.jpg` versucht (siehe images/bikes/README.md). Schlägt
 * das Laden fehl (Foto fehlt), wird automatisch auf eine selbst erzeugte,
 * kategorie-spezifische SVG-Illustration zurückgefallen (Sport, Naked,
 * Touring/Adventure, Retro, Offroad, Cruiser) — keinerlei externe
 * Bild-Requests. Verallgemeinert das frühere, nur in index.html vorhandene
 * `makeBikeSvg()` zu einer einheitlichen, überall wiederverwendbaren Quelle.
 *
 * Bereitgestellt sowohl im Browser (window.BikeImage) als auch in Node
 * (module.exports), analog zum Muster in bikes-data.js.
 */
(function () {
  'use strict';

  var VIEWBOX_W = 520;
  var VIEWBOX_H = 200;

  /**
   * Manifest der Bike-IDs, für die unter images/bikes/<id>.jpg TATSÄCHLICH
   * eine Foto-Datei im Repo liegt. Nur diese IDs lösen einen
   * <img src="images/bikes/<id>.jpg">-Ladeversuch aus — alle anderen
   * springen direkt zur generierten SVG-Illustration (siehe markup()),
   * damit für (noch) nicht vorhandene Fotos KEIN 404-Request entsteht.
   *
   * Aktuell leer, weil images/bikes/ absichtlich noch keine echten Fotos
   * enthält (siehe images/bikes/README.md). Um ein Foto zu aktivieren:
   * Datei unter images/bikes/<id>.jpg ablegen UND die ID hier eintragen,
   * z. B. `{ z900: true }`.
   * @type {Object<string, boolean>}
   */
  var BIKE_PHOTO_MANIFEST = {};

  /**
   * Prüft, ob für eine Bike-ID laut BIKE_PHOTO_MANIFEST ein echtes Foto
   * vorhanden ist.
   * @param {string} id - Bike-ID (z. B. "z900").
   * @returns {boolean} true, wenn ein Foto-Ladeversuch sinnvoll ist.
   */
  function hasPhoto(id) {
    return !!(id && BIKE_PHOTO_MANIFEST[id]);
  }

  /** Bildet die (deutschen) Kategorie-Strings aus den Bike-Daten auf einen der sechs Silhouette-Buckets ab. */
  var CATEGORY_MAP = {
    'Hypersportler': 'sport',
    'Supersportler': 'sport',
    'Sportler': 'sport',
    'Sport Tourer': 'touring',
    'Naked': 'naked',
    'Adventure': 'touring',
    'Klassiker': 'retro',
    'Off-Road': 'offroad',
    'Cruiser': 'cruiser'
  };

  /** Standard-Gradient (Hex ohne '#') je Kategorie-Bucket, falls ein Bike kein eigenes g1/g2 mitbringt. */
  var CATEGORY_GRADIENTS = {
    sport: ['0f1115', '2fa06b'],
    naked: ['1c1c1e', '38383c'],
    touring: ['16222a', '355c7d'],
    retro: ['4a2c14', 'a9927d'],
    offroad: ['22331b', '6b8e23'],
    cruiser: ['2b1b17', '8b5a2b']
  };

  /**
   * Normalisiert eine rohe Kategorie-Bezeichnung auf einen der sechs
   * unterstützten Silhouette-Buckets (fällt auf "naked" zurück).
   * @param {string} category - Rohe Kategorie aus den Bike-Daten (z. B. "Adventure").
   * @returns {string} Einer von: sport, naked, touring, retro, offroad, cruiser.
   */
  function categoryKey(category) {
    return CATEGORY_MAP[category] || 'naked';
  }

  /**
   * Escaped die für SVG-Text relevanten Sonderzeichen (& und <).
   * @param {string} s - Roher Text.
   * @returns {string} SVG-sicherer Text.
   */
  function escSvgText(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  }

  /**
   * Liefert die zusätzliche Linien-Silhouette (über dem gemeinsamen
   * Zweirad-Grundgerüst) für einen Kategorie-Bucket.
   * @param {string} key - Kategorie-Bucket (siehe categoryKey()).
   * @returns {string} SVG-Pfad-/Formen-Fragment.
   */
  function silhouetteFor(key) {
    switch (key) {
      case 'sport':
        // Geduckte Sitzposition, kleine Frontscheibe.
        return '<path d="M155 150 L245 104 L300 100 L375 150 M245 104 L226 66 L268 66 M155 150 L300 100"/>' +
               '<path d="M300 100 L322 62 L344 78" opacity="0.85"/>';
      case 'touring':
        // Hohe Frontscheibe + Seitenkoffer.
        return '<path d="M150 150 L230 100 L300 96 L382 150 M230 100 L214 54 L252 50 M150 150 L300 96"/>' +
               '<path d="M300 96 L322 42 L340 96" opacity="0.9"/>' +
               '<rect x="352" y="120" width="34" height="26" rx="4" opacity="0.7"/>';
      case 'retro':
        // Rundscheinwerfer + angedeutete Speichen.
        return '<path d="M150 150 L230 104 L298 104 L378 150 M230 104 L214 66 L256 66 M150 150 L298 104"/>' +
               '<circle cx="140" cy="112" r="12" opacity="0.85"/>' +
               '<path d="M150 150 L150 124 M150 150 L170 138 M150 150 L130 138 M378 150 L378 124 M378 150 L398 138 M378 150 L358 138" opacity="0.4"/>';
      case 'offroad':
        // Hoher Frontkotflügel, langer Federweg.
        return '<path d="M150 152 L228 96 L296 100 L382 150 M228 96 L206 46 L246 56 M150 152 L296 100"/>' +
               '<path d="M118 130 A34 20 0 0 1 178 122" opacity="0.85"/>';
      case 'cruiser':
        // Langer, tiefer Radstand, zurückgelehnte Sitzposition.
        return '<path d="M130 152 L214 128 L330 128 L404 152 M214 128 L198 90 L246 82"/>' +
               '<path d="M330 128 L352 98 L330 92" opacity="0.85"/>';
      case 'naked':
      default:
        // Freiliegender Lenker, keine Verkleidung (Basis-Silhouette).
        return '<path d="M150 150 L232 98 L302 98 L380 150 M232 98 L206 52 L258 60 M302 98 L322 66 L364 78 M150 150 L302 98"/>';
    }
  }

  /**
   * Liefert die Radposition/-größe (an die Silhouette angepasst) für einen
   * Kategorie-Bucket, z. B. größerer Radstand für Cruiser.
   * @param {string} key - Kategorie-Bucket.
   * @returns {string} SVG <circle>-Fragment für Vorder-/Hinterrad.
   */
  function wheelsFor(key) {
    if (key === 'cruiser') return '<circle cx="130" cy="152" r="27"/><circle cx="404" cy="152" r="27"/>';
    if (key === 'offroad') return '<circle cx="150" cy="152" r="30"/><circle cx="382" cy="150" r="26"/>';
    return '<circle cx="150" cy="150" r="28"/><circle cx="380" cy="150" r="28"/>';
  }

  /**
   * Baut eine kategorie-spezifische SVG-Illustration (Gradient-Hintergrund +
   * Linien-Silhouette + Modellname) als data:-URI. Dient als Fallback, wenn
   * unter images/bikes/<id>.jpg kein echtes Foto vorhanden ist.
   * @param {Object} bike - Bike-Datensatz mit mind. name, category. Optional g1/g2 (Hex ohne '#') für eine bike-eigene Gradientfarbe statt der Kategorie-Standardfarbe.
   * @returns {string} data:image/svg+xml,... Data-URI.
   */
  function buildCategorySvg(bike) {
    var key = categoryKey(bike && bike.category);
    var defaults = CATEGORY_GRADIENTS[key];
    var g1 = (bike && bike.g1) || defaults[0];
    var g2 = (bike && bike.g2) || defaults[1];
    var name = (bike && bike.name) || '';

    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + VIEWBOX_W + ' ' + VIEWBOX_H + '">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0%" stop-color="#' + g1 + '"/>' +
      '<stop offset="100%" stop-color="#' + g2 + '"/>' +
      '</linearGradient></defs>' +
      '<rect width="' + VIEWBOX_W + '" height="' + VIEWBOX_H + '" fill="url(#g)"/>' +
      '<g fill="none" stroke="#ffffff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" opacity="0.55">' +
      wheelsFor(key) + silhouetteFor(key) +
      '</g>' +
      '<text x="260" y="188" font-family="Segoe UI, sans-serif" font-size="20" font-weight="700" fill="#ffffff" text-anchor="middle" opacity="0.92">' +
      escSvgText(name) +
      '</text>' +
      '</svg>';
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }

  /**
   * Pfad zum bevorzugten echten Foto eines Motorrads.
   * @param {string} id - Bike-ID (z. B. "z900").
   * @returns {string} Relativer Pfad, z. B. "images/bikes/z900.jpg".
   */
  function photoPath(id) {
    return 'images/bikes/' + id + '.jpg';
  }

  /**
   * Baut das komplette Bild-Markup (echtes Foto bevorzugt, Kategorie-SVG als
   * Fallback, sanftes Fade-in beim Laden) als HTML-String zum direkten
   * Einfügen via innerHTML. Nutzt inline onload/onerror, da die Aufrufer
   * (index.html, shop.html, wheel.html, garage.js) Karten/Widgets bereits
   * per String-Konkatenation/Template-Literal rendern.
   *
   * Versucht ein echtes Foto NUR, wenn die Bike-ID im BIKE_PHOTO_MANIFEST
   * eingetragen ist (siehe hasPhoto()) — andernfalls wird direkt die
   * generierte SVG-Illustration als src gesetzt, damit für (noch) nicht
   * vorhandene Fotos kein 404-Request entsteht. Das Endergebnis (welche
   * SVG letztlich angezeigt wird) ist in beiden Fällen identisch.
   * @param {Object} bike - Bike-Datensatz (mind. id, name; optional category, g1, g2).
   * @param {Object} [opts] - { eager?: boolean, className?: string }
   * @returns {string} HTML-Markup: <div class="bike-photo-wrap ...">...</div>.
   */
  function markup(bike, opts) {
    opts = opts || {};
    var svgFallback = buildCategorySvg(bike);
    var id = bike && bike.id;
    var photoAvailable = hasPhoto(id);
    var src = photoAvailable ? photoPath(id) : svgFallback;
    var altText = escSvgText((bike && bike.name) || '');
    var loading = opts.eager ? 'eager' : 'lazy';
    var extraClass = opts.className ? ' ' + opts.className : '';
    var imgClass = 'bike-photo' + (photoAvailable ? '' : ' bike-photo-fallback');
    var onErrorAttr = photoAvailable
      ? 'onerror="this.onerror=null;this.src=\'' + svgFallback + '\';this.classList.add(\'is-loaded\');this.classList.add(\'bike-photo-fallback\');" '
      : '';
    return '<div class="bike-photo-wrap' + extraClass + '">' +
      '<img class="' + imgClass + '" src="' + src + '" alt="' + altText + '" loading="' + loading + '" ' +
      'onload="this.classList.add(\'is-loaded\')" ' + onErrorAttr +
      '>' +
      '</div>';
  }

  var api = {
    categoryKey: categoryKey,
    buildCategorySvg: buildCategorySvg,
    photoPath: photoPath,
    hasPhoto: hasPhoto,
    photoManifest: BIKE_PHOTO_MANIFEST,
    markup: markup
  };

  if (typeof window !== 'undefined') {
    window.BikeImage = api;
  } else if (typeof globalThis !== 'undefined') {
    globalThis.BikeImage = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
