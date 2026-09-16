/**
 * garage.js — Logik für die "Meine Garage"-Seite (garage.html).
 *
 * Enthält reine, Node-testbare Helper-Funktionen (View-Model-Aufbau aus
 * Zustand, Traum-Bike get/set, Zuletzt-angesehen-Capping/Dedup) sowie
 * DOM-Rendering-Funktionen, die NUR im Browser ausgeführt werden
 * (per typeof-Guard abgesichert). Konsumiert bikes-data.js (SHARED_BIKES),
 * stats.js (VroooomStats) und achievements.js (VroooomAchievements), liest
 * zusätzlich (nur lesend!) die bestehenden Keys vroooom_favorites und
 * vroooom_reviews.
 *
 * Neue, eigene localStorage-Keys:
 *   - vroooom_garage_recentlyViewed  (Array<{bikeKey, viewedAt}>, capped)
 *   - vroooom_garage_dreamBike       (string Bike-ID oder null)
 *
 * Bereitgestellt sowohl im Browser (window/globalThis) als auch in Node
 * (module.exports), analog zum Muster in bikes-data.js/stats.js/achievements.js.
 */
'use strict';

/** localStorage-Key für die "Zuletzt angesehen"-Liste. */
var RECENTLY_VIEWED_KEY = 'vroooom_garage_recentlyViewed';
/** localStorage-Key für das gewählte Traum-Bike. */
var DREAM_BIKE_KEY = 'vroooom_garage_dreamBike';
/** Maximale Anzahl an Einträgen in der "Zuletzt angesehen"-Liste. */
var MAX_RECENTLY_VIEWED = 8;

/** Obergrenzen für die einfachen CSS-Statistik-Balken (rein visuelle Skalierung). */
var STAT_BAR_MAX = {
  raceFinishes: 20,
  wheelSpins: 20,
  bikeViewCount: 30,
  reviewsWritten: 10,
  shopConfigsSaved: 10,
  raceEndlessBestTime: 120
};

/**
 * Liest ein JSON-Objekt/Array sicher aus localStorage.
 * @param {string} key - localStorage-Key.
 * @param {*} fallback - Rückgabewert bei Fehler/Fehlen.
 * @returns {*} Geparster Wert oder fallback.
 */
function safeReadJSON(key, fallback) {
  try {
    if (typeof localStorage === 'undefined' || localStorage === null) return fallback;
    var raw = localStorage.getItem(key);
    if (raw === null || raw === undefined) return fallback;
    var parsed = JSON.parse(raw);
    return parsed;
  } catch (e) {
    return fallback;
  }
}

/**
 * Schreibt einen Wert als JSON sicher in localStorage.
 * @param {string} key - localStorage-Key.
 * @param {*} value - Zu speichernder Wert.
 * @returns {void}
 */
function safeWriteJSON(key, value) {
  try {
    if (typeof localStorage === 'undefined' || localStorage === null) return;
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    /* bewusst ignoriert — darf App nie blockieren */
  }
}

/**
 * Fügt ein Bike vorne in eine "Zuletzt angesehen"-Liste ein: bestehende
 * Einträge desselben Bikes werden dedupliziert (nach vorne verschoben,
 * kein Doppel-Eintrag), die Liste wird auf maxLen Einträge gekappt.
 * Reine Funktion (kein localStorage-Zugriff) — daher direkt testbar.
 * @param {Array<{bikeKey: string, viewedAt: string}>} list - Bisherige Liste (neueste zuerst).
 * @param {string} bikeKey - Bike-ID des neu angesehenen Motorrads.
 * @param {number} [maxLen] - Maximale Listenlänge (Standard: MAX_RECENTLY_VIEWED).
 * @param {string} [viewedAt] - ISO-Zeitstempel (Standard: jetzt); als Parameter für Tests.
 * @returns {Array<{bikeKey: string, viewedAt: string}>} Neue, gekappte Liste.
 */
