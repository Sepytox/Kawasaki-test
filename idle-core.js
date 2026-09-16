/**
 * idle-core.js — Kawasaki Idle Racer: reine Spiel-/Wirtschafts-Logik.
 *
 * DOM-freies, Node-requireable Modul (Muster identisch zu bikes-data.js):
 * bereitgestellt sowohl im Browser (window/globalThis) als auch in Node
 * (module.exports). Enthält NUR reine Funktionen + Datenkonstanten — kein
 * DOM-Zugriff, kein requestAnimationFrame, kein Rendering. Die Seiten-
 * steuerung (Game-Loop, DOM-Bindings) lebt in idle.js.
 *
 * Verantwortlich für:
 *   - IDLE_BIKES: die 16 spielbaren Kawasaki-Modelle (aufsteigend nach
 *     Topspeed), mit exponentiell wachsendem Kaufpreis (kaufpreisKm).
 *   - IDLE_BALANCE: EIN zentrales Balancing-Konfigurationsobjekt.
 *   - Zustands-Erzeugung/-Migration/-Persistenz (createInitialState,
 *     migrateState, loadState, saveState) unter dem EINEN neuen
 *     localStorage-Key `vroooom_idle_state` (Präfix vroooom_idle_*,
 *     siehe GOLDEN_PRINCIPLES_KE.md Regel 7 — bestehende Keys werden nie
 *     umbenannt/angefasst).
 *   - Wirtschafts-Formeln (bikeCost, tuningCost, passiveEarn, activeEarn,
 *     deriveBikeStats) sowie Zustands-Mutationen fürs Kaufen/Tunen/
 *     Wechseln von Bikes (buyNextBike, upgradeBike, selectBike).
 *
 * Phase B ergänzte Canvas-Strecke/Tacho/Motorsound sowie die
 * Schaltpunkt-Combo (MECHANIK A). Phase C ergänzt MECHANIK B — Saison/
 * Prestige: ab der ZX-10R kann eine Saison abgeschlossen werden
 * (trophiesForSeason/canFinishSeason/finishSeason); die dabei verdienten
 * TROPHÄEN sind PERMANENT und kaufen dauerhafte WERKSVERTRÄGE
 * (IDLE_CONTRACTS/contractEffects), die Reset-Saisons überleben. Teile-
 * Sammlung/Offline-Ertrag/Statistiken folgen in weiteren Phase-C-Commits.
 *
 * Phase D (IDLE_STATE_VERSION 2) ergänzt eine ZWEITE MECHANIK A:
 * Werkstattrechnungen + Insolvenz (nextBillIntervalSeconds/billAmount/
 * payBill/triggerInsolvency) — eine unbezahlte Rechnung löst KEINE Strafe
 * aus, sondern eine Insolvenz (ein normaler Saison-Reset via finishSeason
 * mit bypassEligibilityGate). Ausserdem AUSRÜSTUNG (GEAR): eine zweite,
 * parallele Sammlung zu den Teilen, die dieselbe generalisierte
 * Drop-/Dubletten-/Set-Bonus-Engine wiederverwendet (rollPartDrop/addPart/
 * setBonuses akzeptieren jetzt einen optionalen pool-Parameter) UND
 * zusätzlich einen permanenten Pro-Item-Ertragsbonus gewährt (siehe
 * itemBonusSum/gearBonuses).
 *
 * Phase E ergänzt MECHANIK B: Sparschweine zerschlagen
 * (nextPiggyIntervalSeconds/piggyVisibleSeconds/piggybankReward/
 * smashPiggybank) — ein zeitkritisches, rein optionales Extra (Verpassen
 * hat KEINE Strafe) mit einem km-Bonus + derselben wiederverwendeten
 * Gear-Drop-Chance wie payBill().
 *
 * Teil 1 (IDLE_STATE_VERSION 3) ersetzt die Oval-Renn-Strecke durch einen
 * ENDLESS-RUNNER: eine 2–3-Lane-Straße, auf der Hindernisse Richtung
 * Spieler vorrücken (Rendering + Steuerung/Touch/Tastatur lebt in
 * idle.js, siehe dessen tickRunner()). Diese Datei liefert NUR die reinen
 * Bausteine: Speed-Cap/Vorlaufzeit (runnerLeadSeconds — nie unter
 * RUNNER_MIN_LEAD_SECONDS, unabhängig von der Bike-Geschwindigkeit),
 * Hindernis-Dichte (obstacleDensity — steigt ÜBER den Speed-Cap hinaus
 * stärker an, statt die Reaktionszeit zu gefährden), den rein VISUELLEN
 * Kollisions-Geschwindigkeits-Malus (collisionSpeedMalus/
 * applyCollisionMalus — NIEMALS ein Reset/Fail-State, NIEMALS ein Effekt
 * auf passiveEarn()) sowie den Idle-Auto-Run (runnerActivityState/
 * runnerAutoRunSpeedPct — passiver Ertrag läuft UNABHÄNGIG vom
 * Steuerungs-/Kollisions-Zustand immer weiter, siehe passiveEarn()).
 */
'use strict';

/** localStorage-Key des zentralen, versionierten Idle-Zustands (EIN Key für alles). */
var IDLE_STATE_KEY = 'vroooom_idle_state';

/** Aktuelle Zustands-Versionsnummer (für migrateState). */
var IDLE_STATE_VERSION = 3;

/**
 * IDLE_BALANCE — zentrale Balancing-Konstanten für die gesamte Idle-Economy.
 *
 * Zielvorgabe "erste 3 Bikes in ~10 Minuten erreichbar":
 *   - PASSIVE_KM_PER_SEC=1 ergibt bei reinem Idle-Zusehen 600 km in 10 Min
 *     (600s × 1 km/s), ohne jeglichen Klick.
 *   - Bike-Index 1 (KLX 300) kostet BASE_BIKE_COST=300 km, Bike-Index 2
 *     (Eliminator 500) kostet 300×1.6=480 km → kumulativ 780 km für die
 *     ersten beiden Käufe (macht das Startbike + 2 gekaufte = "erste 3
 *     Bikes" komplett).
 *   - 780 km liegt knapp über den rein-passiven 600 km in 10 Minuten;
 *     bereits gelegentliches Klicken auf "Gas geben" (ACTIVE_KM_PER_CLICK
 *     =10 km/Klick, ca. 20 Klicks über 10 Minuten verteilt = 200 km)
 *     schließt die Lücke komfortabel (600+200=800 ≥ 780). Damit sind die
 *     ersten 3 Bikes für aktive UND rein passive Spieler:innen realistisch
 *     in ~10 Minuten erreichbar, ohne die Kurve danach zu verflachen
 *     (BIKE_COST_GROWTH=1.6 sorgt für spürbares, aber nicht extremes
 *     exponentielles Wachstum bis Bike 16 bei ca. 216.170 km).
 */
var IDLE_BALANCE = {
  /** Index des kostenlosen Startbikes in IDLE_BIKES (immer besessen). */
  STARTER_BIKE_INDEX: 0,

  /** Kaufpreis (in km) des ersten käuflichen Bikes (Index 1). */
  BASE_BIKE_COST: 300,
  /** Wachstumsfaktor je weiterem Bike-Index (exponentiell). */
  BIKE_COST_GROWTH: 1.6,
  /** Rundungsschritt für Bike-Kaufpreise (auf "runde" km-Werte). */
  BIKE_COST_ROUND_TO: 10,

  /** Basis-Passivertrag in km/Sekunde (vor Bike-/Level-Boni), bei laufendem Spiel. */
  PASSIVE_KM_PER_SEC: 1,
  /** km-Ertrag pro Klick auf "Gas geben" (vor Bike-/Level-Boni). */
  ACTIVE_KM_PER_CLICK: 10,

  /** Maximales Tuning-/Level pro Bike (siehe tuningCost). */
  TUNING_LEVEL_CAP: 25,
  /** Basis-Tuningkosten (in km) für Level 0→1 des Startbikes (Index 0). */
  TUNING_BASE_COST: 50,
  /** Wachstumsfaktor der Tuningkosten je Level (exponentiell). */
  TUNING_GROWTH: 1.35,
  /** Rundungsschritt für Tuningkosten. */
  TUNING_COST_ROUND_TO: 5,
  /** Ertrag-Bonus pro Tuning-Level (multiplikativ, z. B. 0.04 = +4%/Level). */
  ERTRAG_BONUS_PER_LEVEL: 0.04,

  /** Referenzwerte zur Normierung der Statistik-Balken (0–100%). */
  STAT_BAR_MAX_TOPSPEED: 400,
  STAT_BAR_MAX_PS: 320,
  /** Zusätzlicher Balken-Boost pro Tuning-Level (Geschwindigkeit/Beschleunigung). */
  STAT_BAR_LEVEL_BOOST_PER_LEVEL: 0.01,

  /** Zeit-Deckelung (Sekunden) für EINEN Game-Loop-Tick in idle.js — verhindert,
   *  dass ein längere Zeit inaktiver/hintergründiger Tab beim Zurückkehren
   *  einen riesigen Delta-Sprung auf einmal gutschreibt. Nur hier zentral
   *  definiert, damit idle.js keine eigene "magische Zahl" pflegt. */
  MAX_TICK_DELTA_SECONDS: 0.25,

  /* ── Phase C: MECHANIK B — Saison/Prestige/Werksverträge ─────────
   * Ab der ZX-10R (siehe canFinishSeason) kann eine Saison abgeschlossen
   * werden (finishSeason): km + besessene Bikes werden zurückgesetzt,
   * TROPHÄEN (siehe trophiesForSeason) bleiben PERMANENT und kaufen
   * Werksverträge (IDLE_CONTRACTS), die selbst einen Reset überleben. */
  /** Permanenter Ertrags-Bonus pro abgeschlossener Saison (prestige.level), stackt multiplikativ mit Werksverträgen. */
  PRESTIGE_BONUS_PER_LEVEL: 0.05,
  /** Je 5 kumulierte Tuning-Level (über alle Bikes) gibt es +1 Bonus-Trophäe beim Saisonabschluss. */
  TROPHY_LEVEL_BONUS_DIVISOR: 5,
  /* ── Phase C: Teile-Sammlung ──────────────────────────────────── */
  /** @deprecated Abgelöst durch die individuellen bonusPct-Werte in IDLE_PART_SETS (siehe setBonuses()); bleibt als inaktiver Platzhalter erhalten. */
  PARTS_BONUS_MULTIPLIER: 1,
  /** Wahrscheinlichkeit (0–1) pro abgeschlossener Runde, dass überhaupt ein Teil dropt. */
  PART_DROP_CHANCE_PER_LAP: 0.035,
  /** Relative Gewichtung der drei Seltenheitsstufen bei einem Drop (müssen nicht auf 100 summieren). */
  PART_RARITY_WEIGHTS: { common: 70, rare: 25, legendary: 5 },
  /** km-Gutschrift, wenn ein bereits besessenes Teil erneut dropt (Dubletten→km), je Seltenheitsstufe. */
  PART_DUPLICATE_KM_VALUE: { common: 15, rare: 60, legendary: 250 },

  /* ── Phase C: Offline-Ertrag ──────────────────────────────────── */
  /** Anteil des Passivertrags, der offline (bis zum Cap) gutgeschrieben wird (1 = voller Passivertrag). */
  OFFLINE_EARN_FRACTION: 1,
  /** Offline-Ertrags-Deckelung in Sekunden (4h), ggf. verdoppelt durch den "Offline verdoppelt"-Werksvertrag. */
  OFFLINE_CAP_SECONDS: 4 * 60 * 60,

  /* ── Phase B: Schaltpunkt-Combo (MECHANIK A) ────────────────────
   * Alle ca. 15–30s erscheint eine Schaltpunkt-Leiste mit wandernder
   * Markierung und einer grünen "perfekten Zone" in der Mitte. Ein
   * Treffer (Klick innerhalb der Zone) erhöht die Combo und gewährt für
   * COMBO_MULTIPLIER_DURATION_MS einen steigenden Ertrags-Multiplikator
   * (x2 bis maximal x5); ein Fehlklick (ausserhalb der Zone) setzt die
   * Combo zurück auf 0; Ignorieren (Leiste läuft ab) hat KEINE Strafe. */
  /** Basis-Breite der perfekten Zone in % der Leistenbreite (Combo 0). */
  COMBO_ZONE_BASE_WIDTH_PCT: 34,
  /** Untere Grenze, unter die die Zone niemals schrumpft (% Leistenbreite). */
  COMBO_ZONE_MIN_WIDTH_PCT: 8,
  /** Schrumpfung der Zonenbreite je Combo-Punkt (Prozentpunkte). */
  COMBO_ZONE_SHRINK_PER_COMBO_PCT: 2,
  /** Ertrags-Multiplikator, der bei Combo 1 gewährt wird. */
  COMBO_MULTIPLIER_BASE: 2,
  /** Höchster erreichbarer Ertrags-Multiplikator (Deckel). */
  COMBO_MULTIPLIER_MAX: 5,
  /** Zusätzlicher Multiplikator je weiterem Combo-Punkt über 1 hinaus. */
  COMBO_MULTIPLIER_STEP: 0.5,
  /** Dauer (ms), die ein frisch gewährter Multiplikator aktiv bleibt. */
  COMBO_MULTIPLIER_DURATION_MS: 10000,
  /** Zufälliges Intervall (Sekunden) zwischen zwei Schaltpunkt-Leisten — untere Grenze. */
  SHIFT_INTERVAL_MIN_SECONDS: 15,
  /** Zufälliges Intervall (Sekunden) zwischen zwei Schaltpunkt-Leisten — obere Grenze. */
  SHIFT_INTERVAL_MAX_SECONDS: 30,
  /** Dauer (Sekunden) des Marker-Durchlaufs einer einzelnen Schaltpunkt-Leiste. */
  SHIFT_SWEEP_DURATION_SECONDS: 2.2,

  /* ── Phase D: MECHANIK A — Werkstattrechnungen + Insolvenz ────────
   * Alle nextBillIntervalSeconds() Sekunden wird eine Werkstattrechnung
   * fällig; ein sichtbares Zahlungsfenster (billGraceSeconds()) läuft
   * ab, bevor eine unbezahlte Rechnung zu einer Insolvenz führt.
   * Insolvenz ist dabei KEINE Strafe, sondern ein normaler Saison-Reset
   * (siehe triggerInsolvency/finishSeason mit bypassEligibilityGate). */
  /** Basis-Intervall (Sekunden) bis zur nächsten Rechnung — untere Grenze bei Saison-Start. */
  BILL_INTERVAL_MIN_SECONDS: 60,
  /** Basis-Intervall (Sekunden) bis zur nächsten Rechnung — obere Grenze bei Saison-Start. */
  BILL_INTERVAL_MAX_SECONDS: 120,
  /** Untere Grenze, unter die das Intervall trotz Saison-Fortschritt niemals schrumpft. */
  BILL_INTERVAL_FLOOR_SECONDS: 30,
  /** Schrumpfung (Sekunden) von Min/Max je Trophäe (trophiesForSeason) Saison-Fortschritt. */
  BILL_INTERVAL_SHRINK_PER_TROPHY_SECONDS: 1.5,
  /** Sichtbares Zahlungsfenster (Sekunden) einer fälligen Rechnung — untere Grenze. */
  BILL_GRACE_MIN_SECONDS: 30,
  /** Sichtbares Zahlungsfenster (Sekunden) einer fälligen Rechnung — obere Grenze. */
  BILL_GRACE_MAX_SECONDS: 45,
  /** Sicherheits-Faktor auf den aus passiveEarn() abgeleiteten Rechnungsbetrag (siehe billAmount()). */
  BILL_AMOUNT_SAFETY_FACTOR: 1.3,
  /** Mindestbetrag (km) einer Rechnung, damit sehr frühe Rechnungen nicht auf 0 runden. */
  BILL_AMOUNT_MIN_KM: 20,
  /** Anteil des bezahlten Betrags, der als kleiner Bonus zurück-gutgeschrieben wird (siehe payBill()). */
  BILL_PAY_BONUS_FRACTION: 0.08,
  /** Schwelle (Sekunden Restzeit), ab der eine Zahlung als "in letzter Sekunde" gilt. */
  BILL_LAST_SECOND_THRESHOLD_SECONDS: 3,

  /* ── Phase D: Ausrüstung (GEAR) — feat(idle-gear) ─────────────────
   * Zweite, parallele Sammlung zu den Teilen (siehe IDLE_PARTS oben),
   * wiederverwendet dieselbe generalisierte Engine (rollPartDrop/addPart/
   * setBonuses). 4 Seltenheitsstufen statt 3, UND ein permanenter
   * Pro-Item-Ertragsbonus zusätzlich zum Set-Bonus (siehe gearBonuses()). */
  /** Relative Gewichtung der vier Seltenheitsstufen bei einem Gear-Drop. */
  GEAR_RARITY_WEIGHTS: { gewoehnlich: 60, selten: 25, episch: 11, legendaer: 4 },
  /** km-Gutschrift für eine Gear-Dublette, je Seltenheitsstufe. */
  GEAR_DUPLICATE_KM_VALUE: { gewoehnlich: 20, selten: 50, episch: 120, legendaer: 300 },
  /** Wahrscheinlichkeit (0–1), dass eine pünktlich bezahlte Rechnung zusätzlich ein Gear-Item dropt. */
  GEAR_DROP_CHANCE_ON_BILL_PAY: 0.18,

  /* ── Phase E: MECHANIK B — Sparschweine zerschlagen ────────────────
   * Alle nextPiggyIntervalSeconds() Sekunden (flach, 20–40s) erscheint
   * ein Sparschwein (DOM-Overlay wie #idleHandover, siehe idle.js), das
   * für piggyVisibleSeconds() Sekunden (3–4s) sichtbar/klickbar ist.
   * Ein rechtzeitiger Klick zerschlägt es (piggybankReward()/
   * smashPiggybank()): ein km-Bonus PLUS eine Chance auf einen Gear-Drop
   * (wiederverwendet dieselbe Engine wie payBill(), siehe rollGearDrop()).
   * Verpasst/unbeklickt abgelaufen = KEINE Strafe (identisches Muster
   * zur Schaltpunkt-Leiste, siehe tickShift()/endShift(..., true)). */
  /** Zufälliges Intervall (Sekunden) zwischen zwei Sparschweinen — untere Grenze. */
  PIGGY_INTERVAL_MIN_SECONDS: 20,
  /** Zufälliges Intervall (Sekunden) zwischen zwei Sparschweinen — obere Grenze. */
  PIGGY_INTERVAL_MAX_SECONDS: 40,
  /** Sichtbarkeitsdauer (Sekunden) EINES Sparschweins, bevor es unbeklickt wieder verschwindet — untere Grenze. */
  PIGGY_VISIBLE_MIN_SECONDS: 3,
  /** Sichtbarkeitsdauer (Sekunden) EINES Sparschweins, bevor es unbeklickt wieder verschwindet — obere Grenze. */
  PIGGY_VISIBLE_MAX_SECONDS: 4,
  /** Vielfaches von activeEarn(state), das ein zerschlagenes Sparschwein als km-Bonus gewährt (skaliert automatisch mit Bike/Tuning, wie billAmount() über passiveEarn()). */
  PIGGY_KM_BONUS_MULTIPLIER: 6,
  /** Wahrscheinlichkeit (0–1), dass ein zerschlagenes Sparschwein zusätzlich ein Gear-Item dropt. */
  GEAR_DROP_CHANCE_ON_PIGGY_SMASH: 0.22,

  /* ── Teil 1: ENDLESS-RUNNER — 2–3-Lane-Straße statt Oval-Strecke ──
   * Ersetzt renderTrack()'s Oval durch eine perspektivische Lane-Straße
   * (siehe idle.js): das Bike wechselt zwischen Lanes (Tastatur ←/→ bzw.
   * A/D, Touch-Swipe), Hindernisse spawnen am Horizont und rücken
   * Richtung Spieler vor. EIN Treffer verursacht NUR einen KURZEN,
   * REIN VISUELLEN Geschwindigkeits-Einbruch (siehe collisionSpeedMalus()
   * / applyCollisionMalus()) — NIEMALS einen Reset oder Fail-State; der
   * passive km-Ertrag (passiveEarn()) ist davon komplett entkoppelt.
   * Speed-Cap: die visuelle Scroll-Geschwindigkeit (runnerScrollSpeed())
   * steigt mit geschwindigkeitPct bis RUNNER_SPEED_CAP_PCT, danach bleibt
   * sie flach — das garantiert runnerLeadSeconds() >= RUNNER_MIN_LEAD_
   * SECONDS für JEDES Bike/Tuning-Level (RUNNER_SPAWN_LEAD_DISTANCE ist
   * bewusst so gewählt, dass RUNNER_SCROLL_SPEED_MAX × RUNNER_MIN_LEAD_
   * SECONDS exakt RUNNER_SPAWN_LEAD_DISTANCE ergibt). Oberhalb des Caps
   * steigt stattdessen obstacleDensity() stärker an — schnellere Bikes
   * bleiben dadurch spürbar anspruchsvoller, ohne die Reaktionszeit zu
   * gefährden. Idle-Auto-Run: ohne Lane-Wechsel-Eingabe für RUNNER_IDLE_
   * TIMEOUT_SECONDS gilt runnerActivityState() als 'idle' — das Bike fährt
   * automatisch mit einer gedeckelten, aber VERLÄSSLICHEN Geschwindigkeit
   * (runnerAutoRunSpeedPct()) weiter, Kollisionen werden im Idle-Modus
   * grundsätzlich nicht ausgewertet (siehe idle.js tickRunner()) — Idle-
   * Spieler:innen dürfen NIEMALS gegenüber aktivem Ausweichen benachteiligt
   * werden (passiveEarn() lief ohnehin schon immer unabhängig davon). */
  /** Anzahl der Fahrspuren der Runner-Straße. */
  RUNNER_LANE_COUNT: 3,
  /** Untere Schranke der Hindernis-Vorlaufzeit (Sekunden) — garantiert eine faire Reaktionszeit unabhängig von der Bike-Geschwindigkeit (siehe runnerLeadSeconds()). */
  RUNNER_MIN_LEAD_SECONDS: 0.6,
  /** Prozentsatz von geschwindigkeitPct, ab dem die visuelle Scroll-Geschwindigkeit der Straße nicht mehr weiter ansteigt (siehe runnerScrollSpeed()). */
  RUNNER_SPEED_CAP_PCT: 70,
  /** Visuelle Scroll-Geschwindigkeit (abstrakte Einheiten/Sekunde) bei geschwindigkeitPct=0. */
  RUNNER_SCROLL_SPEED_BASE: 70,
  /** Visuelle Scroll-Geschwindigkeit (abstrakte Einheiten/Sekunde) am/ab RUNNER_SPEED_CAP_PCT (Deckel). */
  RUNNER_SCROLL_SPEED_MAX: 260,
  /** "Distanz" (dieselben abstrakten Einheiten wie RUNNER_SCROLL_SPEED_*) zwischen Hindernis-Spawn (Horizont) und Spieler-Position. Bewusst so gewählt, dass RUNNER_SCROLL_SPEED_MAX × RUNNER_MIN_LEAD_SECONDS exakt diesen Wert ergibt (156 = 260 × 0.6) — der Speed-Cap garantiert dadurch mathematisch die Mindest-Vorlaufzeit. */
  RUNNER_SPAWN_LEAD_DISTANCE: 156,
  /** Hindernis-Dichte-Multiplikator bei geschwindigkeitPct=0 (Basis-Spawnrate, siehe obstacleDensity()). */
  RUNNER_OBSTACLE_DENSITY_BASE: 1,
  /** Hindernis-Dichte-Multiplikator genau am Speed-Cap (RUNNER_SPEED_CAP_PCT). */
  RUNNER_OBSTACLE_DENSITY_AT_CAP: 1.3,
  /** Hindernis-Dichte-Multiplikator bei geschwindigkeitPct=100 — steigt ÜBER den Speed-Cap hinaus stärker an, kompensiert die gedeckelte Scroll-Geschwindigkeit. */
  RUNNER_OBSTACLE_DENSITY_MAX: 2.4,
  /** Basis-Spawnintervall (Sekunden) für Hindernisse bei Dichte 1 (wird durch obstacleDensity() geteilt, siehe nextObstacleSpawnIntervalSeconds()). */
  RUNNER_OBSTACLE_SPAWN_INTERVAL_BASE_SECONDS: 1.8,
  /** Zufälliger Jitter-Faktor (untere Grenze) auf das berechnete Spawnintervall — verhindert einen metronomartig gleichmässigen Rhythmus. */
  RUNNER_OBSTACLE_SPAWN_JITTER_MIN: 0.8,
  /** Zufälliger Jitter-Faktor (obere Grenze) auf das berechnete Spawnintervall. */
  RUNNER_OBSTACLE_SPAWN_JITTER_MAX: 1.25,
  /** Zurückgelegte Distanz (dieselben abstrakten Einheiten wie RUNNER_SCROLL_SPEED_*), nach der ein Distanz-Meilenstein erreicht ist — ersetzt die frühere rundenbasierte onLapCompleted()-Auslösung durch einen äquivalenten, geschwindigkeitsabhängigen Distanz-Trigger (siehe idle.js tickRunner()). */
  RUNNER_LAP_DISTANCE_UNITS: 1000,
  /** Multiplikator (<1), der die visuelle Geschwindigkeit für RUNNER_COLLISION_MALUS_DURATION_MS nach einer Kollision reduziert (siehe collisionSpeedMalus()). NUR visuell — passiveEarn()/activeEarn() sind unberührt. */
  RUNNER_COLLISION_MALUS_MULTIPLIER: 0.55,
  /** Dauer (ms) des kurzen visuellen Geschwindigkeits-Einbruchs nach einer Kollision. */
  RUNNER_COLLISION_MALUS_DURATION_MS: 1200,
  /** Sekunden ohne Lane-Wechsel-Eingabe, nach denen der Auto-Run (Idle-Modus) greift (siehe runnerActivityState()). */
  RUNNER_IDLE_TIMEOUT_SECONDS: 4,
  /** Deckel der visuellen Geschwindigkeit (%) im Auto-Run-/Idle-Modus — "reduziert, aber verlässlich" (siehe runnerAutoRunSpeedPct()); Kollisionen werden im Idle-Modus grundsätzlich nicht ausgewertet (siehe idle.js tickRunner()). */
  RUNNER_AUTO_RUN_SPEED_CAP_PCT: 45,
};

