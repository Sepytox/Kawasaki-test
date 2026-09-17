/**
 * modal.js — Zentrales Modal-System (Vrooooom Unified Design System v2)
 *
 * Ein einziges, wiederverwendbares Modul für alle echten Dialoge der App
 * (Ausnahme: settings.js-Drawer, das bewusst separat bleibt, siehe
 * GOLDEN_PRINCIPLES_KE.md-Migrationsplan). Kapselt die bisher mehrfach
 * hand-verdrahtete Öffnen/Schließen/Escape/Backdrop-Klick/Fokus-Logik an
 * einer Stelle und stellt sie über zwei globale Funktionen bereit:
 *
 *   Modal.openModal({ id, title, body, actions, variant, trigger, onClose })
 *   Modal.closeModal(id)
 *
 * Zwei Betriebsarten pro `id`:
 *  1. "Chrome-Modus" — existiert bereits ein Element mit dieser id UND der
 *     Klasse "modal-overlay" im DOM (z.B. die fest ausgezeichneten
 *     #specModal/#compareModal-Blöcke), wird dessen Inhalt NICHT
 *     angerührt — der Aufrufer befüllt Titel/Body/Aktionen selbst, bevor
 *     openModal() aufgerufen wird. Es werden nur Sichtbarkeit, Escape,
 *     Backdrop-Klick, Fokus-Trap und Fokus-Rückgabe zentral verdrahtet.
 *  2. "Build-Modus" — existiert noch kein Element mit dieser id, wird ein
 *     komplettes .modal-overlay/.modal-content-Gerüst aus title/body/
 *     actions erzeugt und einmalig an <body> gehängt. Wird openModal()
 *     danach erneut mit title/body/actions aufgerufen, wird der Inhalt
 *     frisch neu aufgebaut (z.B. für sich ändernde Werte wie eine
 *     Crash-Zusammenfassung).
 *
 * Wiederverwendet ausschliesslich die bestehende CSS-Vokabular
 * ".modal-overlay"/".modal-content"/".modal-visible"/".modal-closing"
 * (styles.css) sowie die neuen Glassmorphism-Tokens aus design.css
 * (--glass-blur-*, --glass-saturate, --glass-bg-strong, --shadow-xl) für
 * eine additive Glass-Optik obendrauf — keine neuen Klassennamen für die
 * Kern-Mechanik.
 */