function addToRecentlyViewed(list, bikeKey, maxLen, viewedAt) {
  var cap = (typeof maxLen === 'number' && maxLen > 0) ? maxLen : MAX_RECENTLY_VIEWED;
  var ts = viewedAt || new Date().toISOString();
  var safeList = Array.isArray(list) ? list : [];
  var filtered = safeList.filter(function (entry) { return entry && entry.bikeKey !== bikeKey; });
  filtered.unshift({ bikeKey: bikeKey, viewedAt: ts });
  return filtered.slice(0, cap);
}

/**
 * Liefert die api-client.js-Bridge, falls verfügbar (window.ApiClient im
 * Browser, sonst per require() im Node-Testkontext) — siehe api-client.js
 * für die Begründung dieser Bridge. Liefert null, falls beides fehlschlägt
 * (dann greift der rohe safeReadJSON/safeWriteJSON-Fallback unten).
 * @returns {Object|null} ApiClient-API oder null.
 */
function getApiClient() {
  if (typeof window !== 'undefined' && window.ApiClient) return window.ApiClient;
  if (typeof globalThis !== 'undefined' && globalThis.ApiClient) return globalThis.ApiClient;
  try {
    if (typeof require === 'function') return require('./js/api-client.js');
  } catch (e) { /* kein api-client.js verfügbar — Fallback greift */ }
  return null;
}

/**
 * Liest die aktuelle "Zuletzt angesehen"-Liste aus localStorage (via
 * api-client.js, sofern verfügbar — identische Daten/Key wie zuvor).
 * @returns {Array<{bikeKey: string, viewedAt: string}>} Liste (leer, falls keine Daten/korrupt).
 */
function getRecentlyViewed() {
  var api = getApiClient();
  if (api && typeof api.getRecentlyViewed === 'function') return api.getRecentlyViewed();
  var list = safeReadJSON(RECENTLY_VIEWED_KEY, []);
  return Array.isArray(list) ? list : [];
}

/**
 * Trägt ein Bike als "zuletzt angesehen" ein (liest, dedupliziert/kappt,
 * schreibt zurück, via api-client.js sofern verfügbar). Für den
 * Modal.open()-Hook in index.html gedacht.
 * @param {string} bikeKey - Bike-ID des angesehenen Motorrads.
 * @returns {Array<{bikeKey: string, viewedAt: string}>} Aktualisierte Liste.
 */
function recordRecentlyViewed(bikeKey) {
  var api = getApiClient();
  if (api && typeof api.addRecentlyViewed === 'function') return api.addRecentlyViewed(bikeKey, MAX_RECENTLY_VIEWED);
  var updated = addToRecentlyViewed(getRecentlyViewed(), bikeKey, MAX_RECENTLY_VIEWED);
  safeWriteJSON(RECENTLY_VIEWED_KEY, updated);
  return updated;
}

/**
 * Liest die aktuell gewählte Traum-Bike-ID (via api-client.js, sofern
 * verfügbar).
 * @returns {string|null} Bike-ID oder null, falls keins gewählt ist.
 */
function getDreamBikeKey() {
  var api = getApiClient();
  if (api && typeof api.getDreamBike === 'function') return api.getDreamBike();
  var v = safeReadJSON(DREAM_BIKE_KEY, null);
  return (typeof v === 'string' && v) ? v : null;
}

/**
 * Setzt (oder löscht) das Traum-Bike (via api-client.js, sofern verfügbar).
 * @param {string|null} bikeKey - Neue Bike-ID, oder null/leer zum Löschen.
 * @returns {string|null} Der gespeicherte Wert (normalisiert).
 */
function setDreamBikeKey(bikeKey) {
  var api = getApiClient();
  if (api && typeof api.setDreamBike === 'function') return api.setDreamBike(bikeKey);
  var normalized = (typeof bikeKey === 'string' && bikeKey) ? bikeKey : null;
  safeWriteJSON(DREAM_BIKE_KEY, normalized);
  return normalized;
}

