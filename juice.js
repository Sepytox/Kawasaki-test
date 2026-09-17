/**
 * juice.js — Wiederverwendbare "Game-Feel"-Bausteine für den Endless-
 * Runner (Teil 5, feat(juice-overlay)): ein DOM-Overlay-Layer über dem
 * Runner-Canvas + ein gedeckelter Partikel-Pool + ein Koordinaten-Helfer,
 * die von idle.js für Coin-/Near-Miss-/Combo-Feedback genutzt werden.
 *
 * Reine Präsentationsschicht — enthält KEINE Spiellogik, liest/mutiert
 * niemals state oder IdleCore.* und darf ausschliesslich transform/
 * opacity/filter animieren (siehe idle.css-Kommentar zu diesem Prinzip).
 *
 * DOM-freie Kernfunktionen (canvasPointToOverlayPoint, createParticlePool,
 * acquireParticleNode, prefersReducedMotion) sind sowohl im Browser
 * (window.Juice) als auch in Node (module.exports) verfügbar — Muster
 * identisch zu count-up.js.
 *
 * Warum ein Pool statt "ein <div> pro Event"? Der Game-Loop (idle.js
 * tick()) läuft ungedeckelt per requestAnimationFrame, auch lange im
 * Auto-Pilot — ohne Deckelung könnten viele schnelle Coin-/Near-Miss-
 * Events unbegrenzt neue DOM-Knoten erzeugen (Jank-Risiko). Der Pool
 * legt höchstens JUICE_PARTICLE_POOL_MAX Knoten an und verwendet danach
 * reihum (Round-Robin) bestehende Knoten wieder.
 */