(function (global) {
  'use strict';

  /** CSS-Klasse des Overlay-Wrappers (bestehend, styles.css). */
  var MODAL_OVERLAY_CLASS = 'modal-overlay';
  /** CSS-Klasse der eigentlichen Dialog-Karte (bestehend, styles.css). */
  var MODAL_CONTENT_CLASS = 'modal-content';
  /** Breiten-Variante der Dialog-Karte (bestehend, styles.css). */
  var MODAL_WIDE_CLASS = 'modal-content-wide';
  /** Sichtbarkeits-Klasse, steuert display:flex + Öffnen-Animation. */
  var MODAL_VISIBLE_CLASS = 'modal-visible';
  /** Schliessen-Animation-Klasse (bestehend, styles.css). */
  var MODAL_CLOSING_CLASS = 'modal-closing';
  /** Wartezeit in ms, bis nach modal-closing die Klassen entfernt werden
      (entspricht der bestehenden 220ms-Konvention aus den Ursprungs-
      Implementierungen in index.html). */
  var CLOSE_ANIMATION_MS = 220;
  /** Selektor für alles, was innerhalb eines Dialogs fokussierbar ist
      (Grundlage für Fokus-Trap + Autofokus-Fallback). */
  var FOCUSABLE_SELECTOR =
    'a[href], button:not([disabled]), textarea:not([disabled]), ' +
    'input:not([disabled]), select:not([disabled]), ' +
    '[tabindex]:not([tabindex="-1"])';

  /** Registry aller jemals über Modal.openModal() gesehenen Dialoge,
      keyed by id. Enthält den aktuellen Zustand für Escape/Backdrop/
      Fokus-Rückgabe. */
  var registry = {};

  /** Stapel der aktuell sichtbaren Modal-ids, in Öffnungsreihenfolge —
      Escape schliesst immer nur das zuletzt geöffnete. */
  var openStack = [];

  /**
   * Prüft, ob der Nutzer reduzierte Bewegung wünscht (OS-Einstellung).
   * Spiegelt denselben Helfer aus scroll-reveal.js, damit rAF-/Timer-
   * basierte Effekte dieselbe Quelle der Wahrheit nutzen wie die
   * CSS-Media-Query.
   * @returns {boolean} true, wenn prefers-reduced-motion aktiv ist.
   */
  function prefersReducedMotion() {
    return (
      typeof global.matchMedia === 'function' &&
      global.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  /**
   * Liefert alle fokussierbaren Elemente innerhalb eines Containers,
   * in DOM-Reihenfolge.
   * @param {HTMLElement} container - Wurzelelement der Suche.
   * @returns {HTMLElement[]} Liste fokussierbarer Elemente.
   */
  function getFocusableElements(container) {
    if (!container) return [];
    return Array.prototype.slice.call(
      container.querySelectorAll(FOCUSABLE_SELECTOR)
    );
  }

  /**
   * Baut eine Aktions-Schaltfläche gemäss der `actions`-Beschreibung.
   * @param {{label:string, onClick?:Function, variant?:string, autofocus?:boolean, id?:string}} action - Aktionsbeschreibung.
   * @param {string} modalId - id des zugehörigen Dialogs (für Modal.closeModal()-Fallback).
   * @returns {HTMLButtonElement} Die erzeugte Schaltfläche.
   */
  function buildActionButton(action, modalId) {
    var btn = global.document.createElement('button');
    btn.type = 'button';
    btn.className = action.variant === 'outline' ? 'btn btn-outline' : 'btn';
    if (action.id) btn.id = action.id;
    btn.textContent = action.label;
    btn.addEventListener('click', function () {
      if (typeof action.onClick === 'function') action.onClick();
      else closeModal(modalId);
    });
    return btn;
  }

  /**
   * Rendert den Body-Inhalt eines Dialogs in einen Ziel-Container.
   * Unterstützt drei Formen (siehe API-Doku): fertiges HTMLElement,
   * HTML-String oder eine render(container)-Callback-Funktion.
   * @param {HTMLElement} container - Ziel-Container (wird vorher geleert).
   * @param {HTMLElement|string|Function} body - Body-Inhalt.
   * @returns {void}
   */
  function renderModalBody(container, body) {
    container.innerHTML = '';
    if (body == null) return;
    if (typeof body === 'function') {
      body(container);
    } else if (typeof body === 'string') {
      container.innerHTML = body;
    } else if (body instanceof global.Node) {
      container.appendChild(body);
    }
  }

  /**
   * Baut (oder aktualisiert) den kompletten Inhalt eines im Build-Modus
   * verwalteten Dialogs — Titel, Body und Aktionszeile — neu auf.
   * @param {HTMLElement} content - Das ".modal-content"-Element.
   * @param {string} modalId - id des Dialogs.
   * @param {{title?:string, body?:*, actions?:Array}} options - openModal()-Optionen.
   * @returns {void}
   */
  function renderModalContent(content, modalId, options) {
    content.innerHTML = '';

    if (options.title != null) {
      var header = global.document.createElement('div');
      header.className = 'modal-header';
      var h2 = global.document.createElement('h2');
      h2.id = modalId + 'Title';
      h2.textContent = options.title;
      header.appendChild(h2);
      content.appendChild(header);
    }

    var bodyWrap = global.document.createElement('div');
    bodyWrap.className = 'modal-body';
    renderModalBody(bodyWrap, options.body);
    content.appendChild(bodyWrap);

    if (options.actions && options.actions.length) {
      var actionsRow = global.document.createElement('div');
      actionsRow.className = 'modal-actions';
      options.actions.forEach(function (action) {
        actionsRow.appendChild(buildActionButton(action, modalId));
      });
      content.appendChild(actionsRow);
    }

    if (options.variant !== 'forced-choice') {
      var closeBtn = global.document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'modal-close';
      closeBtn.setAttribute('aria-label', 'Schließen');
      closeBtn.title = 'Schließen';
      closeBtn.innerHTML = '&times;';
      closeBtn.addEventListener('click', function () {
        closeModal(modalId);
      });
      content.appendChild(closeBtn);
    }
  }

  /**
   * Verdrahtet Backdrop-Klick und Fokus-Trap für ein Overlay EINMALIG
   * (idempotent — mehrfaches openModal() auf dieselbe id hängt keine
   * doppelten Listener an).
   * @param {HTMLElement} overlay - Das ".modal-overlay"-Element.
   * @param {string} modalId - id des Dialogs.
   * @returns {void}
   */
  function wireOverlayOnce(overlay, modalId) {
    if (overlay.dataset.modalWired === 'true') return;
    overlay.dataset.modalWired = 'true';

    overlay.addEventListener('click', function (e) {
      var entry = registry[modalId];
      if (entry && entry.variant !== 'forced-choice' && e.target === overlay) {
        closeModal(modalId);
      }
    });

    overlay.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      var entry = registry[modalId];
      if (!entry || !entry.content) return;
      var focusable = getFocusableElements(entry.content);
      if (!focusable.length) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (e.shiftKey && global.document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && global.document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
  }

  /**
   * Öffnet (oder aktualisiert + zeigt) den Dialog mit der gegebenen id.
   * Siehe Modul-Dokumentation für die zwei Betriebsarten (Chrome- vs.
   * Build-Modus).
   * @param {{id:string, title?:string, body?:(HTMLElement|string|Function), actions?:Array<{label:string,onClick?:Function,variant?:string,autofocus?:boolean,id?:string}>, variant?:('default'|'wide'|'forced-choice'), trigger?:HTMLElement, onClose?:Function}} options - Modal-Konfiguration.
   * @returns {void}
   */
  function openModal(options) {
    options = options || {};
    var id = options.id;
    if (!id) return;

    var overlay = global.document.getElementById(id);
    var hasContentOptions =
      'title' in options || 'body' in options || 'actions' in options;

    if (!overlay) {
      overlay = global.document.createElement('div');
      overlay.id = id;
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-hidden', 'true');
      global.document.body.appendChild(overlay);
    }
    overlay.classList.add(MODAL_OVERLAY_CLASS);

    var content = overlay.querySelector('.' + MODAL_CONTENT_CLASS);
    if (!content) {
      content = global.document.createElement('div');
      content.className = MODAL_CONTENT_CLASS;
      overlay.appendChild(content);
    }
    content.classList.toggle(MODAL_WIDE_CLASS, options.variant === 'wide');

    if (hasContentOptions) {
      renderModalContent(content, id, options);
    }

    var titleEl = global.document.getElementById(id + 'Title');
    if (titleEl) overlay.setAttribute('aria-labelledby', titleEl.id);

    wireOverlayOnce(overlay, id);

    registry[id] = {
      overlay: overlay,
      content: content,
      variant: options.variant || 'default',
      trigger: options.trigger || global.document.activeElement,
      onClose: options.onClose
    };
    openStack.push(id);

    overlay.classList.remove(MODAL_CLOSING_CLASS);
    overlay.classList.add(MODAL_VISIBLE_CLASS);
    overlay.setAttribute('aria-hidden', 'false');
    global.document.body.style.overflow = 'hidden';

    var autofocusAction =
      options.actions && options.actions.filter(function (a) { return a.autofocus; })[0];
    var autofocusTarget =
      (autofocusAction && autofocusAction.id && global.document.getElementById(autofocusAction.id)) ||
      content.querySelector('.modal-close') ||
      getFocusableElements(content)[0];
    if (autofocusTarget && typeof autofocusTarget.focus === 'function') {
      autofocusTarget.focus();
    }
  }

  /**
   * Schliesst den Dialog mit der gegebenen id: entfernt die
   * Sichtbarkeits-Klassen (respektiert prefers-reduced-motion — dann
   * ohne die 220ms-Ausblend-Verzögerung), gibt den Fokus an das
   * ursprüngliche Trigger-Element zurück und ruft onClose() auf.
   * @param {string} id - id des zu schliessenden Dialogs.
   * @returns {void}
   */
  function closeModal(id) {
    var entry = registry[id];
    if (!entry) return;
    var overlay = entry.overlay;

    var stackIndex = openStack.lastIndexOf(id);
    if (stackIndex !== -1) openStack.splice(stackIndex, 1);

    /**
     * Räumt die Sichtbarkeits-Klassen ab, sperrt aria-hidden wieder und
     * gibt ggf. den Fokus zurück — geteilte Schlussroutine für den
     * sofortigen (reduced-motion) und den verzögerten (Standard) Pfad.
     * @returns {void}
     */
    function finish() {
      overlay.classList.remove(MODAL_VISIBLE_CLASS, MODAL_CLOSING_CLASS);
      overlay.setAttribute('aria-hidden', 'true');
      if (!openStack.length) global.document.body.style.overflow = '';
      if (entry.trigger && typeof entry.trigger.focus === 'function') {
        entry.trigger.focus();
      }
      if (typeof entry.onClose === 'function') entry.onClose();
    }

    if (prefersReducedMotion()) {
      finish();
    } else {
      overlay.classList.add(MODAL_CLOSING_CLASS);
      global.setTimeout(finish, CLOSE_ANIMATION_MS);
    }
  }

  /**
   * Globaler Escape-Handler: schliesst ausschliesslich den zuletzt
   * geöffneten, sichtbaren Dialog — sofern dessen Variante das erlaubt
   * (variant "forced-choice" ignoriert Escape bewusst, z.B. die
   * Idle-Racer-Crash-Zusammenfassung).
   * @param {KeyboardEvent} e - Das keydown-Event.
   * @returns {void}
   */
  function onGlobalKeydown(e) {
    if (e.key !== 'Escape' || !openStack.length) return;
    var topId = openStack[openStack.length - 1];
    var entry = registry[topId];
    if (entry && entry.variant !== 'forced-choice') closeModal(topId);
  }

  global.document.addEventListener('keydown', onGlobalKeydown);

  global.Modal = {
    openModal: openModal,
    closeModal: closeModal
  };
})(typeof window !== 'undefined' ? window : this);