/**
 * Baut die Anzeige-Liste für "Meine Bikes" (Favoriten) aus dem aktuellen
 * Zustand. Rein funktional, empty-state-sicher.
 * @param {Array<string>} favoriteKeys - Favoriten-IDs (vroooom_favorites).
 * @param {Object<string, Object>} bikes - Bike-Datenquelle (SHARED_BIKES).
 * @returns {{items: Array<Object>, empty: boolean}} Anzeige-Liste + Leer-Flag.
 */
function buildFavoritesViewModel(favoriteKeys, bikes) {
  var keys = Array.isArray(favoriteKeys) ? favoriteKeys : [];
  var items = keys
    .filter(function (k) { return bikes && bikes[k]; })
    .map(function (k) { return { bikeKey: k, bike: bikes[k] }; });
  return { items: items, empty: items.length === 0 };
}

/**
 * Baut die Anzeige-Liste für "Zuletzt angesehen" aus dem aktuellen Zustand.
 * @param {Array<{bikeKey: string, viewedAt: string}>} recentlyViewed - Rohliste.
 * @param {Object<string, Object>} bikes - Bike-Datenquelle (SHARED_BIKES).
 * @returns {{items: Array<Object>, empty: boolean}} Anzeige-Liste + Leer-Flag.
 */
function buildRecentlyViewedViewModel(recentlyViewed, bikes) {
  var list = Array.isArray(recentlyViewed) ? recentlyViewed : [];
  var items = list
    .filter(function (entry) { return entry && bikes && bikes[entry.bikeKey]; })
    .map(function (entry) { return { bikeKey: entry.bikeKey, bike: bikes[entry.bikeKey], viewedAt: entry.viewedAt }; });
  return { items: items, empty: items.length === 0 };
}

/**
 * Baut die Anzeige-Liste für "Meine Reviews" aus dem vroooom_reviews-Objekt
 * (wird NUR gelesen, nie verändert). Neueste Bewertung je Bike zuerst.
 * @param {Object<string, Array<{rating: number, text: string, date: string}>>} reviews - Rohdaten.
 * @param {Object<string, Object>} bikes - Bike-Datenquelle (SHARED_BIKES).
 * @returns {{items: Array<Object>, empty: boolean, count: number}} Anzeige-Liste + Leer-Flag + Gesamtzahl.
 */
function buildReviewsViewModel(reviews, bikes) {
  var data = (reviews && typeof reviews === 'object') ? reviews : {};
  var items = [];
  Object.keys(data).forEach(function (bikeKey) {
    if (!bikes || !bikes[bikeKey]) return;
    var list = Array.isArray(data[bikeKey]) ? data[bikeKey] : [];
    list.slice().reverse().forEach(function (review) {
      items.push({
        bikeKey: bikeKey,
        bike: bikes[bikeKey],
        rating: review.rating,
        text: review.text,
        date: review.date
      });
    });
  });
  return { items: items, empty: items.length === 0, count: items.length };
}

/**
 * Baut die Anzeige-Daten für das Traum-Bike (inklusive Specs), falls eins
 * gewählt und weiterhin in der Bike-Datenquelle vorhanden ist.
 * @param {string|null} dreamBikeKey - Aktuell gewählte Traum-Bike-ID.
 * @param {Object<string, Object>} bikes - Bike-Datenquelle (SHARED_BIKES).
 * @returns {{bike: Object|null, bikeKey: string|null, empty: boolean}} Traum-Bike-Anzeige-Daten.
 */
function buildDreamBikeViewModel(dreamBikeKey, bikes) {
  var bike = (dreamBikeKey && bikes && bikes[dreamBikeKey]) ? bikes[dreamBikeKey] : null;
  return { bike: bike, bikeKey: bike ? dreamBikeKey : null, empty: !bike };
}