/**
 * Baut einen einzelnen IDLE_BIKES-Eintrag inkl. berechnetem Kaufpreis.
 * @param {number} index - Position in der aufsteigend sortierten Liste (0-basiert).
 * @param {string} id - Eindeutiger Bike-Schlüssel.
 * @param {string} name - Anzeigename.
 * @param {number} topspeed - Höchstgeschwindigkeit in km/h.
 * @param {number} ps - Leistung in PS.
 * @param {string} kategorie - Fahrzeugkategorie (deutsch).
 * @returns {Object} Vollständiger IDLE_BIKES-Eintrag.
 */
function makeIdleBike(index, id, name, topspeed, ps, kategorie) {
  return {
    id: id,
    name: name,
    topspeed: topspeed,
    ps: ps,
    kategorie: kategorie,
    kaufpreisKm: bikeCost(index),
  };
}

/**
 * IDLE_BIKES — die 16 spielbaren Kawasaki-Modelle, AUFSTEIGEND nach
 * Topspeed sortiert (Index 0 = Startbike, kostenlos besessen). Reale,
 * plausible Eckdaten (Topspeed/PS/Kategorie); der Kaufpreis wächst rein
 * exponentiell über IDLE_BALANCE (siehe bikeCost()), unabhängig von der
 * realen Preisgestaltung der Fahrzeuge.
 */
var IDLE_BIKES = [
  makeIdleBike(0, 'z125pro', 'Kawasaki Z125 PRO', 100, 15, 'Einsteiger-Naked'),
  makeIdleBike(1, 'klx300', 'Kawasaki KLX 300', 130, 27, 'Off-Road'),
  makeIdleBike(2, 'eliminator500', 'Kawasaki Eliminator 500', 165, 45, 'Cruiser'),
  makeIdleBike(3, 'ninja400', 'Kawasaki Ninja 400', 180, 45, 'Sportler'),
  makeIdleBike(4, 'w800', 'Kawasaki W800', 190, 52, 'Klassiker'),
  makeIdleBike(5, 'z650', 'Kawasaki Z650', 200, 68, 'Naked'),
  makeIdleBike(6, 'ninja650', 'Kawasaki Ninja 650', 210, 68, 'Sportler'),
  makeIdleBike(7, 'versys1000', 'Kawasaki Versys 1000', 220, 120, 'Adventure'),
  makeIdleBike(8, 'z900', 'Kawasaki Z900', 245, 125, 'Naked'),
  makeIdleBike(9, 'ninja1000sx', 'Kawasaki Ninja 1000SX', 250, 142, 'Sport Tourer'),
  makeIdleBike(10, 'zx6r', 'Kawasaki Ninja ZX-6R', 260, 130, 'Supersportler'),
  makeIdleBike(11, 'zh2', 'Kawasaki Z H2', 270, 200, 'Naked'),
  makeIdleBike(12, 'zx10r', 'Kawasaki Ninja ZX-10R', 290, 203, 'Supersportler'),
  makeIdleBike(13, 'zx10rr', 'Kawasaki Ninja ZX-10RR', 295, 204, 'Supersportler'),
  makeIdleBike(14, 'ninjah2', 'Kawasaki Ninja H2', 300, 231, 'Hypersportler'),
  makeIdleBike(15, 'ninjah2r', 'Kawasaki Ninja H2R', 400, 310, 'Hypersportler (Track)'),
];

/**
 * IDLE_CONTRACTS — MECHANIK B: die käuflichen Werksverträge. Jeder Vertrag
 * kostet eine feste Anzahl TROPHÄEN (permanente Saison-Währung, siehe
 * trophiesForSeason/finishSeason) und gewährt einen dauerhaften, Saison-
 * Reset überlebenden Effekt. `effect` benennt den Schlüssel in dem von
 * contractEffects() aggregierten Ergebnisobjekt, `value` den anzuwendenden
 * Rohwert (Multiplikator, Prozentpunkte oder Bike-id, je nach `effect`).
 */
var IDLE_CONTRACTS = [
  { id: 'ertrag25', name: '+25% passiver Ertrag', beschreibung: 'Erhöht sämtlichen Ertrag (aktiv & passiv) dauerhaft um 25%.', kostenTrophaeen: 3, effect: 'earnMultiplier', value: 1.25 },
  { id: 'startNinja400', name: 'Start mit Ninja 400', beschreibung: 'Jede neue Saison beginnt direkt mit der Ninja 400 statt der Z125 PRO.', kostenTrophaeen: 5, effect: 'startBikeId', value: 'ninja400' },
  { id: 'zoneBreiter10', name: 'Perfekt-Zone 10% breiter', beschreibung: 'Die Schaltpunkt-Zone ist dauerhaft 10 Prozentpunkte breiter.', kostenTrophaeen: 4, effect: 'zoneWidthBonusPct', value: 10 },
  { id: 'offlineVerdoppelt', name: 'Offline-Ertrag verdoppelt', beschreibung: 'Verdoppelt die Offline-Ertragsdeckelung von 4 auf 8 Stunden.', kostenTrophaeen: 6, effect: 'offlineCapMultiplier', value: 2 },
  { id: 'tuningGuenstiger15', name: 'Tuning 15% günstiger', beschreibung: 'Alle Tuning-Kosten sinken dauerhaft um 15%.', kostenTrophaeen: 4, effect: 'tuningCostMultiplier', value: 0.85 },
];

/**
 * IDLE_PART_SETS — die 7 Teile-Sets (Ausrüstungs-Kategorien). Ist ein Set
 * komplett (alle 3 Seltenheitsstufen besessen, siehe setBonuses()), gilt
 * dessen bonusPct permanent und dauerhaft auf den Gesamtertrag.
 */
var IDLE_PART_SETS = [
  { id: 'vergaser', name: 'Vergaser', bonusPct: 3 },
  { id: 'auspuff', name: 'Auspuff', bonusPct: 4 },
  { id: 'kettensatz', name: 'Kettensatz', bonusPct: 2 },
  { id: 'verkleidung', name: 'Verkleidung', bonusPct: 5 },
  { id: 'helm', name: 'Helm', bonusPct: 3 },
  { id: 'bremsen', name: 'Bremsen', bonusPct: 4 },
  { id: 'felgen', name: 'Felgen', bonusPct: 3 },
];

/**
 * Baut einen einzelnen IDLE_PARTS-Eintrag.
 * @param {string} id - Eindeutige Teile-id.
 * @param {string} name - Anzeigename.
 * @param {string} setId - id des zugehörigen IDLE_PART_SETS-Eintrags.
 * @param {string} rarity - Seltenheitsstufe ('common'|'rare'|'legendary').
 * @returns {Object} Vollständiger IDLE_PARTS-Eintrag.
 */
function makeIdlePart(id, name, setId, rarity) {
  return { id: id, name: name, setId: setId, rarity: rarity };
}

/**
 * IDLE_PARTS — 21 Teile über 7 Sets × 3 Seltenheitsstufen (common/rare/
 * legendary), rundenbasiert per rollPartDrop() erspielbar.
 */
var IDLE_PARTS = [
  makeIdlePart('vergaser_standard', 'Standard-Vergaser', 'vergaser', 'common'),
  makeIdlePart('vergaser_sport', 'Sport-Vergaser', 'vergaser', 'rare'),
  makeIdlePart('vergaser_racing', 'Racing-Vergaser', 'vergaser', 'legendary'),

  makeIdlePart('auspuff_standard', 'Standard-Auspuff', 'auspuff', 'common'),
  makeIdlePart('auspuff_slipon', 'Slip-On-Auspuff', 'auspuff', 'rare'),
  makeIdlePart('auspuff_vollanlage', 'Voll-Titan-Anlage', 'auspuff', 'legendary'),

  makeIdlePart('kette_standard', 'Standard-Kettensatz', 'kettensatz', 'common'),
  makeIdlePart('kette_verstaerkt', 'Verstärkter Kettensatz', 'kettensatz', 'rare'),
  makeIdlePart('kette_gold', 'Gold-Kettensatz', 'kettensatz', 'legendary'),

  makeIdlePart('verkleidung_standard', 'Standard-Verkleidung', 'verkleidung', 'common'),
  makeIdlePart('verkleidung_carbon', 'Carbon-Verkleidung', 'verkleidung', 'rare'),
  makeIdlePart('verkleidung_replika', 'Renn-Replika-Verkleidung', 'verkleidung', 'legendary'),

  makeIdlePart('helm_standard', 'Standard-Helm', 'helm', 'common'),
  makeIdlePart('helm_carbon', 'Carbon-Helm', 'helm', 'rare'),
  makeIdlePart('helm_replica', 'Replica-Rennhelm', 'helm', 'legendary'),

  makeIdlePart('bremsen_standard', 'Standard-Bremsanlage', 'bremsen', 'common'),
  makeIdlePart('bremsen_sport', 'Sport-Bremsanlage', 'bremsen', 'rare'),
  makeIdlePart('bremsen_renn', 'Renn-Bremsanlage', 'bremsen', 'legendary'),

  makeIdlePart('felgen_standard', 'Standard-Felgen', 'felgen', 'common'),
  makeIdlePart('felgen_leicht', 'Leichtmetall-Felgen', 'felgen', 'rare'),
  makeIdlePart('felgen_carbon', 'Carbon-Felgen', 'felgen', 'legendary'),
];

