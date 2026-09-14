/**
 * VROOOOM — Shared Navbar Module (Single Source of Truth)
 *
 * Ersetzt die 7 kopierten `<nav class="site-nav">`-Blöcke durch EINE
 * gemeinsame Render-Funktion, damit die Navigation auf allen Seiten
 * garantiert identisch ist (Link-Set, aktiver Menüpunkt, Garage-Badge,
 * Theme-Toggle, mobiles Burger-Menü, Scroll-Verhalten).
 *
 * Struktur (style(hover)/feat(navbar) — Design-Polish-Phase): die schlanke
 * Top-Level-Navigation (Home, Aftermarket, Garage) bleibt flach; die fünf
 * "Erlebnis"-Seiten (Quiz, Glücksrad, Racing Sim, SoundCheck, Idle Racer)
 * sind unter einem gemeinsamen "Erlebnisse"-Dropdown gruppiert
 * (siehe TOP_LINKS/EXPERIENCE_LINKS + wireDropdown()). Auf Mobile (siehe
 * `@media (max-width: 768px)` in design.css) wird aus dem Popover-Dropdown
 * automatisch eine aufklappbare Sektion innerhalb des Burger-Menüs — rein
 * über CSS, dieselbe `is-open`-Klasse/Klick-Logik steuert beides.
 *
 * Einbindung:
 * - Bearbeitbare Seiten (index/quiz/race/wheel/shop/garage) laden diese
 *   Datei per <script src="navbar.js"> direkt NACH einem leeren
 *   Container `<nav id="siteNavRoot" class="site-nav" ...></nav>`. Das
 *   Modul mountet dann sofort synchron (kein Warten auf
 *   DOMContentLoaded nötig, der Container existiert bereits im DOM,
 *   sobald das Skript ausgeführt wird), damit spätere Skripte im selben
 *   Dokument (theme-toggle.js, index.html's eigene Toggle-Logik) den
 *   bereits gerenderten #themeToggle-Button vorfinden.
 * - soundcheck.html (geschützte Datei, GOLDEN_PRINCIPLES_KE.md Regel 6)
 *   wird NICHT verändert. Stattdessen lädt settings.js (das dort bereits
 *   eingebunden ist) dieses Skript zur Laufzeit dynamisch nach und
 *   dieses Modul findet dann das bestehende, statische
 *   `<nav class="site-nav">` per Fallback-Selektor und ersetzt dessen
 *   Inhalt — ohne dass soundcheck.html selbst je bearbeitet wird.
 *
 * Der Theme-Toggle-Klick-Handler wird von diesem Modul NUR dann selbst
 * verdrahtet, wenn der Container KEIN `data-theme-toggle="external"`
 * trägt (gesetzt auf allen 6 bearbeitbaren Seiten, die ihren Toggle
 * bereits über theme-toggle.js bzw. index.html's eigene Logik
 * verdrahten) — so wird der Button nie doppelt verdrahtet
 * (Erst-Klick-Bug).
 */