/**
 * Ermittelt das meistgesehene Bike (falls vorhanden) inklusive Bike-Daten.
 * @param {Object<string, number>} bikesViewed - Map Bike-ID → Ansichtszahl.
 * @param {Object<string, Object>} bikes - Bike-Datenquelle (SHARED_BIKES).
 * @returns {{bikeKey: string, bike: Object, count: number}|null} Meistgesehenes Bike oder null.
 */
function buildMostViewedBike(bikesViewed, bikes) {
  var map = (bikesViewed && typeof bikesViewed === 'object') ? bikesViewed : {};
  var keys = Object.keys(map);
  if (keys.length === 0) return null;
  var best = keys[0];
  for (var i = 1; i < keys.length; i++) {
    if (map[keys[i]] > map[best]) best = keys[i];
  }
  if (!bikes || !bikes[best]) return null;
  return { bikeKey: best, bike: bikes[best], count: map[best] };
}

/**
 * Skaliert einen einzelnen Statistik-Wert auf einen 0–100-Prozentwert für
 * die CSS-Balkendarstellung (ohne Chart-Framework).
 * @param {number} value - Roh-Wert.
 * @param {number} max - Obergrenze für 100%.
 * @returns {number} Prozentwert zwischen 0 und 100.
 */
function scaleToPercent(value, max) {
  if (!max || max <= 0) return 0;
  var v = typeof value === 'number' && isFinite(value) ? value : 0;
  return Math.max(0, Math.min(100, Math.round((v / max) * 100)));
}

/**
 * Baut die Liste der einfachen Statistik-Balken (Label, Wert, Prozent) aus
 * dem Statistik-Objekt für die Garage-Statistiken-Sektion.
 * @param {Object} stats - Statistik-Objekt aus VroooomStats.getStats().
 * @param {number} visitedPageCount - Anzahl besuchter Mini-Apps (0–6).
 * @returns {Array<{label: string, value: string, pct: number}>} Balken-Daten.
 */
function buildStatBars(stats, visitedPageCount) {
  var s = stats || {};
  var visited = typeof visitedPageCount === 'number' ? visitedPageCount : 0;
  return [
    { label: 'Rennen beendet', value: String(s.raceFinishes || 0), pct: scaleToPercent(s.raceFinishes, STAT_BAR_MAX.raceFinishes) },
    { label: 'Endlos-Bestzeit', value: (s.raceBestEndlessTime ? s.raceBestEndlessTime.toFixed(1) + 's' : '—'), pct: scaleToPercent(s.raceBestEndlessTime, STAT_BAR_MAX.raceEndlessBestTime) },
    { label: 'Quiz-Bestwert', value: (s.quizBestMatchPct || 0) + '%', pct: scaleToPercent(s.quizBestMatchPct, 100) },
    { label: 'Glücksrad-Spins', value: String(s.wheelSpins || 0), pct: scaleToPercent(s.wheelSpins, STAT_BAR_MAX.wheelSpins) },
    { label: 'Bike-Ansichten', value: String(s.bikeViewCount || 0), pct: scaleToPercent(s.bikeViewCount, STAT_BAR_MAX.bikeViewCount) },
    { label: 'Reviews geschrieben', value: String(s.reviewsWritten || 0), pct: scaleToPercent(s.reviewsWritten, STAT_BAR_MAX.reviewsWritten) },
    { label: 'Shop-Konfigurationen', value: String(s.shopConfigsSaved || 0), pct: scaleToPercent(s.shopConfigsSaved, STAT_BAR_MAX.shopConfigsSaved) },
    { label: 'Mini-Apps besucht', value: visited + ' / 6', pct: scaleToPercent(visited, 6) }
  ];
}