/**
 * Berechnet den Kaufpreis (in km) des Bikes an der gegebenen Position in
 * IDLE_BIKES. Reine Funktion aus IDLE_BALANCE — Index 0 (Startbike) ist
 * immer 0 (kostenlos besessen), ab Index 1 wächst der Preis exponentiell
 * mit IDLE_BALANCE.BIKE_COST_GROWTH, gerundet auf BIKE_COST_ROUND_TO.
 * @param {number} index - Position in IDLE_BIKES (0-basiert).
 * @returns {number} Kaufpreis in km (0 für das Startbike).
 */
function bikeCost(index) {
  if (index <= IDLE_BALANCE.STARTER_BIKE_INDEX) return 0;
  var raw = IDLE_BALANCE.BASE_BIKE_COST * Math.pow(IDLE_BALANCE.BIKE_COST_GROWTH, index - 1);
  var step = IDLE_BALANCE.BIKE_COST_ROUND_TO;
  return Math.round(raw / step) * step;
}

/**
 * Findet den Index eines Bikes in IDLE_BIKES anhand seiner id.
 * @param {string} bikeId - Bike-id.
 * @returns {number} Index in IDLE_BIKES, oder -1 falls nicht gefunden.
 */
function findBikeIndex(bikeId) {
  for (var i = 0; i < IDLE_BIKES.length; i++) {
    if (IDLE_BIKES[i].id === bikeId) return i;
  }
  return -1;
}

/**
 * Liefert den Bike-Datensatz zu einer id.
 * @param {string} bikeId - Bike-id.
 * @returns {Object|null} Bike-Datensatz aus IDLE_BIKES oder null.
 */
function getBikeById(bikeId) {
  var index = findBikeIndex(bikeId);
  return index === -1 ? null : IDLE_BIKES[index];
}

/**
 * Berechnet die Tuning-/Level-Kosten (in km), um ein Bike von currentLevel
 * auf currentLevel+1 zu heben. Wächst exponentiell mit dem Level UND mit
 * der Position des Bikes in IDLE_BIKES (teurere/bessere Bikes kosten pro
 * Level mehr). Respektiert IDLE_BALANCE.TUNING_LEVEL_CAP.
 * @param {string} bikeId - id des zu tunenden Bikes.
 * @param {number} currentLevel - Aktuelles Level des Bikes (0 = ungetunt).
 * @returns {number|null} Kosten in km, oder null falls bikeId unbekannt
 *   ODER currentLevel bereits am/über dem Level-Cap liegt (kein weiteres
 *   Tuning möglich).
 */
function tuningCost(bikeId, currentLevel) {
  var index = findBikeIndex(bikeId);
  if (index === -1) return null;
  if (currentLevel >= IDLE_BALANCE.TUNING_LEVEL_CAP) return null;
  var raw = IDLE_BALANCE.TUNING_BASE_COST * (index + 1) * Math.pow(IDLE_BALANCE.TUNING_GROWTH, currentLevel);
  var step = IDLE_BALANCE.TUNING_COST_ROUND_TO;
  return Math.max(step, Math.round(raw / step) * step);
}

/**
 * Liest das aktuelle Tuning-Level eines Bikes aus dem Zustand (0, falls
 * noch nie getunt).
 * @param {Object} state - Zentraler Idle-Zustand.
 * @param {string} bikeId - Bike-id.
 * @returns {number} Aktuelles Level (>= 0).
 */
function getBikeLevel(state, bikeId) {
  if (!state || !state.bikeLevels) return 0;
  var lvl = state.bikeLevels[bikeId];
  return typeof lvl === 'number' && lvl >= 0 ? lvl : 0;
}

/**
 * Leitet die normierten Anzeige-Statistiken (0–100%) sowie den
 * Ertrags-Multiplikator eines Bikes bei einem bestimmten Tuning-Level ab.
 * Geschwindigkeit/Beschleunigung basieren auf Topspeed/PS (IDLE_BIKES hat
 * keine separate Beschleunigungs-Kennzahl, daher PS als Näherung — mehr
 * PS = spürbar bessere Beschleunigungs-Balken-Füllung) und werden durch
 * das Tuning-Level leicht angehoben; der Ertrag-Bonus-Balken zeigt den
 * Fortschritt zum Level-Cap.
 * @param {Object} bike - Ein Eintrag aus IDLE_BIKES.
 * @param {number} level - Aktuelles Tuning-Level des Bikes.
 * @returns {{geschwindigkeitPct:number, beschleunigungPct:number, ertragBonusPct:number, ertragMultiplier:number}}
 */
function deriveBikeStats(bike, level) {
  var lvl = level > 0 ? level : 0;
  var boost = 1 + lvl * IDLE_BALANCE.STAT_BAR_LEVEL_BOOST_PER_LEVEL;
  var geschwindigkeitPct = clampPct((bike.topspeed / IDLE_BALANCE.STAT_BAR_MAX_TOPSPEED) * 100 * boost);
  var beschleunigungPct = clampPct((bike.ps / IDLE_BALANCE.STAT_BAR_MAX_PS) * 100 * boost);
  var ertragBonusPct = clampPct((lvl / IDLE_BALANCE.TUNING_LEVEL_CAP) * 100);
  var ertragMultiplier = 1 + lvl * IDLE_BALANCE.ERTRAG_BONUS_PER_LEVEL;
  return {
    geschwindigkeitPct: geschwindigkeitPct,
    beschleunigungPct: beschleunigungPct,
    ertragBonusPct: ertragBonusPct,
    ertragMultiplier: ertragMultiplier,
  };
}

/**
 * Begrenzt einen Prozentwert auf den Bereich [0, 100].
 * @param {number} value - Eingabewert.
 * @returns {number} Begrenzter Wert.
 */
