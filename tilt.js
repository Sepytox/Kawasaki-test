/**
 * tilt.js — dezenter Cursor-Tilt für Bike-Karten (".fact-card", index.html).
 *
 * Reine transform-Animation über zwei CSS-Custom-Properties
 * ("--tilt-rx"/"--tilt-ry"), die per Maus-Position auf der Karte gesetzt
 * werden — design.css komponiert daraus zusammen mit dem bereits
 * bestehenden Hover-Lift EINE einzige transform-Deklaration
 * (perspective + translateY + scale + rotateX/rotateY), sodass Tilt und
 * Lift sich nicht gegenseitig überschreiben. Ohne JS/ohne Mausbewegung
 * bleiben beide Custom-Properties auf ihrem CSS-Default (0deg) — die
 * Karte verhält sich dann exakt wie zuvor (nur Lift, kein Tilt), auch
 * bei Tastatur-Fokus (":focus-visible"/"focus-within" lösen kein
 * "mousemove" aus).
 *
 * Nutzt --tilt-max-deg/--tilt-perspective (design.css, Phase A) als
 * einzige Quelle für Stärke/Perspektive.
 *
 * prefers-reduced-motion wird eigenständig per JS geprüft (mirror von
 * scroll-reveal.js' prefersReducedMotion()): ist reduzierte Bewegung
 * aktiv, registriert diese Datei überhaupt keine Maus-Listener — der
 * Tilt-Effekt ist dann vollständig deaktiviert (nicht nur "reduziert").
 */
(function () {
  'use strict';

  /** CSS-Selektor für Karten mit Cursor-Tilt. */
  var TILT_SELECTOR = '.fact-card';
  /** Custom-Property für die X-Rotation (siehe styles.css/design.css). */
  var PROP_RX = '--tilt-rx';
  /** Custom-Property für die Y-Rotation. */
  var PROP_RY = '--tilt-ry';

  /**
   * Prüft, ob der Benutzer reduzierte Bewegung bevorzugt (Systemeinstellung).
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
   * Liest den in --tilt-max-deg (design.css) hinterlegten Maximalwinkel
   * aus, mit einem defensiven Fallback, falls das Token einmal fehlen
   * sollte (z.B. in sehr alten Browsern ohne CSS-Custom-Property-Support).
   * @returns {number} Maximalwinkel in Grad.
   */
  function readMaxTiltDeg() {
    var raw = getComputedStyle(document.documentElement).getPropertyValue('--tilt-max-deg');
    var parsed = parseFloat(raw);
    return isNaN(parsed) ? 6 : parsed;
  }

  /**
   * Berechnet und setzt die Tilt-Rotation für eine Karte anhand der
   * aktuellen Cursor-Position innerhalb ihrer Bounding-Box (nur
   * transform-Custom-Properties, kein Layout-Zugriff ausser dem
   * einmaligen getBoundingClientRect() pro Mausbewegung).
   * @param {Element} card - Die Karte, deren Tilt aktualisiert wird.
   * @param {MouseEvent} event - Das mousemove-Event.
   * @param {number} maxDeg - Maximalwinkel in Grad (aus --tilt-max-deg).
   * @returns {void}
   */
  function applyTilt(card, event, maxDeg) {
    var rect = card.getBoundingClientRect();
    var px = (event.clientX - rect.left) / rect.width;
    var py = (event.clientY - rect.top) / rect.height;
    var rotateY = (px - 0.5) * 2 * maxDeg;
    var rotateX = (0.5 - py) * 2 * maxDeg;
    card.style.setProperty(PROP_RX, rotateX.toFixed(2) + 'deg');
    card.style.setProperty(PROP_RY, rotateY.toFixed(2) + 'deg');
  }

  /**
   * Setzt den Tilt einer Karte zurück auf den neutralen Zustand (0deg),
   * z.B. beim Verlassen der Karte mit der Maus.
   * @param {Element} card - Die zurückzusetzende Karte.
   * @returns {void}
   */
  function resetTilt(card) {
    card.style.setProperty(PROP_RX, '0deg');
    card.style.setProperty(PROP_RY, '0deg');
  }

  /**
   * Verdrahtet den Cursor-Tilt für alle aktuell im DOM vorhandenen
   * ".fact-card"-Elemente. Wird nicht ausgeführt, wenn der Benutzer
   * reduzierte Bewegung bevorzugt.
   * @returns {void}
   */
  function initTilt() {
    if (prefersReducedMotion()) return;

    var maxDeg = readMaxTiltDeg();
    var cards = Array.prototype.slice.call(document.querySelectorAll(TILT_SELECTOR));
    if (!cards.length) return;

    cards.forEach(function (card) {
      card.addEventListener('mousemove', function (event) {
        applyTilt(card, event, maxDeg);
      });
      card.addEventListener('mouseleave', function () {
        resetTilt(card);
      });
    });
  }

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initTilt);
    } else {
      initTilt();
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      prefersReducedMotion: prefersReducedMotion,
      applyTilt: applyTilt,
      resetTilt: resetTilt
    };
  }
})();