/**
 * Baut das vollständige View-Model für die Garage-Seite aus einem
 * plain-JS-Zustandsobjekt. Rein funktional (keine DOM-/localStorage-
 * Zugriffe) — die zentrale, in Node testbare Aggregations-Funktion.
 * @param {Object} state - Aggregierter Zustand.
 * @param {Array<string>} state.favorites - vroooom_favorites (nur lesend).
 * @param {Object} state.reviews - vroooom_reviews (nur lesend).
 * @param {Array<Object>} state.recentlyViewed - vroooom_garage_recentlyViewed.
 * @param {string|null} state.dreamBikeKey - vroooom_garage_dreamBike.
 * @param {Object} state.stats - VroooomStats.getStats()-Ergebnis.
 * @param {number} state.visitedPageCount - Anzahl besuchter Mini-Apps.
 * @param {Array<Object>} state.achievements - VroooomAchievements.getAllWithStatus()-Ergebnis.
 * @param {Object<string, Object>} state.bikes - SHARED_BIKES.
 * @returns {Object} Vollständiges, render-fertiges View-Model.
 */
function buildGarageViewModel(state) {
  var s = state || {};
  var bikes = s.bikes || {};
  var favoritesVM = buildFavoritesViewModel(s.favorites, bikes);
  var recentVM = buildRecentlyViewedViewModel(s.recentlyViewed, bikes);
  var reviewsVM = buildReviewsViewModel(s.reviews, bikes);
  var dreamVM = buildDreamBikeViewModel(s.dreamBikeKey, bikes);
  var mostViewed = buildMostViewedBike((s.stats || {}).bikesViewed, bikes);
  var achievements = Array.isArray(s.achievements) ? s.achievements : [];
  var achievementsUnlocked = achievements.filter(function (a) { return a.unlocked; });
  var achievementsLocked = achievements.filter(function (a) { return !a.unlocked; });

  return {
    favorites: favoritesVM,
    recentlyViewed: recentVM,
    reviews: reviewsVM,
    dreamBike: dreamVM,
    stats: {
      raw: s.stats || {},
      bars: buildStatBars(s.stats, s.visitedPageCount),
      mostViewedBike: mostViewed,
      visitedPageCount: typeof s.visitedPageCount === 'number' ? s.visitedPageCount : 0
    },
    achievements: {
      all: achievements,
      unlocked: achievementsUnlocked,
      locked: achievementsLocked,
      unlockedCount: achievementsUnlocked.length,
      totalCount: achievements.length,
      progressPct: achievements.length > 0 ? Math.round((achievementsUnlocked.length / achievements.length) * 100) : 0
    }
  };
}

/* ==========================================================
   Ab hier: DOM-Rendering — läuft NUR im Browser (Guard) und
   wird von garage-test.js NICHT direkt getestet (nur die
   reinen Helper oberhalb).
   ========================================================== */

/**
 * Escaped einen String für die sichere Verwendung in innerHTML-Strings
 * (verhindert einfaches HTML/Skript-Einschleusen aus Freitext-Feldern
 * wie Review-Texten).
 * @param {string} str - Roh-String.
 * @returns {string} HTML-escapter String.
 */
function escapeHtml(str) {
  var div = document.createElement('div');
  div.textContent = (str === null || str === undefined) ? '' : String(str);
  return div.innerHTML;
}

/**
 * Rendert die Favoriten-Sektion ("Meine Bikes").
 * @param {{items: Array<Object>, empty: boolean}} vm - Favoriten-View-Model.
 * @returns {void}
 */
function renderFavorites(vm) {
  var grid = document.getElementById('garageFavoritesGrid');
  var empty = document.getElementById('garageFavoritesEmpty');
  if (!grid || !empty) return;
  empty.hidden = !vm.empty;
  grid.hidden = vm.empty;
  if (vm.empty) { grid.innerHTML = ''; return; }
  grid.innerHTML = vm.items.map(function (it) {
    return '<div class="garage-card">' +
      '<h3>' + it.bike.icon + ' ' + escapeHtml(it.bike.name) + '</h3>' +
      '<p>' + escapeHtml(it.bike.sub || '') + '</p>' +
      '<a class="btn btn-outline garage-card-link" href="index.html">Zur Übersicht</a>' +
      '</div>';
  }).join('');
}

