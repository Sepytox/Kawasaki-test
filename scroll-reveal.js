/**
 * VROOOOM — Scroll-Reveal (Eintritts-Animationen)
 *
 * Beobachtet alle Elemente mit der Klasse ".js-reveal" per
 * IntersectionObserver und blendet sie beim ersten Sichtbarwerden sanft
 * ein (Opacity + Transform, gesteuert über CSS-Transitions in
 * styles.css/design.css — hier wird nur die Klasse "is-visible" gesetzt).
 *
 * Sicherheitsnetz (Mängelliste-Vorgabe "nie dauerhaft verstecken"):
 * - Ohne diese Datei bzw. ohne unterstützten IntersectionObserver bleiben
 *   ".js-reveal"-Elemente sichtbar, weil die "versteckt"-Optik nur unter
 *   der Klasse "reveal-ready" (von diesem Skript auf <html> gesetzt) aktiv
 *   wird. Kein JS/kein Observer = kein Verstecken.
 * - Bei aktivierter Systemeinstellung "Bewegung reduzieren"
 *   (prefers-reduced-motion) werden alle Elemente sofort ohne Animation
 *   sichtbar gemacht.
 *
 * Wird von index.html, quiz.html, race.html, wheel.html und shop.html
 * eingebunden. index.html/soundcheck.html sind bewusst ausgenommen
 * (soundcheck.html: geschützte Datei, siehe GOLDEN_PRINCIPLES_KE.md
 * Regel 6; index.html bindet stattdessen dieselbe Datei ebenfalls ein,
 * sofern im HTML referenziert).
 *
 * feat(scroll-anim): Richtungs-Varianten für den Eintritt. Jedes
 * ".js-reveal"-Element bekommt (falls noch nicht vorhanden) ein Attribut
 * "data-reveal-dir" mit dem Wert "up"|"down"|"left"|"right" — entweder
 * explizit im Markup vorgegeben, oder automatisch aus der horizontalen
 * Position des Elements im Viewport abgeleitet (siehe
 * resolveRevealDirection()). Die tatsächliche transform-Ausgangslage pro
 * Richtung steht rein additiv in design.css (Attribut-Selektoren neben
 * der bestehenden ".reveal-ready .js-reveal"-Basisregel) — hier wird nur
 * das Attribut gesetzt, das bestehende Verhalten für Elemente ohne
 * jegliche Richtungs-Ableitung (z.B. kein IntersectionObserver) ändert
 * sich dadurch nicht.
 */
(function () {
    'use strict';

    /** CSS-Selektor für alle zu beobachtenden Eintritts-Elemente. */
    var REVEAL_SELECTOR = '.js-reveal';
    /** Klasse, die beim Sichtbarwerden auf das Zielelement gesetzt wird. */
    var VISIBLE_CLASS = 'is-visible';
    /** Klasse auf <html>, die die "versteckt bis sichtbar"-Optik aktiviert. */
    var READY_CLASS = 'reveal-ready';
    /** Verzögerung zwischen gestaffelten Elementen in Millisekunden. */
    var STAGGER_STEP_MS = 70;
    /** Maximale Anzahl an gestaffelten Schritten (danach identische Verzögerung). */
    var MAX_STAGGER_STEPS = 8;

    /**
     * Prüft, ob der Benutzer reduzierte Bewegung bevorzugt (Systemeinstellung).
     * @returns {boolean} true, wenn prefers-reduced-motion: reduce aktiv ist.
     */
    function prefersReducedMotion() {
        return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    /**
     * Macht alle übergebenen Elemente sofort sichtbar (kein Staffel-Effekt).
     * @param {Element[]} elements - Zu enthüllende Elemente.
     * @returns {void}
     */
    function revealAllImmediately(elements) {
        elements.forEach(function (el) {
            el.classList.add(VISIBLE_CLASS);
        });
    }

    /**
     * Gültige Richtungswerte für "data-reveal-dir" (siehe design.css für
     * die zugehörigen transform-Ausgangswerte je Richtung).
     */
    var VALID_REVEAL_DIRS = ['up', 'down', 'left', 'right'];

    /**
     * Ermittelt die Eintritts-Richtung für ein Element: ein bereits im
     * Markup gesetztes "data-reveal-dir"-Attribut hat Vorrang; ansonsten
     * wird die Richtung aus der horizontalen Position des Elements im
     * Viewport abgeleitet (linkes Drittel → "left", rechtes Drittel →
     * "right", Mitte → "up", identisch zum bisherigen Standardverhalten).
     * @param {Element} el - Das zu beobachtende Eintritts-Element.
     * @returns {string} Eine der Richtungen aus VALID_REVEAL_DIRS.
     */
    function resolveRevealDirection(el) {
        var explicit = el.getAttribute('data-reveal-dir');
        if (explicit && VALID_REVEAL_DIRS.indexOf(explicit) !== -1) {
            return explicit;
        }
        if (typeof el.getBoundingClientRect !== 'function') return 'up';
        var rect = el.getBoundingClientRect();
        var viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1;
        var centerRatio = (rect.left + rect.width / 2) / viewportWidth;
        if (centerRatio < 0.33) return 'left';
        if (centerRatio > 0.66) return 'right';
        return 'up';
    }

    /**
     * Initialisiert die Scroll-Reveal-Beobachtung für alle ".js-reveal"-Elemente
     * auf der aktuellen Seite.
     * @returns {void}
     */
    function initScrollReveal() {
        var elements = Array.prototype.slice.call(document.querySelectorAll(REVEAL_SELECTOR));
        if (!elements.length) return;

        if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') {
            revealAllImmediately(elements);
            return;
        }

        document.documentElement.classList.add(READY_CLASS);

        elements.forEach(function (el, index) {
            var step = Math.min(index, MAX_STAGGER_STEPS);
            el.style.transitionDelay = (step * STAGGER_STEP_MS) + 'ms';
            el.setAttribute('data-reveal-dir', resolveRevealDirection(el));
        });

        var observer = new IntersectionObserver(function (entries, obs) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    entry.target.classList.add(VISIBLE_CLASS);
                    obs.unobserve(entry.target);
                }
            });
        }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });

        elements.forEach(function (el) {
            observer.observe(el);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initScrollReveal);
    } else {
        initScrollReveal();
    }
})();
