/**
 * exhaust-image.js — Geteiltes Bild-System für Auspuff-Teile (shop.html).
 *
 * Analog zu bike-image.js, aber für die 4 `cat:'exhaust'`-Einträge im
 * PARTS-Array (shop.html): dieselbe 3-stufige Fallback-Kette —
 * Tier 1 (lokal, images/exhausts/<part-id>.png, nur falls im
 * EXHAUST_PHOTO_MANIFEST eingetragen), Tier 2 (Unsplash-Platzhalter,
 * eine kategorie-unabhängige Auspuff-Nahaufnahme, da alle 4 Teile
 * gleichartig `cat:'exhaust'` sind — kein Kategorie-Bucket-System wie bei
 * Motorrädern nötig) und Tier 3 (generierte Auspuff-Silhouette als SVG,
 * letzter Rückfall, z. B. bei Offline-Zugriff auf die Unsplash-URL).
 *
 * Bereitgestellt sowohl im Browser (window.ExhaustImage) als auch in Node
 * (module.exports), analog zum Muster in bike-image.js/bikes-data.js.
 */
(function () {
  'use strict';

  var VIEWBOX_W = 520;
  var VIEWBOX_H = 200;

  /**
   * Manifest der Auspuff-Teil-IDs, für die unter
   * images/exhausts/<part-id>.png TATSÄCHLICH eine Foto-Datei im Repo
   * liegt. Nur diese IDs lösen einen Ladeversuch aus — analog zu
   * BIKE_PHOTO_MANIFEST in bike-image.js. Aktuell leer, weil
   * images/exhausts/ absichtlich noch keine echten Fotos enthält (siehe
   * images/exhausts/README.md).
   * @type {Object<string, boolean>}
   */
  var EXHAUST_PHOTO_MANIFEST = {};

  /**
   * Prüft, ob für eine Auspuff-Teil-ID laut EXHAUST_PHOTO_MANIFEST ein
   * echtes Foto vorhanden ist.
   * @param {string} id - Teil-ID (z. B. "akrapovic-slip").
   * @returns {boolean} true, wenn ein Foto-Ladeversuch sinnvoll ist.
   */
  function hasPhoto(id) {
    return !!(id && EXHAUST_PHOTO_MANIFEST[id]);
  }

  /**
   * Tier-2-Platzhalter-URL für ALLE Auspuff-Teile (keine Kategorie-Buckets
   * nötig, da alle 4 PARTS-Einträge gleichartig `cat:'exhaust'` sind) —
   * stabile, direkte Unsplash-Foto-URL (fester `photo-<id>`-Slug, NIE
   * `source.unsplash.com/random`), 4:3-Crop via Query-Parameter.
   *
   * WICHTIG: In dieser Sandbox mangels Netzzugriff auf
   * images.unsplash.com NICHT verifiziert (Option 3, siehe PR-
   * Beschreibung) — kuratiert nach bestem Wissen als thematisch passende
   * Auspuff-Nahaufnahme. Bitte vor dem Merge einmal visuell in einem
   * normalen Browser gegenprüfen.
   * @type {string}
   */
  var UNSPLASH_EXHAUST_URL = 'https://images.unsplash.com/photo-1517686469429-8456aa77332d?w=800&h=600&fit=crop&crop=entropy&q=80&auto=format';

  /**
   * HTML-escaped eine URL für die Verwendung als doppelt-gequotetes
   * HTML-Attribut (nur '&', siehe bike-image.js' escUrlForAttr()).
   * @param {string} url - Rohe URL.
   * @returns {string} Attribut-sichere URL.
   */
  function escUrlForAttr(url) {
    return String(url == null ? '' : url).replace(/&/g, '&amp;');
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
   * Baut eine generische Auspuff-/Endtopf-Silhouette (Gradient-Hintergrund
   * + Linien-Illustration + Marken-/Teilename) als data:-URI. Dient als
   * letzter Rückfall (Tier 3), falls weder das lokale Foto noch die
   * Unsplash-URL laden.
   * @param {Object} part - PARTS-Eintrag mit mind. name. Optional brand.
   * @returns {string} data:image/svg+xml,... Data-URI.
   */
  function buildExhaustSvg(part) {
    var name = (part && part.name) || '';
    var brand = (part && part.brand) || '';
    var g1 = '2b2b2b';
    var g2 = '585858';

    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + VIEWBOX_W + ' ' + VIEWBOX_H + '">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0%" stop-color="#' + g1 + '"/>' +
      '<stop offset="100%" stop-color="#' + g2 + '"/>' +
      '</linearGradient></defs>' +
      '<rect width="' + VIEWBOX_W + '" height="' + VIEWBOX_H + '" fill="url(#g)"/>' +
      '<g fill="none" stroke="#ffffff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" opacity="0.55">' +
      // Krümmer + Mittelrohr + Endtopf-Silhouette.
      '<path d="M90 120 L160 96 L230 96 L300 108"/>' +
      '<rect x="300" y="84" width="130" height="48" rx="22"/>' +
      '<path d="M430 96 L430 120 M430 108 L456 108" opacity="0.8"/>' +
      '</g>' +
      '<text x="260" y="168" font-family="Segoe UI, sans-serif" font-size="20" font-weight="700" fill="#ffffff" text-anchor="middle" opacity="0.92">' +
      escSvgText(brand ? brand + ' ' + name : name) +
      '</text>' +
      '</svg>';
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }

  /**
   * Pfad zum bevorzugten echten Foto eines Auspuff-Teils.
   * @param {string} id - Teil-ID (z. B. "akrapovic-slip").
   * @returns {string} Relativer Pfad, z. B. "images/exhausts/akrapovic-slip.png".
   */
  function photoPath(id) {
    return 'images/exhausts/' + id + '.png';
  }

  /** Markup des dezenten "Platzhalter"-Eck-Badges (siehe design.css .placeholder-badge, geteilt mit bike-image.js). Nur eingefügt, solange Tier 2/3 (nicht lokal) aktiv ist. */
  var PLACEHOLDER_BADGE_HTML = '<span class="placeholder-badge">Platzhalter</span>';

  /**
   * Fügt (idempotent) den "Platzhalter"-Eck-Badge in den
   * `.exhaust-photo-wrap`-Container eines Bildes ein, sobald zur Laufzeit
   * auf eine Nicht-lokal-Stufe (Unsplash-Tier-2 oder SVG-Tier-3)
   * zurückgefallen wird — analog zu BikeImage.ensurePlaceholderBadge()
   * (bike-image.js), hier als eigenständige Kopie, da beide Module
   * unabhängig voneinander eingebunden werden können.
   * @param {HTMLImageElement} img - Das <img>-Element, dessen Elternelement den Badge erhalten soll.
   * @returns {void}
   */
  function ensurePlaceholderBadge(img) {
    var wrap = img && img.parentNode;
    if (!wrap || wrap.querySelector('.placeholder-badge')) return;
    var badge = document.createElement('span');
    badge.className = 'placeholder-badge';
    badge.textContent = 'Platzhalter';
    wrap.appendChild(badge);
  }

  /**
   * Baut das komplette Bild-Markup eines Auspuff-Teils als HTML-String zum
   * direkten Einfügen via innerHTML — dieselbe 3-stufige Fallback-Kette
   * wie BikeImage.markup() (bike-image.js), nur mit exhaust-eigenen
   * Klassen (`exhaust-photo-wrap`/`exhaust-photo`), damit Bike- und
   * Auspuff-Bilder unabhängig stylebar bleiben:
   *   Tier 1 (lokal)    → images/exhausts/<id>.png, NUR falls im
   *                       EXHAUST_PHOTO_MANIFEST eingetragen.
   *   Tier 2 (Unsplash) → UNSPLASH_EXHAUST_URL — aktiv als initiale src,
   *                       wenn kein lokales Foto vorhanden ist, ODER als
   *                       onerror-Ziel, falls das lokale Foto trotz
   *                       Manifest-Eintrag nicht lädt.
   *   Tier 3 (SVG)      → buildExhaustSvg(), letzter Rückfall.
   * Die Klasse `exhaust-photo-placeholder` markiert jederzeit, ob AKTUELL
   * eine Nicht-lokal-Stufe (2 oder 3) aktiv ist (Hook für den
   * "Platzhalter"-Badge aus einem Folge-Commit).
   * @param {Object} part - PARTS-Eintrag (mind. id, name; optional brand).
   * @param {Object} [opts] - { eager?: boolean, className?: string }
   * @returns {string} HTML-Markup: <div class="exhaust-photo-wrap ...">...</div>.
   */
  function markup(part, opts) {
    opts = opts || {};
    var svgFallback = buildExhaustSvg(part);
    var id = part && part.id;
    var photoAvailable = hasPhoto(id);
    var src = photoAvailable ? photoPath(id) : UNSPLASH_EXHAUST_URL;
    var altText = escSvgText(((part && part.brand) ? part.brand + ' ' : '') + ((part && part.name) || ''));
    var loading = opts.eager ? 'eager' : 'lazy';
    var extraClass = opts.className ? ' ' + opts.className : '';
    var imgClass = 'exhaust-photo' + (photoAvailable ? '' : ' exhaust-photo-placeholder');
    var badgeHtml = photoAvailable ? '' : PLACEHOLDER_BADGE_HTML;
    var unsplashUrlAttrSafe = escUrlForAttr(UNSPLASH_EXHAUST_URL);
    var onErrorAttr = photoAvailable
      ? 'onerror="this.onerror=function(){this.onerror=null;this.src=\'' + svgFallback + '\';this.classList.add(\'is-loaded\');this.classList.add(\'exhaust-photo-fallback\');};this.classList.add(\'exhaust-photo-placeholder\');this.src=\'' + unsplashUrlAttrSafe + '\';if(window.ExhaustImage)window.ExhaustImage.ensurePlaceholderBadge(this);" '
      : 'onerror="this.onerror=null;this.src=\'' + svgFallback + '\';this.classList.add(\'is-loaded\');this.classList.add(\'exhaust-photo-fallback\');" ';
    return '<div class="exhaust-photo-wrap' + extraClass + '">' +
      '<img class="' + imgClass + '" src="' + escUrlForAttr(src) + '" alt="' + altText + '" loading="' + loading + '" ' +
      'onload="this.classList.add(\'is-loaded\')" ' + onErrorAttr +
      '>' + badgeHtml +
      '</div>';
  }

  var api = {
    hasPhoto: hasPhoto,
    photoPath: photoPath,
    photoManifest: EXHAUST_PHOTO_MANIFEST,
    buildExhaustSvg: buildExhaustSvg,
    unsplashExhaustUrl: UNSPLASH_EXHAUST_URL,
    ensurePlaceholderBadge: ensurePlaceholderBadge,
    markup: markup
  };

  if (typeof window !== 'undefined') {
    window.ExhaustImage = api;
  } else if (typeof globalThis !== 'undefined') {
    globalThis.ExhaustImage = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