/**
 * Rendert die "Zuletzt angesehen"-Sektion.
 * @param {{items: Array<Object>, empty: boolean}} vm - View-Model.
 * @returns {void}
 */
function renderRecentlyViewed(vm) {
  var grid = document.getElementById('garageRecentGrid');
  var empty = document.getElementById('garageRecentEmpty');
  if (!grid || !empty) return;
  empty.hidden = !vm.empty;
  grid.hidden = vm.empty;
  if (vm.empty) { grid.innerHTML = ''; return; }
  grid.innerHTML = vm.items.map(function (it) {
    var when = '';
    try { when = new Date(it.viewedAt).toLocaleString('de-DE'); } catch (e) { when = ''; }
    return '<div class="garage-card">' +
      '<h3>' + it.bike.icon + ' ' + escapeHtml(it.bike.name) + '</h3>' +
      '<p class="garage-card-meta">' + escapeHtml(when) + '</p>' +
      '</div>';
  }).join('');
}

/**
 * Rendert die "Meine Reviews"-Sektion.
 * @param {{items: Array<Object>, empty: boolean, count: number}} vm - View-Model.
 * @returns {void}
 */
function renderReviews(vm) {
  var list = document.getElementById('garageReviewsList');
  var empty = document.getElementById('garageReviewsEmpty');
  if (!list || !empty) return;
  empty.hidden = !vm.empty;
  list.hidden = vm.empty;
  if (vm.empty) { list.innerHTML = ''; return; }
  list.innerHTML = vm.items.map(function (it) {
    var stars = '';
    for (var i = 1; i <= 5; i++) stars += i <= it.rating ? '★' : '☆';
    return '<div class="garage-review-item">' +
      '<div class="garage-review-head"><strong>' + it.bike.icon + ' ' + escapeHtml(it.bike.name) + '</strong>' +
      '<span class="garage-review-stars">' + stars + '</span></div>' +
      '<p class="garage-review-text">' + escapeHtml(it.text) + '</p>' +
      '<p class="garage-card-meta">' + escapeHtml(it.date || '') + '</p>' +
      '</div>';
  }).join('');
}

/**
 * Rendert die Traum-Bike-Hero-Sektion inklusive Auswahl-Dropdown.
 * @param {{bike: Object|null, bikeKey: string|null, empty: boolean}} vm - View-Model.
 * @param {Object<string, Object>} bikes - SHARED_BIKES (für das Auswahl-Dropdown).
 * @returns {void}
 */