(function (global) {
    'use strict';

    /** ID des Navbar-Containers auf den 6 bearbeitbaren Seiten. */
    var NAV_ROOT_ID = 'siteNavRoot';
    /** localStorage-Key der Favoriten (nur lesend, siehe GOLDEN_PRINCIPLES_KE.md Regel 7). */
    var FAVORITES_KEY = 'vroooom_favorites';

    /** Schlanke Top-Level-Links (immer sichtbar, kein Dropdown). Garage wird
     *  separat gerendert (eigenes Badge-Widget, siehe buildMarkup()). */
    var TOP_LINKS = [
        { href: 'index.html', label: 'Übersicht' },
        { href: 'shop.html', label: 'Aftermarket' },
    ];

    /** "Spiel/Demo"-Seiten, gruppiert unter dem "Erlebnisse"-Dropdown. */
    var EXPERIENCE_LINKS = [
        { href: 'quiz.html', label: 'Quiz' },
        { href: 'wheel.html', label: 'Glücksrad' },
        { href: 'race.html', label: 'Racing Sim' },
        { href: 'soundcheck.html', label: 'SoundCheck' },
        { href: 'idle.html', label: 'Idle Racer' },
    ];

    /**
     * Ermittelt den Dateinamen der aktuell angezeigten Seite (für die
     * "active"-Markierung im Menü).
     * @returns {string} z.B. "index.html" (auch für "/" oder "").
     */
    function currentPageFile() {
        var path = (global.location && global.location.pathname) || '';
        var file = path.substring(path.lastIndexOf('/') + 1);
        return file || 'index.html';
    }

    /**
     * Liest die aktuelle Favoriten-Anzahl rein lesend aus localStorage.
     * Wirft nie einen Fehler (defensiv gegen fehlendes/korruptes Storage).
     * @returns {number} Anzahl gespeicherter Favoriten.
     */
    function readFavoritesCount() {
        try {
            var raw = global.localStorage.getItem(FAVORITES_KEY);
            var arr = raw ? JSON.parse(raw) : [];
            return Array.isArray(arr) ? arr.length : 0;
        } catch (e) {
            return 0;
        }
    }

    /**
     * Baut das innere Markup der Navbar (Wordmark, Burger, Top-Level-Links,
     * "Erlebnisse"-Dropdown, Garage-Badge, Theme-Toggle) als HTML-String.
     * @returns {string} HTML-Markup für den Navbar-Container.
     */
    function buildMarkup() {
        var page = currentPageFile();

        var topLinksHtml = TOP_LINKS.map(function (link) {
            var activeAttr = link.href === page ? ' class="active"' : '';
            return '<a href="' + link.href + '"' + activeAttr + '>' + link.label + '</a>';
        }).join('');

        // Ist die aktuell angezeigte Seite eine der fünf Dropdown-Seiten?
        // Falls ja, wird der Dropdown-Trigger selbst zusätzlich als "aktiv"
        // markiert (analog zum bestehenden garageActiveClass-Muster), damit
        // z.B. auf quiz.html sichtbar bleibt, in welchem Menü man sich
        // befindet.
        var experienceActive = EXPERIENCE_LINKS.some(function (link) {
            return link.href === page;
        });
        var experienceLinksHtml = EXPERIENCE_LINKS.map(function (link) {
            var activeAttr = link.href === page ? ' class="active"' : '';
            return '<a href="' + link.href + '" role="menuitem"' + activeAttr + '>' + link.label + '</a>';
        }).join('');

        var favCount = readFavoritesCount();
        var garageActiveClass = page === 'garage.html' ? ' active' : '';
        var badgeHiddenAttr = favCount > 0 ? '' : ' hidden';

        return (
            '<a class="brand" href="index.html">🏍️ Vrooooom</a>' +
            '<button type="button" class="nav-burger" id="navBurger" aria-label="Menü öffnen" aria-expanded="false" aria-controls="siteNavLinks">' +
                '<span></span><span></span><span></span>' +
            '</button>' +
            '<div class="site-nav-links" id="siteNavLinks">' +
                topLinksHtml +
                '<div class="nav-dropdown' + (experienceActive ? ' active' : '') + '" id="navExperiencesDropdown">' +
                    '<button type="button" class="nav-dropdown-trigger' + (experienceActive ? ' active' : '') + '" id="navExperiencesTrigger" aria-haspopup="true" aria-expanded="false" aria-controls="navExperiencesMenu">' +
                        'Erlebnisse <span class="nav-dropdown-caret" aria-hidden="true">▾</span>' +
                    '</button>' +
                    '<div class="nav-dropdown-menu" id="navExperiencesMenu" role="menu" aria-label="Erlebnisse">' +
                        experienceLinksHtml +
                    '</div>' +
                '</div>' +
                '<a href="garage.html" class="garage-nav-link' + garageActiveClass + '">🏠 Garage ' +
                    '<span class="garage-nav-badge" id="garageNavFavCount"' + badgeHiddenAttr + '>' + favCount + '</span>' +
                '</a>' +
            '</div>' +
            '<button type="button" class="theme-toggle" id="themeToggle" aria-label="Theme umschalten">☀️</button>'
        );
    }

    /**
     * Aktualisiert das Garage-Favoriten-Badge (Anzahl + Sichtbarkeit).
     * Rein additiv, darf nie einen Fehler nach außen werfen.
     * @returns {void}
     */
    function refreshGarageBadge() {
        try {
            var badge = global.document.getElementById('garageNavFavCount');
            if (!badge) return;
            var count = readFavoritesCount();
            badge.textContent = String(count);
            badge.hidden = count === 0;
        } catch (e) {
            /* Badge-Refresh darf nie eine Seite blockieren */
        }
    }

    /**
     * Verdrahtet das Ein-/Ausblenden der hairline-Trennlinie + des
     * dezenten Blur-Schattens beim Scrollen (siehe .site-nav.is-scrolled
     * in design.css).
     * @param {HTMLElement} nav - Das Navbar-Wurzelelement.
     * @returns {void}
     */
    function wireScrollState(nav) {
        var ticking = false;
        function update() {
            ticking = false;
            nav.classList.toggle('is-scrolled', global.scrollY > 8);
        }
        function onScroll() {
            if (ticking) return;
            ticking = true;
            global.requestAnimationFrame(update);
        }
        update();
        global.addEventListener('scroll', onScroll, { passive: true });
    }

    /**
     * Verdrahtet das mobile Burger-Menü (Öffnen/Schließen inkl.
     * Escape-Taste und Klick auf einen Link).
     * @param {HTMLElement} nav - Das Navbar-Wurzelelement.
     * @returns {void}
     */
    function wireBurger(nav) {
        var burger = nav.querySelector('#navBurger');
        var links = nav.querySelector('#siteNavLinks');
        if (!burger || !links) return;

        function setOpen(open) {
            links.classList.toggle('is-open', open);
            burger.setAttribute('aria-expanded', open ? 'true' : 'false');
            burger.setAttribute('aria-label', open ? 'Menü schließen' : 'Menü öffnen');
        }

        burger.addEventListener('click', function () {
            setOpen(!links.classList.contains('is-open'));
        });

        links.addEventListener('click', function (e) {
            if (e.target && e.target.tagName === 'A') setOpen(false);
        });

        global.document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && links.classList.contains('is-open')) setOpen(false);
        });
    }

    /**
     * Verdrahtet das "Erlebnisse"-Dropdown: Öffnen/Schließen per Klick auf
     * den Trigger, per Tastatur (Enter/Leertaste/Pfeil-runter öffnet + setzt
     * Fokus auf den ersten Eintrag, Pfeil-hoch/-runter wandert innerhalb des
     * Menüs, Escape schließt und gibt den Fokus an den Trigger zurück),
     * Schließen bei Klick ausserhalb sowie bei Klick auf einen Menüpunkt.
     * Dieselbe `is-open`-Klasse steuert sowohl das Desktop-Popover
     * (Fade + leichtes Herunterschieben) als auch — per CSS-Media-Query in
     * design.css — die mobile aufklappbare Sektion; hier ist keine
     * Verzweigung nach Viewport nötig.
     * @param {HTMLElement} nav - Das Navbar-Wurzelelement.
     * @returns {void}
     */
    function wireDropdown(nav) {
        var dropdown = nav.querySelector('#navExperiencesDropdown');
        var trigger = nav.querySelector('#navExperiencesTrigger');
        var menu = nav.querySelector('#navExperiencesMenu');
        if (!dropdown || !trigger || !menu) return;

        var menuItems = Array.prototype.slice.call(menu.querySelectorAll('a'));

        function setOpen(open) {
            dropdown.classList.toggle('is-open', open);
            trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
        }

        function isOpen() {
            return dropdown.classList.contains('is-open');
        }

        trigger.addEventListener('click', function (e) {
            e.stopPropagation();
            setOpen(!isOpen());
        });

        trigger.addEventListener('keydown', function (e) {
            if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setOpen(true);
                if (menuItems[0]) menuItems[0].focus();
            } else if (e.key === 'Escape' && isOpen()) {
                setOpen(false);
            }
        });

        menu.addEventListener('keydown', function (e) {
            var idx = menuItems.indexOf(global.document.activeElement);
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                (menuItems[idx + 1] || menuItems[0]).focus();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                (menuItems[idx - 1] || menuItems[menuItems.length - 1]).focus();
            } else if (e.key === 'Escape') {
                setOpen(false);
                trigger.focus();
            }
        });

        menu.addEventListener('click', function (e) {
            if (e.target && e.target.tagName === 'A') setOpen(false);
        });

        // Schliessen bei Klick ausserhalb des Dropdowns.
        global.document.addEventListener('click', function (e) {
            if (isOpen() && !dropdown.contains(e.target)) setOpen(false);
        });

        // Schliessen bei Escape, unabhängig davon, wo der Fokus gerade liegt
        // (deckt z.B. den Fall ab, dass mit der Maus geöffnet wurde).
        global.document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && isOpen()) setOpen(false);
        });
    }

    /**
     * Eigenständige Theme-Toggle-Verdrahtung — funktional identisch zu
     * theme-toggle.js's initThemeToggle(), aber nur für Seiten gedacht,
     * die den Toggle nirgendwo sonst verdrahten (aktuell nur
     * soundcheck.html, dessen Nav zur Laufzeit von settings.js ersetzt
     * wird). Wird NIE aufgerufen, wenn der Container
     * data-theme-toggle="external" trägt.
     * @returns {void}
     */
    function wireThemeToggleFallback() {
        var btn = global.document.getElementById('themeToggle');
        if (!btn) return;
        var t = global.localStorage.getItem('theme') || 'dark';
        btn.textContent = t === 'dark' ? '☀️' : '🌙';
        btn.addEventListener('click', function () {
            var current = global.document.documentElement.getAttribute('data-theme');
            var next = current === 'dark' ? 'light' : 'dark';
            global.document.documentElement.setAttribute('data-theme', next);
            global.localStorage.setItem('theme', next);
            btn.textContent = next === 'dark' ? '☀️' : '🌙';
        });
    }

    /**
     * Rendert die Navbar in den übergebenen Container und verdrahtet
     * alle interaktiven Elemente.
     * @param {HTMLElement} nav - Ziel-Element (bestehendes `<nav>`).
     * @returns {void}
     */
    function renderInto(nav) {
        nav.classList.add('site-nav');
        nav.innerHTML = buildMarkup();
        wireScrollState(nav);
        wireBurger(nav);
        wireDropdown(nav);
        if (nav.getAttribute('data-theme-toggle') !== 'external') {
            wireThemeToggleFallback();
        }
        global.addEventListener('storage', function (e) {
            if (!e || e.key === FAVORITES_KEY) refreshGarageBadge();
        });
    }

    /**
     * Sucht den Navbar-Container (per ID auf bearbeitbaren Seiten, sonst
     * per Fallback-Selektor auf soundcheck.html) und mountet die Navbar,
     * sofern gefunden.
     * @returns {void}
     */
    function mount() {
        var nav = global.document.getElementById(NAV_ROOT_ID) || global.document.querySelector('nav.site-nav');
        if (nav) renderInto(nav);
    }

    // Sofortiges, synchrones Mounten (kein DOMContentLoaded-Warten): auf
    // den 6 bearbeitbaren Seiten steht der Container bereits im Markup,
    // BEVOR dieses <script>-Tag ausgeführt wird, daher ist er zu diesem
    // Zeitpunkt schon vorhanden. Für den dynamischen Ladepfad (soundcheck
    // via settings.js) ist das gesamte Dokument zu diesem Zeitpunkt
    // ohnehin längst geparst.
    mount();

    global.VroooomNavbar = {
        mount: mount,
        refreshGarageBadge: refreshGarageBadge,
        // Read-only Einblick für Tests (tests/navbar-test.js) — Kopien, kein
        // Verweis auf die internen Arrays, damit niemand von aussen
        // versehentlich die Navigation mutiert.
        topLinks: TOP_LINKS.slice(),
        experienceLinks: EXPERIENCE_LINKS.slice(),
    };
})(window);