(function () {
  'use strict';

  /** Maximale Anzahl gleichzeitig gepoolter Partikel-DOM-Knoten (verhindert unbegrenztes DOM-Wachstum bei vielen Events). */
  var JUICE_PARTICLE_POOL_MAX = 24;

  /** ID des DOM-Overlay-Containers über dem Runner-Canvas (siehe ensureOverlay()). */
  var JUICE_OVERLAY_ID = 'idleJuiceOverlay';

  /**
   * Prüft, ob der Benutzer reduzierte Bewegung bevorzugt (Systemeinstellung)
   * — mirrort denselben Ausdruck wie idle.js/count-up.js/modal.js/tilt.js
   * (siehe deren jeweilige Docblocks zu diesem projektweiten Muster).
   * @returns {boolean} true, wenn prefers-reduced-motion: reduce aktiv ist.
   */
  function prefersReducedMotion() {
    return !!(
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  /**
   * Stellt sicher, dass der Partikel-/Popup-Overlay-Container über dem
   * Runner-Canvas existiert, und gibt ihn zurück — legt ihn NUR beim
   * ersten Aufruf an (idempotent, per ID geprüft), verschachtelt als Kind
   * von wrapEl (i.d.R. #idleTrackWrap), sodass er dessen
   * position:relative + overflow:hidden-Kontext erbt und automatisch
   * exakt die Canvas-Box überdeckt (siehe .idle-juice-overlay in
   * idle.css: position:absolute; inset:0). Rein additiv — das
   * bestehende Canvas-/HUD-Markup bleibt unverändert.
   * @param {HTMLElement} wrapEl - Container-Element, in das das Overlay eingehängt wird (z.B. #idleTrackWrap).
   * @returns {HTMLElement|null} Das Overlay-Element, oder null ohne DOM/wrapEl.
   */
  function ensureOverlay(wrapEl) {
    if (!wrapEl || typeof document === 'undefined') return null;
    var existing = document.getElementById(JUICE_OVERLAY_ID);
    if (existing) return existing;
    var overlay = document.createElement('div');
    overlay.id = JUICE_OVERLAY_ID;
    overlay.className = 'idle-juice-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    wrapEl.appendChild(overlay);
    return overlay;
  }

  /**
   * Rechnet einen Canvas-CSS-Pixel-Punkt (z.B. aus idle.js' laneCenterX()/
   * laneRowY()) in einen zum Overlay-Container relativen Pixel-Punkt um —
   * beide Rects werden bereits als getBoundingClientRect()-Ergebnis
   * übergeben, damit diese Funktion pur (und ohne echtes DOM testbar)
   * bleibt. Da Canvas und Overlay in der Praxis exakt dieselbe Box
   * ausfüllen (beide 100% von #idleTrackWrap), ergibt sich meist
   * (x,y) == (canvasX, canvasY) — bleibt aber auch korrekt, falls sich
   * das Layout jemals ändert.
   * @param {{left:number, top:number}} canvasRect - getBoundingClientRect() des Runner-Canvas.
   * @param {{left:number, top:number}} overlayRect - getBoundingClientRect() des Overlay-Containers.
   * @param {number} canvasX - x-Position im Canvas-CSS-Pixel-Raum.
   * @param {number} canvasY - y-Position im Canvas-CSS-Pixel-Raum.
   * @returns {{x:number, y:number}} Pixel-Position relativ zur Overlay-Box (für left/top bzw. transform: translate()).
   */
  function canvasPointToOverlayPoint(canvasRect, overlayRect, canvasX, canvasY) {
    return {
      x: (canvasRect.left - overlayRect.left) + canvasX,
      y: (canvasRect.top - overlayRect.top) + canvasY
    };
  }

  /**
   * Legt einen neuen, gedeckelten Partikel-Pool an — ein einfaches
   * Round-Robin-Array wiederverwendbarer DOM-Knoten, siehe Docblock oben.
   * @param {number} [maxSize] - Maximale Poolgrösse (Standard JUICE_PARTICLE_POOL_MAX).
   * @returns {{nodes: Array, max: number, cursor: number}} Neuer, leerer Pool-Zustand.
   */
  function createParticlePool(maxSize) {
    return {
      nodes: [],
      max: typeof maxSize === 'number' && maxSize > 0 ? maxSize : JUICE_PARTICLE_POOL_MAX,
      cursor: 0
    };
  }

  /**
   * Liefert einen wiederverwendbaren DOM-Knoten für einen neuen Partikel
   * aus dem Pool. Solange der Pool seine Maximalgrösse noch nicht
   * erreicht hat, wird ein neuer <div> angelegt und an overlayEl
   * angehängt; danach wird reihum (Round-Robin) ein bereits existierender
   * Knoten wiederverwendet. className wird bei jedem Aufruf frisch
   * gesetzt (nicht addClass), damit ein Aufrufer per Entfernen/erneutem
   * Setzen + void node.offsetWidth (identisches Muster zu idle.js'
   * triggerCollisionFeedback()/showNearMissPopup()) eine CSS-Animation
   * bei Wiederverwendung zuverlässig neu starten kann. Ohne echtes DOM
   * (kein document.createElement) wird null zurückgegeben.
   * @param {{nodes: Array, max: number, cursor: number}} pool - Poolzustand aus createParticlePool().
   * @param {HTMLElement} overlayEl - Overlay-Container, an den neue Knoten angehängt werden.
   * @param {string} className - CSS-Klasse, die dem Knoten gesetzt wird.
   * @returns {HTMLElement|null} Wiederverwendbarer Partikel-Knoten, oder null ohne DOM.
   */
  function acquireParticleNode(pool, overlayEl, className) {
    if (!pool || !overlayEl || typeof document === 'undefined') return null;
    var node;
    if (pool.nodes.length < pool.max) {
      node = document.createElement('div');
      overlayEl.appendChild(node);
      pool.nodes.push(node);
    } else {
      node = pool.nodes[pool.cursor % pool.max];
      pool.cursor += 1;
    }
    node.className = className;
    return node;
  }

  var api = {
    JUICE_PARTICLE_POOL_MAX: JUICE_PARTICLE_POOL_MAX,
    JUICE_OVERLAY_ID: JUICE_OVERLAY_ID,
    prefersReducedMotion: prefersReducedMotion,
    ensureOverlay: ensureOverlay,
    canvasPointToOverlayPoint: canvasPointToOverlayPoint,
    createParticlePool: createParticlePool,
    acquireParticleNode: acquireParticleNode
  };

  if (typeof window !== 'undefined') {
    window.Juice = api;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
