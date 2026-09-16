/**
 * idle.js — Kawasaki Idle Racer: Seitensteuerung (DOM + Game-Loop).
 *
 * Konsumiert das DOM-freie idle-core.js (window.IdleCore) und übernimmt
 * ALLES, was idle-core.js bewusst NICHT tut: DOM-Bindings, Rendering,
 * den requestAnimationFrame-Game-Loop mit Delta-Zeit (entkoppelt von der
 * Render-Rate, tab-inactive-safe per IDLE_BALANCE.MAX_TICK_DELTA_SECONDS)
 * sowie sanft animierte ("tweenende") Zahlenanzeigen.
 *
 * Persistiert den Zustand regelmässig sowie bei jeder Kauf-/Tuning-
 * Aktion und beim Verlassen der Seite (siehe wireLifecycleSave()).
 */
(function () {
  'use strict';

  if (typeof window === 'undefined' || !window.IdleCore) return;
  var IdleCore = window.IdleCore;

  /** Intervall (ms) für periodisches Auto-Speichern des Zustands. */
  var AUTO_SAVE_INTERVAL_MS = 5000;
  /** Glättungsfaktor pro Frame für die "tweenende" km-Anzeige (0..1, höher = schneller). */
  var KM_DISPLAY_EASE = 0.12;
  /** Differenz-Schwelle (km), unterhalb derer die Anzeige direkt auf den Zielwert springt. */
  var KM_DISPLAY_SNAP_THRESHOLD = 0.05;

  /* ── Teil 1: ENDLESS-RUNNER — 2–3-Lane-Straße (Canvas) ────────────
   * Rein visuelle/geometrische Konstanten (Perspektive, Grössen, Ease-/
   * Swipe-Schwellen) — die eigentliche Spiel-Balance (Speed-Cap/
   * Vorlaufzeit/Hindernis-Dichte/Kollisions-Malus/Idle-Timeout) lebt
   * zentral in IdleCore.IDLE_BALANCE (siehe idle-core.js). */
  /** Y-Position des Horizonts (Fluchtpunkt-Bereich) als Anteil der Canvas-Höhe. */
  var RUNNER_HORIZON_Y_PCT = 0.16;
  /** Y-Position der Spieler-Reihe (Bike-Marker) als Anteil der Canvas-Höhe. */
  var RUNNER_PLAYER_ROW_Y_PCT = 0.9;
  /** Strassenbreite am Horizont als Anteil der Canvas-Breite (schmal = Tiefenwirkung). */
  var RUNNER_ROAD_WIDTH_TOP_PCT = 0.16;
  /** Strassenbreite an der Spieler-Reihe als Anteil der Canvas-Breite (breit = nah am Betrachter). */
  var RUNNER_ROAD_WIDTH_BOTTOM_PCT = 0.88;
  /** Hindernis-Fortschritt (0=Horizont, 1=Spieler-Reihe), ab dem eine Kollision ausgewertet wird. */
  var RUNNER_HIT_ZONE_T = 0.92;
  /** Hindernis-Fortschritt, ab dem ein Hindernis endgültig entfernt wird (leicht über 1, "vorbeigefahren"). */
  var RUNNER_OBSTACLE_REMOVE_T = 1.08;
  /** Hindernis-Grösse (px) am Horizont (Fortschritt 0). */
  var RUNNER_OBSTACLE_MIN_SIZE_PX = 5;
  /** Hindernis-Grösse (px) an der Spieler-Reihe (Fortschritt 1). */
  var RUNNER_OBSTACLE_MAX_SIZE_PX = 22;
  /** Ease-Faktor (pro Sekunde) für den weichen Lane-Wechsel-Tween des Bike-Markers. */
  var RUNNER_LANE_EASE_PER_SECOND = 10;
  /** Mindest-Distanz (px) eines horizontalen Touch-Swipes, um einen Lane-Wechsel auszulösen. */
  var RUNNER_SWIPE_THRESHOLD_PX = 40;
  /** Anzeigedauer (ms) des Kollisions-Flash/Shake-Effekts (siehe triggerCollisionFeedback()). */
  var RUNNER_COLLISION_FLASH_MS = 320;
  /** Ab dieser Geschwindigkeit (%) werden dezente Speed-Lines gezeichnet. */
  var TRACK_SPEED_LINES_THRESHOLD_PCT = 45;

  /* ── Phase B: Tacho (Canvas) ─────────────────────────────────────── */
  /** Glättungsfaktor pro Frame für die Tacho-Nadel (0..1, höher = schneller). */
  var TACHO_NEEDLE_EASE = 0.09;

  /* ── Phase B: "Neues Bike in der Garage"-Übergabe ───────────────── */
  /** Anzeigedauer (ms) des Übergabe-Banners nach einem Bike-Kauf. */
  var HANDOVER_BANNER_MS = 2200;

  /* ── Phase B: Schaltpunkt-Combo (MECHANIK A) — UI-Konstanten ────── */
  /** Fixe Mitte der perfekten Zone (% der Leistenbreite) — "in der Mitte". */
  var SHIFT_ZONE_CENTER_PCT = 50;
  /** Anzeigedauer (ms) des Treffer-/Fehlklick-Flashs, bevor die Leiste ausblendet. */
  var SHIFT_RESULT_FLASH_MS = 550;

  /* ── Phase C: Web Audio Motorsound — sanfter, tonaler Synth-Pad (synthetisiert, standardmässig AUS) ── */
  /** Motor-Grundfrequenz (Hz) bei Geschwindigkeit 0% — musikalisch statt roh, tiefes Sub-Rumpeln vermieden. */
  var ENGINE_BASE_HZ = 96;
  /** Zusätzliche Frequenz (Hz) bei Geschwindigkeit 100%, addiert auf ENGINE_BASE_HZ — bewusst klein: Tonhöhe steigt nur SUBTIL mit Speed. */
  var ENGINE_RANGE_HZ = 60;
  /** Zeitkonstante (s) für sanfte Frequenz-/Lautstärke-/Filter-Übergänge (Web Audio setTargetAtTime). */
  var ENGINE_SMOOTH_TIME_CONSTANT = 0.18;
  /** Verstimmung (Cent) der zweiten Ton-Schicht gegenüber der Grundschicht — mildes Chorus-Schweben statt Dissonanz. */
  var ENGINE_CHORUS_DETUNE_CENTS = 7;
  /** Tiefpassfilter-Grenzfrequenz (Hz) bei Geschwindigkeit 0% — nimmt harte obere Anteile, macht den Klang weich statt schneidend. */
  var ENGINE_FILTER_BASE_HZ = 900;
  /** Zusätzliche Filter-Grenzfrequenz (Hz) bei 100% Speed — Klang wird bei Tempo dezent "heller", nie grell. */
  var ENGINE_FILTER_RANGE_HZ = 500;
  /** Rate (Hz) der langsamen Lautstärke-LFO — das ruhige "Atmen" des Pads. */
  var ENGINE_TREMOLO_RATE_HZ = 0.18;
  /** Tiefe (0..1) der Lautstärke-LFO relativ zur Zielamplitude. */
  var ENGINE_TREMOLO_DEPTH = 0.18;
  /** Zusätzlicher Frequenz-Boost (Hz) des kurzen "Rev-up"-Effekts bei "Gas geben" — bewusst dezent, kein Aufheulen. */
  var ENGINE_REV_UP_BOOST_HZ = 18;
  /** Dauer (s) des "Rev-up"-Effekts, bevor er zur Grundfrequenz zurückklingt. */
  var ENGINE_REV_UP_DECAY_SECONDS = 0.45;
  /** Maximale Master-Lautstärke (0..1) bei Lautstärke-Regler = 100%. */
  var ENGINE_MAX_GAIN = 0.16;

  /** Emoji-Zuordnung je Bike-Kategorie, rein dekorativ (kein externes Bildmaterial). */
  var CATEGORY_ICONS = {
    'Einsteiger-Naked': '🔰',
    'Off-Road': '⛰️',
    'Cruiser': '😎',
    'Sportler': '🏍️',
    'Klassiker': '🕰️',
    'Naked': '💪',
    'Adventure': '🌍',
    'Sport Tourer': '🚀',
    'Supersportler': '🏆',
    'Hypersportler': '⚡',
    'Hypersportler (Track)': '🔥',
  };

  /** Emoji-Zuordnung je Teile-Seltenheitsstufe (feat(idle-parts)), rein dekorativ. */
  var PART_RARITY_ICONS = { common: '⚙️', rare: '🔧', legendary: '💎' };
  /** Anzeigedauer (ms) eines Teile-Drop-Toasts, bevor er wieder ausblendet. */
  var PART_TOAST_VISIBLE_MS = 3200;

  /** Emoji-Zuordnung je Gear-Seltenheitsstufe (feat(idle-gear)), rein dekorativ. */
  var GEAR_RARITY_ICONS = { gewoehnlich: '🥉', selten: '🥈', episch: '🥇', legendaer: '💠' };

  /** Mindest-Abwesenheitszeit (Sekunden), ab der ein Offline-Willkommens-Banner gezeigt wird (verhindert Rauschen bei schnellen Reloads/Tab-Wechseln). */
  var OFFLINE_MIN_AWAY_SECONDS = 30;

  /* ── Werkstattrechnungen + Insolvenz (MECHANIK A) — feat(idle-bills) ── */
  /** Anzeigedauer (ms) des "Bezahlt!"-Stempel-Effekts, bevor das Rechnungs-Panel ausblendet. */
  var BILL_PAID_STAMP_MS = 900;
  /** Anzeigedauer (ms) des Insolvenz-Hinweises, bevor er automatisch ausblendet. */
  var BILL_INSOLVENCY_NOTICE_MS = 5200;

  /* ── Sparschweine zerschlagen (MECHANIK B) — feat(idle-piggybanks) ── */
  /** Anzeigedauer (ms) des kurzen "Zerschlagen"-Effekts, bevor das Sparschwein despawnt. */
  var PIGGY_SMASH_ANIM_MS = 220;
  /** Rand-Puffer (% der Streckenbreite/-höhe), innerhalb dessen die zufällige Sparschwein-Position NICHT liegen darf (verhindert Anklebe-Positionen am Rand). */
  var PIGGY_POSITION_MARGIN_PCT = 12;

  /* ── Teil 2: POWERUPS — Magnet/Schild/Turbo/Münzregen — feat(powerups)
   * Wiederverwendet EXAKT das Sparschwein-Muster (spawnPiggy/tickPiggy/
   * smashPiggy oben), nur lane-gebunden statt frei-%-positioniert (siehe
   * laneCenterX()/laneRowY() aus Teil 1) UND mit 4 statt 1 Effekt-Typ. */
  /** Hindernis-Fortschritt t (0=Horizont, 1=Spieler-Reihe), auf dem ein Powerup erscheint — mittig auf der Strecke, gut erreichbar, bevor es despawnt. */
  var POWERUP_SPAWN_T = 0.6;
  /** Anzeigedauer (ms) des kurzen "Eingesammelt"-Effekts, bevor das Powerup despawnt (mirrors PIGGY_SMASH_ANIM_MS). */
  var POWERUP_COLLECT_ANIM_MS = 220;
  /** Anzeigedauer (ms) des kurzen Schild-Block-Flash/Toasts (siehe triggerShieldFeedback()). */
  var POWERUP_SHIELD_FLASH_MS = 320;
  /** Emoji je Powerup-Typ, rein dekorativ (Teil 4: 'muenzregen' durch 'scoreX2' ersetzt). */
  var POWERUP_ICONS = { magnet: '🧲', schild: '🛡️', turbo: '🚀', scoreX2: '✨' };
  /** Deutsche Anzeigenamen je Powerup-Typ (Toasts/aria-label/HUD). */
  var POWERUP_NAMES = { magnet: 'Magnet', schild: 'Schild', turbo: 'Turbo', scoreX2: 'Score x2' };

  /* ── Teil 4: RUN-FEEL — Score-HUD/Münz-Trails/Near-Miss-Combo/Powerup-
   * Timer-HUD/Schwierigkeitskurve — feat(score)/feat(coins)/
   * feat(nearmiss)/feat(powerups)/feat(difficulty) ──────────────────── */
  /** Glättungsfaktor pro Frame für die "schnell hochzählende" Score-Anzeige (0..1, höher = schneller — bewusst deutlich schneller als KM_DISPLAY_EASE). */
  var RUN_SCORE_DISPLAY_EASE = 0.35;
  /** Differenz-Schwelle (Score-Punkte), unterhalb derer die Score-Anzeige direkt auf den Zielwert springt. */
  var RUN_SCORE_DISPLAY_SNAP_THRESHOLD = 0.5;
  /** Anzeigedauer (ms) des "Knapp vorbei!"-Near-Miss-Popups, bevor es wieder ausblendet. */
  var NEAR_MISS_POPUP_MS = 850;
  /** Reihenfolge/Icons der Powerup-Timer-HUD-Badges (Teil 4) — identisch zu POWERUP_ICONS, aber als feste Liste für eine stabile HUD-Reihenfolge. */
  var POWERUP_HUD_TYPES = ['magnet', 'schild', 'turbo', 'scoreX2'];

  /** Zentraler, aus localStorage geladener Idle-Zustand (siehe idle-core.js). */
  var state = ApiClient.loadIdleState();

  /** In km gutgeschriebener Offline-Ertrag beim Laden (0, falls keine/zu kurze Abwesenheit). Siehe showOfflineBanner() in initIdlePage(). */
  var offlineEarnedKm = 0;
  (function creditOfflineEarnings() {
    if (!state.offline || typeof state.offline.lastSeenAt !== 'number') return;
    var awaySeconds = (Date.now() - state.offline.lastSeenAt) / 1000;
    if (awaySeconds < OFFLINE_MIN_AWAY_SECONDS) return;
    var earned = IdleCore.offlineEarn(state, awaySeconds);
    if (earned > 0) {
      IdleCore.creditKm(state, earned);
      offlineEarnedKm = earned;
      // Sofort speichern (aktualisiert auch offline.lastSeenAt, siehe
      // idle-core.js saveState()) — verhindert Doppel-Gutschrift, falls
      // die Seite vor dem nächsten Auto-Save/beforeunload erneut geladen wird.
      ApiClient.saveIdleState(state);
    }
  })();

  /* ── Werkstattrechnungen (MECHANIK A): Laufzeit-Zustand einer Rechnung —
     NICHT persistiert (mirrors shiftState/shiftTimerSeconds), NUR die
     amount/dueAt/graceSeconds-Eckdaten einer AKTIVEN Rechnung leben in
     state.finance (siehe idle-core.js), damit ein schnelles Neuladen eine
     laufende Frist nicht einfach verschwinden lässt. ── */
  var billState = { active: false, amount: 0, totalSeconds: 0, secondsRemaining: 0 };
  /** Sekunden bis zur nächsten fälligen Werkstattrechnung (siehe idle-core.js nextBillIntervalSeconds()). */
  var billTimerSeconds = IdleCore.nextBillIntervalSeconds(state);

  // Stellt eine beim letzten Speichern noch aktive, aber noch nicht abgelaufene
  // Rechnung wieder her (verhindert, dass ein schnelles Neuladen die laufende
  // Frist einfach "wegzaubert" und so trivial umgangen werden könnte). Eine
  // WÄHREND der Abwesenheit abgelaufene Rechnung wird dagegen bewusst
  // VERZIEHEN — Insolvenz entsteht NIEMALS durch blosse Abwesenheit, sondern
  // ausschliesslich durch tickBill() bei offener/aktiver Seite (Fairness).
  (function restoreOrForgiveActiveBill() {
    if (!state.finance || typeof state.finance.activeBillDueAt !== 'number') return;
    var remainingMs = state.finance.activeBillDueAt - Date.now();
    if (remainingMs > 0 && typeof state.finance.activeBillAmount === 'number') {
      var graceSeconds = typeof state.finance.activeBillGraceSeconds === 'number' ? state.finance.activeBillGraceSeconds : remainingMs / 1000;
      billState = {
        active: true,
        amount: state.finance.activeBillAmount,
        totalSeconds: graceSeconds,
        secondsRemaining: remainingMs / 1000,
      };
    } else {
      state.finance.activeBillAmount = null;
      state.finance.activeBillDueAt = null;
      state.finance.activeBillGraceSeconds = null;
      // Sofort speichern (analog zur Offline-Ertrags-Gutschrift oben) — die
      // "Verziehen"-Entscheidung soll dauerhaft in localStorage stehen und
      // nicht erst auf den nächsten Auto-Save (bis zu 5s) warten müssen.
      ApiClient.saveIdleState(state);
    }
  })();

  /** Aktuell angezeigter (sanft nachlaufender) km-Wert für die Tween-Animation — startet VOR dem Offline-Ertrag, damit dieser sichtbar "hochzählt". */
  var displayedKm = state.km - offlineEarnedKm;
  /** Zeitstempel des letzten Game-Loop-Frames (für Delta-Zeit-Berechnung). */
  var lastFrameTime = null;

  /** true, wenn das System "Bewegung reduzieren" bevorzugt (prefers-reduced-motion). */
  var reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ── Teil 1: ENDLESS-RUNNER — Laufzeit-Zustand ────────────────────
   * Hindernisse (runnerObstacles) sind bewusst NICHT persistiert (siehe
   * state.runner-Docblock in idle-core.js) — reiner Laufzeit-Zustand,
   * identisches Muster zu piggyState/shiftState. Jedes Element:
   * {lane, t, resolved} — t läuft von 0 (Horizont/Spawn) bis >1
   * (vorbeigefahren, wird entfernt); resolved verhindert eine doppelte
   * Kollisionsauswertung desselben Hindernisses. */
  var runnerObstacles = [];
  /** Sekunden bis zum nächsten Hindernis-Spawn (siehe tickRunner()). */
  var runnerSpawnTimerSeconds = IdleCore.nextObstacleSpawnIntervalSeconds(0, Math.random, 0);
  /** Aufsummierte Scroll-Distanz seit dem letzten Distanz-Meilenstein (ersetzt die frühere Runden-Erkennung, siehe onLapCompleted()). */
  var runnerLapProgressUnits = 0;
  /* ── Teil 4: Münz-Trails — Laufzeit-Zustand (feat(coins)) ─────────
   * Analog zu runnerObstacles: {lane, displayLane, t, resolved} — t läuft
   * von <=0 (noch nicht erschienen, gestaffelter Trail-Versatz via
   * generateCoinTrail()'s offsetT) bis >1 (vorbeigefahren, entfernt). NICHT
   * persistiert (identisches Muster zu runnerObstacles). */
  var runnerCoins = [];
  /** Sekunden bis zum nächsten Münz-Trail-Spawn (siehe tickRunner()). */
  var runnerCoinSpawnTimerSeconds = IdleCore.nextCoinTrailIntervalSeconds(Math.random);
  /** Weich nachlaufende (getweente) Lane-Position des Bike-Markers (Float, für einen sanften Lane-Wechsel statt eines harten Sprungs). */
  var runnerBikeDisplayLane = state.runner.lane;
  /** Timeout-Handle des aktuell angezeigten Kollisions-Flash/Shake-Effekts (für Re-Trigger bei schnell aufeinanderfolgenden Treffern). */
  var runnerCollisionFlashTimeoutId = null;
  /** Zuletzt angezeigter Aktivitäts-Zustand ('active'/'idle'), nur für den Auto-Pilot-Badge-Text (vermeidet unnötige DOM-Schreibzugriffe jeden Frame). */
  var runnerLastDisplayedActivity = null;
  /** DOM-Referenzen für Canvas + 2D-Kontext (einmalig aufgelöst, siehe initCanvases()). */
  var trackCanvas = null, trackCtx = null;
  var tachoCanvas = null, tachoCtx = null;

  /* ── Teil 4: Score/Highscore-HUD — Laufzeit-Zustand (feat(score)) ── */
  /** Aktuell angezeigter (weich, aber SCHNELL nachlaufender) Score-Wert für die Tween-Animation. */
  var displayedRunScore = 0;
  /** Timeout-Handle des aktuell angezeigten Near-Miss-Popups (für Re-Trigger bei schnell aufeinanderfolgenden Near-Misses). */
  var nearMissPopupTimeoutId = null;

  /* ── Tacho: Laufzeit-Zustand ─────────────────────────────────────── */
  /** Aktuell angezeigter (weich nachlaufender) Tacho-Nadel-Prozentwert. */
  var tachoDisplayPct = 0;

  /* ── "Neues Bike in der Garage"-Übergabe ────────────────────────── */
  /** Timeout-Handle des aktuell angezeigten Übergabe-Banners (für Re-Trigger). */
  var handoverTimeoutId = null;

  /* ── Web Audio Motorsound: Laufzeit-Zustand (lazy, erst nach Nutzer-Geste) ── */
  var audioCtx = null;
  var masterGain = null;
  var engineOsc = null;
  var chorusOsc = null;
  var subOsc = null;
  var toneFilter = null;
  var tremoloGain = null;
  var lfoOsc = null;

  /* ── Schaltpunkt-Combo (MECHANIK A): Laufzeit-Zustand einer Leiste ── */
  var shiftState = {
    active: false,
    elapsedSeconds: 0,
    zoneWidthPct: IdleCore.IDLE_BALANCE.COMBO_ZONE_BASE_WIDTH_PCT,
    resultShown: false,
  };
  /** Sekunden bis zur nächsten Schaltpunkt-Leiste (zufällig 15–30s, siehe idle-core.js). */
  var shiftTimerSeconds = IdleCore.nextShiftIntervalSeconds();

  /* ── Sparschweine zerschlagen (MECHANIK B): Laufzeit-Zustand — NICHT
     persistiert (mirrors shiftState), nur der Lebenszeit-Zähler
     state.piggy.smashedCount lebt im persistierten Zustand. ── */
  var piggyState = { active: false, elapsedSeconds: 0, visibleSeconds: 0 };
  /** Sekunden bis zum nächsten erscheinenden Sparschwein (flach 20–40s, siehe idle-core.js). */
  var piggyTimerSeconds = IdleCore.nextPiggyIntervalSeconds(Math.random);

  /* ── Teil 2: POWERUPS (feat(powerups)) — Laufzeit-Zustand, NICHT
     persistiert (mirrors piggyState); nur die aktiven Effekt-Timer
     (state.powerups.*ExpiresAt) + der Lebenszeit-Zähler (collected) leben
     im persistierten Zustand (siehe idle-core.js). ── */
  var powerupState = { active: false, elapsedSeconds: 0, visibleSeconds: 0, type: null };
  /** Sekunden bis zum nächsten Powerup-Spawn-VERSUCH (siehe IdleCore.rollPowerupDrop() — ob dabei tatsächlich eines erscheint, ist tuning-abhängig). */
  var powerupTimerSeconds = IdleCore.nextPowerupIntervalSeconds(Math.random);

  /**
   * Formatiert eine km-Zahl für die Anzeige (deutsches Zahlenformat,
   * abgerundet auf ganze km).
   * @param {number} value - Roh-km-Wert.
   * @returns {string} Formatierte Zeichenkette.
   */
  function formatKm(value) {
    return Math.floor(Math.max(0, value)).toLocaleString('de-DE');
  }

  /**
   * Formatiert eine Spielzeit (Sekunden) als "Xh Ym" bzw. "Ym" (feat(idle-stats)).
   * @param {number} totalSeconds - Spielzeit in Sekunden.
   * @returns {string} Formatierte Zeichenkette.
   */
  function formatPlayTime(totalSeconds) {
    var minutes = Math.floor(Math.max(0, totalSeconds) / 60);
    var hours = Math.floor(minutes / 60);
    var remMinutes = minutes % 60;
    return hours > 0 ? (hours + 'h ' + remMinutes + 'm') : (remMinutes + 'm');
  }

  /**
   * Liefert das aktuell gefahrene Bike-Objekt inkl. Level und
   * abgeleiteten Statistiken.
   * @returns {{bike: Object, level: number, stats: Object}} Aktuelles Bike + Stats.
   */
  function getCurrentBikeInfo() {
    var bike = IdleCore.getBikeById(state.currentBikeId) || IdleCore.IDLE_BIKES[0];
    var level = IdleCore.getBikeLevel(state, bike.id);
    var stats = IdleCore.deriveBikeStats(bike, level);
    return { bike: bike, level: level, stats: stats };
  }

  /**
   * Aggregiert ALLE Ertrags-Multiplikatoren, die auf JEDEN km-Ertrag
   * (aktiv wie passiv) angewendet werden: den Schaltpunkt-Combo-
   * Multiplikator (siehe activeComboMultiplier), den permanenten
   * Werksvertrag-/Prestige-Bonus (siehe IdleCore.contractEffects), den
   * permanenten Teile-Set-Bonus (siehe IdleCore.setBonuses) UND den
   * permanenten Ausrüstungs-Bonus (Pro-Item + Set, siehe IdleCore.gearBonuses).
   * @param {number} nowMs - Aktueller Zeitstempel (ms), für activeComboMultiplier.
   * @returns {number} Gesamt-Multiplikator (>= 1).
   */
  function totalEarnMultiplier(nowMs) {
    var combo = IdleCore.activeComboMultiplier(state, nowMs);
    var contract = IdleCore.contractEffects(state).earnMultiplier;
    var parts = IdleCore.setBonuses(state).totalBonusMultiplier;
    var gear = IdleCore.gearBonuses(state).totalBonusMultiplier;
    return combo * contract * parts * gear;
  }

  /**
   * Ruft (falls achievements.js geladen ist, siehe idle.html) VroooomAchievements.
   * checkNow() mit den aktuellen Idle-Racer-Zählerständen als Overrides auf —
   * achievements.js selbst bleibt dabei bewusst idle-frei (siehe dessen
   * buildContext()-Docblock), ALLE idle-spezifischen Werte kommen von hier.
   * No-op, falls achievements.js nicht eingebunden ist.
   * @returns {void}
   */
  function checkIdleAchievements() {
    if (!window.VroooomAchievements) return;
    window.VroooomAchievements.checkNow({
      billsPaidOnTime: state.finance.billsPaidOnTime,
      billsPaidLastSecond: state.finance.billsPaidLastSecond,
      insolvenciesSurvived: state.finance.insolvencies,
      piggybanksSmashed: state.piggy.smashedCount,
      gearCompletedSets: IdleCore.gearBonuses(state).completedSets.length,
      seasonsInsolvencyFree: state.finance.seasonsInsolvencyFree,
    });
  }

  /**
   * Rendert die Bike-Detailkarte (Name, Kategorie, Statistik-Balken,
   * Tuning-Level, Upgrade-Button inkl. Preis/Deaktivierung).
   * @returns {void}
   */
  function renderBikeCard() {
    var info = getCurrentBikeInfo();
    var nameEl = document.getElementById('idleBikeName');
    var metaEl = document.getElementById('idleBikeMeta');
    if (nameEl) nameEl.textContent = info.bike.name;
    if (metaEl) metaEl.textContent = info.bike.kategorie + ' · ' + info.bike.topspeed + ' km/h · ' + info.bike.ps + ' PS';

    setBar('idleStatSpeedFill', 'idleStatSpeedVal', info.stats.geschwindigkeitPct);
    setBar('idleStatAccelFill', 'idleStatAccelVal', info.stats.beschleunigungPct);
    setBar('idleStatErtragFill', 'idleStatErtragVal', info.stats.ertragBonusPct);

    var levelEl = document.getElementById('idleBikeLevel');
    if (levelEl) levelEl.textContent = String(info.level);

    var cost = IdleCore.effectiveTuningCost(state, info.bike.id, info.level);
    var upgradeBtn = document.getElementById('idleUpgradeBtn');
    var costEl = document.getElementById('idleUpgradeCost');
    if (costEl) costEl.textContent = cost === null ? 'MAX' : formatKm(cost);
    if (upgradeBtn) upgradeBtn.disabled = cost === null || state.km < cost;
  }

  /**
   * Setzt Breite + Prozent-Text eines Statistik-Balkens.
   * @param {string} fillId - Element-id des Fülleistens-Elements.
   * @param {string} valueId - Element-id des Prozent-Text-Elements.
   * @param {number} pct - Prozentwert (0–100).
   * @returns {void}
   */
  function setBar(fillId, valueId, pct) {
    var fillEl = document.getElementById(fillId);
    var valueEl = document.getElementById(valueId);
    if (fillEl) fillEl.style.width = pct + '%';
    if (valueEl) valueEl.textContent = Math.round(pct) + '%';
  }

  /**
   * Rendert die Bike-Shop-Liste: bereits besessene Bikes (mit "Fahren"-
   * Button, hervorgehoben falls aktuell aktiv), das nächste käufliche
   * Bike (mit Preis + Kaufen-Button, deaktiviert falls zu teuer) sowie
   * alle noch gesperrten, zukünftigen Bikes (nur Vorschau, keine
   * Interaktion).
   * @returns {void}
   */
  function renderShopList() {
    var list = document.getElementById('idleShopList');
    if (!list) return;
    list.innerHTML = '';

    IdleCore.IDLE_BIKES.forEach(function (bike, index) {
      var owned = state.ownedBikeIds.indexOf(bike.id) !== -1;
      var isCurrent = state.currentBikeId === bike.id;
      var isNextToBuy = !owned && index === state.ownedBikeIds.length;

      var item = document.createElement('div');
      item.className = 'idle-shop-item' + (isCurrent ? ' is-current' : '') + (!owned && !isNextToBuy ? ' is-locked' : '');

      var icon = document.createElement('span');
      icon.className = 'idle-shop-item-icon';
      icon.textContent = CATEGORY_ICONS[bike.kategorie] || '🏍️';
      item.appendChild(icon);

      var info = document.createElement('div');
      info.className = 'idle-shop-item-info';
      var h4 = document.createElement('h4');
      h4.textContent = bike.name;
      var p = document.createElement('p');
      p.textContent = bike.kategorie + ' · ' + bike.topspeed + ' km/h · ' + bike.ps + ' PS';
      info.appendChild(h4);
      info.appendChild(p);
      item.appendChild(info);

      var action = document.createElement('div');
      action.className = 'idle-shop-item-action';

      if (owned) {
        if (isCurrent) {
          var badge = document.createElement('span');
          badge.className = 'idle-shop-item-badge';
          badge.textContent = '🏁 Aktuell gefahren';
          action.appendChild(badge);
        } else {
          var selectBtn = document.createElement('button');
          selectBtn.type = 'button';
          selectBtn.className = 'btn-outline';
          selectBtn.textContent = 'Fahren';
          selectBtn.addEventListener('click', function () {
            IdleCore.selectBike(state, bike.id);
            ApiClient.saveIdleState(state);
            renderAll();
          });
          action.appendChild(selectBtn);
        }
      } else if (isNextToBuy) {
        // balance(tuning) — TUNING-GATE: getNextBikeToBuy() liefert zusätzlich
        // zum km-Preis, ob das zuletzt besessene Bike das erforderliche
        // Tuning-Level erreicht hat (tuningMet/tuningRequirement/tuningLevel).
        var nextInfo = IdleCore.getNextBikeToBuy(state);
        var buyBtn = document.createElement('button');
        buyBtn.type = 'button';
        buyBtn.className = 'btn idle-buy-btn';
        buyBtn.textContent = 'Kaufen — ' + formatKm(bike.kaufpreisKm) + ' km';
        buyBtn.disabled = !nextInfo.affordable;
        buyBtn.addEventListener('click', function () {
          var result = IdleCore.buyNextBike(state);
          if (result.success) {
            IdleCore.selectBike(state, result.bike.id);
            ApiClient.saveIdleState(state);
            renderAll();
            triggerBikeHandover(result.bike);
          }
        });
        action.appendChild(buyBtn);

        if (!nextInfo.tuningMet) {
          var tuningHint = document.createElement('span');
          tuningHint.className = 'idle-shop-item-tuning-hint';
          tuningHint.textContent = '🔧 Benötigt Tuning-Stufe ' + nextInfo.tuningRequirement + ' (aktuell ' + nextInfo.tuningLevel + ')';
          action.appendChild(tuningHint);
        }
      } else {
        var lockedBadge = document.createElement('span');
        lockedBadge.className = 'idle-shop-item-badge';
        lockedBadge.textContent = '🔒 ' + formatKm(bike.kaufpreisKm) + ' km';
        action.appendChild(lockedBadge);
      }

      item.appendChild(action);
      list.appendChild(item);
    });
  }

  /**
   * Rendert alle Teile der Seite neu (Bike-Karte, Shop-Liste, Saison-/
   * Werksvertrags-Übersicht, Teile-Sammlung, Statistik-Panel). Die
   * km-Anzeige wird separat im Game-Loop weich nachgezogen, siehe
   * updateKmDisplay().
   * @returns {void}
   */
  function renderAll() {
    renderBikeCard();
    renderShopList();
    renderSeasonPanel();
    renderPartsPanel();
    renderGearPanel();
    renderStatsPanel();
    renderBillPanel();
  }

  /**
   * Zieht die angezeigte km-Zahl weich in Richtung des tatsächlichen
   * state.km nach (einfache Lerp-"Tween"-Animation statt hartem Sprung)
   * und schreibt sie in die DOM-Anzeige.
   * @returns {void}
   */
  function updateKmDisplay() {
    var diff = state.km - displayedKm;
    if (Math.abs(diff) < KM_DISPLAY_SNAP_THRESHOLD) {
      displayedKm = state.km;
    } else {
      displayedKm += diff * KM_DISPLAY_EASE;
    }
    var el = document.getElementById('idleKmValue');
    if (el) el.textContent = formatKm(displayedKm);
  }

  /**
   * Verdrahtet den "Gas geben"-Button: schreibt sofort activeEarn() auf
   * den Zustand gut, löst eine kurze Puls-Animation aus und aktualisiert
   * die abhängigen Anzeigen (Shop-Kaufbarkeit, Upgrade-Kosten).
   * @returns {void}
   */
  function wireGasButton() {
    var btn = document.getElementById('idleGasBtn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var earned = IdleCore.activeEarn(state) * totalEarnMultiplier(Date.now());
      IdleCore.creditKm(state, earned);
      btn.classList.remove('is-pulsing');
      // Reflow erzwingen, damit die Animation bei schnellem Mehrfach-Klick erneut startet.
      void btn.offsetWidth;
      btn.classList.add('is-pulsing');
      renderAll();
      revUpEngineSound();
    });
  }

  /**
   * Verdrahtet den Tuning-Upgrade-Button der Bike-Detailkarte.
   * @returns {void}
   */
  function wireUpgradeButton() {
    var btn = document.getElementById('idleUpgradeBtn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var result = IdleCore.upgradeBike(state, state.currentBikeId);
      if (result.success) {
        ApiClient.saveIdleState(state);
        renderAll();
      }
    });
  }

  /**
   * Element-ids, die ihre EIGENE Enter/Leertaste-Interaktion verdrahten
   * (Schaltpunkt-Leiste/Sparschwein/Powerup/Crash-Zusammenfassung-Button,
   * siehe wireShiftInteraction()/wirePiggyInteraction()/
   * wirePowerupInteraction()/wireRunSummaryButtons()) — der globale
   * Sprung/Ducken-Handler in wireRunnerControls() ignoriert Leertaste-
   * Drücke auf genau diesen Elementen, damit "Space" dort NICHT
   * zusätzlich einen Sprung auslöst (verhindert doppelte Aktivierung).
   */
  var RUNNER_CONTROL_EXEMPT_IDS = { idleShiftTrack: true, idlePiggy: true, idlePowerup: true, idleRunSummaryRestartBtn: true };

  /**
   * Verdrahtet die Steuerung des Endless-Runners (Teil 1 + Teil 3):
   * Tastatur (ArrowLeft/ArrowRight sowie A/D für den Lane-Wechsel,
   * ArrowUp/Space für einen Sprung, ArrowDown/Ctrl für Ducken —
   * unabhängig von der Eingabe-Fokussierung ausser innerhalb von
   * Formularfeldern bzw. den in RUNNER_CONTROL_EXEMPT_IDS gelisteten
   * Elementen) UND Touch-Swipe in ALLEN 4 Richtungen (links/rechts = Lane-
   * Wechsel, hoch = Sprung, runter = Ducken) auf der Renn-Strecke. Jede
   * erkannte Eingabe ruft IdleCore.steerRunnerLane()/jumpRunner()/
   * duckRunner() auf, was automatisch auch den Aktivitäts-Zustand auf
   * 'active' setzt (siehe IdleCore.runnerActivityState()).
   * @returns {void}
   */
  function wireRunnerControls() {
    document.addEventListener('keydown', function (event) {
      var target = event.target;
      var tag = target && target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (target && target.id && RUNNER_CONTROL_EXEMPT_IDS[target.id]) return;
      if (event.key === 'ArrowLeft' || event.key === 'a' || event.key === 'A') {
        event.preventDefault();
        IdleCore.steerRunnerLane(state, -1, Date.now());
      } else if (event.key === 'ArrowRight' || event.key === 'd' || event.key === 'D') {
        event.preventDefault();
        IdleCore.steerRunnerLane(state, 1, Date.now());
      } else if (event.key === 'ArrowUp' || event.key === ' ' || event.key === 'Spacebar') {
        event.preventDefault();
        IdleCore.jumpRunner(state, Date.now());
      } else if (event.key === 'ArrowDown' || event.key === 'Control') {
        event.preventDefault();
        IdleCore.duckRunner(state, Date.now());
      }
    });

    var wrap = document.getElementById('idleTrackWrap');
    if (!wrap) return;
    var touchStartX = null;
    var touchStartY = null;
    wrap.addEventListener('touchstart', function (event) {
      if (!event.touches || event.touches.length === 0) return;
      touchStartX = event.touches[0].clientX;
      touchStartY = event.touches[0].clientY;
    }, { passive: true });
    wrap.addEventListener('touchend', function (event) {
      if (touchStartX === null || !event.changedTouches || event.changedTouches.length === 0) return;
      var dx = event.changedTouches[0].clientX - touchStartX;
      var dy = event.changedTouches[0].clientY - (touchStartY || 0);
      touchStartX = null;
      touchStartY = null;
      if (Math.abs(dx) >= RUNNER_SWIPE_THRESHOLD_PX && Math.abs(dx) >= Math.abs(dy)) {
        IdleCore.steerRunnerLane(state, dx < 0 ? -1 : 1, Date.now());
      } else if (Math.abs(dy) >= RUNNER_SWIPE_THRESHOLD_PX && Math.abs(dy) > Math.abs(dx)) {
        if (dy < 0) {
          IdleCore.jumpRunner(state, Date.now());
        } else {
          IdleCore.duckRunner(state, Date.now());
        }
      }
    }, { passive: true });
  }

  /* ============================================================
     RENN-STRECKE + TACHO (Canvas) — feat(idle-visuals)
     ============================================================ */

  /**
   * Passt die Backing-Store-Grösse eines Canvas an seine tatsächliche
   * CSS-Anzeigegrösse an (inkl. devicePixelRatio), damit Zeichnungen auf
   * hochauflösenden Displays nicht unscharf wirken.
   * @param {HTMLCanvasElement} canvas - Zu skalierendes Canvas-Element.
   * @returns {CanvasRenderingContext2D|null} 2D-Kontext des Canvas, oder null.
   */
  function resizeCanvasToDisplaySize(canvas) {
    if (!canvas) return null;
    var ratio = window.devicePixelRatio || 1;
    var width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    var height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    var ctx = canvas.getContext('2d');
    if (ctx) ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    return ctx;
  }

  /**
   * Löst die Canvas-Elemente (Strecke + Tacho) einmalig auf und skaliert
   * sie initial. Wird zusätzlich bei jedem Fenster-Resize erneut aufgerufen.
   * @returns {void}
   */
  function initCanvases() {
    trackCanvas = document.getElementById('idleTrackCanvas');
    tachoCanvas = document.getElementById('idleTachoCanvas');
    trackCtx = resizeCanvasToDisplaySize(trackCanvas);
    tachoCtx = resizeCanvasToDisplaySize(tachoCanvas);
    window.addEventListener('resize', function () {
      trackCtx = resizeCanvasToDisplaySize(trackCanvas);
      tachoCtx = resizeCanvasToDisplaySize(tachoCanvas);
    });
  }

  /**
   * Lineare Interpolation zwischen a und b.
   * @param {number} a - Startwert (t=0).
   * @param {number} b - Endwert (t=1).
   * @param {number} t - Fortschritt (0–1, wird nicht geklemmt).
   * @returns {number} Interpolierter Wert.
   */
  function lerpValue(a, b, t) {
    return a + (b - a) * t;
  }

  /**
   * Berechnet die x-Position einer (ggf. fraktionalen) Fahrspur bei einem
   * gegebenen Tiefen-Fortschritt t (0=Horizont, 1=Spieler-Reihe) — die
   * Strasse verjüngt sich zum Horizont hin (perspektivische Konvergenz),
   * siehe RUNNER_ROAD_WIDTH_TOP_PCT/RUNNER_ROAD_WIDTH_BOTTOM_PCT.
   * @param {number} w - Canvas-Breite (CSS-Pixel).
   * @param {number} laneIndexFloat - Fahrspur-Index (0-basiert, auch fraktional für Tweens).
   * @param {number} t - Tiefen-Fortschritt (0–1).
   * @returns {number} x-Position (CSS-Pixel).
   */
  function laneCenterX(w, laneIndexFloat, t) {
    var laneCount = IdleCore.IDLE_BALANCE.RUNNER_LANE_COUNT;
    var normalized = (laneIndexFloat + 0.5) / laneCount - 0.5;
    var roadWidth = lerpValue(w * RUNNER_ROAD_WIDTH_TOP_PCT, w * RUNNER_ROAD_WIDTH_BOTTOM_PCT, t);
    return w / 2 + normalized * roadWidth;
  }

  /**
   * Berechnet die y-Position bei einem gegebenen Tiefen-Fortschritt t
   * (0=Horizont, 1=Spieler-Reihe).
   * @param {number} h - Canvas-Höhe (CSS-Pixel).
   * @param {number} t - Tiefen-Fortschritt (0–1).
   * @returns {number} y-Position (CSS-Pixel).
   */
  function laneRowY(h, t) {
    return lerpValue(h * RUNNER_HORIZON_Y_PCT, h * RUNNER_PLAYER_ROW_Y_PCT, t);
  }

  /**
   * Fügt eine neue Hindernis-WELLE am Horizont (t=0) hinzu (Teil 3+4,
   * feat(obstacles)/feat(difficulty)): die Wellen-GRÖSSE (1 bis
   * laneCount-1 gleichzeitige Hindernisse auf UNTERSCHIEDLICHEN Lanes,
   * siehe IdleCore.runDifficultyWaveSize()) steigt mit der bereits
   * zurückgelegten In-Run-Distanz (state.run.distanceUnits) — ab Distanz-
   * Schwellenwerten spawnen dadurch KOMBINIERTE Muster (z. B. 'side' auf
   * einer Lane UND 'lowBar' auf einer anderen), IMMER mit mindestens
   * einer garantiert freien Lane (nie unmöglich/unfair). `lane` ist die
   * für die Kollisionsprüfung massgebliche (unveränderliche) Lane,
   * `displayLane` die für das Zeichnen genutzte, ggf. vom Magnet-Effekt
   * weich Richtung Bike-Lane gezogene Lane (siehe tickRunner()/
   * renderTrack()). `type` (Teil 3, feat(obstacles)) bestimmt die
   * passende Ausweich-Aktion: 'side' (Lane wechseln), 'lowBar'
   * (springen, IdleCore.jumpRunner()) oder 'highBarrier' (ducken,
   * IdleCore.duckRunner()) — siehe IdleCore.rollObstacleType()/
   * detectRunCollision().
   * @returns {void}
   */
  function spawnRunnerObstacle() {
    var laneCount = IdleCore.IDLE_BALANCE.RUNNER_LANE_COUNT;
    var waveSize = IdleCore.runDifficultyWaveSize(state.run.distanceUnits, laneCount);
    var availableLanes = [];
    for (var i = 0; i < laneCount; i++) availableLanes.push(i);
    for (var w = 0; w < waveSize && availableLanes.length > 0; w++) {
      var pickIndex = Math.floor(Math.random() * availableLanes.length);
      var lane = availableLanes.splice(pickIndex, 1)[0];
      var type = IdleCore.rollObstacleType(Math.random);
      runnerObstacles.push({ lane: lane, displayLane: lane, t: 0, resolved: false, type: type });
    }
  }

  /**
   * Fügt einen neuen Münz-Trail hinzu (Teil 4, feat(coins)) — eine
   * gerade Linie oder ein über Lanes wandernder Bogen (IdleCore.
   * generateCoinTrail()), gestaffelt in der Tiefe (negatives Start-`t`
   * pro Münze, siehe deren offsetT), sodass der Trail wie eine Perlen-
   * kette Richtung Spieler auf die Strecke läuft (siehe tickRunner()).
   * @returns {void}
   */
  function spawnCoinTrail() {
    var pattern = IdleCore.generateCoinTrail(Math.random, IdleCore.IDLE_BALANCE.RUNNER_LANE_COUNT);
    pattern.forEach(function (coinDef) {
      runnerCoins.push({ lane: coinDef.lane, displayLane: coinDef.lane, t: -coinDef.offsetT, resolved: false });
    });
  }

  /**
   * Löst den kurzen, dezenten Kollisions-Flash/Shake-Effekt auf der
   * Renn-Strecke aus (CSS-Klasse .is-collision, siehe idle.css) —
   * respektiert prefers-reduced-motion (das transform-Shake wird dort per
   * CSS deaktiviert, ein statischer Akzent-Rahmen bleibt als Feedback
   * erhalten).
   * @returns {void}
   */
  function triggerCollisionFeedback() {
    var wrap = document.getElementById('idleTrackWrap');
    if (!wrap) return;
    wrap.classList.remove('is-collision');
    // Reflow erzwingen, damit die Animation bei schnell aufeinanderfolgenden Treffern erneut startet.
    void wrap.offsetWidth;
    wrap.classList.add('is-collision');
    if (runnerCollisionFlashTimeoutId) clearTimeout(runnerCollisionFlashTimeoutId);
    runnerCollisionFlashTimeoutId = setTimeout(function () {
      wrap.classList.remove('is-collision');
    }, RUNNER_COLLISION_FLASH_MS);
  }

  /**
   * Löst den kurzen, POSITIVEN Schild-Block-Flash aus (CSS-Klasse
   * .is-shielded, siehe idle.css) UND einen Toast — Feedback dafür, dass
   * ein Schild-Powerup GENAU EINE Kollision geblockt hat (siehe
   * IdleCore.consumeShield()). Respektiert prefers-reduced-motion
   * identisch zu triggerCollisionFeedback() (nur ein statischer Akzent-
   * Rahmen, kein Shake).
   * @returns {void}
   */
  function triggerShieldFeedback() {
    var wrap = document.getElementById('idleTrackWrap');
    if (wrap) {
      wrap.classList.remove('is-shielded');
      void wrap.offsetWidth;
      wrap.classList.add('is-shielded');
      if (runnerCollisionFlashTimeoutId) clearTimeout(runnerCollisionFlashTimeoutId);
      runnerCollisionFlashTimeoutId = setTimeout(function () {
        wrap.classList.remove('is-shielded');
      }, POWERUP_SHIELD_FLASH_MS);
    }
    showPowerupBlockToast();
  }

  /**
   * Aktualisiert den kleinen "Aktiv"/"Auto-Pilot"-Badge über der Strecke,
   * NUR wenn sich der Aktivitäts-Zustand tatsächlich geändert hat
   * (vermeidet unnötige DOM-Schreibzugriffe in jedem Frame).
   * @param {('active'|'idle')} activity - Aktueller Runner-Aktivitäts-Zustand.
   * @returns {void}
   */
  function updateRunnerModeBadge(activity) {
    if (activity === runnerLastDisplayedActivity) return;
    runnerLastDisplayedActivity = activity;
    var badge = document.getElementById('idleTrackMode');
    if (!badge) return;
    badge.textContent = activity === 'idle' ? '🤖 Auto-Pilot' : '🎮 Aktiv';
    badge.classList.toggle('is-idle', activity === 'idle');
  }

  /**
   * Aktualisiert die live SCORE-HUD + die persistente Highscore-Anzeige
   * (Teil 4, feat(score)) — der angezeigte Score-Wert "tweent" (RUN_
   * SCORE_DISPLAY_EASE, bewusst deutlich schneller als die km-Anzeige,
   * damit ein Score-Zuwachs "auffällig schnell" hochzählt) Richtung des
   * tatsächlichen state.run.score, springt aber bei einer sehr kleinen
   * Restdifferenz (RUN_SCORE_DISPLAY_SNAP_THRESHOLD) direkt auf den
   * Zielwert (identisches Prinzip zu updateKmDisplay()). Die Highscore-
   * Anzeige selbst wird nicht getweent (sie ändert sich ohnehin nur beim
   * Run-Ende, siehe IdleCore.endRun()).
   * @returns {void}
   */
  function updateRunScoreHud() {
    var target = state.run.score;
    var diff = target - displayedRunScore;
    if (Math.abs(diff) < RUN_SCORE_DISPLAY_SNAP_THRESHOLD) {
      displayedRunScore = target;
    } else {
      displayedRunScore += diff * RUN_SCORE_DISPLAY_EASE;
    }
    var scoreEl = document.getElementById('idleRunScore');
    if (scoreEl) scoreEl.textContent = String(Math.floor(displayedRunScore));
    var highscoreEl = document.getElementById('idleRunHighscore');
    if (highscoreEl) highscoreEl.textContent = String(Math.floor(state.runHighscore));
  }

  /**
   * Aktualisiert die Near-Miss-Combo-HUD (Teil 4, feat(nearmiss)) —
   * zeigt die aktuelle Combo-Anzahl + den daraus abgeleiteten Score-
   * Multiplikator (state.run.comboMult, siehe IdleCore.
   * runComboMultiplier()), versteckt sich komplett bei Combo 0 (kein
   * Near-Miss seit Run-Start bzw. seit dem letzten Crash).
   * @returns {void}
   */
  function updateRunComboHud() {
    var badge = document.getElementById('idleRunComboBadge');
    if (!badge) return;
    var combo = state.run.combo || 0;
    badge.hidden = combo <= 0;
    if (combo <= 0) return;
    var countEl = document.getElementById('idleRunComboCount');
    var multEl = document.getElementById('idleRunComboMultiplier');
    if (countEl) countEl.textContent = '💨 Near-Miss ×' + combo;
    var activeMultiplier = state.run.comboMult || 1;
    if (multEl) multEl.textContent = activeMultiplier > 1 ? ('· Score ×' + formatMultiplier(activeMultiplier)) : '';
  }

  /**
   * Zeigt das kurze "Knapp vorbei!"-Near-Miss-Popup über der Strecke
   * (Teil 4, feat(nearmiss)) — respektiert prefers-reduced-motion (nur
   * ein sanftes Ein-/Ausblenden statt der zusätzlichen Aufstiegs-
   * Bewegung, siehe idle.css).
   * @param {number} bonus - Gutgeschriebener Score-Bonus (siehe IdleCore.registerNearMiss()).
   * @returns {void}
   */
  function showNearMissPopup(bonus) {
    var popup = document.getElementById('idleNearMissPopup');
    if (!popup) return;
    popup.textContent = '💨 Knapp vorbei! +' + Math.floor(bonus);
    popup.classList.remove('is-visible');
    void popup.offsetWidth;
    popup.classList.add('is-visible');
    if (nearMissPopupTimeoutId) clearTimeout(nearMissPopupTimeoutId);
    nearMissPopupTimeoutId = setTimeout(function () {
      popup.classList.remove('is-visible');
    }, NEAR_MISS_POPUP_MS);
  }

  /**
   * Verbucht einen erkannten Near-Miss (Teil 4, feat(nearmiss)) —
   * IdleCore.registerNearMiss() (Combo/Score-Bonus, reine Zustands-
   * Mutation) + die dazugehörige UI (Popup + Combo-HUD).
   * @param {number} nowMs - Zeitstempel "jetzt" in ms.
   * @returns {void}
   */
  function triggerNearMiss(nowMs) {
    var result = IdleCore.registerNearMiss(state, nowMs);
    showNearMissPopup(result.bonus);
    updateRunComboHud();
  }

  /**
   * Berechnet die verbleibenden Sekunden eines Powerup-Effekts bis zu
   * seinem *ExpiresAt-Zeitstempel (Teil 4, feat(powerups)) — 0, falls
   * inaktiv/abgelaufen. Reine Hilfsfunktion für die Timer-HUD.
   * @param {?number} expiresAt - Ablauf-Zeitstempel (ms) oder null.
   * @param {number} nowMs - Zeitstempel "jetzt" in ms.
   * @returns {number} Verbleibende Sekunden (>= 0).
   */
  function powerupRemainingSeconds(expiresAt, nowMs) {
    if (typeof expiresAt !== 'number' || nowMs >= expiresAt) return 0;
    return (expiresAt - nowMs) / 1000;
  }

  /**
   * Aktualisiert die Powerup-Timer-HUD (Teil 4, feat(powerups)) — jeder
   * der 4 Typen (Magnet/Schild/Turbo/Score-x2) zeigt EIN Badge mit Icon +
   * verbleibenden Sekunden, NUR solange sein Effekt aktiv ist (mirrors
   * das bestehende "kein UI ohne aktiven Zustand"-Prinzip, siehe
   * .idle-combo-badge[hidden]).
   * @param {number} nowMs - Zeitstempel "jetzt" in ms.
   * @returns {void}
   */
  function updatePowerupHud(nowMs) {
    var hud = document.getElementById('idlePowerupHud');
    if (!hud) return;
    var expiresAtByType = {
      magnet: state.powerups.magnetExpiresAt,
      schild: state.powerups.shieldExpiresAt,
      turbo: state.powerups.turboExpiresAt,
      scoreX2: state.powerups.scoreX2ExpiresAt,
    };
    var anyActive = false;
    POWERUP_HUD_TYPES.forEach(function (type) {
      var badge = document.getElementById('idlePowerupHud-' + type);
      if (!badge) return;
      var remaining = powerupRemainingSeconds(expiresAtByType[type], nowMs);
      var active = remaining > 0;
      badge.hidden = !active;
      if (active) {
        anyActive = true;
        var timerEl = badge.querySelector('.idle-powerup-hud-timer');
        if (timerEl) timerEl.textContent = Math.ceil(remaining) + 's';
      }
    });
    hud.classList.toggle('is-empty', !anyActive);
  }

  /**
   * Behandelt einen tatsächlichen Crash (Teil 3, feat(crash)) — beendet
   * den laufenden Run (IdleCore.endRun(), der EINZIGE Punkt, an dem
   * gesammelte Run-Coins der PROGRESS-Schicht gutgeschrieben werden),
   * speichert sofort, löst den bestehenden Kollisions-Flash aus,
   * aktualisiert die Anzeige (km/Shop-Freischaltungen können sich durch
   * die Gutschrift ändern) und zeigt die Crash-Zusammenfassung mit
   * Score/Coins/ggf. neuem Highscore samt "Nochmal fahren"-Button.
   * @param {number} nowMs - Zeitstempel "jetzt" in ms.
   * @returns {void}
   */
  function handleRunCrash(nowMs) {
    var summary = IdleCore.endRun(state, nowMs);
    ApiClient.saveIdleState(state);
    triggerCollisionFeedback();
    renderAll();
    checkIdleAchievements();
    // Teil 4 (feat(nearmiss)): endRun() resettet state.run.combo auf 0 —
    // die Combo-HUD soll das SOFORT widerspiegeln (nicht erst beim
    // nächsten Near-Miss nach dem Neustart).
    updateRunComboHud();
    showCrashSummary(summary);
  }

  /**
   * Zeigt die Crash-Zusammenfassung-Dialog (Teil 3, feat(crash)): Score,
   * gesammelte Coins (bereits über IdleCore.endRun() in km umgewandelt)
   * und — falls erreicht — den "Neuer Highscore!"-Hinweis.
   * @param {{score: number, coins: number, newHighscore: boolean}} summary - Ergebnis von IdleCore.endRun().
   * @returns {void}
   */
  function showCrashSummary(summary) {
    var overlay = document.getElementById('idleRunSummary');
    if (!overlay) return;
    var scoreEl = document.getElementById('idleRunSummaryScore');
    var coinsEl = document.getElementById('idleRunSummaryCoins');
    var highscoreEl = document.getElementById('idleRunSummaryHighscore');
    if (scoreEl) scoreEl.textContent = String(Math.floor(summary.score));
    if (coinsEl) coinsEl.textContent = String(Math.floor(summary.coins));
    if (highscoreEl) highscoreEl.hidden = !summary.newHighscore;
    overlay.hidden = false;
    window.requestAnimationFrame(function () { overlay.classList.add('is-visible'); });
  }

  /**
   * Blendet die Crash-Zusammenfassung wieder aus (nach "Nochmal fahren").
   * @returns {void}
   */
  function hideCrashSummary() {
    var overlay = document.getElementById('idleRunSummary');
    if (!overlay) return;
    overlay.classList.remove('is-visible');
    overlay.hidden = true;
  }

  /**
   * Startet einen neuen Run nach einer angezeigten Crash-Zusammenfassung
   * ("Nochmal fahren", Teil 3, feat(crash)): IdleCore.restartRun() setzt
   * die Run-Schicht zurück, die transiente Laufzeit-Hindernisliste (mirrors
   * runnerObstacles-Reset bei jedem Seitenaufruf) wird ebenfalls geleert,
   * damit der neue Run auf einer leeren Strecke beginnt.
   * @returns {void}
   */
  function restartRunAndResume() {
    IdleCore.restartRun(state, Date.now());
    runnerObstacles = [];
    runnerSpawnTimerSeconds = IdleCore.nextObstacleSpawnIntervalSeconds(0, Math.random, 0);
    runnerLapProgressUnits = 0;
    runnerBikeDisplayLane = state.runner.lane;
    // Teil 4 (feat(coins)/feat(score)/feat(nearmiss)): Münz-Trails + Score-
    // Anzeige + Near-Miss-Combo-HUD gehören zur transienten RUN-Schicht und
    // resetten dadurch identisch zu runnerObstacles/runnerLapProgressUnits.
    runnerCoins = [];
    runnerCoinSpawnTimerSeconds = IdleCore.nextCoinTrailIntervalSeconds(Math.random);
    displayedRunScore = 0;
    updateRunComboHud();
    hideCrashSummary();
    ApiClient.saveIdleState(state);
  }

  /**
   * Verdrahtet den "Nochmal fahren"-Button der Crash-Zusammenfassung.
   * @returns {void}
   */
  function wireRunSummaryButtons() {
    var btn = document.getElementById('idleRunSummaryRestartBtn');
    if (!btn) return;
    btn.addEventListener('click', restartRunAndResume);
  }

  /**
   * EIN Game-Loop-Tick des Endless-Runners (Teil 1 + Teil 2 + Teil 3):
   * bestimmt den Aktivitäts-Zustand (aktiv/Auto-Run, siehe IdleCore.
   * runnerActivityState()) und den rein visuellen Kollisions-Malus (siehe
   * IdleCore.collisionSpeedMalus()), rückt alle Hindernisse entsprechend
   * der daraus abgeleiteten Scroll-Geschwindigkeit vor, wertet Kollisionen
   * NUR im aktiven Modus aus (Auto-Pilot "sieht" Hindernisse NIE — dieselbe
   * Prüfung wird für den Auto-Piloten schlicht nie ausgeführt, wodurch er
   * PROVABLY nie crashen kann), spawnt neue Hindernisse (Dichte/Intervall
   * skaliert mit der Geschwindigkeit) und löst Distanz-Meilensteine aus.
   *
   * Teil 3 (feat(crash)) ersetzt den früheren, niemals scheiternden
   * applyCollisionMalus()-Pfad: ein Treffer eines 'side'/'lowBar'/
   * 'highBarrier'-Hindernisses OHNE die passende Ausweich-Aktion (Lane-
   * Wechsel/Sprung/Ducken) UND ohne aktiven Schild beendet über
   * handleRunCrash() den Run (siehe IdleCore.detectRunCollision()).
   * Solange KEIN Run läuft (state.run.phase !== 'running' — z. B. während
   * die Crash-Zusammenfassung angezeigt wird), wird die gesamte Strecke
   * EINGEFROREN (kein Vorrücken/Spawn/Wirtschaft) und 0 zurückgegeben.
   * Der frühere kontinuierliche km-Drip ist entfernt — die Run-Wirtschaft
   * (Score/Coins) läuft jetzt über IdleCore.tickRunEconomy() (siehe dessen
   * Docblock: aktiv sammelt NUR in state.run, Auto-Pilot bankt reduziert
   * kontinuierlich in km).
   *
   * Teil 2 (feat(powerups)/balance(tuning)) unverändert: Turbo hebt die
   * effektive Geschwindigkeit temporär an (POWERUP_TURBO_SPEED_BOOST_PCT,
   * NIEMALS die globale RUNNER_SPEED_CAP_PCT-Konstante selbst mutiert);
   * Magnet zieht Hindernisse ab IdleCore.powerupMagnetRangeT() weich
   * Richtung Bike-Lane (nur `displayLane`, NICHT die für die Kollision
   * massgebliche `lane`) und lässt sie dadurch die Kollisionsprüfung
   * überspringen; die Tuning-PERK-Reaktionszeit (IdleCore.
   * tuningReactionTimeFactor()) verlangsamt den Hindernis-FORTSCHRITT
   * (nicht die Strassen-Scroll-Geschwindigkeit selbst).
   * @param {number} dtSeconds - Verstrichene Zeit seit dem letzten Frame (Sekunden, gedeckelt).
   * @param {number} speedPct - Aktuelle (reale) Geschwindigkeit des Bikes (0–100%).
   * @returns {number} Die für die Strecken-Darstellung zu nutzende visuelle Geschwindigkeit (0–100%, idle-gedeckelt + Kollisions-Malus, 0 falls kein Run läuft).
   */
  function tickRunner(dtSeconds, speedPct) {
    var now = Date.now();
    IdleCore.ensureRunState(state);
    var activity = IdleCore.runnerActivityState(state, now);
    updateRunnerModeBadge(activity);

    if (state.run.phase !== 'running') {
      return 0;
    }

    var turboOn = IdleCore.turboActive(state, now);
    var boostedSpeedPct = turboOn ? Math.min(100, speedPct + IdleCore.IDLE_BALANCE.POWERUP_TURBO_SPEED_BOOST_PCT) : speedPct;
    var baseSpeedPct = activity === 'idle' ? IdleCore.runnerAutoRunSpeedPct(boostedSpeedPct) : boostedSpeedPct;
    var malus = IdleCore.collisionSpeedMalus(state, now);
    var visualSpeedPct = baseSpeedPct * malus;
    var scrollSpeed = IdleCore.runnerScrollSpeed(visualSpeedPct);
    var reactionFactor = IdleCore.tuningReactionTimeFactor(state);
    var progressDelta = dtSeconds > 0 ? (scrollSpeed * dtSeconds * reactionFactor) / IdleCore.IDLE_BALANCE.RUNNER_SPAWN_LEAD_DISTANCE : 0;

    var magnetOn = IdleCore.magnetActive(state, now);
    var magnetRangeT = magnetOn ? IdleCore.powerupMagnetRangeT(state) : null;
    var pullEase = Math.min(1, RUNNER_LANE_EASE_PER_SECOND * dtSeconds);

    var crashedThisTick = false;

    // Hindernisse vorrücken, im aktiven Modus einmalig auf Kollision prüfen, vorbeigefahrene entfernen.
    for (var i = runnerObstacles.length - 1; i >= 0; i--) {
      var obstacle = runnerObstacles[i];
      obstacle.t += progressDelta;

      // Magnet: zieht Hindernisse ab der Reichweiten-Schwelle NUR visuell
      // (displayLane) Richtung Bike-Lane — die für die Kollision
      // massgebliche `lane` bleibt unverändert, magnetSaved entscheidet
      // stattdessen direkt, ob die Kollision übersprungen wird.
      var magnetSaved = magnetOn && obstacle.t >= magnetRangeT;
      if (magnetSaved) {
        obstacle.displayLane += (state.runner.lane - obstacle.displayLane) * pullEase;
      } else {
        obstacle.displayLane = obstacle.lane;
      }

      // Teil 4 (feat(nearmiss)): JEDES Hindernis, das die HIT-Zone erreicht
      // (nicht nur solche in der Bike-Lane), wird auf einen Near-Miss
      // geprüft — 'side' in einer benachbarten Lane, ODER (im sameLane-
      // Zweig unten) ein 'lowBar'/'highBarrier' sauber per Sprung/Ducken/
      // Turbo pariert. Near-Misses zählen NUR im aktiven Modus (Auto-Pilot
      // evaluiert grundsätzlich keine Kollision, siehe Teil-1-Invariante).
      if (!obstacle.resolved && obstacle.t >= RUNNER_HIT_ZONE_T) {
        obstacle.resolved = true;
        var sameLane = !magnetSaved && obstacle.lane === state.runner.lane;
        if (activity === 'active' && !crashedThisTick && sameLane) {
          var collisionResult = IdleCore.detectRunCollision(state, obstacle.type, now);
          if (collisionResult.shielded) {
            triggerShieldFeedback();
          } else if (collisionResult.crashed) {
            crashedThisTick = true;
            handleRunCrash(now);
          } else if (IdleCore.isNearMiss(state, obstacle, now)) {
            triggerNearMiss(now);
          }
        } else if (activity === 'active' && !magnetSaved && IdleCore.isNearMiss(state, obstacle, now)) {
          triggerNearMiss(now);
        }
      }
      if (obstacle.t >= RUNNER_OBSTACLE_REMOVE_T) runnerObstacles.splice(i, 1);
    }

    if (crashedThisTick) {
      return visualSpeedPct;
    }

    // Münz-Trails (Teil 4, feat(coins)): vorrücken, bei Lane-Überlappung
    // (oder aktivem Magnet-Effekt — zieht nahegelegene Münzen zusätzlich
    // zu Hindernissen ein, siehe magnetOn oben) automatisch einsammeln,
    // vorbeigefahrene entfernen. Läuft UNABHÄNGIG vom Aktivitäts-Zustand —
    // Münzen sind reine Belohnungen ohne Kollisionsrisiko, daher auch im
    // Auto-Pilot eingesammelt (identisches "Idle-Spieler:innen nie
    // benachteiligen"-Prinzip wie an anderer Stelle im Idle-Racer).
    for (var ci = runnerCoins.length - 1; ci >= 0; ci--) {
      var coin = runnerCoins[ci];
      coin.t += progressDelta;

      var coinMagnetSaved = magnetOn && coin.t >= magnetRangeT;
      if (coinMagnetSaved) {
        coin.displayLane += (state.runner.lane - coin.displayLane) * pullEase;
      } else {
        coin.displayLane = coin.lane;
      }

      if (!coin.resolved && coin.t >= RUNNER_HIT_ZONE_T) {
        coin.resolved = true;
        if (coin.lane === state.runner.lane || coinMagnetSaved) {
          IdleCore.collectRunCoin(state, now);
        }
      }
      if (coin.t >= RUNNER_OBSTACLE_REMOVE_T) runnerCoins.splice(ci, 1);
    }

    // Run-Wirtschaft (Teil 3, feat(run)): bankt Score/Coins für die in
    // diesem Tick zurückgelegte Distanz (siehe IdleCore.tickRunEconomy()) —
    // Teil 4: der Score-Zuwachs berücksichtigt jetzt automatisch den
    // aktuellen Near-Miss-Combo-Multiplikator + einen ggf. aktiven
    // Score-x2-Effekt (siehe deren Docblock).
    IdleCore.tickRunEconomy(state, scrollSpeed * dtSeconds, activity, now);

    // Spawn-Timer (mit Restzeit-Übertrag, falls ein einzelner Tick mehrere Intervalle überspringt).
    // Teil 4 (feat(difficulty)): die In-Run-Distanz (state.run.distanceUnits)
    // fliesst über runDifficultyDensity() zusätzlich in die Dichte ein —
    // wirkt NUR auf dieses Intervall, NIEMALS auf runnerLeadSeconds()' Boden.
    if (dtSeconds > 0) {
      runnerSpawnTimerSeconds -= dtSeconds;
      while (runnerSpawnTimerSeconds <= 0) {
        spawnRunnerObstacle();
        runnerSpawnTimerSeconds += IdleCore.nextObstacleSpawnIntervalSeconds(visualSpeedPct, Math.random, state.run.distanceUnits);
      }
      runnerCoinSpawnTimerSeconds -= dtSeconds;
      while (runnerCoinSpawnTimerSeconds <= 0) {
        spawnCoinTrail();
        runnerCoinSpawnTimerSeconds += IdleCore.nextCoinTrailIntervalSeconds(Math.random);
      }
    }

    // Distanz-Meilenstein (ersetzt die frühere Runden-Erkennung der Oval-Strecke).
    runnerLapProgressUnits += scrollSpeed * dtSeconds;
    var lapDistance = IdleCore.IDLE_BALANCE.RUNNER_LAP_DISTANCE_UNITS;
    while (runnerLapProgressUnits >= lapDistance) {
      runnerLapProgressUnits -= lapDistance;
      onLapCompleted();
    }

    return visualSpeedPct;
  }

  /**
   * Rendert EINEN Frame der Endless-Runner-Straße (Teil 1): eine
   * perspektivische 2–3-Lane-Strasse (Horizont oben, Spieler-Reihe unten),
   * auf der Hindernisse Richtung Spieler vorrücken. Das Bike wechselt
   * weich (getweent) zwischen den Lanes; im Auto-Pilot-Modus wird der
   * Bike-Marker dezent transparenter dargestellt. Rein zeichnende
   * Funktion — die eigentliche Spiel-Logik (Vorrücken/Spawn/Kollision)
   * läuft bereits vorher in tickRunner().
   * @param {number} dtSeconds - Verstrichene Zeit seit dem letzten Frame (Sekunden, gedeckelt) — nur für den Lane-Wechsel-Tween.
   * @param {number} visualSpeedPct - Von tickRunner() berechnete visuelle Geschwindigkeit (0–100%).
   * @returns {void}
   */
  function renderTrack(dtSeconds, visualSpeedPct) {
    if (!trackCtx || !trackCanvas) return;
    var w = trackCanvas.clientWidth;
    var h = trackCanvas.clientHeight;
    if (w <= 0 || h <= 0) return;

    // Bike-Lane weich nachziehen (Tween), analog zum Tacho-Nadel-Ease-Muster.
    var targetLane = state.runner.lane;
    var laneEase = Math.min(1, RUNNER_LANE_EASE_PER_SECOND * dtSeconds);
    runnerBikeDisplayLane += (targetLane - runnerBikeDisplayLane) * laneEase;
    if (Math.abs(targetLane - runnerBikeDisplayLane) < 0.01) runnerBikeDisplayLane = targetLane;

    trackCtx.clearRect(0, 0, w, h);

    var laneCount = IdleCore.IDLE_BALANCE.RUNNER_LANE_COUNT;
    var topY = h * RUNNER_HORIZON_Y_PCT, bottomY = h * RUNNER_PLAYER_ROW_Y_PCT;
    var topWidth = w * RUNNER_ROAD_WIDTH_TOP_PCT, bottomWidth = w * RUNNER_ROAD_WIDTH_BOTTOM_PCT;
    var cx = w / 2;

    // Horizont-Linie (dezent).
    trackCtx.beginPath();
    trackCtx.moveTo(cx - topWidth / 2, topY);
    trackCtx.lineTo(cx + topWidth / 2, topY);
    trackCtx.strokeStyle = 'rgba(150,150,150,0.2)';
    trackCtx.lineWidth = Math.max(1, h * 0.005);
    trackCtx.stroke();

    // Fahrbahn-Aussenkanten (konvergierendes Trapez).
    trackCtx.beginPath();
    trackCtx.moveTo(cx - topWidth / 2, topY);
    trackCtx.lineTo(cx - bottomWidth / 2, bottomY);
    trackCtx.moveTo(cx + topWidth / 2, topY);
    trackCtx.lineTo(cx + bottomWidth / 2, bottomY);
    trackCtx.strokeStyle = 'rgba(150,150,150,0.35)';
    trackCtx.lineWidth = Math.max(1, h * 0.008);
    trackCtx.stroke();

    // Lane-Trenner (laneCount-1 innere Linien).
    for (var lane = 1; lane < laneCount; lane++) {
      var frac = lane / laneCount - 0.5;
      trackCtx.beginPath();
      trackCtx.moveTo(cx + frac * topWidth, topY);
      trackCtx.lineTo(cx + frac * bottomWidth, bottomY);
      trackCtx.strokeStyle = 'rgba(150,150,150,0.22)';
      trackCtx.lineWidth = Math.max(1, h * 0.004);
      trackCtx.stroke();
    }

    // Münz-Trails (Teil 4, feat(coins)): VOR den Hindernissen gezeichnet
    // (kleine goldene Kreise, dieselbe Lane-Geometrie wie Hindernisse) —
    // t < 0 (noch nicht "erschienen", siehe spawnCoinTrail()' gestaffelter
    // Versatz) wird schlicht nicht gezeichnet.
    var sortedCoins = runnerCoins.slice().sort(function (a, b) { return a.t - b.t; });
    sortedCoins.forEach(function (coin) {
      if (coin.t < 0) return;
      var ct = Math.min(1, Math.max(0, coin.t));
      var cx2 = laneCenterX(w, coin.displayLane, ct);
      var cy2 = laneRowY(h, ct);
      var coinSize = lerpValue(RUNNER_OBSTACLE_MIN_SIZE_PX, RUNNER_OBSTACLE_MAX_SIZE_PX, ct) * 0.55;
      trackCtx.beginPath();
      trackCtx.arc(cx2, cy2, coinSize, 0, Math.PI * 2);
      trackCtx.fillStyle = 'rgba(234,179,8,0.9)';
      trackCtx.strokeStyle = 'rgba(161,98,7,0.9)';
      trackCtx.lineWidth = 1;
      trackCtx.fill();
      trackCtx.stroke();
    });

    // Hindernisse: weiter entfernte zuerst zeichnen, damit näherliegende oben liegen.
    // Teil 3 (feat(obstacles)): DREI Typen, jeweils eine eigene Form/Position
    // innerhalb derselben Lane-Geometrie (laneCenterX()/laneRowY() unverändert) —
    // 'side' (Lane wechseln, wie bisher ein zentriertes Quadrat), 'lowBar'
    // (springen — flacher Balken UNTEN, man springt darüber) und 'highBarrier'
    // (ducken — flacher Balken OBEN, man duckt darunter).
    var sortedObstacles = runnerObstacles.slice().sort(function (a, b) { return a.t - b.t; });
    sortedObstacles.forEach(function (obstacle) {
      var t = Math.min(1, Math.max(0, obstacle.t));
      // displayLane statt lane: bei aktivem Magnet-Effekt weich Richtung
      // Bike-Lane gezogen (rein visuell — siehe tickRunner()), sonst
      // identisch zu obstacle.lane.
      var x = laneCenterX(w, obstacle.displayLane, t);
      var y = laneRowY(h, t);
      var size = lerpValue(RUNNER_OBSTACLE_MIN_SIZE_PX, RUNNER_OBSTACLE_MAX_SIZE_PX, t);
      var type = obstacle.type || 'side';

      trackCtx.beginPath();
      if (type === 'lowBar') {
        var barW = size * 1.7, barH = size * 0.55;
        trackCtx.rect(x - barW / 2, y + size / 2 - barH, barW, barH);
        trackCtx.fillStyle = 'rgba(0,112,243,0.55)';
        trackCtx.strokeStyle = 'rgba(0,112,243,0.85)';
      } else if (type === 'highBarrier') {
        var topW = size * 1.7, topH = size * 0.55;
        trackCtx.rect(x - topW / 2, y - size / 2, topW, topH);
        trackCtx.fillStyle = 'rgba(120,120,120,0.75)';
        trackCtx.strokeStyle = 'rgba(90,90,90,0.9)';
      } else {
        trackCtx.rect(x - size / 2, y - size / 2, size, size);
        trackCtx.fillStyle = 'rgba(241,241,239,0.85)';
        trackCtx.strokeStyle = 'rgba(150,150,150,0.5)';
      }
      trackCtx.lineWidth = 1;
      trackCtx.fill();
      trackCtx.stroke();
    });

    // Speed-Lines entlang der Strasse ab spürbarem Tempo (respektiert prefers-reduced-motion).
    if (!reducedMotion && visualSpeedPct >= TRACK_SPEED_LINES_THRESHOLD_PCT) {
      for (var laneIdx = 0; laneIdx < laneCount; laneIdx++) {
        var lineT = 0.55;
        var lx = laneCenterX(w, laneIdx, lineT);
        var ly = laneRowY(h, lineT);
        trackCtx.beginPath();
        trackCtx.moveTo(lx, ly - h * 0.05);
        trackCtx.lineTo(lx, ly + h * 0.05);
        trackCtx.strokeStyle = 'rgba(0,112,243,0.18)';
        trackCtx.lineWidth = 2;
        trackCtx.stroke();
      }
    }

    // Bike-Marker (Vercel-Akzent) — dezent transparenter im Auto-Pilot-Modus.
    // Teil 3 (feat(controls)): ein aktiver Sprung hebt den Marker sichtbar an
    // (springt über ein 'lowBar'-Hindernis), ein aktives Ducken staucht ihn
    // nach unten (duckt unter ein 'highBarrier'-Hindernis) — rein visuelles
    // Feedback, die eigentliche Kollisionslogik lebt in IdleCore.detectRunCollision().
    var bikeX = laneCenterX(w, runnerBikeDisplayLane, 1);
    var bikeY = bottomY;
    var bikeRadius = Math.max(6, h * 0.07);
    var nowForBike = Date.now();
    var activity = IdleCore.runnerActivityState(state, nowForBike);
    if (IdleCore.isJumping(state, nowForBike)) {
      bikeY -= bikeRadius * 1.4;
    } else if (IdleCore.isDucking(state, nowForBike)) {
      bikeY += bikeRadius * 0.25;
      bikeRadius *= 0.7;
    }
    trackCtx.globalAlpha = activity === 'idle' ? 0.7 : 1;
    trackCtx.beginPath();
    trackCtx.arc(bikeX, bikeY, bikeRadius, 0, Math.PI * 2);
    trackCtx.fillStyle = '#0070f3';
    trackCtx.shadowColor = reducedMotion ? 'transparent' : 'rgba(0,112,243,0.75)';
    trackCtx.shadowBlur = reducedMotion ? 0 : 10;
    trackCtx.fill();
    trackCtx.shadowBlur = 0;
    trackCtx.globalAlpha = 1;
  }

  /**
   * Rendert EINEN Frame des Halbkreis-Tachos: zeichnet Skalenstriche +
   * eine weich nachlaufende Nadel, die sich zur aktuellen Geschwindigkeit
   * des Bikes hin bewegt (siehe deriveBikeStats().geschwindigkeitPct).
   * Ein Bike-Wechsel/-Kauf erzeugt dadurch automatisch einen sichtbaren
   * Nadel-Sweep vom alten zum neuen Wert.
   * @param {number} speedPct - Ziel-Geschwindigkeit des Bikes (0–100%).
   * @param {number} kmh - Anzuzeigende km/h-Zahl (rein informativ).
   * @returns {void}
   */
  function renderTacho(speedPct, kmh) {
    if (!tachoCtx || !tachoCanvas) return;
    var w = tachoCanvas.clientWidth;
    var h = tachoCanvas.clientHeight;
    if (w <= 0 || h <= 0) return;

    var diff = speedPct - tachoDisplayPct;
    tachoDisplayPct += diff * TACHO_NEEDLE_EASE;
    if (Math.abs(diff) < 0.05) tachoDisplayPct = speedPct;

    var cx = w / 2, cy = h * 0.92;
    var radius = Math.min(w * 0.46, h * 0.85);

    tachoCtx.clearRect(0, 0, w, h);

    // Skalenbogen + feine Skalenstriche (Halbkreis, 180°→0°).
    tachoCtx.beginPath();
    tachoCtx.arc(cx, cy, radius, Math.PI, 0, false);
    tachoCtx.lineWidth = Math.max(2, radius * 0.04);
    tachoCtx.strokeStyle = 'rgba(150,150,150,0.35)';
    tachoCtx.stroke();

    var tickCount = 24;
    for (var i = 0; i <= tickCount; i++) {
      var tickAngle = Math.PI - (i / tickCount) * Math.PI;
      var isMajor = i % 4 === 0;
      var inner = radius * (isMajor ? 0.82 : 0.9);
      var outer = radius * 0.98;
      tachoCtx.beginPath();
      tachoCtx.moveTo(cx + Math.cos(tickAngle) * inner, cy - Math.sin(tickAngle) * inner);
      tachoCtx.lineTo(cx + Math.cos(tickAngle) * outer, cy - Math.sin(tickAngle) * outer);
      tachoCtx.lineWidth = isMajor ? 2 : 1;
      tachoCtx.strokeStyle = 'rgba(156,156,158,0.6)';
      tachoCtx.stroke();
    }

    // Nadel.
    var needleAngle = Math.PI - (tachoDisplayPct / 100) * Math.PI;
    var needleLen = radius * 0.78;
    tachoCtx.beginPath();
    tachoCtx.moveTo(cx, cy);
    tachoCtx.lineTo(cx + Math.cos(needleAngle) * needleLen, cy - Math.sin(needleAngle) * needleLen);
    tachoCtx.lineWidth = Math.max(2, radius * 0.05);
    tachoCtx.lineCap = 'round';
    tachoCtx.strokeStyle = '#1f6d4a';
    tachoCtx.stroke();

    tachoCtx.beginPath();
    tachoCtx.arc(cx, cy, Math.max(3, radius * 0.07), 0, Math.PI * 2);
    tachoCtx.fillStyle = '#1f6d4a';
    tachoCtx.fill();

    // km/h-Zahl.
    tachoCtx.fillStyle = '#9c9c9e';
    tachoCtx.font = (Math.max(10, radius * 0.16)) + 'px sans-serif';
    tachoCtx.textAlign = 'center';
    tachoCtx.fillText(Math.round(kmh) + ' km/h', cx, cy - radius * 0.22);
  }

  /**
   * Zeigt kurz das "Neues Bike in der Garage"-Übergabe-Banner über der
   * Strecke an und löst einen Zoom-Puls des Strecken-Containers aus. Die
   * Tacho-Nadel sweept dabei automatisch vom alten zum neuen Wert (siehe
   * renderTacho()'s Easing zusammen mit dem geänderten currentBikeId).
   * @param {Object} bike - Das neu gekaufte Bike (IDLE_BIKES-Eintrag).
   * @returns {void}
   */
  function triggerBikeHandover(bike) {
    var banner = document.getElementById('idleHandover');
    var trackWrap = document.getElementById('idleTrackWrap');
    if (banner) {
      banner.textContent = '🏁 Neues Bike in der Garage: ' + bike.name;
      banner.classList.add('is-visible');
      if (handoverTimeoutId) clearTimeout(handoverTimeoutId);
      handoverTimeoutId = setTimeout(function () {
        banner.classList.remove('is-visible');
      }, HANDOVER_BANNER_MS);
    }
    if (trackWrap && !reducedMotion) {
      trackWrap.classList.remove('is-pulsing');
      void trackWrap.offsetWidth;
      trackWrap.classList.add('is-pulsing');
    }
  }

  /* ============================================================
     WEB AUDIO MOTORSOUND (synthetisiert) — feat(idle-sound)
     ============================================================ */

  /**
   * Prüft, ob die Web Audio API im aktuellen Browser verfügbar ist.
   * @returns {boolean} true, falls AudioContext (ggf. mit webkit-Präfix) existiert.
   */
  function hasWebAudio() {
    return !!(window.AudioContext || window.webkitAudioContext);
  }

  /**
   * Erzeugt (einmalig, lazy) den synthetisierten Motorsound-Signalgraph als
   * angenehmen, tonalen Synth-Pad: zwei leicht verstimmte Dreieck-
   * Oszillatoren ("Chorus"-Schweben statt harter Sägezahn-Kante) + ein
   * Sub-Sinus eine Oktave tiefer für Wärme, gemeinsam durch ein sanftes
   * Tiefpassfilter geführt und mit einer langsamen Lautstärke-LFO
   * ("Atmen") moduliert, zusammengeführt in einem Master-Gain (initial
   * stumm). Priorität ist "angenehm zu hören" — der Klang muss nicht nach
   * Motorrad klingen. MUSS erst nach einer Nutzer-Geste aufgerufen werden
   * (Autoplay-Policy).
   * @returns {AudioContext|null} Der aktive AudioContext, oder null falls Web Audio fehlt.
   */
  function ensureAudioEngine() {
    if (!hasWebAudio()) return null;
    if (!audioCtx) {
      try {
        var AudioCtxCtor = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioCtxCtor();

        masterGain = audioCtx.createGain();
        masterGain.gain.value = 0;
        masterGain.connect(audioCtx.destination);

        // Langsame Lautstärke-LFO (Tremolo) direkt vor dem Master-Gain —
        // gibt dem Pad ein ruhiges "Atmen" statt einer statischen Fläche.
        tremoloGain = audioCtx.createGain();
        tremoloGain.gain.value = 1;
        tremoloGain.connect(masterGain);

        // Gemeinsames Tiefpassfilter für alle Ton-Schichten — nimmt harte
        // obere Frequenzanteile, macht den Klang weich statt schneidend.
        toneFilter = audioCtx.createBiquadFilter();
        toneFilter.type = 'lowpass';
        toneFilter.Q.value = 0.4;
        toneFilter.frequency.value = ENGINE_FILTER_BASE_HZ;
        toneFilter.connect(tremoloGain);

        engineOsc = audioCtx.createOscillator();
        engineOsc.type = 'triangle';
        engineOsc.frequency.value = ENGINE_BASE_HZ;
        engineOsc.connect(toneFilter);
        engineOsc.start();

        // Zweite Ton-Schicht, minimal verstimmt — mildes Chorus-Schweben,
        // KEINE Dissonanz (nur wenige Cent Abstand).
        chorusOsc = audioCtx.createOscillator();
        chorusOsc.type = 'triangle';
        chorusOsc.frequency.value = ENGINE_BASE_HZ;
        chorusOsc.detune.value = ENGINE_CHORUS_DETUNE_CENTS;
        var chorusGain = audioCtx.createGain();
        chorusGain.gain.value = 0.6;
        chorusOsc.connect(chorusGain);
        chorusGain.connect(toneFilter);
        chorusOsc.start();

        subOsc = audioCtx.createOscillator();
        subOsc.type = 'sine';
        subOsc.frequency.value = ENGINE_BASE_HZ / 2;
        var subGain = audioCtx.createGain();
        subGain.gain.value = 0.5;
        subOsc.connect(subGain);
        subGain.connect(toneFilter);
        subOsc.start();

        // LFO-Oszillator moduliert die Tremolo-Gain direkt (AudioParam-
        // Verbindung) — sehr langsam + flach, kein hörbares "Pumpen".
        lfoOsc = audioCtx.createOscillator();
        lfoOsc.type = 'sine';
        lfoOsc.frequency.value = ENGINE_TREMOLO_RATE_HZ;
        var lfoDepthGain = audioCtx.createGain();
        lfoDepthGain.gain.value = ENGINE_TREMOLO_DEPTH;
        lfoOsc.connect(lfoDepthGain);
        lfoDepthGain.connect(tremoloGain.gain);
        lfoOsc.start();
      } catch (e) {
        audioCtx = null;
        return null;
      }
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  /**
   * Aktualisiert Frequenz, Filter-Helligkeit und Lautstärke des
   * Motorsounds gemäss der aktuellen Geschwindigkeit UND dem
   * Sound-EIN/AUS-/Lautstärke-Zustand. Tonhöhe UND Filter-Helligkeit
   * steigen nur SUBTIL mit `speedPct` (schnell soll sich schneller
   * anfühlen, ohne grell/gehetzt zu klingen). Sanfte Übergänge per
   * setTargetAtTime (kein hörbares Klicken). No-op, falls der Motor noch
   * nie gestartet wurde (Sound war nie aktiviert).
   * @param {number} speedPct - Aktuelle Geschwindigkeit des Bikes (0–100%).
   * @returns {void}
   */
  function updateEngineSound(speedPct) {
    if (!audioCtx || !engineOsc || !chorusOsc || !subOsc || !masterGain || !toneFilter) return;
    var now = audioCtx.currentTime;
    var targetHz = ENGINE_BASE_HZ + (speedPct / 100) * ENGINE_RANGE_HZ;
    engineOsc.frequency.setTargetAtTime(targetHz, now, ENGINE_SMOOTH_TIME_CONSTANT);
    chorusOsc.frequency.setTargetAtTime(targetHz, now, ENGINE_SMOOTH_TIME_CONSTANT);
    subOsc.frequency.setTargetAtTime(targetHz / 2, now, ENGINE_SMOOTH_TIME_CONSTANT);

    var targetFilterHz = ENGINE_FILTER_BASE_HZ + (speedPct / 100) * ENGINE_FILTER_RANGE_HZ;
    toneFilter.frequency.setTargetAtTime(targetFilterHz, now, ENGINE_SMOOTH_TIME_CONSTANT);

    var targetGain = state.sound.enabled ? state.sound.volume * ENGINE_MAX_GAIN : 0;
    masterGain.gain.setTargetAtTime(targetGain, now, ENGINE_SMOOTH_TIME_CONSTANT);
  }

  /**
   * Löst einen kurzen, dezenten "Rev-up"-Effekt aus (sanfte Frequenz-
   * Spitze, die wieder zur aktuellen Geschwindigkeit zurückklingt), beim
   * Klick auf "Gas geben". No-op, falls Sound nicht aktiviert/erzeugt ist.
   * @returns {void}
   */
  function revUpEngineSound() {
    if (!audioCtx || !engineOsc || !chorusOsc || !state.sound.enabled) return;
    var now = audioCtx.currentTime;
    var info = getCurrentBikeInfo();
    var baseHz = ENGINE_BASE_HZ + (info.stats.geschwindigkeitPct / 100) * ENGINE_RANGE_HZ;
    engineOsc.frequency.cancelScheduledValues(now);
    chorusOsc.frequency.cancelScheduledValues(now);
    engineOsc.frequency.setValueAtTime(baseHz + ENGINE_REV_UP_BOOST_HZ, now);
    chorusOsc.frequency.setValueAtTime(baseHz + ENGINE_REV_UP_BOOST_HZ, now);
    engineOsc.frequency.setTargetAtTime(baseHz, now + 0.02, ENGINE_REV_UP_DECAY_SECONDS);
    chorusOsc.frequency.setTargetAtTime(baseHz, now + 0.02, ENGINE_REV_UP_DECAY_SECONDS);
  }

  /**
   * Verdrahtet den Motorsound-Toggle-Button + Lautstärke-Regler. Erzeugt
   * den AudioContext erst beim ersten Einschalten (Nutzer-Geste, siehe
   * Autoplay-Policy). Persistiert EIN/AUS + Lautstärke in state.sound.
   * @returns {void}
   */
  function wireSoundControls() {
    var toggleBtn = document.getElementById('idleSoundToggle');
    var volumeInput = document.getElementById('idleSoundVolume');
    if (!toggleBtn || !volumeInput) return;

    if (!hasWebAudio()) {
      toggleBtn.disabled = true;
      toggleBtn.textContent = '🔇 Motorsound nicht verfügbar';
      volumeInput.disabled = true;
      return;
    }

    volumeInput.value = String(Math.round((state.sound.volume || 0) * 100));

    function refreshToggleLabel() {
      toggleBtn.setAttribute('aria-pressed', state.sound.enabled ? 'true' : 'false');
      toggleBtn.textContent = state.sound.enabled ? '🔊 Motorsound: AN' : '🔈 Motorsound: AUS';
    }
    refreshToggleLabel();

    toggleBtn.addEventListener('click', function () {
      ensureAudioEngine();
      state.sound.enabled = !state.sound.enabled;
      ApiClient.saveIdleState(state);
      refreshToggleLabel();
      updateEngineSound(getCurrentBikeInfo().stats.geschwindigkeitPct);
    });

    volumeInput.addEventListener('input', function () {
      state.sound.volume = Math.max(0, Math.min(100, Number(volumeInput.value) || 0)) / 100;
      updateEngineSound(getCurrentBikeInfo().stats.geschwindigkeitPct);
    });
    volumeInput.addEventListener('change', function () {
      ApiClient.saveIdleState(state);
    });
  }

  /* ============================================================
     SCHALTPUNKT-COMBO (MECHANIK A) — feat(idle-combo) UI-Wiring
     ============================================================ */

  /**
   * Aktualisiert die dauerhafte Combo-/Multiplikator-Anzeige unterhalb der
   * Renn-Strecke (ausgeblendet, solange Combo 0 ist).
   * @returns {void}
   */
  function updateComboBadge() {
    var badge = document.getElementById('idleComboBadge');
    var countEl = document.getElementById('idleComboCount');
    var multEl = document.getElementById('idleComboMultiplier');
    if (!badge || !countEl || !multEl) return;

    if (!state.combo || state.combo.count <= 0) {
      badge.hidden = true;
      return;
    }
    badge.hidden = false;
    countEl.textContent = '🔥 Combo ×' + state.combo.count;
    var activeMultiplier = IdleCore.activeComboMultiplier(state, Date.now());
    multEl.textContent = activeMultiplier > 1 ? ('· Multiplikator ×' + formatMultiplier(activeMultiplier)) : '';
  }

  /**
   * Formatiert einen Multiplikator ohne unnötige Nachkommastelle (z. B.
   * 2 statt "2.0", aber 2.5 bleibt "2.5").
   * @param {number} value - Roh-Multiplikator.
   * @returns {string} Formatierte Zeichenkette.
   */
  function formatMultiplier(value) {
    return (Math.round(value * 10) / 10).toString().replace(/\.0$/, '');
  }

  /**
   * Startet eine neue Schaltpunkt-Leiste: berechnet die (mit steigender
   * Combo schrumpfende) perfekte Zone per IdleCore.perfectZoneWidth() und
   * macht die Leiste sichtbar/interaktiv.
   * @returns {void}
   */
  function startShift() {
    shiftState.active = true;
    shiftState.elapsedSeconds = 0;
    shiftState.resultShown = false;
    shiftState.zoneWidthPct = IdleCore.perfectZoneWidthForState(state, state.combo ? state.combo.count : 0);

    var zoneEl = document.getElementById('idleShiftZone');
    var trackEl = document.getElementById('idleShiftTrack');
    var wrapEl = document.getElementById('idleShift');
    var halfWidth = shiftState.zoneWidthPct / 2;
    if (zoneEl) {
      zoneEl.style.left = (SHIFT_ZONE_CENTER_PCT - halfWidth) + '%';
      zoneEl.style.width = shiftState.zoneWidthPct + '%';
    }
    if (trackEl) trackEl.classList.remove('is-hit', 'is-miss');
    if (wrapEl) {
      wrapEl.classList.add('is-active');
      wrapEl.setAttribute('aria-hidden', 'false');
    }
    renderShiftMarker(0);
  }

  /**
   * Positioniert den Schaltpunkt-Marker gemäss dem Sweep-Fortschritt.
   * @param {number} progressPct - Fortschritt des Marker-Durchlaufs (0–100).
   * @returns {void}
   */
  function renderShiftMarker(progressPct) {
    var markerEl = document.getElementById('idleShiftMarker');
    if (markerEl) markerEl.style.left = progressPct + '%';
  }

  /**
   * Beendet die aktuell aktive Schaltpunkt-Leiste. Bei einem tatsächlichen
   * Klick (isIgnore=false) wird IdleCore.applyShiftResult() aufgerufen und
   * ein kurzer Treffer-/Fehlklick-Flash gezeigt; läuft die Leiste
   * unbeklickt ab (isIgnore=true), wird NICHTS an der Combo verändert
   * (keine Strafe fürs Ignorieren) und die Leiste blendet sofort aus.
   * @param {boolean} hit - true, falls im grünen Bereich geklickt wurde.
   * @param {boolean} isIgnore - true, falls die Leiste unbeklickt abgelaufen ist.
   * @returns {void}
   */
  function endShift(hit, isIgnore) {
    if (shiftState.resultShown) return;
    shiftState.resultShown = true;

    var trackEl = document.getElementById('idleShiftTrack');
    if (!isIgnore) {
      IdleCore.applyShiftResult(state, hit, Date.now());
      IdleCore.recordComboPeak(state, state.combo.count);
      ApiClient.saveIdleState(state);
      if (trackEl) trackEl.classList.add(hit ? 'is-hit' : 'is-miss');
      renderAll();
      updateComboBadge();
    }

    var wrapEl = document.getElementById('idleShift');
    setTimeout(function () {
      if (wrapEl) {
        wrapEl.classList.remove('is-active');
        wrapEl.setAttribute('aria-hidden', 'true');
      }
      shiftState.active = false;
      shiftTimerSeconds = IdleCore.nextShiftIntervalSeconds();
    }, isIgnore ? 0 : SHIFT_RESULT_FLASH_MS);
  }

  /**
   * Wertet einen Klick/Tastendruck auf die aktuell aktive Schaltpunkt-
   * Leiste aus: prüft, ob sich der Marker gerade innerhalb der perfekten
   * Zone befindet, und beendet die Leiste entsprechend als Treffer/Fehlklick.
   * @returns {void}
   */
  function evaluateShiftClick() {
    if (!shiftState.active || shiftState.resultShown) return;
    var progressPct = Math.min(100, (shiftState.elapsedSeconds / IdleCore.IDLE_BALANCE.SHIFT_SWEEP_DURATION_SECONDS) * 100);
    var half = shiftState.zoneWidthPct / 2;
    var hit = progressPct >= (SHIFT_ZONE_CENTER_PCT - half) && progressPct <= (SHIFT_ZONE_CENTER_PCT + half);
    endShift(hit, false);
  }

  /**
   * Verdrahtet die Klick-/Tastatur-Interaktion (Enter/Leertaste) der
   * Schaltpunkt-Leiste.
   * @returns {void}
   */
  function wireShiftInteraction() {
    var trackEl = document.getElementById('idleShiftTrack');
    if (!trackEl) return;
    trackEl.addEventListener('click', evaluateShiftClick);
    trackEl.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        evaluateShiftClick();
      }
    });
  }

  /**
   * EIN Game-Loop-Tick der Schaltpunkt-Leiste: zählt entweder bis zur
   * nächsten zufälligen Leiste herunter, oder lässt den Marker der
   * aktiven Leiste weiterwandern und wertet ein unbeklicktes Ablaufen
   * (Ignorieren, keine Strafe) als solches aus.
   * @param {number} dtSeconds - Verstrichene Zeit seit dem letzten Frame (Sekunden, gedeckelt).
   * @returns {void}
   */
  function tickShift(dtSeconds) {
    if (!shiftState.active) {
      shiftTimerSeconds -= dtSeconds;
      if (shiftTimerSeconds <= 0) startShift();
      return;
    }
    shiftState.elapsedSeconds += dtSeconds;
    var progressPct = Math.min(100, (shiftState.elapsedSeconds / IdleCore.IDLE_BALANCE.SHIFT_SWEEP_DURATION_SECONDS) * 100);
    renderShiftMarker(progressPct);
    if (progressPct >= 100 && !shiftState.resultShown) {
      endShift(false, true);
    }
  }

  /* ============================================================
     MECHANIK B — SAISON & WERKSVERTRÄGE — feat(idle-prestige)
     ============================================================ */

  /**
   * Rendert die Saison-Übersicht (Saisonnummer, Trophäen, projizierte
   * Trophäen bei Abschluss) sowie den "Saison abschliessen"-Button
   * (nur aktiviert, wenn IdleCore.canFinishSeason() zustimmt) inkl.
   * erklärendem Hinweistext.
   * @returns {void}
   */
  function renderSeasonPanel() {
    var numberEl = document.getElementById('idleSeasonNumber');
    var trophiesEl = document.getElementById('idleSeasonTrophies');
    var projectedEl = document.getElementById('idleSeasonProjected');
    var finishBtn = document.getElementById('idleFinishSeasonBtn');
    var hintEl = document.getElementById('idleSeasonHint');

    if (numberEl) numberEl.textContent = String((state.prestige.level || 0) + 1);
    if (trophiesEl) trophiesEl.textContent = String(state.prestige.trophies || 0);
    var projected = IdleCore.trophiesForSeason(state);
    if (projectedEl) projectedEl.textContent = '+' + projected + ' 🏆';

    var canFinish = IdleCore.canFinishSeason(state);
    if (finishBtn) finishBtn.disabled = !canFinish;
    if (hintEl) {
      hintEl.textContent = canFinish
        ? 'Setzt km und besessene Bikes zurück — Trophäen, Werksverträge, Teile und Statistiken bleiben erhalten.'
        : 'Verfügbar, sobald du die Kawasaki Ninja ZX-10R besitzt.';
    }

    renderContractsList();
  }

  /**
   * Rendert die Werksverträge-Liste: besessene Verträge (Abzeichen),
   * kaufbare Verträge ("Kaufen"-Button) und noch unerreichbare Verträge
   * (Preis-Anzeige, deaktiviert).
   * @returns {void}
   */
  function renderContractsList() {
    var list = document.getElementById('idleContractsList');
    if (!list) return;
    list.innerHTML = '';

    IdleCore.IDLE_CONTRACTS.forEach(function (contract) {
      var owned = state.prestige.contracts.indexOf(contract.id) !== -1;

      var item = document.createElement('div');
      item.className = 'idle-contract-item' + (owned ? ' is-owned' : '');

      var info = document.createElement('div');
      info.className = 'idle-contract-item-info';
      var h4 = document.createElement('h4');
      h4.textContent = contract.name;
      var p = document.createElement('p');
      p.textContent = contract.beschreibung;
      info.appendChild(h4);
      info.appendChild(p);
      item.appendChild(info);

      var action = document.createElement('div');
      action.className = 'idle-contract-item-action';

      if (owned) {
        var badge = document.createElement('span');
        badge.className = 'idle-contract-badge';
        badge.textContent = '✅ Aktiv';
        action.appendChild(badge);
      } else {
        var buyBtn = document.createElement('button');
        buyBtn.type = 'button';
        buyBtn.className = 'btn-outline';
        buyBtn.textContent = 'Kaufen — ' + contract.kostenTrophaeen + ' 🏆';
        buyBtn.disabled = !IdleCore.canBuyContract(state, contract.id);
        buyBtn.addEventListener('click', function () {
          var result = IdleCore.buyContract(state, contract.id);
          if (result.success) {
            ApiClient.saveIdleState(state);
            renderAll();
          }
        });
        action.appendChild(buyBtn);
      }

      item.appendChild(action);
      list.appendChild(item);
    });
  }

  /**
   * Verdrahtet den "Saison abschliessen"-Button: zeigt einen klaren
   * deutschen Bestätigungsdialog (was zurückgesetzt wird vs. was
   * dauerhaft erhalten bleibt) und führt bei Bestätigung
   * IdleCore.finishSeason() aus. Ersetzt die lokale state-Referenz durch
   * den neuen, zurückgesetzten Zustand.
   * @returns {void}
   */
  function wireSeasonControls() {
    var finishBtn = document.getElementById('idleFinishSeasonBtn');
    if (!finishBtn) return;
    finishBtn.addEventListener('click', function () {
      if (!IdleCore.canFinishSeason(state)) return;
      var projected = IdleCore.trophiesForSeason(state);
      var confirmed = window.confirm(
        'Saison abschliessen?\n\n' +
        'Zurückgesetzt werden: deine Kilometer (km) und alle besessenen Bikes ' +
        '(du startest wieder beim Startbike bzw. dem Bike aus einem aktiven Werksvertrag).\n\n' +
        'Erhalten bleiben: Trophäen (+' + projected + ' 🏆 durch diese Saison), ' +
        'Werksverträge, deine Teile-Sammlung und alle Statistiken.'
      );
      if (!confirmed) return;
      state = IdleCore.finishSeason(state);
      ApiClient.saveIdleState(state);
      renderAll();
      checkIdleAchievements();
    });
  }

  /* ============================================================
     TEILE-SAMMLUNG — feat(idle-parts)
     ============================================================ */

  /**
   * Rendert die Teile-Sammlung, gruppiert nach Set: besessene Teile
   * farbig, fehlende als Silhouette; pro Set wird dessen Ertrags-Bonus
   * gezeigt (hervorgehoben, sobald das Set komplett ist).
   * @returns {void}
   */
  function renderPartsPanel() {
    var container = document.getElementById('idlePartsSets');
    if (!container) return;
    container.innerHTML = '';

    var owned = state.parts.collected;

    IdleCore.IDLE_PART_SETS.forEach(function (set) {
      var partsInSet = IdleCore.IDLE_PARTS.filter(function (p) { return p.setId === set.id; });
      var allOwned = partsInSet.length > 0 && partsInSet.every(function (p) { return owned.indexOf(p.id) !== -1; });

      var card = document.createElement('div');
      card.className = 'idle-part-set' + (allOwned ? ' is-complete' : '');

      var header = document.createElement('div');
      header.className = 'idle-part-set-header';
      var h4 = document.createElement('h4');
      h4.textContent = set.name;
      var bonus = document.createElement('span');
      bonus.className = 'idle-part-set-bonus';
      bonus.textContent = (allOwned ? '✅ ' : '') + '+' + set.bonusPct + '% Ertrag';
      header.appendChild(h4);
      header.appendChild(bonus);
      card.appendChild(header);

      var itemsRow = document.createElement('div');
      itemsRow.className = 'idle-part-set-items';
      partsInSet.forEach(function (part) {
        var isOwned = owned.indexOf(part.id) !== -1;
        var chip = document.createElement('div');
        chip.className = 'idle-part-chip ' + (isOwned ? 'is-owned' : 'is-missing');
        chip.title = isOwned ? part.name : 'Noch nicht gefunden';

        var icon = document.createElement('span');
        icon.textContent = PART_RARITY_ICONS[part.rarity] || '⚙️';
        var label = document.createElement('span');
        label.className = 'idle-part-chip-label';
        label.textContent = isOwned ? part.name : '???';

        chip.appendChild(icon);
        chip.appendChild(label);
        itemsRow.appendChild(chip);
      });
      card.appendChild(itemsRow);

      container.appendChild(card);
    });
  }

  /**
   * Zeigt einen kurzen Toast für einen Teile-Drop: neues Teil oder
   * (bei einer Dublette) die umgewandelte km-Gutschrift.
   * @param {{isNew: boolean, awardedKm: number, part: Object}} result - Ergebnis von IdleCore.addPart().
   * @returns {void}
   */
  function showPartToast(result) {
    var container = document.getElementById('idleToastContainer');
    if (!container || !result || !result.part) return;

    var toast = document.createElement('div');
    toast.className = 'idle-toast';
    toast.textContent = result.isNew
      ? '🎁 Neues Teil gefunden: ' + result.part.name
      : '♻️ Dublette umgewandelt: ' + result.part.name + ' (+' + formatKm(result.awardedKm) + ' km)';
    container.appendChild(toast);

    window.requestAnimationFrame(function () { toast.classList.add('is-visible'); });
    setTimeout(function () {
      toast.classList.remove('is-visible');
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 400);
    }, PART_TOAST_VISIBLE_MS);
  }

  /**
   * Wird bei jedem erreichten Distanz-Meilenstein des Endless-Runners
   * aufgerufen (siehe tickRunner()'s Distanz-Trigger, ersetzt die frühere
   * rundenbasierte Auslösung der Oval-Strecke): zählt die Runden-
   * Statistik hoch und würfelt einen möglichen Teile-Drop (IdleCore.rollPartDrop).
   * Bei einem Drop wird das Teil hinzugefügt (oder als Dublette in km
   * umgewandelt), gespeichert, die Sammlung neu gerendert und ein Toast
   * gezeigt.
   * @returns {void}
   */
  function onLapCompleted() {
    IdleCore.recordLap(state);
    renderStatsPanel();
    var partId = IdleCore.rollPartDrop(Math.random);
    if (partId) {
      var result = IdleCore.addPart(state, partId);
      ApiClient.saveIdleState(state);
      renderPartsPanel();
      renderBikeCard();
      showPartToast(result);
    }
  }

  /* ============================================================
     AUSRÜSTUNGS-SAMMLUNG (GEAR) — feat(idle-gear)
     ============================================================ */

  /**
   * Rendert die Ausrüstungs-Sammlung, gruppiert nach Kategorie: besessene
   * Items farbig MIT dezentem Seltenheits-Farbakzent, fehlende als
   * Silhouette (identisches Muster zu renderPartsPanel()); pro Kategorie
   * wird deren Set-Bonus gezeigt (hervorgehoben, sobald komplett).
   * @returns {void}
   */
  function renderGearPanel() {
    var container = document.getElementById('idleGearSets');
    if (!container) return;
    container.innerHTML = '';

    var owned = state.gear.collected;

    IdleCore.IDLE_GEAR_SETS.forEach(function (set) {
      var itemsInSet = IdleCore.IDLE_GEAR_ITEMS.filter(function (i) { return i.setId === set.id; });
      var allOwned = itemsInSet.length > 0 && itemsInSet.every(function (i) { return owned.indexOf(i.id) !== -1; });

      var card = document.createElement('div');
      card.className = 'idle-gear-set' + (allOwned ? ' is-complete' : '');

      var header = document.createElement('div');
      header.className = 'idle-gear-set-header';
      var h4 = document.createElement('h4');
      h4.textContent = set.name;
      var bonus = document.createElement('span');
      bonus.className = 'idle-gear-set-bonus';
      bonus.textContent = (allOwned ? '✅ ' : '') + '+' + set.bonusPct + '% Set-Bonus';
      header.appendChild(h4);
      header.appendChild(bonus);
      card.appendChild(header);

      var itemsRow = document.createElement('div');
      itemsRow.className = 'idle-gear-set-items';
      itemsInSet.forEach(function (item) {
        var isOwned = owned.indexOf(item.id) !== -1;
        var chip = document.createElement('div');
        chip.className = 'idle-gear-chip idle-gear-rarity-' + item.rarity + ' ' + (isOwned ? 'is-owned' : 'is-missing');
        chip.title = isOwned ? (item.name + ' (+' + item.bonusPct + '% Ertrag)') : 'Noch nicht gefunden';

        var icon = document.createElement('span');
        icon.textContent = GEAR_RARITY_ICONS[item.rarity] || '🎽';
        var label = document.createElement('span');
        label.className = 'idle-gear-chip-label';
        label.textContent = isOwned ? item.name : '???';

        chip.appendChild(icon);
        chip.appendChild(label);
        itemsRow.appendChild(chip);
      });
      card.appendChild(itemsRow);

      container.appendChild(card);
    });
  }

  /**
   * Zeigt einen kurzen Toast für einen Ausrüstungs-Drop: neues Item oder
   * (bei einer Dublette) die umgewandelte km-Gutschrift. Nutzt denselben
   * Toast-Container/dieselbe CSS-Klasse wie showPartToast().
   * @param {{isNew: boolean, awardedKm: number, part: Object}} result - Ergebnis von IdleCore.addGear().
   * @returns {void}
   */
  function showGearToast(result) {
    var container = document.getElementById('idleToastContainer');
    if (!container || !result || !result.part) return;

    var toast = document.createElement('div');
    toast.className = 'idle-toast';
    toast.textContent = result.isNew
      ? '🎽 Neue Ausrüstung: ' + result.part.name
      : '♻️ Ausrüstungs-Dublette umgewandelt: ' + result.part.name + ' (+' + formatKm(result.awardedKm) + ' km)';
    container.appendChild(toast);

    window.requestAnimationFrame(function () { toast.classList.add('is-visible'); });
    setTimeout(function () {
      toast.classList.remove('is-visible');
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 400);
    }, PART_TOAST_VISIBLE_MS);
  }

  /* ============================================================
     WERKSTATTRECHNUNGEN + INSOLVENZ (MECHANIK A) — feat(idle-bills)
     ============================================================ */

  /**
   * Rendert das Rechnungs-Panel: versteckt es, solange keine Rechnung
   * aktiv ist, zeigt sonst Betrag + Zahlen-Button (deaktiviert, falls
   * nicht genug km vorhanden sind) und aktualisiert den Countdown.
   * @returns {void}
   */
  function renderBillPanel() {
    var panel = document.getElementById('idleBillPanel');
    var amountEl = document.getElementById('idleBillAmount');
    var payBtn = document.getElementById('idleBillPayBtn');
    if (!panel) return;

    if (!billState.active) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    if (amountEl) amountEl.textContent = formatKm(billState.amount);
    if (payBtn) payBtn.disabled = state.km < billState.amount;
    renderBillCountdown();
  }

  /**
   * Aktualisiert Countdown-Text, Fortschrittsbalken UND die (blinkfreie,
   * sanft driftende) Warnfarb-Intensität des aktiven Rechnungs-Panels,
   * je knapper die Restzeit wird. Kein Fortschritt/keine aktive Rechnung
   * → No-op.
   * @returns {void}
   */
  function renderBillCountdown() {
    if (!billState.active) return;
    var panel = document.getElementById('idleBillPanel');
    var countdownEl = document.getElementById('idleBillCountdown');
    var fillEl = document.getElementById('idleBillProgressFill');

    var remain = Math.max(0, billState.secondsRemaining);
    if (countdownEl) countdownEl.textContent = Math.ceil(remain) + 's';

    var pct = billState.totalSeconds > 0 ? Math.max(0, Math.min(100, (remain / billState.totalSeconds) * 100)) : 0;
    if (fillEl) fillEl.style.width = pct + '%';

    // Driftet sanft Richtung gedämpfter Warnfarbe (rgba(200,60,60,…), siehe
    // idle.css .idle-shift-track.is-miss-Präzedenzfall), je weniger Zeit
    // bleibt — KEIN Blinken, nur eine kontinuierliche Intensität (0–1).
    var urgency = 1 - pct / 100;
    if (panel) panel.style.setProperty('--idle-bill-warn', urgency.toFixed(3));
  }

  /**
   * Startet eine neue, fällige Werkstattrechnung: berechnet Betrag
   * (IdleCore.billAmount) + Zahlungsfenster (IdleCore.billGraceSeconds),
   * persistiert deren Eckdaten SOFORT in state.finance (anti-"schnelles
   * Neuladen dodged die Rechnung", siehe restoreOrForgiveActiveBill())
   * und macht das Panel sichtbar.
   * @returns {void}
   */
  function startBill() {
    var amount = IdleCore.billAmount(state);
    var grace = IdleCore.billGraceSeconds();
    state.finance.activeBillAmount = amount;
    state.finance.activeBillGraceSeconds = grace;
    state.finance.activeBillDueAt = Date.now() + grace * 1000;
    billState = { active: true, amount: amount, totalSeconds: grace, secondsRemaining: grace };
    renderBillPanel();
    ApiClient.saveIdleState(state);
  }

  /**
   * Beendet eine BEZAHLTE Rechnung: löscht die persistierten activeBill*-
   * Felder, würfelt das Intervall bis zur nächsten Rechnung neu, und
   * blendet das Panel nach dem kurzen "Bezahlt!"-Stempel-Effekt aus.
   * @returns {void}
   */
  function endBill() {
    state.finance.activeBillAmount = null;
    state.finance.activeBillDueAt = null;
    state.finance.activeBillGraceSeconds = null;
    billTimerSeconds = IdleCore.nextBillIntervalSeconds(state);
    setTimeout(function () {
      billState = { active: false, amount: 0, totalSeconds: 0, secondsRemaining: 0 };
      var panel = document.getElementById('idleBillPanel');
      if (panel) panel.hidden = true;
      var stamp = document.getElementById('idleBillPaidStamp');
      if (stamp) {
        stamp.classList.remove('is-visible');
        stamp.hidden = true;
      }
    }, BILL_PAID_STAMP_MS);
  }

  /**
   * Zeigt den kurzen "Bezahlt!"-Stempel-Effekt nach einer erfolgreichen
   * Zahlung (transform/opacity, respektiert prefers-reduced-motion via CSS).
   * @returns {void}
   */
  function showBillPaidStamp() {
    var stamp = document.getElementById('idleBillPaidStamp');
    if (!stamp) return;
    stamp.hidden = false;
    void stamp.offsetWidth; // Reflow erzwingen, damit die Transition bei erneuter Anzeige greift.
    stamp.classList.add('is-visible');
  }

  /**
   * Zeigt den nicht-punitiven Insolvenz-Hinweis ("Saison zurückgesetzt,
   * frischer Neustart") kurz an und blendet ihn danach automatisch aus.
   * @returns {void}
   */
  function showInsolvencyNotice() {
    var notice = document.getElementById('idleInsolvencyNotice');
    if (!notice) return;
    notice.hidden = false;
    window.requestAnimationFrame(function () { notice.classList.add('is-visible'); });
    setTimeout(function () {
      notice.classList.remove('is-visible');
      setTimeout(function () { notice.hidden = true; }, 400);
    }, BILL_INSOLVENCY_NOTICE_MS);
  }

  /**
   * Verarbeitet eine unbezahlt abgelaufene Werkstattrechnung: löst
   * IdleCore.triggerInsolvency() aus (ein normaler, NICHT-punitiver
   * Saison-Reset) und ersetzt die lokale state-Referenz durch den neuen
   * Zustand — exakt das Aufrufer-Muster von wireSeasonControls().
   * @returns {void}
   */
  function handleInsolvency() {
    state = IdleCore.triggerInsolvency(state);
    billState = { active: false, amount: 0, totalSeconds: 0, secondsRemaining: 0 };
    billTimerSeconds = IdleCore.nextBillIntervalSeconds(state);
    var panel = document.getElementById('idleBillPanel');
    if (panel) panel.hidden = true;
    ApiClient.saveIdleState(state);
    showInsolvencyNotice();
    renderAll();
    checkIdleAchievements();
  }

  /**
   * Verdrahtet den "Jetzt bezahlen"-Button des Rechnungs-Panels: manuelle
   * Frühzahlung ist jederzeit während des Zahlungsfensters möglich, nicht
   * nur kurz vor Ablauf.
   * @returns {void}
   */
  function wireBillPayButton() {
    var btn = document.getElementById('idleBillPayBtn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (!billState.active) return;
      var lastSecond = billState.secondsRemaining <= IdleCore.IDLE_BALANCE.BILL_LAST_SECOND_THRESHOLD_SECONDS;
      var result = IdleCore.payBill(state, true, lastSecond, Math.random);
      if (!result.success) return;

      showBillPaidStamp();
      if (result.gearResult && result.gearResult.part) {
        renderGearPanel();
        showGearToast(result.gearResult);
      }
      endBill();
      renderAll();
      ApiClient.saveIdleState(state);
      checkIdleAchievements();
    });
  }

  /**
   * EIN Game-Loop-Tick der Werkstattrechnungen: zählt entweder bis zur
   * nächsten fälligen Rechnung herunter (startBill() bei Ablauf), oder
   * lässt die Restzeit der aktiven Rechnung weiterlaufen (rendert den
   * Countdown) und löst bei Ablauf handleInsolvency() aus. Tickt NUR,
   * während die Seite offen/im Vordergrund ist (dtSeconds stammt aus dem
   * rAF-Loop) — Abwesenheit allein kann daher NIE eine Insolvenz auslösen
   * (siehe restoreOrForgiveActiveBill() für die Lade-seitige Fairness).
   * @param {number} dtSeconds - Verstrichene Zeit seit dem letzten Frame (Sekunden, gedeckelt).
   * @returns {void}
   */
  function tickBill(dtSeconds) {
    if (!billState.active) {
      billTimerSeconds -= dtSeconds;
      if (billTimerSeconds <= 0) startBill();
      return;
    }
    billState.secondsRemaining -= dtSeconds;
    renderBillCountdown();
    if (billState.secondsRemaining <= 0) {
      handleInsolvency();
    }
  }

  /* ============================================================
     SPARSCHWEINE ZERSCHLAGEN (MECHANIK B) — feat(idle-piggybanks)
     ============================================================ */

  /**
   * Zeigt einen kurzen Toast für ein zerschlagenes Sparschwein (km-Bonus).
   * Nutzt denselben Toast-Container/dieselbe CSS-Klasse wie showPartToast()/
   * showGearToast().
   * @param {{kmBonus: number}} result - Ergebnis von IdleCore.smashPiggybank().
   * @returns {void}
   */
  function showPiggyToast(result) {
    var container = document.getElementById('idleToastContainer');
    if (!container || !result) return;

    var toast = document.createElement('div');
    toast.className = 'idle-toast';
    toast.textContent = '🐷 Sparschwein zerschlagen — +' + formatKm(result.kmBonus) + ' km';
    container.appendChild(toast);

    window.requestAnimationFrame(function () { toast.classList.add('is-visible'); });
    setTimeout(function () {
      toast.classList.remove('is-visible');
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 400);
    }, PART_TOAST_VISIBLE_MS);
  }

  /**
   * Lässt ein neues Sparschwein an einer zufälligen Position innerhalb der
   * Renn-Strecke erscheinen, für piggyVisibleSeconds() Sekunden klickbar.
   * @returns {void}
   */
  function spawnPiggy() {
    var el = document.getElementById('idlePiggy');
    if (!el) return;

    piggyState.active = true;
    piggyState.elapsedSeconds = 0;
    piggyState.visibleSeconds = IdleCore.piggyVisibleSeconds(Math.random);

    var leftPct = PIGGY_POSITION_MARGIN_PCT + Math.random() * (100 - 2 * PIGGY_POSITION_MARGIN_PCT);
    var topPct = PIGGY_POSITION_MARGIN_PCT + Math.random() * (100 - 2 * PIGGY_POSITION_MARGIN_PCT);
    el.style.left = leftPct + '%';
    el.style.top = topPct + '%';

    el.classList.remove('is-smashed');
    el.classList.add('is-visible');
    el.setAttribute('aria-hidden', 'false');
    el.tabIndex = 0;
  }

  /**
   * Lässt das aktuell sichtbare Sparschwein wieder verschwinden (unbeklickt
   * abgelaufen ODER kurz nach dem Zerschlagen-Effekt) und würfelt das
   * Intervall bis zum nächsten Sparschwein neu. Ein unbeklickt despawntes
   * Sparschwein ist KEINE Strafe — identisches Muster wie eine ignorierte
   * Schaltpunkt-Leiste (endShift(..., true)).
   * @returns {void}
   */
  function despawnPiggy() {
    var el = document.getElementById('idlePiggy');
    if (el) {
      el.classList.remove('is-visible');
      el.setAttribute('aria-hidden', 'true');
      el.tabIndex = -1;
    }
    piggyState.active = false;
    piggyTimerSeconds = IdleCore.nextPiggyIntervalSeconds(Math.random);
  }

  /**
   * Zerschlägt das aktuell sichtbare Sparschwein: verbucht km-Bonus +
   * eventuellen Gear-Drop (IdleCore.smashPiggybank()), zeigt die
   * entsprechenden Toasts + einen kurzen, dezenten "Zerschlagen"-Effekt
   * (respektiert prefers-reduced-motion via CSS) und despawnt danach.
   * @returns {void}
   */
  function smashPiggy() {
    if (!piggyState.active) return;
    var el = document.getElementById('idlePiggy');

    var result = IdleCore.smashPiggybank(state, Math.random);
    ApiClient.saveIdleState(state);

    if (el) el.classList.add('is-smashed');
    showPiggyToast(result);
    if (result.gearResult && result.gearResult.part) {
      renderGearPanel();
      showGearToast(result.gearResult);
    }
    renderAll();
    checkIdleAchievements();

    setTimeout(despawnPiggy, reducedMotion ? 0 : PIGGY_SMASH_ANIM_MS);
  }

  /**
   * Verdrahtet die Klick-/Tastatur-Interaktion (Enter/Leertaste) des
   * Sparschweins.
   * @returns {void}
   */
  function wirePiggyInteraction() {
    var el = document.getElementById('idlePiggy');
    if (!el) return;
    el.addEventListener('click', smashPiggy);
    el.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        smashPiggy();
      }
    });
  }

  /**
   * EIN Game-Loop-Tick der Sparschweine: zählt entweder bis zum nächsten
   * zufälligen Sparschwein herunter (spawnPiggy() bei Ablauf), oder lässt
   * das sichtbare Sparschwein weiterlaufen und despawnt es unbeklickt
   * (keine Strafe), sobald piggyVisibleSeconds() erreicht ist.
   * @param {number} dtSeconds - Verstrichene Zeit seit dem letzten Frame (Sekunden, gedeckelt).
   * @returns {void}
   */
  function tickPiggy(dtSeconds) {
    if (!piggyState.active) {
      piggyTimerSeconds -= dtSeconds;
      if (piggyTimerSeconds <= 0) spawnPiggy();
      return;
    }
    piggyState.elapsedSeconds += dtSeconds;
    if (piggyState.elapsedSeconds >= piggyState.visibleSeconds) {
      despawnPiggy();
    }
  }

  /* ============================================================
     TEIL 2/4 — POWERUPS: Magnet/Schild/Turbo/Score-x2 — feat(powerups)
     Wiederverwendet EXAKT das obige Sparschwein-Muster (spawnPiggy/
     tickPiggy/smashPiggy) — Unterschied: LANE-gebunden (via laneCenterX()/
     laneRowY() aus Teil 1, statt frei-%-positioniert) UND 4 statt 1
     Effekt-Typ (siehe IdleCore.rollPowerupDrop()/activatePowerupEffect()).
     Teil 4 ersetzt 'muenzregen' im selben Gewichtungs-Slot durch
     'scoreX2' (Magnet zieht seither zusätzlich Münzen ein, siehe
     tickRunner(); Turbo lässt 'lowBar'-Hindernisse ohne Sprung passieren,
     siehe IdleCore.obstacleCausesCrash()).
     ============================================================ */

  /**
   * Zeigt einen kurzen Toast für ein eingesammeltes Powerup (Effekt-
   * abhängiger Text). Nutzt denselben Toast-Container/dieselbe CSS-Klasse
   * wie showPartToast()/showGearToast()/showPiggyToast().
   * @param {('magnet'|'schild'|'turbo'|'scoreX2')} type - Eingesammelter Powerup-Typ.
   * @param {{type: string}} result - Ergebnis von IdleCore.activatePowerupEffect().
   * @returns {void}
   */
  function showPowerupToast(type, result) {
    var container = document.getElementById('idleToastContainer');
    if (!container) return;

    var messages = {
      magnet: '🧲 Magnet aktiviert — zieht Hindernisse & Münzen an!',
      schild: '🛡️ Schild aktiviert — blockt die nächste Kollision!',
      turbo: '🚀 Turbo aktiviert — Speedboost & fährt durch niedrige Hindernisse!',
      scoreX2: '✨ Score x2 aktiviert — doppelter Score für kurze Zeit!',
    };

    var toast = document.createElement('div');
    toast.className = 'idle-toast';
    toast.textContent = messages[type] || (POWERUP_NAMES[type] || 'Powerup') + ' eingesammelt';
    container.appendChild(toast);

    window.requestAnimationFrame(function () { toast.classList.add('is-visible'); });
    setTimeout(function () {
      toast.classList.remove('is-visible');
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 400);
    }, PART_TOAST_VISIBLE_MS);
  }

  /**
   * Zeigt einen kurzen Toast dafür, dass ein Schild-Powerup GENAU EINE
   * Kollision geblockt hat (siehe triggerShieldFeedback()).
   * @returns {void}
   */
  function showPowerupBlockToast() {
    var container = document.getElementById('idleToastContainer');
    if (!container) return;
    var toast = document.createElement('div');
    toast.className = 'idle-toast';
    toast.textContent = '🛡️ Schild hat eine Kollision geblockt!';
    container.appendChild(toast);
    window.requestAnimationFrame(function () { toast.classList.add('is-visible'); });
    setTimeout(function () {
      toast.classList.remove('is-visible');
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 400);
    }, PART_TOAST_VISIBLE_MS);
  }

  /**
   * Lässt ein neues Powerup auf einer zufälligen Lane erscheinen (bei
   * POWERUP_SPAWN_T Tiefen-Fortschritt — mittig auf der Strecke, gut
   * erreichbar), für powerupVisibleSeconds() Sekunden klickbar. Nutzt
   * dieselben Lane-Geometrie-Helfer (laneCenterX()/laneRowY()) wie die
   * Hindernis-/Bike-Darstellung, umgerechnet auf %-Position innerhalb von
   * #idleTrackWrap (identisches Overlay-Prinzip wie #idlePiggy).
   * @param {('magnet'|'schild'|'turbo'|'scoreX2')} type - Zu spawnender Powerup-Typ.
   * @returns {void}
   */
  function spawnPowerup(type) {
    var el = document.getElementById('idlePowerup');
    if (!el || !trackCanvas) return;

    var lane = Math.floor(Math.random() * IdleCore.IDLE_BALANCE.RUNNER_LANE_COUNT);
    var w = trackCanvas.clientWidth, h = trackCanvas.clientHeight;
    var leftPct = w > 0 ? (laneCenterX(w, lane, POWERUP_SPAWN_T) / w) * 100 : 50;
    var topPct = h > 0 ? (laneRowY(h, POWERUP_SPAWN_T) / h) * 100 : 50;

    powerupState.active = true;
    powerupState.type = type;
    powerupState.elapsedSeconds = 0;
    powerupState.visibleSeconds = IdleCore.powerupVisibleSeconds(Math.random);

    el.style.left = leftPct + '%';
    el.style.top = topPct + '%';
    el.textContent = POWERUP_ICONS[type] || '❓';
    el.className = 'idle-powerup is-visible idle-powerup-' + type;
    el.setAttribute('aria-label', (POWERUP_NAMES[type] || 'Powerup') + ' einsammeln');
    el.setAttribute('aria-hidden', 'false');
    el.tabIndex = 0;
  }

  /**
   * Lässt das aktuell sichtbare Powerup wieder verschwinden (unbeklickt
   * abgelaufen ODER kurz nach dem Einsammeln-Effekt) und würfelt das
   * Intervall bis zum nächsten Spawn-Versuch neu. Ein unbeklickt
   * despawntes Powerup ist KEINE Strafe (identisches Muster zu despawnPiggy()).
   * @returns {void}
   */
  function despawnPowerup() {
    var el = document.getElementById('idlePowerup');
    if (el) {
      el.classList.remove('is-visible');
      el.setAttribute('aria-hidden', 'true');
      el.tabIndex = -1;
    }
    powerupState.active = false;
    powerupState.type = null;
    powerupTimerSeconds = IdleCore.nextPowerupIntervalSeconds(Math.random);
  }

  /**
   * Sammelt das aktuell sichtbare Powerup ein: aktiviert dessen Effekt
   * (IdleCore.activatePowerupEffect()), zeigt einen entsprechenden Toast +
   * einen kurzen, dezenten "Eingesammelt"-Effekt (respektiert prefers-
   * reduced-motion via CSS) und despawnt danach.
   * @returns {void}
   */
  function collectPowerup() {
    if (!powerupState.active) return;
    var type = powerupState.type;
    var el = document.getElementById('idlePowerup');

    var result = IdleCore.activatePowerupEffect(state, type, Date.now());
    ApiClient.saveIdleState(state);

    if (el) el.classList.add('is-collected');
    showPowerupToast(type, result);
    checkIdleAchievements();

    setTimeout(despawnPowerup, reducedMotion ? 0 : POWERUP_COLLECT_ANIM_MS);
  }

  /**
   * Verdrahtet die Klick-/Tastatur-Interaktion (Enter/Leertaste) des
   * Powerups (identisches Muster zu wirePiggyInteraction()).
   * @returns {void}
   */
  function wirePowerupInteraction() {
    var el = document.getElementById('idlePowerup');
    if (!el) return;
    el.addEventListener('click', collectPowerup);
    el.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        collectPowerup();
      }
    });
  }

  /**
   * EIN Game-Loop-Tick der Powerups: zählt entweder bis zum nächsten
   * Spawn-VERSUCH herunter (bei Ablauf entscheidet IdleCore.
   * rollPowerupDrop() — tuning-abhängig — OB und WELCHER Typ tatsächlich
   * erscheint; kein Treffer = einfach das Intervall neu würfeln, KEINE
   * Strafe), oder lässt das sichtbare Powerup weiterlaufen und despawnt
   * es unbeklickt, sobald powerupVisibleSeconds() erreicht ist.
   * @param {number} dtSeconds - Verstrichene Zeit seit dem letzten Frame (Sekunden, gedeckelt).
   * @returns {void}
   */
  function tickPowerup(dtSeconds) {
    if (!powerupState.active) {
      powerupTimerSeconds -= dtSeconds;
      if (powerupTimerSeconds <= 0) {
        var type = IdleCore.rollPowerupDrop(Math.random, state);
        if (type) {
          spawnPowerup(type);
        } else {
          powerupTimerSeconds = IdleCore.nextPowerupIntervalSeconds(Math.random);
        }
      }
      return;
    }
    powerupState.elapsedSeconds += dtSeconds;
    if (powerupState.elapsedSeconds >= powerupState.visibleSeconds) {
      despawnPowerup();
    }
  }

  /* ============================================================
     STATISTIKEN — feat(idle-stats)
     ============================================================ */

  /**
   * Rendert das Statistik-Panel (Gesamt-km, Runden, beste Combo,
   * Spielzeit) sowie die Saison-Historie-Liste.
   * @returns {void}
   */
  function renderStatsPanel() {
    var grid = document.getElementById('idleStatsGrid');
    if (grid) {
      grid.innerHTML = '';
      var tiles = [
        { label: 'Gesamt-km', value: formatKm(state.totalKmEarned) + ' km' },
        { label: 'Runden', value: String(state.stats.laps) },
        { label: 'Beste Combo', value: '×' + state.stats.bestCombo },
        { label: 'Spielzeit', value: formatPlayTime(state.stats.playTimeSeconds) },
      ];
      tiles.forEach(function (tile) {
        var tileEl = document.createElement('div');
        tileEl.className = 'idle-stat-tile';
        var labelEl = document.createElement('span');
        labelEl.className = 'idle-stat-tile-label';
        labelEl.textContent = tile.label;
        var valueEl = document.createElement('span');
        valueEl.className = 'idle-stat-tile-value';
        valueEl.textContent = tile.value;
        tileEl.appendChild(labelEl);
        tileEl.appendChild(valueEl);
        grid.appendChild(tileEl);
      });
    }

    var historyList = document.getElementById('idleSeasonHistory');
    if (historyList) {
      historyList.innerHTML = '';
      var history = state.stats.seasonHistory;
      if (!history || history.length === 0) {
        var emptyEl = document.createElement('li');
        emptyEl.className = 'idle-season-history-empty';
        emptyEl.textContent = 'Noch keine Saison abgeschlossen.';
        historyList.appendChild(emptyEl);
      } else {
        history.slice().reverse().forEach(function (entry) {
          var li = document.createElement('li');
          var strong = document.createElement('strong');
          strong.textContent = 'Saison ' + entry.season;
          var trophies = document.createElement('span');
          trophies.textContent = '+' + entry.trophiesEarned + ' 🏆';
          li.appendChild(strong);
          li.appendChild(trophies);
          historyList.appendChild(li);
        });
      }
    }
  }

  /**
   * Verdrahtet regelmässiges Auto-Speichern sowie ein finales Speichern,
   * bevor die Seite verlassen/versteckt wird (Tab-Wechsel, Schliessen).
   * @returns {void}
   */
  function wireLifecycleSave() {
    setInterval(function () {
      ApiClient.saveIdleState(state);
    }, AUTO_SAVE_INTERVAL_MS);

    window.addEventListener('beforeunload', function () {
      ApiClient.saveIdleState(state);
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') ApiClient.saveIdleState(state);
    });
  }

  /**
   * EIN Game-Loop-Frame: berechnet die (auf IDLE_BALANCE.MAX_TICK_DELTA_
   * SECONDS gedeckelte) verstrichene Zeit seit dem letzten Frame und
   * aktualisiert die weich nachlaufende km-Anzeige. Die Wirtschaft
   * (Erträge) tickt damit von der Bildwiederholrate entkoppelt —
   * verstrichene Echtzeit wird akkumuliert, nicht die Anzahl der Frames
   * gezählt.
   *
   * Teil 3 (feat(crash)): der frühere KONTINUIERLICHE passive km-Drip
   * (IdleCore.passiveEarn() × IdleCore.runnerEarnMultiplier(), jeden
   * Frame direkt in km) ist entfernt — der laufende RUN sammelt Score/
   * Run-Coins jetzt nur noch in state.run (siehe IdleCore.
   * tickRunEconomy(), aufgerufen aus tickRunner()) und bankt sie ERST
   * bei einem Crash (IdleCore.endRun(), siehe handleRunCrash()) bzw.
   * kontinuierlich-reduziert im Auto-Pilot (der laut Teil-1-Invariante
   * NIE crasht). activeEarn() ("Gas geben", siehe wireGasButton()) bleibt
   * davon unberührt.
   * @param {number} timestamp - Von requestAnimationFrame übergebener High-Res-Zeitstempel.
   * @returns {void}
   */
  function tick(timestamp) {
    if (lastFrameTime === null) lastFrameTime = timestamp;
    var dtSeconds = (timestamp - lastFrameTime) / 1000;
    lastFrameTime = timestamp;

    // Tab-inactive-safe: ein einzelner Frame darf nie mehr als
    // MAX_TICK_DELTA_SECONDS an Ertrag auf einmal gutschreiben (verhindert
    // einen riesigen Sprung, wenn ein hintergründiger Tab zurückkehrt).
    var clampedDt = Math.min(Math.max(dtSeconds, 0), IdleCore.IDLE_BALANCE.MAX_TICK_DELTA_SECONDS);

    IdleCore.addPlayTime(state, clampedDt);

    updateKmDisplay();

    // Strecke/Tacho/Runner teilen sich denselben Game-Loop-Tick (kein zweiter rAF-Loop).
    // tickRunner() liefert die visuelle (idle-gedeckelte + Kollisions-Malus-behaftete)
    // Geschwindigkeit NUR für die Strecken-Darstellung — Tacho/Sound/kmh bleiben an der
    // realen Bike-Geschwindigkeit; tickRunner() bankt/bucht dort auch die Run-Wirtschaft
    // (siehe IdleCore.tickRunEconomy()) für genau dieses Delta.
    var info = getCurrentBikeInfo();
    var kmh = (info.bike.topspeed * info.stats.geschwindigkeitPct) / 100;
    var runnerVisualSpeedPct = tickRunner(clampedDt, info.stats.geschwindigkeitPct);
    renderTrack(clampedDt, runnerVisualSpeedPct);
    renderTacho(info.stats.geschwindigkeitPct, kmh);
    updateEngineSound(info.stats.geschwindigkeitPct);
    tickShift(clampedDt);
    tickBill(clampedDt);
    tickPiggy(clampedDt);
    tickPowerup(clampedDt);
    updateComboBadge();
    // Teil 4 (feat(score)/feat(powerups)): live Score-/Highscore-HUD +
    // Powerup-Timer-HUD, jeden Frame aktualisiert (rein lesend bzgl.
    // state — beide spiegeln nur, was tickRunner()/collectPowerup()
    // bereits mutiert haben).
    updateRunScoreHud();
    updatePowerupHud(Date.now());

    window.requestAnimationFrame(tick);
  }

  /* ============================================================
     OFFLINE-ERTRAG — feat(idle-offline)
     ============================================================ */

  /**
   * Zeigt das "Willkommen zurück"-Banner mit dem beim Laden
   * gutgeschriebenen Offline-Ertrag (siehe offlineEarnedKm oben) und
   * verdrahtet dessen Schliessen-Button. No-op, falls kein Offline-
   * Ertrag gutgeschrieben wurde.
   * @returns {void}
   */
  function showOfflineBanner() {
    if (offlineEarnedKm <= 0) return;
    var banner = document.getElementById('idleOfflineBanner');
    var textEl = document.getElementById('idleOfflineBannerText');
    var closeBtn = document.getElementById('idleOfflineBannerClose');
    if (!banner || !textEl) return;

    textEl.textContent = '👋 Willkommen zurück! Während du weg warst, hast du ' + formatKm(offlineEarnedKm) + ' km gesammelt.';
    banner.hidden = false;

    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        banner.hidden = true;
      });
    }
  }

  /**
   * Initialisiert die Idle-Racer-Seite: rendert den initialen Zustand,
   * verdrahtet alle Buttons + das Auto-Speichern und startet den
   * Game-Loop.
   * @returns {void}
   */
  function initIdlePage() {
    // Teil 3 (feat(run)): jeder Seitenaufruf beginnt einen frischen Run
    // (startRun() setzt Score/Coins/Combo/Distanz zurück und leitet die
    // Basis-Geschwindigkeit aus dem aktuellen Bike/Tuning ab) — ein evtl.
    // aus einer vorherigen Sitzung als 'crashed' persistierter Run wird
    // dadurch bewusst NICHT als noch offene Zusammenfassung fortgeführt.
    IdleCore.startRun(state, Date.now());
    runnerBikeDisplayLane = state.runner.lane;
    // Teil 4 (feat(score)/feat(nearmiss)): Score-HUD-Tween + Combo-HUD
    // synchron zum frischen Run starten (beide sind 0 direkt nach startRun()).
    displayedRunScore = state.run.score;
    updateRunComboHud();

    renderAll();
    updateKmDisplay();
    initCanvases();
    tachoDisplayPct = getCurrentBikeInfo().stats.geschwindigkeitPct;
    updateComboBadge();
    updateRunScoreHud();
    updatePowerupHud(Date.now());
    showOfflineBanner();
    wireGasButton();
    wireUpgradeButton();
    wireRunnerControls();
    wireShiftInteraction();
    wireSoundControls();
    wireSeasonControls();
    wireBillPayButton();
    wirePiggyInteraction();
    wirePowerupInteraction();
    wireRunSummaryButtons();
    wireLifecycleSave();
    window.requestAnimationFrame(tick);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initIdlePage);
  } else {
    initIdlePage();
  }
})();