function clampPct(value) {
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

/**
 * Liefert den bikeSpeedFactor für die Ertragsberechnung: das Verhältnis
 * der Topspeed des aktuell gefahrenen Bikes zur Topspeed des Startbikes.
 * Schnellere (später gekaufte) Bikes erwirtschaften dadurch spürbar mehr
 * km pro Sekunde/Klick als das Startbike.
 * @param {Object} bike - Aktuell gefahrenes Bike (IDLE_BIKES-Eintrag).
 * @returns {number} Faktor >= 1.
 */
function bikeSpeedFactor(bike) {
  var starter = IDLE_BIKES[IDLE_BALANCE.STARTER_BIKE_INDEX];
  if (!starter || !starter.topspeed) return 1;
  return bike.topspeed / starter.topspeed;
}

/**
 * Berechnet den passiven km-Ertrag für ein Zeitintervall, basierend auf
 * dem aktuell gefahrenen Bike (Topspeed-Faktor) und dessen Tuning-Level
 * (Ertrag-Bonus). Reine Funktion — mutiert state NICHT.
 * @param {Object} state - Zentraler Idle-Zustand (liest currentBikeId/bikeLevels).
 * @param {number} dtSeconds - Verstrichene Zeit in Sekunden (>= 0).
 * @returns {number} Erwirtschaftete km (>= 0).
 */
function passiveEarn(state, dtSeconds) {
  if (!dtSeconds || dtSeconds <= 0) return 0;
  var bike = getBikeById(state.currentBikeId) || IDLE_BIKES[IDLE_BALANCE.STARTER_BIKE_INDEX];
  var level = getBikeLevel(state, bike.id);
  var stats = deriveBikeStats(bike, level);
  return IDLE_BALANCE.PASSIVE_KM_PER_SEC * dtSeconds * stats.ertragMultiplier * bikeSpeedFactor(bike);
}

/**
 * Berechnet den km-Ertrag für EINEN Klick auf "Gas geben", basierend auf
 * dem aktuell gefahrenen Bike (Topspeed-Faktor) und dessen Tuning-Level
 * (Ertrag-Bonus). Reine Funktion — mutiert state NICHT.
 * @param {Object} state - Zentraler Idle-Zustand (liest currentBikeId/bikeLevels).
 * @returns {number} Erwirtschaftete km (>= 0).
 */
function activeEarn(state) {
  var bike = getBikeById(state.currentBikeId) || IDLE_BIKES[IDLE_BALANCE.STARTER_BIKE_INDEX];
  var level = getBikeLevel(state, bike.id);
  var stats = deriveBikeStats(bike, level);
  return IDLE_BALANCE.ACTIVE_KM_PER_CLICK * stats.ertragMultiplier * bikeSpeedFactor(bike);
}

/**
 * Erzeugt einen frischen, initialen Idle-Zustand (Startbike besessen und
 * ausgewählt, 0 km, Level 0). Enthält bereits alle Erweiterungsfelder aus
 * Phase B (combo/sound) sowie Phase C (prestige inkl. Trophäen/Verträge,
 * parts, offline, stats), damit die Zustandsform von Anfang an stabil ist.
 * @returns {Object} Neuer, gültiger Idle-Zustand mit version=IDLE_STATE_VERSION.
 */
function createInitialState() {
  var starter = IDLE_BIKES[IDLE_BALANCE.STARTER_BIKE_INDEX];
  var bikeLevels = {};
  bikeLevels[starter.id] = 0;
  return {
    version: IDLE_STATE_VERSION,
    km: 0,
    totalKmEarned: 0,
    ownedBikeIds: [starter.id],
    currentBikeId: starter.id,
    bikeLevels: bikeLevels,
    lastSavedAt: null,

    /* ── Phase C: MECHANIK B — Saison/Prestige/Werksverträge ──────
     * level = Anzahl abgeschlossener Saisons (0 = erste, laufende
     * Saison). points = Lebenszeit-Summe aller je verdienten Trophäen
     * (Statistik, sinkt nie). trophies = aktuell verfügbare/ausgebbare
     * Trophäen (siehe buyContract). contracts = ids der dauerhaft
     * gekauften Werksverträge (überleben jeden Saison-Reset). */
    prestige: { level: 0, points: 0, trophies: 0, contracts: [] },
    /** Gesammelte Teile-ids (siehe IDLE_PARTS/addPart) — permanent, überlebt Saison-Resets. */
    parts: { collected: [] },
    /** Zeitstempel (ms) der letzten Sichtung, für die Offline-Ertragsberechnung beim nächsten Laden. */
    offline: { lastSeenAt: null },
    /** Zentrale Statistiken (siehe recordLap/recordComboPeak/addPlayTime/finishSeason). */
    stats: { laps: 0, bestCombo: 0, seasonHistory: [], playTimeSeconds: 0 },

    /* ── Phase B ────────────────────────────────────────────────── */
    /** Schaltpunkt-Combo-Fortschritt (siehe applyShiftResult/comboMultiplier). */
    combo: { count: 0, multiplier: 1, multiplierExpiresAt: null },
    /** Motorsound-Einstellungen (Web Audio, standardmässig AUS). */
    sound: { enabled: false, volume: 0.5 },

    /* ── Phase D: MECHANIK A — Werkstattrechnungen + Insolvenz ─────
     * Lebenszeit-Zähler (überleben jeden Saison-Reset) PLUS die aktuell
     * fällige Rechnung (activeBill*, null falls keine offen) — wird
     * persistiert, damit ein schnelles Neuladen eine noch laufende Frist
     * nicht einfach verschwinden lässt (siehe idle.js). insolvencyFreeFlag
     * startet true und wird bei einer Insolvenz auf false gesetzt; ein
     * darauffolgender ERFOLGREICHER Saisonabschluss zählt dann NICHT als
     * insolvenzfrei (siehe finishSeason/triggerInsolvency). */
    finance: {
      billsPaidOnTime: 0,
      billsPaidLastSecond: 0,
      insolvencies: 0,
      seasonsInsolvencyFree: 0,
      insolvencyFreeFlag: true,
      activeBillAmount: null,
      activeBillDueAt: null,
      activeBillGraceSeconds: null,
    },
    /** Gesammelte Ausrüstungs-ids (siehe IDLE_GEAR_ITEMS/addGear) — permanent, überlebt Saison-Resets. */
    gear: { collected: [] },

    /* ── Phase E: MECHANIK B — Sparschweine zerschlagen ────────────
     * Eigener, kleiner Namensraum (parallel zu finance/gear) — NUR ein
     * Lebenszeit-Zähler, überlebt Saison-Resets (siehe finishSeason()),
     * genutzt für die "10 Sparschweine zerschlagen"-Achievement. */
    piggy: { smashedCount: 0 },

    /* ── Teil 1: ENDLESS-RUNNER — 2–3-Lane-Straße ───────────────────
     * lane = aktuell gewählte Fahrspur (0-basiert, startet mittig).
     * lastInputAt = Zeitstempel (ms) der letzten Lane-Wechsel-Eingabe,
     * null = noch nie gesteuert (→ runnerActivityState() liefert sofort
     * 'idle', der Auto-Run greift also von Anfang an, siehe idle.js).
     * collisionMalusExpiresAt = Zeitstempel (ms), bis zu dem der rein
     * visuelle Kollisions-Geschwindigkeits-Malus aktiv ist (null = kein
     * aktiver Malus, siehe collisionSpeedMalus()/applyCollisionMalus()).
     * Hindernisse selbst werden bewusst NICHT persistiert (transienter
     * Laufzeit-Zustand in idle.js, identisches Muster zu trackTrail/
     * piggyState/shiftState) — ein Reload startet einfach mit einer
     * leeren Straße, ohne die Runner-Mechanik zu beeinträchtigen. */
    runner: {
      lane: Math.floor(IDLE_BALANCE.RUNNER_LANE_COUNT / 2),
      lastInputAt: null,
      collisionMalusExpiresAt: null,
    },
  };
}

/**
 * Migriert das prestige-Feld (level/points/trophies/contracts) defensiv.
 * @param {*} raw - Rohes Zustandsobjekt (evtl. null/korrupt).
 * @param {Object} fresh - Frischer Referenzzustand für Standardwerte.
 * @returns {Object} Gültiges prestige-Objekt.
 */
function migratePrestige(raw, fresh) {
  var rp = raw && raw.prestige && typeof raw.prestige === 'object' ? raw.prestige : {};
  return {
    level: typeof rp.level === 'number' && rp.level >= 0 ? rp.level : fresh.prestige.level,
    points: typeof rp.points === 'number' && rp.points >= 0 ? rp.points : fresh.prestige.points,
    trophies: typeof rp.trophies === 'number' && rp.trophies >= 0 ? rp.trophies : fresh.prestige.trophies,
    contracts: Array.isArray(rp.contracts) ? rp.contracts.filter(function (id) { return !!getContractById(id); }) : fresh.prestige.contracts.slice(),
  };
}

/**
 * Migriert das parts-Feld (gesammelte Teile-ids) defensiv — unbekannte/
 * ungültige ids werden verworfen.
 * @param {*} raw - Rohes Zustandsobjekt (evtl. null/korrupt).
 * @param {Object} fresh - Frischer Referenzzustand für Standardwerte.
 * @returns {Object} Gültiges parts-Objekt.
 */
function migrateParts(raw, fresh) {
  var rp = raw && raw.parts && typeof raw.parts === 'object' ? raw.parts : {};
  return {
    collected: Array.isArray(rp.collected) ? rp.collected.filter(function (id) { return !!getPartById(id); }) : fresh.parts.collected.slice(),
  };
}

/**
 * Migriert das finance-Feld (Werkstattrechnungen/Insolvenz-Zähler + aktuell
 * fällige Rechnung) defensiv. Lebenszeit-Zähler und die aktuell fällige
 * Rechnung (activeBill*, siehe createInitialState) werden je einzeln aus
 * raw übernommen, falls gültig getypt, sonst aus fresh übernommen.
 * @param {*} raw - Rohes Zustandsobjekt (evtl. null/korrupt).
 * @param {Object} fresh - Frischer Referenzzustand für Standardwerte.
 * @returns {Object} Gültiges finance-Objekt.
 */
function migrateFinance(raw, fresh) {
  var rf = raw && raw.finance && typeof raw.finance === 'object' ? raw.finance : {};
  return {
    billsPaidOnTime: typeof rf.billsPaidOnTime === 'number' && rf.billsPaidOnTime >= 0 ? rf.billsPaidOnTime : fresh.finance.billsPaidOnTime,
    billsPaidLastSecond: typeof rf.billsPaidLastSecond === 'number' && rf.billsPaidLastSecond >= 0 ? rf.billsPaidLastSecond : fresh.finance.billsPaidLastSecond,
    insolvencies: typeof rf.insolvencies === 'number' && rf.insolvencies >= 0 ? rf.insolvencies : fresh.finance.insolvencies,
    seasonsInsolvencyFree: typeof rf.seasonsInsolvencyFree === 'number' && rf.seasonsInsolvencyFree >= 0 ? rf.seasonsInsolvencyFree : fresh.finance.seasonsInsolvencyFree,
    insolvencyFreeFlag: typeof rf.insolvencyFreeFlag === 'boolean' ? rf.insolvencyFreeFlag : fresh.finance.insolvencyFreeFlag,
    activeBillAmount: typeof rf.activeBillAmount === 'number' && rf.activeBillAmount >= 0 ? rf.activeBillAmount : null,
    activeBillDueAt: typeof rf.activeBillDueAt === 'number' ? rf.activeBillDueAt : null,
    activeBillGraceSeconds: typeof rf.activeBillGraceSeconds === 'number' && rf.activeBillGraceSeconds > 0 ? rf.activeBillGraceSeconds : null,
  };
}

/**
 * Migriert das gear-Feld (gesammelte Ausrüstungs-ids) defensiv — unbekannte/
 * ungültige ids werden verworfen (mirrors migrateParts()).
 * @param {*} raw - Rohes Zustandsobjekt (evtl. null/korrupt).
 * @param {Object} fresh - Frischer Referenzzustand für Standardwerte.
 * @returns {Object} Gültiges gear-Objekt.
 */
function migrateGear(raw, fresh) {
  var rg = raw && raw.gear && typeof raw.gear === 'object' ? raw.gear : {};
  return {
    collected: Array.isArray(rg.collected) ? rg.collected.filter(function (id) { return !!getGearItemById(id); }) : fresh.gear.collected.slice(),
  };
}

/**
 * Migriert das piggy-Feld (Lebenszeit-Zähler zerschlagener Sparschweine)
 * defensiv.
 * @param {*} raw - Rohes Zustandsobjekt (evtl. null/korrupt).
 * @param {Object} fresh - Frischer Referenzzustand für Standardwerte.
 * @returns {Object} Gültiges piggy-Objekt.
 */
function migratePiggy(raw, fresh) {
  var rp = raw && raw.piggy && typeof raw.piggy === 'object' ? raw.piggy : {};
  return {
    smashedCount: typeof rp.smashedCount === 'number' && rp.smashedCount >= 0 ? rp.smashedCount : fresh.piggy.smashedCount,
  };
}

/**
 * Migriert das runner-Feld (Teil 1: Endless-Runner-Lane/Kollisions-Malus)
 * defensiv — u. a. für v2→v3-Saves (vor feat(idle-runner)), die dieses
 * Feld noch gar nicht kennen. Eine runner.lane ausserhalb des gültigen
 * Bereichs (z. B. aus einem Save mit einer inzwischen geänderten
 * RUNNER_LANE_COUNT) wird auf die mittige Standard-Lane zurückgesetzt.
 * @param {*} raw - Rohes Zustandsobjekt (evtl. null/korrupt).
 * @param {Object} fresh - Frischer Referenzzustand für Standardwerte.
 * @returns {Object} Gültiges runner-Objekt.
 */
function migrateRunner(raw, fresh) {
  var rr = raw && raw.runner && typeof raw.runner === 'object' ? raw.runner : {};
  var laneCount = IDLE_BALANCE.RUNNER_LANE_COUNT;
  var laneValid = typeof rr.lane === 'number' && rr.lane >= 0 && rr.lane < laneCount;
  return {
    lane: laneValid ? rr.lane : fresh.runner.lane,
    lastInputAt: typeof rr.lastInputAt === 'number' ? rr.lastInputAt : fresh.runner.lastInputAt,
    collisionMalusExpiresAt: typeof rr.collisionMalusExpiresAt === 'number' ? rr.collisionMalusExpiresAt : fresh.runner.collisionMalusExpiresAt,
  };
}

/**
 * Migriert das offline-Feld (Zeitstempel der letzten Sichtung) defensiv.
 * @param {*} raw - Rohes Zustandsobjekt (evtl. null/korrupt).
 * @param {Object} fresh - Frischer Referenzzustand für Standardwerte.
 * @returns {Object} Gültiges offline-Objekt.
 */
function migrateOffline(raw, fresh) {
  var ro = raw && raw.offline && typeof raw.offline === 'object' ? raw.offline : {};
  return {
    lastSeenAt: typeof ro.lastSeenAt === 'number' ? ro.lastSeenAt : fresh.offline.lastSeenAt,
  };
}

/**
 * Migriert das stats-Feld (Laps/beste Combo/Saison-Historie/Spielzeit)
 * defensiv.
 * @param {*} raw - Rohes Zustandsobjekt (evtl. null/korrupt).
 * @param {Object} fresh - Frischer Referenzzustand für Standardwerte.
 * @returns {Object} Gültiges stats-Objekt.
 */
function migrateStats(raw, fresh) {
  var rs = raw && raw.stats && typeof raw.stats === 'object' ? raw.stats : {};
  return {
    laps: typeof rs.laps === 'number' && rs.laps >= 0 ? rs.laps : fresh.stats.laps,
    bestCombo: typeof rs.bestCombo === 'number' && rs.bestCombo >= 0 ? rs.bestCombo : fresh.stats.bestCombo,
    seasonHistory: Array.isArray(rs.seasonHistory) ? rs.seasonHistory.slice() : fresh.stats.seasonHistory.slice(),
    playTimeSeconds: typeof rs.playTimeSeconds === 'number' && rs.playTimeSeconds >= 0 ? rs.playTimeSeconds : fresh.stats.playTimeSeconds,
  };
}

/**
 * Migriert/validiert ein aus localStorage geparstes Rohobjekt zu einem
 * garantiert gültigen, aktuellen Idle-Zustand. Fehlt das Objekt komplett,
 * ist es kein Objekt, fehlt/veraltet die version, oder fehlen/haben
 * einzelne Felder einen falschen Typ, werden sie defensiv aus einem
 * frischen createInitialState() aufgefüllt (nie ein Fehler/Absturz).
 * @param {*} raw - Rohwert (z. B. JSON.parse-Ergebnis, evtl. null/korrupt).
 * @returns {Object} Gültiger Idle-Zustand mit version=IDLE_STATE_VERSION.
 */
function migrateState(raw) {
  var fresh = createInitialState();
  if (!raw || typeof raw !== 'object') return fresh;

  var state = {
    version: IDLE_STATE_VERSION,
    km: typeof raw.km === 'number' && raw.km >= 0 ? raw.km : fresh.km,
    totalKmEarned: typeof raw.totalKmEarned === 'number' && raw.totalKmEarned >= 0 ? raw.totalKmEarned : fresh.totalKmEarned,
    ownedBikeIds: Array.isArray(raw.ownedBikeIds) && raw.ownedBikeIds.length > 0 ? raw.ownedBikeIds.filter(function (id) { return findBikeIndex(id) !== -1; }) : fresh.ownedBikeIds.slice(),
    currentBikeId: typeof raw.currentBikeId === 'string' && findBikeIndex(raw.currentBikeId) !== -1 ? raw.currentBikeId : fresh.currentBikeId,
    bikeLevels: raw.bikeLevels && typeof raw.bikeLevels === 'object' ? raw.bikeLevels : fresh.bikeLevels,
    lastSavedAt: typeof raw.lastSavedAt === 'number' ? raw.lastSavedAt : fresh.lastSavedAt,
    prestige: migratePrestige(raw, fresh),
    parts: migrateParts(raw, fresh),
    offline: migrateOffline(raw, fresh),
    stats: migrateStats(raw, fresh),
    combo: raw.combo && typeof raw.combo === 'object' ? {
      count: typeof raw.combo.count === 'number' && raw.combo.count >= 0 ? raw.combo.count : 0,
      multiplier: typeof raw.combo.multiplier === 'number' && raw.combo.multiplier >= 1 ? raw.combo.multiplier : 1,
      multiplierExpiresAt: typeof raw.combo.multiplierExpiresAt === 'number' ? raw.combo.multiplierExpiresAt : null,
    } : fresh.combo,
    sound: raw.sound && typeof raw.sound === 'object' ? {
      enabled: typeof raw.sound.enabled === 'boolean' ? raw.sound.enabled : false,
      volume: typeof raw.sound.volume === 'number' && raw.sound.volume >= 0 && raw.sound.volume <= 1 ? raw.sound.volume : 0.5,
    } : fresh.sound,
    finance: migrateFinance(raw, fresh),
    gear: migrateGear(raw, fresh),
    piggy: migratePiggy(raw, fresh),
    runner: migrateRunner(raw, fresh),
  };

  if (state.ownedBikeIds.length === 0) state.ownedBikeIds = fresh.ownedBikeIds.slice();
  if (state.ownedBikeIds.indexOf(state.currentBikeId) === -1) state.currentBikeId = state.ownedBikeIds[0];

  return state;
}

/**
 * Liest den zentralen Idle-Zustand aus localStorage und migriert/validiert
 * ihn. Bei leerem/fehlendem/korruptem Speicher wird ein frischer, gültiger
 * Zustand zurückgegeben (nie ein Fehler nach außen).
 * @returns {Object} Gültiger Idle-Zustand.
 */
function loadState() {
  try {
    if (typeof localStorage === 'undefined' || localStorage === null) return createInitialState();
    var raw = localStorage.getItem(IDLE_STATE_KEY);
    if (raw === null || raw === undefined) return createInitialState();
    return migrateState(JSON.parse(raw));
  } catch (e) {
    return createInitialState();
  }
}

/**
 * Persistiert den zentralen Idle-Zustand in localStorage (setzt
 * lastSavedAt UND — falls vorhanden — offline.lastSeenAt auf jetzt, damit
 * der nächste Ladevorgang die tatsächlich verstrichene Abwesenheitszeit
 * für offlineEarn() korrekt berechnen kann; das deckt automatisch alle
 * Aufruf-Stellen ab, siehe idle.js wireLifecycleSave()). Rein additiv/
 * defensiv — darf die Seite nie blockieren, falls localStorage nicht
 * verfügbar/voll ist.
 * @param {Object} state - Zu speichernder Idle-Zustand.
 * @returns {void}
 */
function saveState(state) {
  try {
    if (typeof localStorage === 'undefined' || localStorage === null) return;
    state.lastSavedAt = Date.now();
    if (state.offline && typeof state.offline === 'object') state.offline.lastSeenAt = state.lastSavedAt;
    localStorage.setItem(IDLE_STATE_KEY, JSON.stringify(state));
  } catch (e) {
    /* bewusst ignoriert — darf App nie blockieren */
  }
}

/**
 * Prüft, ob das nächste (noch nicht besessene) Bike in der IDLE_BIKES-
 * Reihenfolge aktuell käuflich ist (genug km vorhanden). Bikes müssen in
 * aufsteigender Reihenfolge gekauft werden.
 * @param {Object} state - Zentraler Idle-Zustand.
 * @returns {{bike: Object|null, cost: number, affordable: boolean}} Info
 *   zum nächsten Bike, oder bike:null falls bereits alle besessen.
 */
function getNextBikeToBuy(state) {
  var nextIndex = state.ownedBikeIds.length;
  if (nextIndex >= IDLE_BIKES.length) return { bike: null, cost: 0, affordable: false };
  var bike = IDLE_BIKES[nextIndex];
  var cost = bikeCost(nextIndex);
  return { bike: bike, cost: cost, affordable: state.km >= cost };
}

/**
 * Kauft das nächste Bike in der IDLE_BIKES-Reihenfolge, falls genug km
 * vorhanden sind. Mutiert state bei Erfolg (zieht km ab, fügt zu
 * ownedBikeIds hinzu, initialisiert bikeLevels-Eintrag mit 0).
 * @param {Object} state - Zentraler Idle-Zustand (wird bei Erfolg mutiert).
 * @returns {{success: boolean, bike: (Object|null), cost: number}} Ergebnis.
 */
function buyNextBike(state) {
  var next = getNextBikeToBuy(state);
  if (!next.bike || !next.affordable) return { success: false, bike: next.bike, cost: next.cost };
  state.km -= next.cost;
  state.ownedBikeIds.push(next.bike.id);
  if (typeof state.bikeLevels[next.bike.id] !== 'number') state.bikeLevels[next.bike.id] = 0;
  return { success: true, bike: next.bike, cost: next.cost };
}

/**
 * Erhöht das Tuning-Level eines besessenen Bikes um 1, falls genug km
 * vorhanden sind UND das Level-Cap noch nicht erreicht ist. Nutzt
 * effectiveTuningCost() statt der rohen tuningCost(), damit der
 * "Tuning 15% günstiger"-Werksvertrag (siehe contractEffects) automatisch
 * greift. Mutiert state bei Erfolg.
 * @param {Object} state - Zentraler Idle-Zustand (wird bei Erfolg mutiert).
 * @param {string} bikeId - id des zu tunenden, besessenen Bikes.
 * @returns {{success: boolean, cost: (number|null), newLevel: number}} Ergebnis.
 */
function upgradeBike(state, bikeId) {
  if (state.ownedBikeIds.indexOf(bikeId) === -1) return { success: false, cost: null, newLevel: getBikeLevel(state, bikeId) };
  var currentLevel = getBikeLevel(state, bikeId);
  var cost = effectiveTuningCost(state, bikeId, currentLevel);
  if (cost === null || state.km < cost) return { success: false, cost: cost, newLevel: currentLevel };
  state.km -= cost;
  state.bikeLevels[bikeId] = currentLevel + 1;
  return { success: true, cost: cost, newLevel: currentLevel + 1 };
}

/**
 * Wechselt das aktuell gefahrene Bike, sofern es bereits besessen ist.
 * @param {Object} state - Zentraler Idle-Zustand (wird bei Erfolg mutiert).
 * @param {string} bikeId - id des Ziel-Bikes.
 * @returns {boolean} true bei Erfolg, false falls Bike nicht besessen.
 */
function selectBike(state, bikeId) {
  if (state.ownedBikeIds.indexOf(bikeId) === -1) return false;
  state.currentBikeId = bikeId;
  return true;
}

/**
 * Gutschreibt einen km-Betrag auf den Zustand (km + totalKmEarned).
 * Zentrale Stelle, damit Passiv-/Aktiv-Ertrag konsistent gebucht werden.
 * @param {Object} state - Zentraler Idle-Zustand (wird mutiert).
 * @param {number} amount - Zu verbuchende km (>= 0).
 * @returns {void}
 */
function creditKm(state, amount) {
  if (!amount || amount <= 0) return;
  state.km += amount;
  state.totalKmEarned += amount;
}

/**
 * MECHANIK A — Schaltpunkt-Combo: berechnet den Ertrags-Multiplikator für
 * eine gegebene Combo-Anzahl. Combo 0 (oder kleiner) bedeutet "kein
 * Multiplikator" (1x). Ab Combo 1 startet der Multiplikator bei
 * COMBO_MULTIPLIER_BASE und wächst je weiterem Combo-Punkt um
 * COMBO_MULTIPLIER_STEP, gedeckelt auf COMBO_MULTIPLIER_MAX. Reine,
 * deterministische Funktion.
 * @param {number} combo - Aktuelle Combo-Anzahl (>= 0).
 * @returns {number} Ertrags-Multiplikator (1 bis COMBO_MULTIPLIER_MAX).
 */
function comboMultiplier(combo) {
  if (!combo || combo <= 0) return 1;
  var raw = IDLE_BALANCE.COMBO_MULTIPLIER_BASE + (combo - 1) * IDLE_BALANCE.COMBO_MULTIPLIER_STEP;
  return Math.min(IDLE_BALANCE.COMBO_MULTIPLIER_MAX, raw);
}

/**
 * MECHANIK A — Schaltpunkt-Combo: berechnet die Breite der "perfekten
 * Zone" (in % der Leistenbreite) für eine gegebene Combo-Anzahl. Die Zone
 * schrumpft monoton mit steigender Combo (schwerer zu treffen bei hoher
 * Combo), fällt aber nie unter COMBO_ZONE_MIN_WIDTH_PCT. Reine,
 * deterministische Funktion.
 * @param {number} combo - Aktuelle Combo-Anzahl (>= 0).
 * @param {number} [baseWidth] - Basis-Breite in % (Combo 0); Standard
 *   IDLE_BALANCE.COMBO_ZONE_BASE_WIDTH_PCT, falls ausgelassen/ungültig.
 * @returns {number} Zonenbreite in % (>= COMBO_ZONE_MIN_WIDTH_PCT).
 */
function perfectZoneWidth(combo, baseWidth) {
  var base = typeof baseWidth === 'number' && baseWidth > 0 ? baseWidth : IDLE_BALANCE.COMBO_ZONE_BASE_WIDTH_PCT;
  var c = combo > 0 ? combo : 0;
  var shrunk = base - c * IDLE_BALANCE.COMBO_ZONE_SHRINK_PER_COMBO_PCT;
  return Math.max(IDLE_BALANCE.COMBO_ZONE_MIN_WIDTH_PCT, shrunk);
}

/**
 * Stellt sicher, dass state.combo ein gültiges Objekt ist (defensiv, für
 * Zustände, die nicht über createInitialState()/migrateState() gelaufen
 * sind, z. B. handgebaute Test-Zustände).
 * @param {Object} state - Zentraler Idle-Zustand (wird ggf. mutiert).
 * @returns {void}
 */
function ensureComboState(state) {
  if (!state.combo || typeof state.combo !== 'object') {
    state.combo = { count: 0, multiplier: 1, multiplierExpiresAt: null };
  }
}

/**
 * MECHANIK A — Schaltpunkt-Combo: verarbeitet das Ergebnis EINES Klicks
 * auf die Schaltpunkt-Leiste. Treffer (hit=true) erhöht die Combo um 1
 * und gewährt für IDLE_BALANCE.COMBO_MULTIPLIER_DURATION_MS den per
 * comboMultiplier() berechneten Ertrags-Multiplikator. Fehlklick
 * (hit=false) setzt Combo UND aktiven Multiplikator zurück. Mutiert
 * state.combo. Ignorieren (Leiste läuft unbeklickt ab) ruft diese
 * Funktion NICHT auf — daher keine Strafe fürs Ignorieren.
 * @param {Object} state - Zentraler Idle-Zustand (wird mutiert).
 * @param {boolean} hit - true = Klick innerhalb der perfekten Zone.
 * @param {number} [nowMs] - Zeitstempel "jetzt" in ms; Standard Date.now()
 *   (als Parameter überreichbar, damit die Funktion deterministisch/
 *   testbar bleibt).
 * @returns {{count:number, multiplier:number, multiplierExpiresAt:(number|null)}} Neuer Combo-Zustand.
 */
function applyShiftResult(state, hit, nowMs) {
  var now = typeof nowMs === 'number' ? nowMs : Date.now();
  ensureComboState(state);
  if (hit) {
    state.combo.count += 1;
    state.combo.multiplier = comboMultiplier(state.combo.count);
    state.combo.multiplierExpiresAt = now + IDLE_BALANCE.COMBO_MULTIPLIER_DURATION_MS;
  } else {
    state.combo.count = 0;
    state.combo.multiplier = 1;
    state.combo.multiplierExpiresAt = null;
  }
  return { count: state.combo.count, multiplier: state.combo.multiplier, multiplierExpiresAt: state.combo.multiplierExpiresAt };
}

/**
 * Liefert den aktuell aktiven Combo-Ertrags-Multiplikator (1, falls kein
 * Treffer-Multiplikator gerade aktiv/abgelaufen ist). Reine Funktion —
 * mutiert state NICHT. Für die Anwendung des Multiplikators auf
 * passiveEarn()/activeEarn()-Erträge in idle.js gedacht.
 * @param {Object} state - Zentraler Idle-Zustand.
 * @param {number} [nowMs] - Zeitstempel "jetzt" in ms; Standard Date.now().
 * @returns {number} Aktiver Multiplikator (>= 1).
 */
function activeComboMultiplier(state, nowMs) {
  var now = typeof nowMs === 'number' ? nowMs : Date.now();
  if (!state || !state.combo || typeof state.combo.multiplierExpiresAt !== 'number') return 1;
  if (now >= state.combo.multiplierExpiresAt) return 1;
  return state.combo.multiplier || 1;
}

/**
 * Würfelt das nächste Zufallsintervall (Sekunden) bis zur nächsten
 * Schaltpunkt-Leiste, zwischen SHIFT_INTERVAL_MIN_SECONDS und
 * SHIFT_INTERVAL_MAX_SECONDS. Zufälligkeit wird als Parameter
 * übergeben (Standard Math.random), damit die Funktion testbar bleibt.
 * @param {Function} [randomFn] - Zufallsfunktion, liefert [0,1); Standard Math.random.
 * @returns {number} Sekunden bis zur nächsten Schaltpunkt-Leiste.
 */
function nextShiftIntervalSeconds(randomFn) {
  var rnd = typeof randomFn === 'function' ? randomFn : Math.random;
  var min = IDLE_BALANCE.SHIFT_INTERVAL_MIN_SECONDS;
  var max = IDLE_BALANCE.SHIFT_INTERVAL_MAX_SECONDS;
  return min + rnd() * (max - min);
}

/* ============================================================
   MECHANIK B — SAISON/PRESTIGE/WERKSVERTRÄGE — feat(idle-prestige)
   ============================================================ */

/**
 * Findet einen Werksvertrag anhand seiner id.
 * @param {string} contractId - id des Werksvertrags.
 * @returns {Object|null} Eintrag aus IDLE_CONTRACTS, oder null.
 */
function getContractById(contractId) {
  for (var i = 0; i < IDLE_CONTRACTS.length; i++) {
    if (IDLE_CONTRACTS[i].id === contractId) return IDLE_CONTRACTS[i];
  }
  return null;
}

/**
 * Aggregiert ALLE aktiven Werksvertrag-Effekte (siehe IDLE_CONTRACTS)
 * UND den permanenten Pro-Saison-Bonus (IDLE_BALANCE.PRESTIGE_BONUS_PER_
 * LEVEL) zu einem einzigen Ergebnisobjekt. Reine, deterministische
 * Funktion — mutiert state NICHT. Zentrale Stelle, die von earn-/tuning-/
 * offline-/combo-zone-Berechnungen konsumiert wird (siehe passiveEarn/
 * activeEarn-Aufrufstellen in idle.js, effectiveTuningCost, offlineEarn,
 * perfectZoneWidthForState).
 * @param {Object} state - Zentraler Idle-Zustand.
 * @returns {{earnMultiplier:number, startBikeId:(string|null), zoneWidthBonusPct:number, offlineCapMultiplier:number, tuningCostMultiplier:number}} Aggregierte Effekte.
 */
function contractEffects(state) {
  var effects = {
    earnMultiplier: 1,
    startBikeId: null,
    zoneWidthBonusPct: 0,
    offlineCapMultiplier: 1,
    tuningCostMultiplier: 1,
  };
  if (!state) return effects;

  var level = state.prestige && typeof state.prestige.level === 'number' ? state.prestige.level : 0;
  effects.earnMultiplier *= 1 + level * IDLE_BALANCE.PRESTIGE_BONUS_PER_LEVEL;

  var contracts = state.prestige && Array.isArray(state.prestige.contracts) ? state.prestige.contracts : [];
  contracts.forEach(function (contractId) {
    var contract = getContractById(contractId);
    if (!contract) return;
    switch (contract.effect) {
      case 'earnMultiplier': effects.earnMultiplier *= contract.value; break;
      case 'startBikeId': effects.startBikeId = contract.value; break;
      case 'zoneWidthBonusPct': effects.zoneWidthBonusPct += contract.value; break;
      case 'offlineCapMultiplier': effects.offlineCapMultiplier *= contract.value; break;
      case 'tuningCostMultiplier': effects.tuningCostMultiplier *= contract.value; break;
      default: break;
    }
  });
  return effects;
}

/**
 * Prüft, ob ein Werksvertrag aktuell kaufbar ist (existiert, noch nicht
 * besessen, genug Trophäen vorhanden).
 * @param {Object} state - Zentraler Idle-Zustand.
 * @param {string} contractId - id des Werksvertrags.
 * @returns {boolean} true, falls kaufbar.
 */
function canBuyContract(state, contractId) {
  var contract = getContractById(contractId);
  if (!contract || !state || !state.prestige) return false;
  if (Array.isArray(state.prestige.contracts) && state.prestige.contracts.indexOf(contractId) !== -1) return false;
  return (state.prestige.trophies || 0) >= contract.kostenTrophaeen;
}

/**
 * Kauft einen Werksvertrag, falls canBuyContract() zustimmt. Zieht die
 * Trophäenkosten ab und fügt die id dauerhaft zu state.prestige.contracts
 * hinzu (überlebt jeden Saison-Reset). Mutiert state bei Erfolg.
 * @param {Object} state - Zentraler Idle-Zustand (wird bei Erfolg mutiert).
 * @param {string} contractId - id des zu kaufenden Werksvertrags.
 * @returns {{success: boolean, cost: (number|null)}} Ergebnis.
 */
function buyContract(state, contractId) {
  var contract = getContractById(contractId);
  if (!canBuyContract(state, contractId)) return { success: false, cost: contract ? contract.kostenTrophaeen : null };
  state.prestige.trophies -= contract.kostenTrophaeen;
  state.prestige.contracts.push(contractId);
  return { success: true, cost: contract.kostenTrophaeen };
}

/**
 * Berechnet die Anzahl Trophäen, die ein Saisonabschluss JETZT gewähren
 * würde: 1 Trophäe pro über das Startbike hinaus gekauftem Bike, plus 1
 * Bonus-Trophäe je IDLE_BALANCE.TROPHY_LEVEL_BONUS_DIVISOR kumulierten
 * Tuning-Leveln (über alle Bikes). Reine, deterministische Funktion.
 * @param {Object} state - Zentraler Idle-Zustand.
 * @returns {number} Anzahl Trophäen (>= 0).
 */
function trophiesForSeason(state) {
  if (!state || !Array.isArray(state.ownedBikeIds)) return 0;
  var bikesBeyondStarter = Math.max(0, state.ownedBikeIds.length - 1);
  var totalLevels = 0;
  if (state.bikeLevels && typeof state.bikeLevels === 'object') {
    Object.keys(state.bikeLevels).forEach(function (id) {
      var lvl = state.bikeLevels[id];
      if (typeof lvl === 'number' && lvl > 0) totalLevels += lvl;
    });
  }
  var levelBonus = Math.floor(totalLevels / IDLE_BALANCE.TROPHY_LEVEL_BONUS_DIVISOR);
  return bikesBeyondStarter + levelBonus;
}

/**
 * Prüft, ob eine Saison aktuell abgeschlossen werden kann: frühestens ab
 * Besitz der Ninja ZX-10R (Bikes werden strikt in IDLE_BIKES-Reihenfolge
 * gekauft, ein Besitz der ZX-10R impliziert also den Besitz aller
 * günstigeren Bikes davor).
 * @param {Object} state - Zentraler Idle-Zustand.
 * @returns {boolean} true, falls finishSeason() jetzt einen echten Reset ausführen würde.
 */
function canFinishSeason(state) {
  if (!state || !Array.isArray(state.ownedBikeIds)) return false;
  var zxIndex = findBikeIndex('zx10r');
  if (zxIndex === -1) return false;
  return state.ownedBikeIds.length >= zxIndex + 1;
}

/**
 * MECHANIK B — Saison-Abschluss: setzt km, ownedBikeIds, bikeLevels UND
 * die Schaltpunkt-Combo auf einen frischen Saison-Start zurück, während
 * Trophäen, Werksverträge, Teile-Sammlung, Lebenszeit-Statistiken
 * (totalKmEarned/laps/bestCombo/playTimeSeconds), Sound-Einstellungen und
 * der Offline-Zeitstempel PERMANENT erhalten bleiben. Verdient dabei
 * trophiesForSeason(state) neue Trophäen und hängt einen Eintrag an
 * state.stats.seasonHistory an. Reine Funktion — mutiert das übergebene
 * state NICHT, sondern gibt einen komplett neuen Zustand zurück (Aufrufer
 * in idle.js muss die lokale state-Referenz ersetzen + saveState()
 * aufrufen). Ist canFinishSeason(state) false UND opts.bypassEligibilityGate
 * nicht true, wird state UNVERÄNDERT zurückgegeben (kein Reset, kein Effekt).
 * @param {Object} state - Zentraler Idle-Zustand vor dem Saisonabschluss.
 * @param {{bypassEligibilityGate: boolean}} [opts] - Optionen. Bei
 *   bypassEligibilityGate:true wird die ZX-10R-Zugangsschranke
 *   übersprungen und der IDENTISCHE Reset/Erhalt-Ablauf trotzdem
 *   ausgeführt — genutzt von triggerInsolvency() für eine Insolvenz VOR
 *   Besitz der ZX-10R. Voll abwärtskompatibel: ohne opts (alle
 *   bestehenden Aufrufstellen) verhält sich die Funktion exakt wie zuvor.
 * @returns {Object} Neuer, nach dem Saisonabschluss gültiger Idle-Zustand
 *   (oder das unveränderte state, falls (noch) nicht abschliessbar).
 */
function finishSeason(state, opts) {
  var bypassGate = !!(opts && opts.bypassEligibilityGate === true);
  if (!bypassGate && !canFinishSeason(state)) return state;

  var earnedTrophies = trophiesForSeason(state);
  var fresh = createInitialState();
  var prevPrestige = state.prestige || fresh.prestige;
  var prevParts = state.parts || fresh.parts;
  var prevStats = state.stats || fresh.stats;
  var prevGear = state.gear || fresh.gear;
  var prevFinance = state.finance && typeof state.finance === 'object' ? state.finance : fresh.finance;
  var prevPiggy = state.piggy && typeof state.piggy === 'object' ? state.piggy : fresh.piggy;

  fresh.totalKmEarned = typeof state.totalKmEarned === 'number' ? state.totalKmEarned : fresh.totalKmEarned;

  fresh.prestige = {
    level: (typeof prevPrestige.level === 'number' ? prevPrestige.level : 0) + 1,
    points: (typeof prevPrestige.points === 'number' ? prevPrestige.points : 0) + earnedTrophies,
    trophies: (typeof prevPrestige.trophies === 'number' ? prevPrestige.trophies : 0) + earnedTrophies,
    contracts: Array.isArray(prevPrestige.contracts) ? prevPrestige.contracts.slice() : [],
  };
  fresh.parts = { collected: Array.isArray(prevParts.collected) ? prevParts.collected.slice() : [] };
  fresh.gear = { collected: Array.isArray(prevGear.collected) ? prevGear.collected.slice() : [] };
  // Lebenszeit-Zähler, überlebt jeden Saison-Reset (identisches Muster zu finance-Lebenszeit-Zählern unten).
  fresh.piggy = { smashedCount: typeof prevPiggy.smashedCount === 'number' ? prevPiggy.smashedCount : 0 };
  fresh.offline = state.offline && typeof state.offline === 'object' ? { lastSeenAt: state.offline.lastSeenAt } : fresh.offline;
  fresh.sound = state.sound && typeof state.sound === 'object' ? { enabled: state.sound.enabled, volume: state.sound.volume } : fresh.sound;

  // finance: Lebenszeit-Zähler bleiben erhalten; eine noch offene Rechnung
  // wird mit dem Reset hinfällig (activeBill* → null, egal ob freiwilliger
  // Abschluss oder Insolvenz — die Saison, die sie ausgelöst hat, endet
  // gerade). War insolvencyFreeFlag beim Abschluss noch true (diese Saison
  // hatte KEINE Insolvenz), zählt das als "Saison ohne Insolvenz"
  // (seasonsInsolvencyFree) — triggerInsolvency() setzt das Flag VOR
  // diesem Aufruf bewusst auf false, damit eine insolvenz-ausgelöste
  // Saison hier NICHT mitgezählt wird. Jede neue Saison startet wieder
  // mit insolvencyFreeFlag:true.
  var wasInsolvencyFree = prevFinance.insolvencyFreeFlag !== false;
  fresh.finance = {
    billsPaidOnTime: typeof prevFinance.billsPaidOnTime === 'number' ? prevFinance.billsPaidOnTime : 0,
    billsPaidLastSecond: typeof prevFinance.billsPaidLastSecond === 'number' ? prevFinance.billsPaidLastSecond : 0,
    insolvencies: typeof prevFinance.insolvencies === 'number' ? prevFinance.insolvencies : 0,
    seasonsInsolvencyFree: (typeof prevFinance.seasonsInsolvencyFree === 'number' ? prevFinance.seasonsInsolvencyFree : 0) + (wasInsolvencyFree ? 1 : 0),
    insolvencyFreeFlag: true,
    activeBillAmount: null,
    activeBillDueAt: null,
    activeBillGraceSeconds: null,
  };

  var historyEntry = { season: fresh.prestige.level, trophiesEarned: earnedTrophies, finishedAt: Date.now() };
  fresh.stats = {
    laps: typeof prevStats.laps === 'number' ? prevStats.laps : 0,
    bestCombo: typeof prevStats.bestCombo === 'number' ? prevStats.bestCombo : 0,
    playTimeSeconds: typeof prevStats.playTimeSeconds === 'number' ? prevStats.playTimeSeconds : 0,
    seasonHistory: (Array.isArray(prevStats.seasonHistory) ? prevStats.seasonHistory.slice() : []).concat([historyEntry]),
  };

  // "Start mit Ninja 400"-Werksvertrag: die neue Saison beginnt weiter
  // oben in der Bike-Reihe statt beim Z125 PRO.
  var effects = contractEffects(fresh);
  if (effects.startBikeId) {
    var idx = findBikeIndex(effects.startBikeId);
    if (idx > 0) {
      var ownedIds = [];
      var levels = {};
      for (var i = 0; i <= idx; i++) {
        ownedIds.push(IDLE_BIKES[i].id);
        levels[IDLE_BIKES[i].id] = 0;
      }
      fresh.ownedBikeIds = ownedIds;
      fresh.bikeLevels = levels;
      fresh.currentBikeId = effects.startBikeId;
    }
  }

  return fresh;
}

/**
 * Berechnet die tatsächlich zu zahlenden Tuning-Kosten UNTER Berücksichtigung
 * des "Tuning 15% günstiger"-Werksvertrags (siehe contractEffects). Reine
 * Funktion — mutiert state NICHT.
 * @param {Object} state - Zentraler Idle-Zustand (nur lesend, für contractEffects).
 * @param {string} bikeId - id des zu tunenden Bikes.
 * @param {number} currentLevel - Aktuelles Level des Bikes.
 * @returns {number|null} Effektive Kosten in km, oder null (siehe tuningCost()).
 */
function effectiveTuningCost(state, bikeId, currentLevel) {
  var base = tuningCost(bikeId, currentLevel);
  if (base === null) return null;
  var multiplier = contractEffects(state).tuningCostMultiplier;
  var step = IDLE_BALANCE.TUNING_COST_ROUND_TO;
  return Math.max(step, Math.round((base * multiplier) / step) * step);
}

/**
 * Berechnet die Breite der perfekten Schaltpunkt-Zone UNTER
 * Berücksichtigung des "Perfekt-Zone 10% breiter"-Werksvertrags (siehe
 * contractEffects). Reine Funktion — wraps perfectZoneWidth().
 * @param {Object} state - Zentraler Idle-Zustand (nur lesend, für contractEffects).
 * @param {number} combo - Aktuelle Combo-Anzahl (>= 0).
 * @returns {number} Zonenbreite in % (siehe perfectZoneWidth()).
 */
function perfectZoneWidthForState(state, combo) {
  var bonus = contractEffects(state).zoneWidthBonusPct;
  return perfectZoneWidth(combo, IDLE_BALANCE.COMBO_ZONE_BASE_WIDTH_PCT + bonus);
}

/* ============================================================
   TEILE-SAMMLUNG — feat(idle-parts)
   ============================================================ */

/**
 * Findet ein Teil anhand seiner id.
 * @param {string} partId - id des Teils.
 * @returns {Object|null} Eintrag aus IDLE_PARTS, oder null.
 */
function getPartById(partId) {
  for (var i = 0; i < IDLE_PARTS.length; i++) {
    if (IDLE_PARTS[i].id === partId) return IDLE_PARTS[i];
  }
  return null;
}

/**
 * Wählt eine gewichtete Seltenheitsstufe anhand eines Gewichtungsobjekts
 * (Seltenheitsstufe → relatives Gewicht). Zufälligkeit wird als Parameter
 * übergeben, damit die Funktion deterministisch testbar bleibt. Optional
 * pool-fähig (Standard IDLE_BALANCE.PART_RARITY_WEIGHTS — die 3 Teile-
 * Sammlung-Stufen) — bestehende Aufrufstellen ohne zweites Argument
 * verhalten sich exakt wie zuvor. Iteriert in Objekt-Einfügereihenfolge
 * (z. B. common→rare→legendary), identisch zur ursprünglichen festen
 * Reihenfolge.
 * @param {Function} rnd - Zufallsfunktion, liefert [0,1).
 * @param {Object} [weights] - Gewichtungsobjekt {seltenheit: gewicht, ...};
 *   Standard IDLE_BALANCE.PART_RARITY_WEIGHTS.
 * @returns {string} Gewählte Seltenheitsstufe (ein Schlüssel aus weights).
 */
function pickWeightedRarity(rnd, weights) {
  var w = weights || IDLE_BALANCE.PART_RARITY_WEIGHTS;
  var keys = Object.keys(w);
  var total = keys.reduce(function (sum, key) { return sum + w[key]; }, 0);
  var roll = rnd() * total;
  var acc = 0;
  for (var i = 0; i < keys.length; i++) {
    acc += w[keys[i]];
    if (roll < acc) return keys[i];
  }
  return keys[keys.length - 1];
}

/**
 * Würfelt EINEN Sammel-Drop (Teil oder — via pool-Parameter — Ausrüstung,
 * siehe IDLE_GEAR_ITEMS/rollGearDrop): zuerst, OB überhaupt etwas dropt
 * (pool.chance), dann — falls ja — gewichtet WELCHE Seltenheitsstufe
 * (pickWeightedRarity mit pool.weights), dann ein zufälliges Item aus
 * dieser Stufe (pool.items). Zufälligkeit wird als Parameter übergeben
 * (Standard Math.random), damit die Funktion deterministisch testbar
 * bleibt. OHNE pool-Argument verhält sich die Funktion exakt wie zuvor:
 * die Teile-Sammlung (IDLE_PARTS/PART_DROP_CHANCE_PER_LAP/PART_RARITY_
 * WEIGHTS) — bestehende Aufrufstellen (idle.js onLapCompleted()) sind
 * dadurch komplett unverändert.
 * @param {Function} [rng] - Zufallsfunktion, liefert [0,1); Standard Math.random.
 * @param {{items: Object[], chance: number, weights: Object}} [pool] -
 *   Optionaler Item-Pool; Standard {items: IDLE_PARTS, chance:
 *   PART_DROP_CHANCE_PER_LAP, weights: PART_RARITY_WEIGHTS}.
 * @returns {string|null} id des gedroppten Items, oder null (kein Drop).
 */
function rollPartDrop(rng, pool) {
  var rnd = typeof rng === 'function' ? rng : Math.random;
  var p = pool || { items: IDLE_PARTS, chance: IDLE_BALANCE.PART_DROP_CHANCE_PER_LAP, weights: IDLE_BALANCE.PART_RARITY_WEIGHTS };
  if (rnd() >= p.chance) return null;
  var rarity = pickWeightedRarity(rnd, p.weights);
  var candidates = p.items.filter(function (item) { return item.rarity === rarity; });
  if (candidates.length === 0) return null;
  var idx = Math.floor(rnd() * candidates.length);
  if (idx >= candidates.length) idx = candidates.length - 1;
  return candidates[idx].id;
}

/**
 * Stellt sicher, dass state.parts ein gültiges Objekt ist (defensiv, für
 * Zustände, die nicht über createInitialState()/migrateState() gelaufen
 * sind).
 * @param {Object} state - Zentraler Idle-Zustand (wird ggf. mutiert).
 * @returns {void}
 */
function ensurePartsState(state) {
  if (!state.parts || typeof state.parts !== 'object' || !Array.isArray(state.parts.collected)) {
    state.parts = { collected: [] };
  }
}

/**
 * Fügt ein gedropptes Sammel-Item zum Zustand hinzu (Teil oder — via
 * pool-Parameter — Ausrüstung, siehe IDLE_GEAR_ITEMS/addGear). Ist das
 * Item bereits besessen (Dublette), wird stattdessen sein Dubletten-km-
 * Wert (je Seltenheitsstufe) gutgeschrieben — die Sammlung selbst bleibt
 * unverändert. Mutiert state. OHNE pool-Argument verhält sich die
 * Funktion exakt wie zuvor: die Teile-Sammlung (state.parts.collected/
 * IDLE_PARTS/PART_DUPLICATE_KM_VALUE) — bestehende Aufrufstellen sind
 * dadurch komplett unverändert.
 * @param {Object} state - Zentraler Idle-Zustand (wird mutiert).
 * @param {string} itemId - id des gedroppten Items (siehe rollPartDrop()).
 * @param {{collectionKey: string, items: Object[], getById: Function, dupValues: Object}} [pool] -
 *   Optionaler Item-Pool.
 * @returns {{isNew: boolean, awardedKm: number, part: (Object|null)}} Ergebnis.
 */
function addPart(state, itemId, pool) {
  if (!pool) {
    var part = getPartById(itemId);
    if (!part) return { isNew: false, awardedKm: 0, part: null };
    ensurePartsState(state);

    var alreadyOwnedPart = state.parts.collected.indexOf(itemId) !== -1;
    if (alreadyOwnedPart) {
      var valuePart = IDLE_BALANCE.PART_DUPLICATE_KM_VALUE[part.rarity] || 0;
      creditKm(state, valuePart);
      return { isNew: false, awardedKm: valuePart, part: part };
    }

    state.parts.collected.push(itemId);
    return { isNew: true, awardedKm: 0, part: part };
  }

  var item = pool.getById(itemId);
  if (!item) return { isNew: false, awardedKm: 0, part: null };
  if (!state[pool.collectionKey] || typeof state[pool.collectionKey] !== 'object' || !Array.isArray(state[pool.collectionKey].collected)) {
    state[pool.collectionKey] = { collected: [] };
  }
  var collection = state[pool.collectionKey];
  var alreadyOwned = collection.collected.indexOf(itemId) !== -1;
  if (alreadyOwned) {
    var value = pool.dupValues[item.rarity] || 0;
    creditKm(state, value);
    return { isNew: false, awardedKm: value, part: item };
  }
  collection.collected.push(itemId);
  return { isNew: true, awardedKm: 0, part: item };
}

/**
 * Berechnet die aggregierten Set-Boni aus einer Sammlung: für jedes Set
 * (pool.sets), dessen zugehörige Items ALLE besessen sind, zählt dessen
 * bonusPct dauerhaft zum Gesamtertrag. Reine Funktion — mutiert state
 * NICHT. OHNE pool-Argument verhält sich die Funktion exakt wie zuvor:
 * die Teile-Sammlung (state.parts.collected/IDLE_PARTS/IDLE_PART_SETS) —
 * bestehende Aufrufstellen sind dadurch komplett unverändert. Mit pool
 * (z. B. für Ausrüstung, siehe gearBonuses()) wird state[pool.collectionKey]
 * ausgewertet.
 * @param {Object} state - Zentraler Idle-Zustand.
 * @param {{collectionKey: string, items: Object[], sets: Object[]}} [pool] -
 *   Optionaler Sammlungs-Pool.
 * @returns {{totalBonusMultiplier: number, totalBonusPct: number, completedSets: string[]}} Aggregierte Boni.
 */
function setBonuses(state, pool) {
  if (!pool) {
    var owned = state && state.parts && Array.isArray(state.parts.collected) ? state.parts.collected : [];
    var completedSets = [];
    var totalBonusPct = 0;

    IDLE_PART_SETS.forEach(function (set) {
      var partIds = IDLE_PARTS.filter(function (p) { return p.setId === set.id; }).map(function (p) { return p.id; });
      var allOwned = partIds.length > 0 && partIds.every(function (id) { return owned.indexOf(id) !== -1; });
      if (allOwned) {
        completedSets.push(set.id);
        totalBonusPct += set.bonusPct;
      }
    });

    return { totalBonusMultiplier: 1 + totalBonusPct / 100, totalBonusPct: totalBonusPct, completedSets: completedSets };
  }

  var ownedItems = state && state[pool.collectionKey] && Array.isArray(state[pool.collectionKey].collected) ? state[pool.collectionKey].collected : [];
  var completed = [];
  var bonusPct = 0;
  pool.sets.forEach(function (set) {
    var ids = pool.items.filter(function (item) { return item.setId === set.id; }).map(function (item) { return item.id; });
    var allOwned = ids.length > 0 && ids.every(function (id) { return ownedItems.indexOf(id) !== -1; });
    if (allOwned) {
      completed.push(set.id);
      bonusPct += set.bonusPct;
    }
  });
  return { totalBonusMultiplier: 1 + bonusPct / 100, totalBonusPct: bonusPct, completedSets: completed };
}

/**
 * Summiert den permanenten Pro-Item-Ertragsbonus (bonusPct) über alle
 * aktuell besessenen Items eines Pools (z. B. Ausrüstung, siehe
 * IDLE_GEAR_ITEMS/gearBonuses()). Die Teile-Sammlung hat keine bonusPct-
 * Felder auf Item-Ebene (nur Set-Boni, siehe setBonuses()) — für sie
 * liefert diese Funktion daher stets 0. Reine Funktion.
 * @param {string[]} ownedIds - Besessene Item-ids.
 * @param {Object[]} itemsPool - Pool aller möglichen Items ({id, bonusPct, ...}).
 * @returns {number} Summierter bonusPct (>= 0).
 */
function itemBonusSum(ownedIds, itemsPool) {
  if (!Array.isArray(ownedIds) || !Array.isArray(itemsPool)) return 0;
  var byId = {};
  itemsPool.forEach(function (item) { byId[item.id] = item; });
  var sum = 0;
  ownedIds.forEach(function (id) {
    var item = byId[id];
    if (item && typeof item.bonusPct === 'number') sum += item.bonusPct;
  });
  return sum;
}

/* ============================================================
   AUSRÜSTUNG (GEAR) — feat(idle-gear)
   Zweite, parallele Sammlung zur Teile-Sammlung (siehe oben), nutzt
   dieselbe generalisierte Engine (rollPartDrop/addPart/setBonuses) wieder
   — KEIN eigener Drop-/Dubletten-Algorithmus. 5 Kategorien × 4
   Seltenheitsstufen (Gewöhnlich/Selten/Episch/Legendär), jedes Item
   gewährt zusätzlich zum (wiederverwendeten) Set-Bonus einen PERMANENTEN
   Pro-Item-Ertragsbonus (siehe itemBonusSum()/gearBonuses()).
   ============================================================ */

/**
 * IDLE_GEAR_SETS — die 5 Ausrüstungs-Kategorien. Ist eine Kategorie
 * komplett (alle 4 Seltenheitsstufen besessen, siehe setBonuses() mit
 * IDLE_GEAR_POOL), gilt dessen bonusPct zusätzlich zum Pro-Item-Bonus
 * (siehe gearBonuses()).
 */
var IDLE_GEAR_SETS = [
  { id: 'helm', name: 'Helm', bonusPct: 4 },
  { id: 'handschuhe', name: 'Handschuhe', bonusPct: 3 },
  { id: 'lederkombi', name: 'Lederkombi', bonusPct: 5 },
  { id: 'werkzeugkiste', name: 'Werkzeugkiste', bonusPct: 3 },
  { id: 'pokal', name: 'Pokal', bonusPct: 6 },
];

/**
 * Baut einen einzelnen IDLE_GEAR_ITEMS-Eintrag.
 * @param {string} id - Eindeutige Ausrüstungs-id.
 * @param {string} name - Anzeigename.
 * @param {string} setId - id des zugehörigen IDLE_GEAR_SETS-Eintrags.
 * @param {string} rarity - Seltenheitsstufe ('gewoehnlich'|'selten'|'episch'|'legendaer').
 * @param {number} bonusPct - Permanenter Pro-Item-Ertragsbonus in Prozent (1–5, je Seltenheit).
 * @returns {Object} Vollständiger IDLE_GEAR_ITEMS-Eintrag.
 */
function makeIdleGearItem(id, name, setId, rarity, bonusPct) {
  return { id: id, name: name, setId: setId, rarity: rarity, bonusPct: bonusPct };
}

/**
 * IDLE_GEAR_ITEMS — 20 Ausrüstungsteile = 5 Kategorien × 4 Seltenheitsstufen
 * (gewoehnlich/selten/episch/legendaer), erspielbar über rollGearDrop()
 * (z. B. beim Bezahlen einer Werkstattrechnung, siehe payBill()). Jedes
 * Item gewährt +1–5% permanenten Ertragsbonus, je Seltenheitsstufe.
 */
var IDLE_GEAR_ITEMS = [
  makeIdleGearItem('helm_gewoehnlich', 'Standard-Helm', 'helm', 'gewoehnlich', 1),
  makeIdleGearItem('helm_selten', 'Sport-Helm', 'helm', 'selten', 2),
  makeIdleGearItem('helm_episch', 'Carbon-Renn-Helm', 'helm', 'episch', 3),
  makeIdleGearItem('helm_legendaer', 'Meister-Helm', 'helm', 'legendaer', 5),

  makeIdleGearItem('handschuhe_gewoehnlich', 'Stoff-Handschuhe', 'handschuhe', 'gewoehnlich', 1),
  makeIdleGearItem('handschuhe_selten', 'Leder-Handschuhe', 'handschuhe', 'selten', 2),
  makeIdleGearItem('handschuhe_episch', 'Renn-Handschuhe', 'handschuhe', 'episch', 3),
  makeIdleGearItem('handschuhe_legendaer', 'Meister-Handschuhe', 'handschuhe', 'legendaer', 5),

  makeIdleGearItem('lederkombi_gewoehnlich', 'Einteiler-Kombi', 'lederkombi', 'gewoehnlich', 1),
  makeIdleGearItem('lederkombi_selten', 'Sport-Lederkombi', 'lederkombi', 'selten', 2),
  makeIdleGearItem('lederkombi_episch', 'Renn-Lederkombi', 'lederkombi', 'episch', 3),
  makeIdleGearItem('lederkombi_legendaer', 'Meister-Lederkombi', 'lederkombi', 'legendaer', 5),

  makeIdleGearItem('werkzeugkiste_gewoehnlich', 'Basis-Werkzeugkiste', 'werkzeugkiste', 'gewoehnlich', 1),
  makeIdleGearItem('werkzeugkiste_selten', 'Profi-Werkzeugkiste', 'werkzeugkiste', 'selten', 2),
  makeIdleGearItem('werkzeugkiste_episch', 'Werkstatt-Komplettset', 'werkzeugkiste', 'episch', 3),
  makeIdleGearItem('werkzeugkiste_legendaer', 'Meister-Werkzeugkiste', 'werkzeugkiste', 'legendaer', 5),

  makeIdleGearItem('pokal_gewoehnlich', 'Bronze-Pokal', 'pokal', 'gewoehnlich', 1),
  makeIdleGearItem('pokal_selten', 'Silber-Pokal', 'pokal', 'selten', 2),
  makeIdleGearItem('pokal_episch', 'Gold-Pokal', 'pokal', 'episch', 3),
  makeIdleGearItem('pokal_legendaer', 'Meister-Pokal', 'pokal', 'legendaer', 5),
];

/**
 * Findet ein Ausrüstungsteil anhand seiner id.
 * @param {string} gearId - id des Ausrüstungsteils.
 * @returns {Object|null} Eintrag aus IDLE_GEAR_ITEMS, oder null.
 */
function getGearItemById(gearId) {
  for (var i = 0; i < IDLE_GEAR_ITEMS.length; i++) {
    if (IDLE_GEAR_ITEMS[i].id === gearId) return IDLE_GEAR_ITEMS[i];
  }
  return null;
}

/**
 * Wiederverwendbarer Pool für die generalisierten Engine-Funktionen
 * (rollPartDrop/addPart/setBonuses, siehe oben) — die GEAR-Sammlung lebt
 * unter state.gear.collected, komplett getrennt von state.parts.collected.
 */
var IDLE_GEAR_POOL = {
  collectionKey: 'gear',
  items: IDLE_GEAR_ITEMS,
  sets: IDLE_GEAR_SETS,
  getById: getGearItemById,
  weights: IDLE_BALANCE.GEAR_RARITY_WEIGHTS,
  dupValues: IDLE_BALANCE.GEAR_DUPLICATE_KM_VALUE,
};

/**
 * Würfelt EINEN Ausrüstungs-Drop (wrapped rollPartDrop() mit IDLE_GEAR_POOL).
 * @param {Function} [rng] - Zufallsfunktion, liefert [0,1); Standard Math.random.
 * @param {number} [chance] - Drop-Wahrscheinlichkeit (0–1); Standard IDLE_BALANCE.GEAR_DROP_CHANCE_ON_BILL_PAY.
 * @returns {string|null} id des gedroppten Ausrüstungsteils, oder null (kein Drop).
 */
function rollGearDrop(rng, chance) {
  var c = typeof chance === 'number' ? chance : IDLE_BALANCE.GEAR_DROP_CHANCE_ON_BILL_PAY;
  return rollPartDrop(rng, { items: IDLE_GEAR_POOL.items, chance: c, weights: IDLE_GEAR_POOL.weights });
}

/**
 * Fügt ein gedropptes Ausrüstungsteil zum Zustand hinzu (wrapped addPart()
 * mit IDLE_GEAR_POOL) — neu → state.gear.collected, Dublette → km (siehe
 * IDLE_BALANCE.GEAR_DUPLICATE_KM_VALUE).
 * @param {Object} state - Zentraler Idle-Zustand (wird mutiert).
 * @param {string} gearId - id des gedroppten Ausrüstungsteils.
 * @returns {{isNew: boolean, awardedKm: number, part: (Object|null)}} Ergebnis.
 */
function addGear(state, gearId) {
  return addPart(state, gearId, IDLE_GEAR_POOL);
}

/**
 * Aggregiert ALLE GEAR-Boni (siehe IDLE_GEAR_ITEMS/IDLE_GEAR_SETS): den
 * permanenten Pro-Item-Bonus (itemBonusSum über alle besessenen Items)
 * PLUS den Set-Vervollständigungs-Bonus (setBonuses() mit IDLE_GEAR_POOL).
 * Reine Funktion — mutiert state NICHT. Wird zusammen mit contractEffects()
 * und dem Teile-setBonuses() in den Gesamt-Ertragsmultiplikator eingerechnet
 * (siehe idle.js totalEarnMultiplier()/idle-core.js offlineEarn()).
 * @param {Object} state - Zentraler Idle-Zustand.
 * @returns {{totalBonusMultiplier: number, itemBonusPct: number, setBonusPct: number, completedSets: string[]}} Aggregierte Gear-Boni.
 */
function gearBonuses(state) {
  var owned = state && state.gear && Array.isArray(state.gear.collected) ? state.gear.collected : [];
  var itemPct = itemBonusSum(owned, IDLE_GEAR_ITEMS);
  var setResult = setBonuses(state, IDLE_GEAR_POOL);
  var totalPct = itemPct + setResult.totalBonusPct;
  return {
    totalBonusMultiplier: 1 + totalPct / 100,
    itemBonusPct: itemPct,
    setBonusPct: setResult.totalBonusPct,
    completedSets: setResult.completedSets,
  };
}

/* ============================================================
   WERKSTATTRECHNUNGEN + INSOLVENZ (MECHANIK A) — feat(idle-bills)
   Alle nextBillIntervalSeconds() Sekunden droht eine Werkstattrechnung,
   deren Betrag sich automatisch aus dem aktuellen Passivertrag ableitet
   (billAmount()) — ein aufmerksamer Spieler erwirtschaftet sie praktisch
   von selbst. Bleibt sie unbezahlt, ist die Folge KEINE Strafe, sondern
   eine Insolvenz: ein normaler, nicht-punitiver Saison-Reset (identische
   Semantik wie ein freiwilliger Saisonabschluss, siehe finishSeason()
   oben, nur ohne dessen ZX-10R-Zugangsschranke).
   ============================================================ */

/**
 * Stellt sicher, dass state.finance ein gültiges Objekt ist (defensiv, für
 * Zustände, die nicht über createInitialState()/migrateState() gelaufen
 * sind).
 * @param {Object} state - Zentraler Idle-Zustand (wird ggf. mutiert).
 * @returns {void}
 */
function ensureFinanceState(state) {
  if (!state.finance || typeof state.finance !== 'object') {
    state.finance = {
      billsPaidOnTime: 0,
      billsPaidLastSecond: 0,
      insolvencies: 0,
      seasonsInsolvencyFree: 0,
      insolvencyFreeFlag: true,
      activeBillAmount: null,
      activeBillDueAt: null,
      activeBillGraceSeconds: null,
    };
  }
}

/**
 * Würfelt das Zufallsintervall (Sekunden) bis zur nächsten fälligen
 * Werkstattrechnung, zwischen IDLE_BALANCE.BILL_INTERVAL_MIN_SECONDS und
 * BILL_INTERVAL_MAX_SECONDS — beide schrumpfen mit dem Saison-Fortschritt
 * (trophiesForSeason(state)), niemals unter BILL_INTERVAL_FLOOR_SECONDS.
 * Ein fortgeschrittener Spieler bekommt Rechnungen dadurch spürbar
 * häufiger. Zufälligkeit wird als Parameter übergeben, damit die Funktion
 * deterministisch testbar bleibt.
 * @param {Object} state - Zentraler Idle-Zustand.
 * @param {Function} [randomFn] - Zufallsfunktion, liefert [0,1); Standard Math.random.
 * @returns {number} Sekunden bis zur nächsten Werkstattrechnung.
 */
function nextBillIntervalSeconds(state, randomFn) {
  var rnd = typeof randomFn === 'function' ? randomFn : Math.random;
  var progress = trophiesForSeason(state);
  var shrink = progress * IDLE_BALANCE.BILL_INTERVAL_SHRINK_PER_TROPHY_SECONDS;
  var floor = IDLE_BALANCE.BILL_INTERVAL_FLOOR_SECONDS;
  var min = Math.max(floor, IDLE_BALANCE.BILL_INTERVAL_MIN_SECONDS - shrink);
  var max = Math.max(min, IDLE_BALANCE.BILL_INTERVAL_MAX_SECONDS - shrink);
  return min + rnd() * (max - min);
}

/**
 * Würfelt die Länge (Sekunden) des sichtbaren Zahlungsfensters (Countdown)
 * EINER fällig gewordenen Werkstattrechnung, zwischen IDLE_BALANCE.
 * BILL_GRACE_MIN_SECONDS und BILL_GRACE_MAX_SECONDS.
 * @param {Function} [randomFn] - Zufallsfunktion, liefert [0,1); Standard Math.random.
 * @returns {number} Sekunden Zahlungsfenster.
 */
function billGraceSeconds(randomFn) {
  var rnd = typeof randomFn === 'function' ? randomFn : Math.random;
  var min = IDLE_BALANCE.BILL_GRACE_MIN_SECONDS;
  var max = IDLE_BALANCE.BILL_GRACE_MAX_SECONDS;
  return min + rnd() * (max - min);
}

/**
 * Berechnet den Betrag (in km) der aktuell fälligen Werkstattrechnung.
 * Leitet sich direkt aus dem aktuellen Passivertrag ab (passiveEarn()),
 * hochgerechnet auf die durchschnittliche Fensterlänge und mit einem
 * kleinen Sicherheits-Faktor versehen (IDLE_BALANCE.BILL_AMOUNT_SAFETY_
 * FACTOR) — skaliert dadurch automatisch mit besessenen/getunten Bikes,
 * OHNE eigene, parallele Balancing-Formel: ein aufmerksamer Spieler, der
 * das Zahlungsfenster nutzt, erwirtschaftet die Rechnung praktisch von
 * selbst. Reine Funktion — mutiert state NICHT.
 * @param {Object} state - Zentraler Idle-Zustand.
 * @returns {number} Betrag in km (>= IDLE_BALANCE.BILL_AMOUNT_MIN_KM).
 */
function billAmount(state) {
  var avgGrace = (IDLE_BALANCE.BILL_GRACE_MIN_SECONDS + IDLE_BALANCE.BILL_GRACE_MAX_SECONDS) / 2;
  var raw = passiveEarn(state, avgGrace) * IDLE_BALANCE.BILL_AMOUNT_SAFETY_FACTOR;
  return Math.max(IDLE_BALANCE.BILL_AMOUNT_MIN_KM, Math.round(raw));
}

/**
 * Bezahlt die aktuell fällige Werkstattrechnung: zieht billAmount(state)
 * km ab (schlägt fehl — success:false, KEINE Mutation —, falls nicht
 * genug km vorhanden sind), gewährt dafür einen kleinen Bonus
 * (IDLE_BALANCE.BILL_PAY_BONUS_FRACTION des bezahlten Betrags, als km
 * gutgeschrieben) UND würfelt eine Chance auf einen Gear-Drop (siehe
 * rollGearDrop()/addGear()). Zählt die Zahlung in state.finance.
 * billsPaidOnTime (und optional billsPaidLastSecond). Mutiert state bei
 * Erfolg.
 * @param {Object} state - Zentraler Idle-Zustand (wird bei Erfolg mutiert).
 * @param {boolean} [onTime] - true, falls rechtzeitig bezahlt (zählt zu
 *   finance.billsPaidOnTime); Standard true.
 * @param {boolean} [lastSecond] - true, falls die Zahlung innerhalb von
 *   IDLE_BALANCE.BILL_LAST_SECOND_THRESHOLD_SECONDS Restzeit erfolgte
 *   (zählt zusätzlich zu finance.billsPaidLastSecond).
 * @param {Function} [rng] - Zufallsfunktion für den Gear-Drop-Roll; Standard Math.random.
 * @returns {{success: boolean, amount: number, bonusKm: number, gearResult: (Object|null)}} Ergebnis.
 */
function payBill(state, onTime, lastSecond, rng) {
  var amount = billAmount(state);
  if (!state || state.km < amount) return { success: false, amount: amount, bonusKm: 0, gearResult: null };

  state.km -= amount;
  var bonusKm = Math.round(amount * IDLE_BALANCE.BILL_PAY_BONUS_FRACTION);
  creditKm(state, bonusKm);

  ensureFinanceState(state);
  if (onTime !== false) state.finance.billsPaidOnTime += 1;
  if (lastSecond) state.finance.billsPaidLastSecond += 1;

  var gearResult = null;
  var gearId = rollGearDrop(rng);
  if (gearId) gearResult = addGear(state, gearId);

  return { success: true, amount: amount, bonusKm: bonusKm, gearResult: gearResult };
}

/**
 * MECHANIK A — Insolvenz: ein normaler, NICHT-punitiver Saison-Reset,
 * ausgelöst durch eine unbezahlt abgelaufene Werkstattrechnung. Ruft
 * finishSeason(state, {bypassEligibilityGate:true}) auf — identische
 * Reset-/Erhalt-Semantik wie ein freiwilliger Saisonabschluss (Trophäen
 * nach aktuellem Fortschritt, Werksverträge/Teile/Gear/Statistiken
 * bleiben erhalten), nur OHNE die ZX-10R-Zugangsschranke — eine Insolvenz
 * kann so auch früh in einer Saison stattfinden. Markiert VOR dem Reset
 * state.finance.insolvencyFreeFlag als false (diese Saison hatte eine
 * Insolvenz, siehe finishSeason()'s seasonsInsolvencyFree-Logik) und
 * zählt insolvencies hoch. state wird direkt danach durch den
 * Rückgabewert ersetzt (Aufrufer-Muster identisch zu finishSeason()).
 * @param {Object} state - Zentraler Idle-Zustand vor der Insolvenz.
 * @returns {Object} Neuer, nach dem Reset gültiger Idle-Zustand.
 */
function triggerInsolvency(state) {
  ensureFinanceState(state);
  state.finance.insolvencyFreeFlag = false;
  var next = finishSeason(state, { bypassEligibilityGate: true });
  next.finance.insolvencies = (next.finance.insolvencies || 0) + 1;
  return next;
}

/* ============================================================
   SPARSCHWEINE ZERSCHLAGEN (MECHANIK B) — feat(idle-piggybanks)
   Alle nextPiggyIntervalSeconds() Sekunden (flach, 20–40s) erscheint ein
   Sparschwein (DOM-Overlay, siehe idle.js), das für piggyVisibleSeconds()
   Sekunden (3–4s) klickbar ist. Ein rechtzeitiger Klick zerschlägt es
   (smashPiggybank()): ein km-Bonus PLUS eine Chance auf einen Gear-Drop
   (dieselbe generalisierte Engine wie payBill(), siehe rollGearDrop()/
   addGear()). Verpasst/unbeklickt abgelaufen ist KEINE Strafe — identisches
   Muster zur Schaltpunkt-Leiste (tickShift()/endShift(..., true)).
   ============================================================ */

/**
 * Stellt sicher, dass state.piggy ein gültiges Objekt ist (defensiv, für
 * Zustände, die nicht über createInitialState()/migrateState() gelaufen
 * sind).
 * @param {Object} state - Zentraler Idle-Zustand (wird ggf. mutiert).
 * @returns {void}
 */
function ensurePiggyState(state) {
  if (!state.piggy || typeof state.piggy !== 'object') {
    state.piggy = { smashedCount: 0 };
  }
}

/**
 * Würfelt das Zufallsintervall (Sekunden) bis zum nächsten erscheinenden
 * Sparschwein, zwischen IDLE_BALANCE.PIGGY_INTERVAL_MIN_SECONDS und
 * PIGGY_INTERVAL_MAX_SECONDS (flach, wächst NICHT mit dem Saison-Fortschritt
 * — anders als nextBillIntervalSeconds()). Zufälligkeit wird als Parameter
 * übergeben, damit die Funktion deterministisch testbar bleibt.
 * @param {Function} [randomFn] - Zufallsfunktion, liefert [0,1); Standard Math.random.
 * @returns {number} Sekunden bis zum nächsten Sparschwein.
 */
function nextPiggyIntervalSeconds(randomFn) {
  var rnd = typeof randomFn === 'function' ? randomFn : Math.random;
  var min = IDLE_BALANCE.PIGGY_INTERVAL_MIN_SECONDS;
  var max = IDLE_BALANCE.PIGGY_INTERVAL_MAX_SECONDS;
  return min + rnd() * (max - min);
}

/**
 * Würfelt die Sichtbarkeitsdauer (Sekunden) EINES erschienenen Sparschweins,
 * zwischen IDLE_BALANCE.PIGGY_VISIBLE_MIN_SECONDS und PIGGY_VISIBLE_MAX_SECONDS,
 * bevor es unbeklickt wieder verschwindet.
 * @param {Function} [randomFn] - Zufallsfunktion, liefert [0,1); Standard Math.random.
 * @returns {number} Sekunden Sichtbarkeit.
 */
function piggyVisibleSeconds(randomFn) {
  var rnd = typeof randomFn === 'function' ? randomFn : Math.random;
  var min = IDLE_BALANCE.PIGGY_VISIBLE_MIN_SECONDS;
  var max = IDLE_BALANCE.PIGGY_VISIBLE_MAX_SECONDS;
  return min + rnd() * (max - min);
}

/**
 * Berechnet die Belohnung für EIN zerschlagenes Sparschwein: einen km-Bonus
 * (ein Vielfaches von activeEarn(state), skaliert dadurch automatisch mit
 * Bike/Tuning wie billAmount() über passiveEarn() — KEINE eigene, parallele
 * Balancing-Formel) PLUS eine gewürfelte Chance auf einen Gear-Drop
 * (wiederverwendet rollGearDrop()/IDLE_GEAR_POOL, siehe payBill()). Reine
 * Funktion — mutiert state NICHT.
 * @param {Object} state - Zentraler Idle-Zustand.
 * @param {Function} [rng] - Zufallsfunktion für den Gear-Drop-Roll; Standard Math.random.
 * @returns {{kmBonus: number, gearId: (string|null)}} Berechnete Belohnung.
 */
function piggybankReward(state, rng) {
  var kmBonus = Math.round(activeEarn(state) * IDLE_BALANCE.PIGGY_KM_BONUS_MULTIPLIER);
  var gearId = rollGearDrop(rng, IDLE_BALANCE.GEAR_DROP_CHANCE_ON_PIGGY_SMASH);
  return { kmBonus: kmBonus, gearId: gearId };
}

/**
 * Zerschlägt ein Sparschwein: berechnet + verbucht dessen Belohnung
 * (piggybankReward()) — gutschreibt den km-Bonus, fügt einen eventuellen
 * Gear-Drop hinzu (siehe addGear()) — und zählt state.piggy.smashedCount
 * (Lebenszeit-Zähler, überlebt Saison-Resets, siehe finishSeason()) hoch.
 * Mutiert state.
 * @param {Object} state - Zentraler Idle-Zustand (wird mutiert).
 * @param {Function} [rng] - Zufallsfunktion für den Gear-Drop-Roll; Standard Math.random.
 * @returns {{kmBonus: number, gearResult: (Object|null), smashedCount: number}} Ergebnis.
 */
function smashPiggybank(state, rng) {
  ensurePiggyState(state);
  var reward = piggybankReward(state, rng);
  creditKm(state, reward.kmBonus);
  var gearResult = reward.gearId ? addGear(state, reward.gearId) : null;
  state.piggy.smashedCount += 1;
  return { kmBonus: reward.kmBonus, gearResult: gearResult, smashedCount: state.piggy.smashedCount };
}

/* ============================================================
   TEIL 1 — ENDLESS-RUNNER: 2–3-Lane-Straße — feat(idle-runner)
   ============================================================ */

/**
 * Stellt sicher, dass state.runner ein gültiges Objekt ist (defensiv, für
 * Zustände, die nicht über createInitialState()/migrateState() gelaufen
 * sind, z. B. handgebaute Test-Zustände — mirrors ensureComboState()).
 * @param {Object} state - Zentraler Idle-Zustand (wird ggf. mutiert).
 * @returns {void}
 */
function ensureRunnerState(state) {
  if (!state.runner || typeof state.runner !== 'object') {
    state.runner = {
      lane: Math.floor(IDLE_BALANCE.RUNNER_LANE_COUNT / 2),
      lastInputAt: null,
      collisionMalusExpiresAt: null,
    };
  }
}

/**
 * Wechselt die aktuelle Fahrspur um EINE Lane in die gegebene Richtung,
 * geklemmt auf [0, RUNNER_LANE_COUNT-1] (kein Wechsel über den Rand
 * hinaus möglich). Aktualisiert zusätzlich lastInputAt — jede Steuerungs-
 * Eingabe zählt dadurch automatisch als "aktiv" (siehe runnerActivityState()).
 * Mutiert state.
 * @param {Object} state - Zentraler Idle-Zustand (wird mutiert).
 * @param {number} direction - Richtung: <0 = eine Lane nach links, >0 = eine Lane nach rechts, 0 = keine Änderung (nur lastInputAt wird aktualisiert).
 * @param {number} [nowMs] - Zeitstempel "jetzt" in ms; Standard Date.now().
 * @returns {number} Die neue, geklemmte Lane.
 */
function steerRunnerLane(state, direction, nowMs) {
  ensureRunnerState(state);
  var now = typeof nowMs === 'number' ? nowMs : Date.now();
  var delta = direction < 0 ? -1 : (direction > 0 ? 1 : 0);
  var next = Math.max(0, Math.min(IDLE_BALANCE.RUNNER_LANE_COUNT - 1, state.runner.lane + delta));
  state.runner.lane = next;
  state.runner.lastInputAt = now;
  return next;
}

/**
 * Liefert den aktuellen Aktivitäts-Zustand des Runners: 'active', solange
 * die letzte Lane-Wechsel-Eingabe weniger als RUNNER_IDLE_TIMEOUT_SECONDS
 * zurückliegt, sonst 'idle' (Auto-Run, siehe runnerAutoRunSpeedPct()).
 * Ein frischer Zustand (lastInputAt === null, noch nie gesteuert) gilt
 * SOFORT als 'idle' — Idle-Spieler:innen starten dadurch ohne jede
 * Eingabe direkt im verlässlichen Auto-Run. Reine Funktion.
 * @param {Object} state - Zentraler Idle-Zustand.
 * @param {number} [nowMs] - Zeitstempel "jetzt" in ms; Standard Date.now().
 * @returns {('active'|'idle')} Aktueller Aktivitäts-Zustand.
 */
function runnerActivityState(state, nowMs) {
  var now = typeof nowMs === 'number' ? nowMs : Date.now();
  if (!state || !state.runner || typeof state.runner.lastInputAt !== 'number') return 'idle';
  var elapsedSeconds = (now - state.runner.lastInputAt) / 1000;
  return elapsedSeconds >= IDLE_BALANCE.RUNNER_IDLE_TIMEOUT_SECONDS ? 'idle' : 'active';
}

/**
 * Deckelt die visuelle Geschwindigkeit (%) im Auto-Run-/Idle-Modus auf
 * RUNNER_AUTO_RUN_SPEED_CAP_PCT — "reduziert, aber verlässlich": ein
 * bereits langsameres Bike wird NICHT künstlich verlangsamt, ein
 * schnelleres Bike wird auf den Deckel gebremst. Reine Funktion.
 * @param {number} speedPct - Rohe Bike-Geschwindigkeit (0–100%, siehe deriveBikeStats().geschwindigkeitPct).
 * @returns {number} Gedeckelte Auto-Run-Geschwindigkeit (0–100%).
 */
function runnerAutoRunSpeedPct(speedPct) {
  return Math.min(clampPct(speedPct), IDLE_BALANCE.RUNNER_AUTO_RUN_SPEED_CAP_PCT);
}

/**
 * Berechnet die visuelle Scroll-Geschwindigkeit der Runner-Straße
 * (abstrakte Einheiten/Sekunde) für eine gegebene Bike-Geschwindigkeit:
 * steigt linear mit speedPct bis RUNNER_SPEED_CAP_PCT, danach bleibt sie
 * konstant bei RUNNER_SCROLL_SPEED_MAX (Speed-Cap, siehe runnerLeadSeconds()).
 * Reine Funktion.
 * @param {number} speedPct - Bike-Geschwindigkeit (0–100%).
 * @returns {number} Scroll-Geschwindigkeit (abstrakte Einheiten/Sekunde, > 0).
 */
function runnerScrollSpeed(speedPct) {
  var cap = IDLE_BALANCE.RUNNER_SPEED_CAP_PCT;
  var cappedPct = Math.min(clampPct(speedPct), cap);
  var ratio = cap > 0 ? cappedPct / cap : 0;
  return IDLE_BALANCE.RUNNER_SCROLL_SPEED_BASE + (IDLE_BALANCE.RUNNER_SCROLL_SPEED_MAX - IDLE_BALANCE.RUNNER_SCROLL_SPEED_BASE) * ratio;
}

/**
 * Berechnet die Hindernis-Vorlaufzeit (Sekunden) für eine gegebene
 * Bike-Geschwindigkeit: die Zeit, die ein Hindernis vom Spawn (Horizont)
 * bis zur Spieler-Position benötigt (RUNNER_SPAWN_LEAD_DISTANCE geteilt
 * durch runnerScrollSpeed()). NIE unter RUNNER_MIN_LEAD_SECONDS geklemmt —
 * dank des Speed-Caps in runnerScrollSpeed() greift dieser Boden ab
 * RUNNER_SPEED_CAP_PCT ohnehin automatisch (die Konstanten sind bewusst
 * so gewählt, dass beide exakt zusammenfallen), der explizite Math.max()
 * ist die zusätzliche Sicherheits-Garantie. Reine Funktion.
 * @param {number} speedPct - Bike-Geschwindigkeit (0–100%).
 * @returns {number} Vorlaufzeit in Sekunden (>= RUNNER_MIN_LEAD_SECONDS).
 */
function runnerLeadSeconds(speedPct) {
  var scrollSpeed = runnerScrollSpeed(speedPct);
  var raw = scrollSpeed > 0 ? IDLE_BALANCE.RUNNER_SPAWN_LEAD_DISTANCE / scrollSpeed : Infinity;
  return Math.max(IDLE_BALANCE.RUNNER_MIN_LEAD_SECONDS, raw);
}

/**
 * Berechnet den Hindernis-Dichte-Multiplikator für eine gegebene
 * Bike-Geschwindigkeit: steigt sanft von RUNNER_OBSTACLE_DENSITY_BASE
 * (bei 0%) auf RUNNER_OBSTACLE_DENSITY_AT_CAP (bei RUNNER_SPEED_CAP_PCT),
 * und darüber hinaus STÄRKER weiter auf RUNNER_OBSTACLE_DENSITY_MAX (bei
 * 100%) — kompensiert so die ab dem Speed-Cap gedeckelte Scroll-
 * Geschwindigkeit (siehe runnerScrollSpeed()), damit schnellere Bikes
 * trotzdem spürbar anspruchsvoller bleiben, ohne die durch
 * runnerLeadSeconds() garantierte Reaktionszeit zu gefährden. Monoton
 * nicht-fallend über den gesamten 0–100%-Bereich. Reine Funktion.
 * @param {number} speedPct - Bike-Geschwindigkeit (0–100%).
 * @returns {number} Dichte-Multiplikator (>= RUNNER_OBSTACLE_DENSITY_BASE).
 */
function obstacleDensity(speedPct) {
  var pct = clampPct(speedPct);
  var cap = IDLE_BALANCE.RUNNER_SPEED_CAP_PCT;
  var base = IDLE_BALANCE.RUNNER_OBSTACLE_DENSITY_BASE;
  var atCap = IDLE_BALANCE.RUNNER_OBSTACLE_DENSITY_AT_CAP;
  var max = IDLE_BALANCE.RUNNER_OBSTACLE_DENSITY_MAX;
  if (pct <= cap) {
    return cap > 0 ? base + (atCap - base) * (pct / cap) : atCap;
  }
  var overCapFraction = (100 - cap) > 0 ? (pct - cap) / (100 - cap) : 1;
  return atCap + (max - atCap) * overCapFraction;
}

/**
 * Würfelt das nächste Zufallsintervall (Sekunden) bis zum nächsten
 * Hindernis, skaliert mit obstacleDensity(speedPct) (höhere Dichte →
 * kürzeres Intervall) PLUS einem zufälligen Jitter-Faktor (verhindert
 * einen metronomartig gleichmässigen Rhythmus — identisches Prinzip zu
 * nextPiggyIntervalSeconds()/nextShiftIntervalSeconds()). Zufälligkeit
 * wird als Parameter übergeben, damit die Funktion deterministisch
 * testbar bleibt.
 * @param {number} speedPct - Bike-Geschwindigkeit (0–100%).
 * @param {Function} [randomFn] - Zufallsfunktion, liefert [0,1); Standard Math.random.
 * @returns {number} Sekunden bis zum nächsten Hindernis (> 0).
 */
function nextObstacleSpawnIntervalSeconds(speedPct, randomFn) {
  var rnd = typeof randomFn === 'function' ? randomFn : Math.random;
  var density = obstacleDensity(speedPct);
  var base = density > 0 ? IDLE_BALANCE.RUNNER_OBSTACLE_SPAWN_INTERVAL_BASE_SECONDS / density : IDLE_BALANCE.RUNNER_OBSTACLE_SPAWN_INTERVAL_BASE_SECONDS;
  var jitterMin = IDLE_BALANCE.RUNNER_OBSTACLE_SPAWN_JITTER_MIN;
  var jitterMax = IDLE_BALANCE.RUNNER_OBSTACLE_SPAWN_JITTER_MAX;
  return base * (jitterMin + rnd() * (jitterMax - jitterMin));
}

/**
 * Löst den rein VISUELLEN Kollisions-Geschwindigkeits-Malus aus: setzt
 * einen Ablauf-Zeitstempel (state.runner.collisionMalusExpiresAt), bis zu
 * dem collisionSpeedMalus() den konfigurierten Malus-Multiplikator
 * liefert. Betrifft ausschliesslich die Anzeige (Strecke/Tacho/Sound,
 * siehe idle.js tickRunner()) — NIEMALS passiveEarn()/activeEarn(), NIE
 * ein Reset/Fail-State. Mutiert state.
 * @param {Object} state - Zentraler Idle-Zustand (wird mutiert).
 * @param {number} [nowMs] - Zeitstempel "jetzt" in ms; Standard Date.now().
 * @returns {number} Der neue Ablauf-Zeitstempel (ms).
 */
function applyCollisionMalus(state, nowMs) {
  ensureRunnerState(state);
  var now = typeof nowMs === 'number' ? nowMs : Date.now();
  state.runner.collisionMalusExpiresAt = now + IDLE_BALANCE.RUNNER_COLLISION_MALUS_DURATION_MS;
  return state.runner.collisionMalusExpiresAt;
}

/**
 * Liefert den aktuell aktiven, rein visuellen Kollisions-Geschwindigkeits-
 * Multiplikator: 1 (kein Malus), solange keine Kollision aktiv/noch nicht
 * abgelaufen ist, sonst IDLE_BALANCE.RUNNER_COLLISION_MALUS_MULTIPLIER
 * (< 1). Erholt sich automatisch nach RUNNER_COLLISION_MALUS_DURATION_MS —
 * identisches Erholungs-Muster wie activeComboMultiplier(). Reine
 * Funktion — mutiert state NICHT.
 * @param {Object} state - Zentraler Idle-Zustand.
 * @param {number} [nowMs] - Zeitstempel "jetzt" in ms; Standard Date.now().
 * @returns {number} Aktiver Malus-Multiplikator (RUNNER_COLLISION_MALUS_MULTIPLIER oder 1).
 */
function collisionSpeedMalus(state, nowMs) {
  var now = typeof nowMs === 'number' ? nowMs : Date.now();
  if (!state || !state.runner || typeof state.runner.collisionMalusExpiresAt !== 'number') return 1;
  if (now >= state.runner.collisionMalusExpiresAt) return 1;
  return IDLE_BALANCE.RUNNER_COLLISION_MALUS_MULTIPLIER;
}

/* ============================================================
   OFFLINE-ERTRAG — feat(idle-offline)
   ============================================================ */

/**
 * Berechnet den Ertrag für die Zeit, die seit dem letzten Besuch
 * verstrichen ist (awaySeconds), gedeckelt auf IDLE_BALANCE.OFFLINE_CAP_
 * SECONDS (4h) — verdoppelt auf 8h durch den "Offline-Ertrag
 * verdoppelt"-Werksvertrag (siehe contractEffects().offlineCapMultiplier).
 * Wendet denselben Ertrags-Multiplikator (Werksverträge + Prestige-Level)
 * UND die Teile-Set-Boni UND die GEAR-Boni (Pro-Item + Set, siehe
 * gearBonuses()) an wie der normale Passivertrag — NICHT jedoch den
 * Schaltpunkt-Combo-Multiplikator (der ist an Live-Interaktion gebunden
 * und daher offline nie aktiv). Reine Funktion — mutiert state NICHT.
 * @param {Object} state - Zentraler Idle-Zustand.
 * @param {number} awaySeconds - Verstrichene Abwesenheitszeit in Sekunden (>= 0).
 * @returns {number} Gutzuschreibende km (>= 0).
 */
function offlineEarn(state, awaySeconds) {
  if (!state || !awaySeconds || awaySeconds <= 0) return 0;
  var effects = contractEffects(state);
  var cap = IDLE_BALANCE.OFFLINE_CAP_SECONDS * effects.offlineCapMultiplier;
  var cappedSeconds = Math.min(awaySeconds, cap);
  var partsBonus = setBonuses(state).totalBonusMultiplier;
  var gearBonus = gearBonuses(state).totalBonusMultiplier;
  return passiveEarn(state, cappedSeconds) * IDLE_BALANCE.OFFLINE_EARN_FRACTION * effects.earnMultiplier * partsBonus * gearBonus;
}

/* ============================================================
   STATISTIKEN — feat(idle-stats)
   ============================================================ */

/**
 * Stellt sicher, dass state.stats ein gültiges Objekt ist (defensiv, für
 * Zustände, die nicht über createInitialState()/migrateState() gelaufen
 * sind).
 * @param {Object} state - Zentraler Idle-Zustand (wird ggf. mutiert).
 * @returns {void}
 */
function ensureStatsState(state) {
  if (!state.stats || typeof state.stats !== 'object') {
    state.stats = { laps: 0, bestCombo: 0, seasonHistory: [], playTimeSeconds: 0 };
  }
}

/**
 * Zählt eine abgeschlossene Runde auf der Renn-Strecke (siehe idle.js
 * renderTrack()'s Rundenerkennung). Mutiert state.stats.laps.
 * @param {Object} state - Zentraler Idle-Zustand (wird mutiert).
 * @returns {void}
 */
function recordLap(state) {
  ensureStatsState(state);
  state.stats.laps += 1;
}

/**
 * Aktualisiert die höchste je erreichte Combo-Anzahl (Statistik), falls
 * comboCount grösser als der bisherige Bestwert ist. Mutiert state.stats.bestCombo.
 * @param {Object} state - Zentraler Idle-Zustand (wird mutiert).
 * @param {number} comboCount - Aktuell erreichte Combo-Anzahl.
 * @returns {void}
 */
function recordComboPeak(state, comboCount) {
  ensureStatsState(state);
  if (typeof comboCount === 'number' && comboCount > state.stats.bestCombo) {
    state.stats.bestCombo = comboCount;
  }
}

/**
 * Zählt verstrichene Spielzeit (Sekunden) zur Statistik hinzu. Mutiert
 * state.stats.playTimeSeconds.
 * @param {Object} state - Zentraler Idle-Zustand (wird mutiert).
 * @param {number} dtSeconds - Verstrichene Zeit in Sekunden (>= 0).
 * @returns {void}
 */
function addPlayTime(state, dtSeconds) {
  ensureStatsState(state);
  if (typeof dtSeconds === 'number' && dtSeconds > 0) {
    state.stats.playTimeSeconds += dtSeconds;
  }
}

var IdleCore = {
  IDLE_STATE_KEY: IDLE_STATE_KEY,
  IDLE_STATE_VERSION: IDLE_STATE_VERSION,
  IDLE_BIKES: IDLE_BIKES,
  IDLE_BALANCE: IDLE_BALANCE,
  bikeCost: bikeCost,
  tuningCost: tuningCost,
  getBikeById: getBikeById,
  findBikeIndex: findBikeIndex,
  getBikeLevel: getBikeLevel,
  deriveBikeStats: deriveBikeStats,
  bikeSpeedFactor: bikeSpeedFactor,
  passiveEarn: passiveEarn,
  activeEarn: activeEarn,
  createInitialState: createInitialState,
  migrateState: migrateState,
  loadState: loadState,
  saveState: saveState,
  getNextBikeToBuy: getNextBikeToBuy,
  buyNextBike: buyNextBike,
  upgradeBike: upgradeBike,
  selectBike: selectBike,
  creditKm: creditKm,
  comboMultiplier: comboMultiplier,
  perfectZoneWidth: perfectZoneWidth,
  applyShiftResult: applyShiftResult,
  activeComboMultiplier: activeComboMultiplier,
  nextShiftIntervalSeconds: nextShiftIntervalSeconds,

  /* ── Phase C: MECHANIK B — Saison/Prestige/Werksverträge ────────── */
  IDLE_CONTRACTS: IDLE_CONTRACTS,
  getContractById: getContractById,
  contractEffects: contractEffects,
  canBuyContract: canBuyContract,
  buyContract: buyContract,
  trophiesForSeason: trophiesForSeason,
  canFinishSeason: canFinishSeason,
  finishSeason: finishSeason,
  effectiveTuningCost: effectiveTuningCost,
  perfectZoneWidthForState: perfectZoneWidthForState,

  /* ── Phase C: Teile-Sammlung ──────────────────────────────────────── */
  IDLE_PART_SETS: IDLE_PART_SETS,
  IDLE_PARTS: IDLE_PARTS,
  getPartById: getPartById,
  rollPartDrop: rollPartDrop,
  addPart: addPart,
  setBonuses: setBonuses,
  itemBonusSum: itemBonusSum,

  /* ── Phase D: Ausrüstung (GEAR) — feat(idle-gear) ─────────────────── */
  IDLE_GEAR_SETS: IDLE_GEAR_SETS,
  IDLE_GEAR_ITEMS: IDLE_GEAR_ITEMS,
  getGearItemById: getGearItemById,
  rollGearDrop: rollGearDrop,
  addGear: addGear,
  gearBonuses: gearBonuses,

  /* ── Phase D: MECHANIK A — Werkstattrechnungen + Insolvenz ────────── */
  ensureFinanceState: ensureFinanceState,
  nextBillIntervalSeconds: nextBillIntervalSeconds,
  billGraceSeconds: billGraceSeconds,
  billAmount: billAmount,
  payBill: payBill,
  triggerInsolvency: triggerInsolvency,

  /* ── Phase E: MECHANIK B — Sparschweine zerschlagen — feat(idle-piggybanks) ── */
  ensurePiggyState: ensurePiggyState,
  nextPiggyIntervalSeconds: nextPiggyIntervalSeconds,
  piggyVisibleSeconds: piggyVisibleSeconds,
  piggybankReward: piggybankReward,
  smashPiggybank: smashPiggybank,

  /* ── Teil 1: ENDLESS-RUNNER — 2–3-Lane-Straße — feat(idle-runner) ──── */
  ensureRunnerState: ensureRunnerState,
  steerRunnerLane: steerRunnerLane,
  runnerActivityState: runnerActivityState,
  runnerAutoRunSpeedPct: runnerAutoRunSpeedPct,
  runnerScrollSpeed: runnerScrollSpeed,
  runnerLeadSeconds: runnerLeadSeconds,
  obstacleDensity: obstacleDensity,
  nextObstacleSpawnIntervalSeconds: nextObstacleSpawnIntervalSeconds,
  applyCollisionMalus: applyCollisionMalus,
  collisionSpeedMalus: collisionSpeedMalus,

  /* ── Phase C: Offline-Ertrag ──────────────────────────────────────── */
  offlineEarn: offlineEarn,

  /* ── Phase C: Statistiken ──────────────────────────────────────────── */
  recordLap: recordLap,
  recordComboPeak: recordComboPeak,
  addPlayTime: addPlayTime,
};

if (typeof window !== 'undefined') {
  window.IdleCore = IdleCore;
} else if (typeof globalThis !== 'undefined') {
  globalThis.IdleCore = IdleCore;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = IdleCore;
}
