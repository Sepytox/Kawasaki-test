/**
 * count-up.js — Zahlen-Eintritts-Animation ("count-up") für VROOOOM.
 *
 * DOM-freie Kernfunktionen (parseLeadingNumber, easeOutCubic, countUpTo)
 * sind sowohl im Browser (window) als auch in Node (module.exports)
 * verfügbar — Muster identisch zu idle-core.js/bikes-data.js. Der
 * automatische Scroll-in-View-Teil (initCountUp) läuft ausschliesslich
 * im Browser.
 *
 * Zweck: Zahlen (km, PS, Preise, Punkte, Trophäen, ...) zählen beim
 * ersten Sichtbarwerden sanft von 0 zum Zielwert hoch, statt hart zu
 * "springen". Elemente markieren sich dafür selbst mit dem Attribut
 * "data-count-up" — der bereits im Text enthaltene Zielwert wird
 * automatisch erkannt (erste Zahl im Text, inkl. deutscher
 * Tausenderpunkte), animiert wird NUR die Ziffernfolge; am Ende steht
 * garantiert wieder exakt der ursprüngliche Text (inkl. Einheiten,
 * Vorzeichen, Emoji) — es wird also niemals ein von der App berechneter
 * Anzeigewert verändert, nur seine Einblendung verzögert/animiert.
 *
 * Ein MutationObserver erfasst zusätzlich nachträglich eingefügte
 * Elemente (z.B. die Crash-Zusammenfassung oder das Bike-Detail-Modal,
 * die ihren Inhalt erst beim Öffnen per JS erzeugen).
 *
 * prefers-reduced-motion wird eigenständig per JS geprüft (mirror von
 * scroll-reveal.js' prefersReducedMotion()), da eine requestAnimationFrame
 * -Schleife nicht automatisch von der globalen CSS-Media-Query gestoppt
 * wird: in diesem Fall wird der Zieltext sofort ohne Animation gesetzt.
 *
 * Manuelle API (z.B. für Seiten, die einen Zahlensprung selbst auslösen
 * wollen): countUpTo(el, target, { duration, formatter, from }).
 */