function renderDreamBike(vm, bikes) {
  var hero = document.getElementById('garageDreamHero');
  var empty = document.getElementById('garageDreamEmpty');
  var select = document.getElementById('garageDreamSelect');
  if (select && !select.dataset.populated) {
    var options = ['<option value="">— Traum-Bike wählen —</option>'];
    Object.keys(bikes).forEach(function (key) {
      var selectedAttr = key === vm.bikeKey ? ' selected' : '';
      options.push('<option value="' + key + '"' + selectedAttr + '>' + bikes[key].icon + ' ' + escapeHtml(bikes[key].name) + '</option>');
    });
    select.innerHTML = options.join('');
    select.dataset.populated = 'true';
  } else if (select) {
    select.value = vm.bikeKey || '';
  }
  if (!hero || !empty) return;
  if (vm.empty) {
    hero.hidden = true;
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  hero.hidden = false;
  var bike = vm.bike;
  var photoMarkup = (typeof window !== 'undefined' && window.BikeImage)
    ? window.BikeImage.markup({ id: bike.id, name: bike.name, category: bike.category }, { eager: true, className: 'garage-dream-photo' })
    : '<div class="garage-dream-icon">' + bike.icon + '</div>';
  hero.innerHTML =
    photoMarkup +
    '<div class="garage-dream-info">' +
    '<h3>' + escapeHtml(bike.name) + '</h3>' +
    '<p>' + escapeHtml(bike.sub || '') + '</p>' +
    '<div class="garage-dream-specs">' +
    '<span>🐎 ' + bike.ps + ' PS</span>' +
    '<span>🏁 ' + bike.vmax + ' km/h</span>' +
    '<span>⚖️ ' + bike.weight + ' kg</span>' +
    '<span>💶 ' + Number(bike.price).toLocaleString('de-DE') + ' €</span>' +
    '</div></div>';
}

/**
 * Rendert die Achievements-Übersicht (erreicht/offen).
 * @param {Object} achVM - achievements-Teil des Garage-View-Models.
 * @returns {void}
 */
function renderAchievements(achVM) {
  var grid = document.getElementById('garageAchievementsGrid');
  var progressText = document.getElementById('garageAchievementsProgress');
  var progressBar = document.getElementById('garageAchievementsProgressBar');
  if (progressText) progressText.textContent = achVM.unlockedCount + ' / ' + achVM.totalCount + ' freigeschaltet';
  if (progressBar) progressBar.style.width = achVM.progressPct + '%';
  if (!grid) return;
  var ordered = achVM.unlocked.concat(achVM.locked);
  grid.innerHTML = ordered.map(function (a) {
    var cls = 'garage-ach-card' + (a.unlocked ? ' garage-ach-unlocked' : ' garage-ach-locked');
    var when = '';
    if (a.unlocked && a.unlockedAt) {
      try { when = '<p class="garage-card-meta">Freigeschaltet: ' + new Date(a.unlockedAt).toLocaleDateString('de-DE') + '</p>'; } catch (e) { when = ''; }
    }
    return '<div class="' + cls + '">' +
      '<div class="garage-ach-icon" aria-hidden="true">' + (a.unlocked ? a.icon : '🔒') + '</div>' +
      '<div class="garage-ach-body"><h4>' + escapeHtml(a.titel) + '</h4>' +
      '<p>' + escapeHtml(a.beschreibung) + '</p>' + when + '</div></div>';
  }).join('');
}

/**
 * Rendert die Statistiken-Sektion (Zahlen + einfache CSS-Balken).
 * @param {Object} statsVM - stats-Teil des Garage-View-Models.
 * @returns {void}
 */
function renderStats(statsVM) {
  var wrap = document.getElementById('garageStatsBars');
  if (wrap) {
    wrap.innerHTML = statsVM.bars.map(function (b) {
      return '<div class="garage-stat-row">' +
        '<div class="garage-stat-label"><span>' + escapeHtml(b.label) + '</span><span>' + escapeHtml(b.value) + '</span></div>' +
        '<div class="garage-stat-track"><div class="garage-stat-fill" style="width:' + b.pct + '%"></div></div>' +
        '</div>';
    }).join('');
  }
  var mostViewedEl = document.getElementById('garageMostViewed');
  if (mostViewedEl) {
    if (statsVM.mostViewedBike) {
      mostViewedEl.hidden = false;
      mostViewedEl.textContent = '👑 Meistgesehenes Bike: ' + statsVM.mostViewedBike.bike.icon + ' ' + statsVM.mostViewedBike.bike.name + ' (' + statsVM.mostViewedBike.count + '×)';
    } else {
      mostViewedEl.hidden = true;
    }
  }
}

/**
 * Liest den kompletten Garage-Zustand aus localStorage/den Shared-Modulen
 * zusammen (bikes-data.js, stats.js, achievements.js). Rein lesend, nie
 * mutiert vroooom_favorites/vroooom_reviews.
 * @returns {Object} Zustandsobjekt für buildGarageViewModel().
 */
function loadGarageState() {
  var api = getApiClient();
  var favorites = (api && typeof api.getFavorites === 'function') ? api.getFavorites() : safeReadJSON('vroooom_favorites', []);
  if (!Array.isArray(favorites)) favorites = [];
  var reviews = (api && typeof api.getAllReviews === 'function') ? api.getAllReviews() : safeReadJSON('vroooom_reviews', {});
  if (!reviews || typeof reviews !== 'object') reviews = {};

  var bikes = (typeof window !== 'undefined' && window.SHARED_BIKES) ? window.SHARED_BIKES : {};
  var stats = {};
  var visitedPageCount = 0;
  if (typeof window !== 'undefined' && window.VroooomStats) {
    stats = window.VroooomStats.getStats();
    visitedPageCount = window.VroooomStats.getVisitedPageCount();
  }
  var achievements = [];
  if (typeof window !== 'undefined' && window.VroooomAchievements) {
    achievements = window.VroooomAchievements.getAllWithStatus();
  }

  return {
    favorites: favorites,
    reviews: reviews,
    recentlyViewed: getRecentlyViewed(),
    dreamBikeKey: getDreamBikeKey(),
    stats: stats,
    visitedPageCount: visitedPageCount,
    achievements: achievements,
    bikes: bikes
  };
}

/**
 * Baut den Zustand neu auf, rendert alle Garage-Sektionen und stößt
 * (defensiv) eine erneute Achievement-Prüfung an (z. B. falls sich
 * zwischenzeitlich Favoriten geändert haben). Läuft nur im Browser.
 * @returns {void}
 */
function renderGarage() {
  try {
    if (typeof document === 'undefined') return;
    if (typeof window !== 'undefined' && window.VroooomAchievements && typeof window.VroooomAchievements.checkNow === 'function') {
      var api = getApiClient();
      var favs = (api && typeof api.getFavorites === 'function') ? api.getFavorites() : safeReadJSON('vroooom_favorites', []);
      window.VroooomAchievements.checkNow({ favoritesCount: (favs || []).length });
    }
    var state = loadGarageState();
    var vm = buildGarageViewModel(state);
    renderFavorites(vm.favorites);
    renderRecentlyViewed(vm.recentlyViewed);
    renderReviews(vm.reviews);
    renderDreamBike(vm.dreamBike, state.bikes);
    renderAchievements(vm.achievements);
    renderStats(vm.stats);
  } catch (e) {
    /* Rendering darf die Seite nie komplett blockieren */
  }
}

/**
 * Bindet die Interaktions-Handler der Garage-Seite (Traum-Bike-Auswahl).
 * @returns {void}
 */
function bindGarageEvents() {
  var select = document.getElementById('garageDreamSelect');
  if (select) {
    select.addEventListener('change', function () {
      setDreamBikeKey(select.value || null);
      renderGarage();
    });
  }
}

/**
 * Initialisiert die Garage-Seite (Rendering + Event-Bindung).
 * @returns {void}
 */
function initGarage() {
  renderGarage();
  bindGarageEvents();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGarage);
  } else {
    initGarage();
  }
}

var VroooomGarage = {
  RECENTLY_VIEWED_KEY: RECENTLY_VIEWED_KEY,
  DREAM_BIKE_KEY: DREAM_BIKE_KEY,
  MAX_RECENTLY_VIEWED: MAX_RECENTLY_VIEWED,
  addToRecentlyViewed: addToRecentlyViewed,
  getRecentlyViewed: getRecentlyViewed,
  recordRecentlyViewed: recordRecentlyViewed,
  getDreamBikeKey: getDreamBikeKey,
  setDreamBikeKey: setDreamBikeKey,
  buildFavoritesViewModel: buildFavoritesViewModel,
  buildRecentlyViewedViewModel: buildRecentlyViewedViewModel,
  buildReviewsViewModel: buildReviewsViewModel,
  buildDreamBikeViewModel: buildDreamBikeViewModel,
  buildMostViewedBike: buildMostViewedBike,
  buildStatBars: buildStatBars,
  buildGarageViewModel: buildGarageViewModel
};

if (typeof window !== 'undefined') {
  window.VroooomGarage = VroooomGarage;
} else if (typeof globalThis !== 'undefined') {
  globalThis.VroooomGarage = VroooomGarage;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VroooomGarage;
}