(function () {
  'use strict';

  /** CSS-Selektor für automatisch zu animierende Zahlen-Elemente. */
  var COUNT_UP_SELECTOR = '[data-count-up]';
  /** Attribut, das nach der ersten (einmaligen) Animation gesetzt wird. */
  var COUNT_UP_DONE_ATTR = 'data-count-up-done';
  /** Standard-Animationsdauer in Millisekunden. */
  var DEFAULT_DURATION_MS = 900;

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
   * Easing-Funktion (ease-out-cubic) für einen weichen, natürlichen
   * Hochzähl-Effekt (schnell am Anfang, sanft auslaufend am Ende).
   * @param {number} t - Fortschritt zwischen 0 und 1.
   * @returns {number} Geglätteter Fortschritt zwischen 0 und 1.
   */
  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  /**
   * Extrahiert die erste Zahl aus einem Text und entfernt dabei deutsche
   * Tausendertrenner (Punkt oder Komma, gefolgt von genau 3 Ziffern),
   * damit z.B. "12.345 km" als 12345 erkannt wird. Ein verbleibendes
   * Dezimal-Komma wird zu einem Punkt normalisiert. Enthält der Text
   * keine Zahl, wird null zurückgegeben (die Anzeige bleibt dann
   * unverändert — sicherer Fallback statt eines Fehlers).
   * @param {string} text - Der zu durchsuchende Anzeigetext.
   * @returns {number|null} Der gefundene Zahlenwert oder null.
   */
  function parseLeadingNumber(text) {
    if (typeof text !== 'string') return null;
    var match = text.match(/-?\d[\d.,]*/);
    if (!match) return null;
    var raw = match[0];
    var normalized = raw.replace(/[.,](?=\d{3}(\D|$))/g, '');
    normalized = normalized.replace(',', '.');
    var value = parseFloat(normalized);
    return isNaN(value) ? null : value;
  }

  /**
   * Animiert eine Zahl in einem Element von "from" (Standard: 0) zum
   * Zielwert "target" hoch, per requestAnimationFrame. Respektiert
   * prefers-reduced-motion: dann wird sofort formatter(target) gesetzt,
   * ganz ohne Animation. Der letzte Frame ruft formatter(target) exakt
   * mit dem Zielwert auf, sodass kein Rundungs-/Formatierungsdrift
   * entstehen kann.
   * @param {Element} el - Ziel-Element, dessen textContent animiert wird.
   * @param {number} target - Endwert der Animation.
   * @param {{duration?: number, formatter?: (function(number): string), from?: number}} [options] - Optionale Einstellungen.
   * @returns {void}
   */
  function countUpTo(el, target, options) {
    if (!el) return;
    var opts = options || {};
    var duration = typeof opts.duration === 'number' ? opts.duration : DEFAULT_DURATION_MS;
    var formatter = typeof opts.formatter === 'function'
      ? opts.formatter
      : function (n) { return String(Math.round(n)); };
    var from = typeof opts.from === 'number' ? opts.from : 0;

    if (prefersReducedMotion() || typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      el.textContent = formatter(target);
      return;
    }

    var start = null;

    /**
     * Ein einzelner Animationsframe: berechnet den geglätteten
     * Zwischenwert und schreibt ihn via formatter() in das Element.
     * @param {number} timestamp - Von requestAnimationFrame übergebener High-Res-Zeitstempel.
     * @returns {void}
     */
    function frame(timestamp) {
      if (start === null) start = timestamp;
      var elapsed = timestamp - start;
      var progress = duration <= 0 ? 1 : Math.min(elapsed / duration, 1);
      var eased = easeOutCubic(progress);
      var current = from + (target - from) * eased;
      el.textContent = formatter(progress >= 1 ? target : current);
      if (progress < 1) {
        window.requestAnimationFrame(frame);
      }
    }

    window.requestAnimationFrame(frame);
  }

  /**
   * Richtet die automatische Scroll-in-View-Zähl-Animation für alle
   * Elemente mit dem Attribut "data-count-up" ein. Beim ersten
   * Sichtbarwerden wird der im Text bereits enthaltene Zielwert erkannt
   * (parseLeadingNumber) und ab 0 hochgezählt; am Ende steht garantiert
   * wieder der exakte Original-Text. Ein MutationObserver erfasst
   * zusätzlich nachträglich eingefügte Elemente (z.B. Modal-Inhalte).
   * Ohne IntersectionObserver-Unterstützung greift diese Funktion
   * überhaupt nicht ein — Zahlen bleiben dann einfach normal sichtbar
   * (kein Verstecken, kein Blockieren, analog zum Sicherheitsnetz in
   * scroll-reveal.js).
   * @returns {void}
   */
  function initCountUp() {
    if (typeof IntersectionObserver === 'undefined') return;

    var observer = new IntersectionObserver(function (entries, obs) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        obs.unobserve(el);
        el.setAttribute(COUNT_UP_DONE_ATTR, 'true');
        if (prefersReducedMotion()) return;

        var originalText = el.textContent;
        var target = parseLeadingNumber(originalText);
        if (target === null) return;

        countUpTo(el, target, {
          formatter: function (n) {
            return n >= target ? originalText : String(Math.round(n));
          }
        });
      });
    }, { threshold: 0.2 });

    /**
     * Beobachtet ein Element, sofern es noch nicht animiert wurde.
     * @param {Element} el - Das zu prüfende/beobachtende Element.
     * @returns {void}
     */
    function observeIfNeeded(el) {
      if (el.getAttribute(COUNT_UP_DONE_ATTR) === 'true') return;
      observer.observe(el);
    }

    Array.prototype.slice.call(document.querySelectorAll(COUNT_UP_SELECTOR)).forEach(observeIfNeeded);

    if (typeof MutationObserver !== 'undefined') {
      var mutationObserver = new MutationObserver(function (mutations) {
        mutations.forEach(function (mutation) {
          Array.prototype.forEach.call(mutation.addedNodes || [], function (node) {
            if (!node || node.nodeType !== 1) return;
            if (typeof node.matches === 'function' && node.matches(COUNT_UP_SELECTOR)) {
              observeIfNeeded(node);
            }
            if (typeof node.querySelectorAll === 'function') {
              Array.prototype.slice.call(node.querySelectorAll(COUNT_UP_SELECTOR)).forEach(observeIfNeeded);
            }
          });
        });
      });
      mutationObserver.observe(document.body, { childList: true, subtree: true });
    }
  }

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    window.countUpTo = countUpTo;

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initCountUp);
    } else {
      initCountUp();
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      parseLeadingNumber: parseLeadingNumber,
      easeOutCubic: easeOutCubic,
      countUpTo: countUpTo
    };
  }
})();
