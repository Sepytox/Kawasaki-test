#!/usr/bin/env node
/**
 * Headless Test — juice.js (Runner-Game-Feel-Bausteine, Teil 5, feat(juice-overlay))
 *
 * Statische Prüfungen + echte Unit-Tests der DOM-freien Kernfunktionen
 * (Stil analog zu tests/count-up-test.js/tests/idle-core-test.js), die
 * sicherstellen, dass:
 *  1. juice.js existiert, ist syntaktisch gültiges JavaScript, enthält
 *     JSDoc, kein console.log, und respektiert prefers-reduced-motion.
 *  2. canvasPointToOverlayPoint() Canvas-CSS-Pixel-Koordinaten korrekt in
 *     zum Overlay relative Pixel-Koordinaten umrechnet (reine Mathematik,
 *     ohne echtes DOM).
 *  3. createParticlePool()/acquireParticleNode() Knoten bis zur
 *     Maximalgrösse neu anlegen und danach zuverlässig Round-Robin
 *     wiederverwenden (gedeckeltes DOM-Wachstum, kein Leck).
 *  4. prefersReducedMotion() ohne Browser-Umgebung sicher false liefert
 *     und bei window.matchMedia().matches === true entsprechend true.
 *  5. idle.html bindet juice.js ein (NICHT jedoch soundcheck.html —
 *     geschützte Datei) und idle.js verdrahtet den Overlay-Container.
 *
 * Run: node tests/idle-juice-test.js
 * Exit 0 = alle Tests bestanden, Exit 1 = mindestens ein Fehler.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

/**
 * Liest eine Datei aus dem Projekt-Root als UTF-8-String.
 * @param {string} file - Dateiname relativ zum Projekt-Root.
 * @returns {string} Dateiinhalt.
 */
function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

let passed = 0, failed = 0;

/**
 * Prüft eine Bedingung und protokolliert das Ergebnis.
 * @param {boolean} cond - Zu prüfende Bedingung.
 * @param {string} msg - Beschreibung des Tests.
 */
function assert(cond, msg) {
  if (cond) {
    console.log(`  ✅  ${msg}`);
    passed++;
  } else {
    console.log(`  ❌  FAIL: ${msg}`);
    failed++;
  }
}

/**
 * Druckt eine Abschnittsüberschrift für die Konsolenausgabe.
 * @param {string} title - Abschnittstitel.
 */
function section(title) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('═'.repeat(60));
}

// ============================================================
section('1. juice.js existiert und erfüllt die Grundregeln');
// ============================================================
{
  const juicePath = path.join(ROOT, 'juice.js');
  assert(fs.existsSync(juicePath), 'juice.js existiert im Projekt-Root');

  const js = fs.readFileSync(juicePath, 'utf8');
  assert(!js.includes('console.log'), 'juice.js enthält kein console.log');
  assert(js.includes('/**'), 'juice.js enthält JSDoc-Kommentare');
  assert(js.includes('prefersReducedMotion'), 'juice.js prüft prefers-reduced-motion');
  assert(js.includes('JUICE_PARTICLE_POOL_MAX'), 'juice.js definiert eine gedeckelte Partikel-Pool-Grösse (SCREAMING_SNAKE_CASE-Konstante)');

  try {
    execSync(`node --check "${juicePath}"`, { cwd: ROOT, stdio: 'pipe' });
    assert(true, 'juice.js ist syntaktisch gültiges JavaScript (node --check)');
  } catch (e) {
    assert(false, 'juice.js ist syntaktisch gültiges JavaScript (node --check)');
  }
}

// ============================================================
section('2. canvasPointToOverlayPoint() rechnet Canvas- in Overlay-Koordinaten um');
// ============================================================
{
  const Juice = require(path.join(ROOT, 'juice.js'));
  assert(typeof Juice.canvasPointToOverlayPoint === 'function', 'canvasPointToOverlayPoint() ist exportiert (Node-Testbarkeit)');

  // Canvas und Overlay füllen exakt dieselbe Box (Normalfall) → Identität.
  const sameRect = { left: 40, top: 20, width: 300, height: 168 };
  const identical = Juice.canvasPointToOverlayPoint(sameRect, sameRect, 123, 77);
  assert(identical.x === 123 && identical.y === 77, 'Bei identischer Canvas-/Overlay-Box bleibt der Punkt unverändert');

  // Overlay um (10, 5) verschoben (z.B. leicht abweichendes Layout) → Versatz wird korrekt ausgeglichen.
  const canvasRect = { left: 50, top: 30 };
  const overlayRect = { left: 40, top: 25 };
  const shifted = Juice.canvasPointToOverlayPoint(canvasRect, overlayRect, 100, 60);
  assert(shifted.x === 110, 'x-Versatz zwischen Canvas- und Overlay-Box wird korrekt aufaddiert (50-40+100=110)');
  assert(shifted.y === 65, 'y-Versatz zwischen Canvas- und Overlay-Box wird korrekt aufaddiert (30-25+60=65)');
}

// ============================================================
section('3. Partikel-Pool: gedeckeltes Wachstum + Round-Robin-Wiederverwendung');
// ============================================================
{
  const Juice = require(path.join(ROOT, 'juice.js'));
  assert(typeof Juice.createParticlePool === 'function', 'createParticlePool() ist exportiert');
  assert(typeof Juice.acquireParticleNode === 'function', 'acquireParticleNode() ist exportiert');

  const originalDocument = global.document;
  const createdNodes = [];
  const appended = [];
  global.document = {
    createElement: function () {
      const node = { className: '' };
      createdNodes.push(node);
      return node;
    }
  };
  const fakeOverlay = { appendChild: function (node) { appended.push(node); } };

  const pool = Juice.createParticlePool(3);
  const n1 = Juice.acquireParticleNode(pool, fakeOverlay, 'a');
  const n2 = Juice.acquireParticleNode(pool, fakeOverlay, 'b');
  const n3 = Juice.acquireParticleNode(pool, fakeOverlay, 'c');
  assert(createdNodes.length === 3, 'Pool legt bis zur Maximalgrösse (3) neue Knoten an');
  assert(appended.length === 3, 'Jeder neu angelegte Knoten wird an den Overlay-Container angehängt');

  const n4 = Juice.acquireParticleNode(pool, fakeOverlay, 'd');
  assert(createdNodes.length === 3, 'Ein 4. Aufruf legt KEINEN weiteren Knoten an (Deckel greift)');
  assert(n4 === n1, 'Der 4. Aufruf verwendet Round-Robin den ERSTEN Knoten erneut');
  assert(n4.className === 'd', 'Wiederverwendeter Knoten bekommt die neue className gesetzt');

  const n5 = Juice.acquireParticleNode(pool, fakeOverlay, 'e');
  assert(n5 === n2, 'Der 5. Aufruf verwendet den ZWEITEN Knoten (Round-Robin läuft weiter)');

  global.document = originalDocument;
}

// ============================================================
section('4. prefersReducedMotion() — mit/ohne Browser-Umgebung');
// ============================================================
{
  const Juice = require(path.join(ROOT, 'juice.js'));

  const originalWindow = global.window;
  global.window = undefined;
  assert(Juice.prefersReducedMotion() === false, 'Ohne window (reines Node) liefert prefersReducedMotion() sicher false');

  global.window = { matchMedia: function () { return { matches: true }; } };
  assert(Juice.prefersReducedMotion() === true, 'Mit window.matchMedia().matches === true liefert prefersReducedMotion() true');

  global.window = { matchMedia: function () { return { matches: false }; } };
  assert(Juice.prefersReducedMotion() === false, 'Mit window.matchMedia().matches === false liefert prefersReducedMotion() false');

  global.window = originalWindow;
}

// ============================================================
section('5. Einbindung: idle.html bindet juice.js ein, soundcheck.html nicht');
// ============================================================
{
  const idleHtml = read('idle.html');
  assert(idleHtml.includes('<script src="juice.js">'), 'idle.html bindet juice.js ein');

  const soundcheckHtml = read('soundcheck.html');
  assert(!soundcheckHtml.includes('juice.js'), 'soundcheck.html bindet juice.js NICHT ein (geschützte Datei)');

  const idleJs = read('idle.js');
  assert(/window\.Juice/.test(idleJs), 'idle.js prüft/nutzt window.Juice (Overlay-Verdrahtung)');
  assert(/Juice\.ensureOverlay\s*\(/.test(idleJs), 'idle.js ruft Juice.ensureOverlay() auf, um den Overlay-Container anzulegen');
}

// ============================================================
section('6. feat(juice-coins): Coin-Sammel-Feedback (Burst/Flug/Puls/Ton)');
// ============================================================
{
  const idleJs = read('idle.js');
  const idleCss = read('idle.css');

  // Hook sitzt NACH IdleCore.collectRunCoin() im Münz-Loop von tickRunner()
  // — niemals VOR dem Logik-Aufruf, niemals in idle-core.js.
  const coinLoopMatch = idleJs.match(/IdleCore\.collectRunCoin\(state, now\);\s*\n\s*([^\n]+)/);
  assert(coinLoopMatch !== null && /triggerCoinCollectJuice\(coin\)/.test(coinLoopMatch[1]),
    'triggerCoinCollectJuice(coin) wird direkt NACH IdleCore.collectRunCoin() aufgerufen');

  ['function runnerCanvasPoint', 'function playCoinChime', 'function spawnCoinBurst',
    'function flyCoinToScore', 'function pulseScoreOnCoinArrival', 'function triggerCoinCollectJuice']
    .forEach((sig) => {
      const idx = idleJs.indexOf(sig);
      assert(idx !== -1, `idle.js definiert ${sig}()`);
      const jsDocStart = idleJs.lastIndexOf('/**', idx);
      const docBetween = jsDocStart === -1 ? '' : idleJs.slice(jsDocStart, idx);
      assert(jsDocStart !== -1 && /\*\/\s*$/.test(docBetween.trimEnd() + '\n'), `${sig}() hat einen vorangestellten JSDoc-Block`);
    });

  // Reduced-motion: triggerCoinCollectJuice() bricht VOR jeglicher Zusatzbewegung ab.
  const triggerFnMatch = idleJs.match(/function triggerCoinCollectJuice\(coin\) \{([\s\S]*?)\n  \}/);
  assert(triggerFnMatch !== null, 'triggerCoinCollectJuice()-Funktionskörper gefunden');
  assert(triggerFnMatch && /if\s*\(reducedMotion\)\s*return;/.test(triggerFnMatch[1]),
    'triggerCoinCollectJuice() bricht bei reducedMotion vor Burst/Flug ab (Score zählt bereits unabhängig hoch)');

  // playCoinChime() erzeugt NIEMALS selbst einen neuen AudioContext (Autoplay-Policy) und ist an state.sound.enabled gekoppelt.
  const chimeMatch = idleJs.match(/function playCoinChime\(\) \{([\s\S]*?)\n  \}/);
  assert(chimeMatch !== null, 'playCoinChime()-Funktionskörper gefunden');
  assert(chimeMatch && /if\s*\(!audioCtx \|\| !state\.sound\.enabled\)\s*return;/.test(chimeMatch[1]),
    'playCoinChime() ist an audioCtx (bereits per Nutzer-Geste erzeugt) + state.sound.enabled gekoppelt, legt selbst keinen AudioContext an');

  // CSS: Partikel/Ghost-Münze/Score-Puls-Klassen existieren, animieren nur transform/opacity.
  ['idle-juice-coin-particle', 'idle-juice-coin-fly'].forEach((cls) => {
    assert(idleCss.includes('.' + cls), `idle.css definiert .${cls}`);
  });
  assert(/\.idle-run-score-hud-value\.is-coin-pulse\s*\{/.test(idleCss), 'idle.css definiert .idle-run-score-hud-value.is-coin-pulse');
  assert(/@keyframes idle-juice-coin-burst\s*\{[\s\S]*?transform:/.test(idleCss), 'Coin-Burst-Keyframe animiert transform');
  assert(/@keyframes idle-juice-score-pulse\s*\{[\s\S]*?transform: scale/.test(idleCss), 'Score-Puls-Keyframe animiert transform: scale (kein Layout-Property)');

  // Reduced-motion-Block (EIN gemeinsamer Block, kein zweiter) deckt die neuen Klassen zusätzlich defensiv ab.
  const reducedBlockMatch = idleCss.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/);
  assert(reducedBlockMatch !== null, 'idle.css hat weiterhin genau EINEN @media (prefers-reduced-motion: reduce)-Block');
  assert(reducedBlockMatch && /\.idle-juice-coin-particle\.is-bursting \{ animation: none; \}/.test(reducedBlockMatch[1]),
    'Der bestehende reduced-motion-Block deckt .idle-juice-coin-particle.is-bursting zusätzlich ab');
  assert((idleCss.match(/@media \(prefers-reduced-motion: reduce\)/g) || []).length === 1,
    'idle.css hat weiterhin nur EINEN @media (prefers-reduced-motion: reduce)-Block (kein zweiter angelegt)');

  assert(!/console\.log/.test(idleJs), 'idle.js enthält weiterhin kein console.log');
}

// ============================================================
section('7. feat(juice-nearmiss): Near-Miss-Popup an der Hindernis-Position');
// ============================================================
{
  const idleJs = read('idle.js');
  const idleCss = read('idle.css');

  // Deutscher Text bleibt exakt erhalten (bestehende Regression, jetzt zusätzlich explizit geprüft).
  assert(idleJs.includes("'💨 Knapp vorbei! +'"), "idle.js behält den deutschen Text '💨 Knapp vorbei! +' exakt bei");

  // triggerNearMiss() bekommt jetzt das Hindernis übergeben und reicht dessen Canvas-Position weiter.
  assert(/function triggerNearMiss\(nowMs, obstacle\)/.test(idleJs), 'triggerNearMiss() nimmt jetzt (nowMs, obstacle) entgegen');
  assert(/var point = obstacle \? runnerCanvasPoint\(obstacle\.displayLane, obstacle\.t\) : null;/.test(idleJs),
    'triggerNearMiss() berechnet die Canvas-Position des Hindernisses über runnerCanvasPoint()');
  assert((idleJs.match(/triggerNearMiss\(now, obstacle\)/g) || []).length === 2,
    'Beide Aufrufstellen in tickRunner() übergeben jetzt das Hindernis an triggerNearMiss()');

  // showNearMissPopup() positioniert NUR ohne reducedMotion + mit point — sonst der bestehende zentrierte Fallback.
  const popupFnMatch = idleJs.match(/function showNearMissPopup\(bonus, point\) \{([\s\S]*?)\n  \}/);
  assert(popupFnMatch !== null, 'showNearMissPopup(bonus, point)-Funktionskörper gefunden');
  assert(popupFnMatch && /if \(!reducedMotion && point\)/.test(popupFnMatch[1]),
    'showNearMissPopup() positioniert nur ohne prefers-reduced-motion UND mit vorhandenem point');
  assert(popupFnMatch && /popup\.style\.left = ''/.test(popupFnMatch[1]) && /popup\.style\.top = ''/.test(popupFnMatch[1]),
    'showNearMissPopup() setzt ohne point/bei reducedMotion die Inline-Position zurück (fällt auf die zentrierte CSS-Basisposition zurück)');

  // idle-core.js bleibt unangetastet — nur idle.js (Präsentationsschicht) wurde geändert.
  const idleCoreJs = read('idle-core.js');
  assert(/function isNearMiss\(state, obstacle, nowMs\)/.test(idleCoreJs) || /isNearMiss\s*=\s*function/.test(idleCoreJs) || idleCoreJs.includes('function isNearMiss('),
    'idle-core.js definiert isNearMiss() weiterhin unverändert (Signatur vorhanden)');

  // Glassmorphism: halbtransparenter Hintergrund + backdrop-filter (progressive enhancement) + feiner Rahmen aus Glass-Tokens.
  const popupCssMatch = idleCss.match(/\.idle-near-miss-popup \{([\s\S]*?)\n\}/);
  assert(popupCssMatch !== null, '.idle-near-miss-popup CSS-Regel gefunden');
  assert(popupCssMatch && /rgba\(0, 112, 243, 0\.\d+\)/.test(popupCssMatch[1]), '.idle-near-miss-popup hat einen halbtransparenten (nicht voll-deckenden) Hintergrund');
  assert(popupCssMatch && /border:\s*1px solid var\(--glass-border/.test(popupCssMatch[1]), '.idle-near-miss-popup nutzt --glass-border für einen feinen Rahmen');
  assert(/@supports \(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\) \{\s*\n\s*\.idle-near-miss-popup \{[\s\S]*?backdrop-filter: blur\(var\(--glass-blur-sm\)\) saturate\(var\(--glass-saturate\)\);/.test(idleCss),
    '.idle-near-miss-popup bekommt per @supports progressiv einen backdrop-filter-Blur (Glass-Tokens)');

  // Weiterhin nur EIN reduced-motion-Block, keine neuen Klassen dafür nötig (nur Positionierung + Glass, keine neue Bewegung).
  assert((idleCss.match(/@media \(prefers-reduced-motion: reduce\)/g) || []).length === 1,
    'idle.css hat weiterhin nur EINEN @media (prefers-reduced-motion: reduce)-Block');

  assert(!/console\.log/.test(idleJs), 'idle.js enthält weiterhin kein console.log');
}

// ============================================================
section('8. feat(juice-combo): Farb-Intensität + Skalier-Puls auf #idleRunComboBadge');
// ============================================================
{
  const idleJs = read('idle.js');
  const idleCss = read('idle.css');

  // Puls wird bei JEDEM Near-Miss (= Combo-Zuwachs) ausgelöst, direkt nach der HUD-Aktualisierung.
  const triggerFnMatch = idleJs.match(/function triggerNearMiss\(nowMs, obstacle\) \{([\s\S]*?)\n  \}/);
  assert(triggerFnMatch !== null, 'triggerNearMiss()-Funktionskörper gefunden');
  assert(triggerFnMatch && /updateRunComboHud\(\);\s*\n\s*triggerComboPulse\(\);/.test(triggerFnMatch[1]),
    'triggerNearMiss() ruft triggerComboPulse() direkt nach updateRunComboHud() auf');

  // updateRunComboHud() setzt --combo-intensity NUR auf #idleRunComboBadge (nicht die unrelated Schaltpunkt-Combo).
  assert(/badge\.style\.setProperty\('--combo-intensity',/.test(idleJs),
    'updateRunComboHud() setzt die CSS-Variable --combo-intensity auf dem Combo-Badge');
  assert(idleJs.includes("document.getElementById('idleRunComboBadge')"),
    'updateRunComboHud()/triggerComboPulse() lesen weiterhin ausschliesslich #idleRunComboBadge (nicht #idleComboBadge)');
  assert(!/idleComboBadge['"]\)[^\n]*--combo-intensity/.test(idleJs),
    '--combo-intensity wird NICHT auf der unrelated Schaltpunkt-Combo (#idleComboBadge) gesetzt');

  // triggerComboPulse() respektiert prefers-reduced-motion (No-op dort).
  const pulseFnMatch = idleJs.match(/function triggerComboPulse\(\) \{([\s\S]*?)\n  \}/);
  assert(pulseFnMatch !== null, 'triggerComboPulse()-Funktionskörper gefunden');
  assert(pulseFnMatch && /if \(reducedMotion\) return;/.test(pulseFnMatch[1]),
    'triggerComboPulse() bricht bei prefers-reduced-motion sofort ab (kein Puls)');

  // CSS: Intensität ausschliesslich über filter (erlaubte Eigenschaft), Puls ausschliesslich über transform: scale.
  const comboCssMatch = idleCss.match(/\.idle-run-combo-badge \{([\s\S]*?)\n\}/);
  assert(comboCssMatch !== null, '.idle-run-combo-badge CSS-Regel gefunden');
  assert(comboCssMatch && /filter:\s*saturate\(calc\(1 \+ var\(--combo-intensity\)/.test(comboCssMatch[1]),
    '.idle-run-combo-badge treibt die Farb-Intensität über filter: saturate(...) aus --combo-intensity');
  assert(comboCssMatch && !/(width|height|top|left|margin)\s*:/.test(comboCssMatch[1]),
    '.idle-run-combo-badge animiert/setzt KEIN Layout-Property (nur filter/transition)');
  assert(/@keyframes idle-juice-combo-pulse\s*\{[\s\S]*?transform: scale\([\s\S]*?\}\s*\n\}/.test(idleCss),
    'Der Combo-Puls-Keyframe animiert ausschliesslich transform: scale');
  // NICHT auf der gemeinsamen .idle-combo-badge-Basis (die auch #idleComboBadge stylt).
  assert(!/\.idle-combo-badge\s*\{[^}]*--combo-intensity/.test(idleCss),
    'Die --combo-intensity-Regel sitzt NICHT auf der gemeinsamen .idle-combo-badge-Basis (nur auf .idle-run-combo-badge)');

  // Reduced-motion: NUR der Puls entfällt, die Farb-Intensität (filter) bleibt als reine Zustandsanzeige erhalten.
  const reducedBlockMatch = idleCss.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/);
  assert(reducedBlockMatch !== null, 'idle.css hat weiterhin genau EINEN @media (prefers-reduced-motion: reduce)-Block');
  assert(reducedBlockMatch && /\.idle-run-combo-badge\.is-combo-pulse \{ animation: none; \}/.test(reducedBlockMatch[1]),
    'Der reduced-motion-Block deaktiviert NUR .idle-run-combo-badge.is-combo-pulse (die Animation), nicht den Basis-filter');
  assert(!reducedBlockMatch[1].includes('.idle-run-combo-badge {') , 'Der reduced-motion-Block überschreibt die Basis-.idle-run-combo-badge-Regel (Farb-Intensität) NICHT');
  assert((idleCss.match(/@media \(prefers-reduced-motion: reduce\)/g) || []).length === 1,
    'idle.css hat weiterhin nur EINEN @media (prefers-reduced-motion: reduce)-Block (kein zweiter angelegt)');

  assert(!/console\.log/.test(idleJs), 'idle.js enthält weiterhin kein console.log');
}

// ============================================================
section('9. feat(juice-powerup): Farb-Wash + HUD-Eintritt + Restdauer-Ring');
// ============================================================
{
  const idleJs = read('idle.js');
  const idleCss = read('idle.css');

  // collectPowerup() löst BEIDE Effekte direkt nach der Effekt-Aktivierung aus.
  const collectFnMatch = idleJs.match(/function collectPowerup\(\) \{([\s\S]*?)\n  \}/);
  assert(collectFnMatch !== null, 'collectPowerup()-Funktionskörper gefunden');
  assert(collectFnMatch && /triggerPowerupWash\(type\);\s*\n\s*triggerPowerupHudEnter\(type\);/.test(collectFnMatch[1]),
    'collectPowerup() ruft triggerPowerupWash(type) + triggerPowerupHudEnter(type) auf');

  ['function ensurePowerupWashNode', 'function triggerPowerupWash', 'function triggerPowerupHudEnter']
    .forEach((sig) => {
      const idx = idleJs.indexOf(sig);
      assert(idx !== -1, `idle.js definiert ${sig}()`);
      const jsDocStart = idleJs.lastIndexOf('/**', idx);
      const docBetween = jsDocStart === -1 ? '' : idleJs.slice(jsDocStart, idx);
      assert(jsDocStart !== -1 && /\*\/\s*$/.test(docBetween.trimEnd() + '\n'), `${sig}() hat einen vorangestellten JSDoc-Block`);
    });

  // Beide Zusatz-Bewegungen brechen bei prefers-reduced-motion sofort ab.
  const washFnMatch = idleJs.match(/function triggerPowerupWash\(type\) \{([\s\S]*?)\n  \}/);
  assert(washFnMatch !== null, 'triggerPowerupWash()-Funktionskörper gefunden');
  assert(washFnMatch && /if \(reducedMotion\) return;/.test(washFnMatch[1]),
    'triggerPowerupWash() bricht bei prefers-reduced-motion sofort ab (kein Wash)');
  const enterFnMatch = idleJs.match(/function triggerPowerupHudEnter\(type\) \{([\s\S]*?)\n  \}/);
  assert(enterFnMatch !== null, 'triggerPowerupHudEnter()-Funktionskörper gefunden');
  assert(enterFnMatch && /if \(reducedMotion\) return;/.test(enterFnMatch[1]),
    'triggerPowerupHudEnter() bricht bei prefers-reduced-motion sofort ab (keine Eintritts-Animation)');

  // Der Ring liest NUR bereits vorhandene, reine IdleCore.powerup*DurationSeconds()-Funktionen — keine neue Zustands-Mutation.
  assert(/var totalDurationFn = POWERUP_TOTAL_DURATION_FN\[type\];/.test(idleJs),
    'updatePowerupHud() liest die Gesamt-Wirkdauer über POWERUP_TOTAL_DURATION_FN');
  assert(/POWERUP_TOTAL_DURATION_FN = \{[\s\S]*?magnet: IdleCore\.powerupMagnetDurationSeconds,/.test(idleJs),
    'POWERUP_TOTAL_DURATION_FN referenziert ausschliesslich bestehende, reine IdleCore.powerup*DurationSeconds()-Funktionen');
  assert(/badge\.style\.setProperty\('--powerup-progress', progress\.toFixed\(3\)\);/.test(idleJs),
    'updatePowerupHud() setzt --powerup-progress synchron pro Frame auf dem Badge');

  // CSS: Ring ist eine reine (nicht animierte) Zustandsanzeige, Eintritt/Wash animieren nur transform/opacity.
  const badgeCssMatch = idleCss.match(/\.idle-powerup-hud-badge::before \{([\s\S]*?)\n\}/);
  assert(badgeCssMatch !== null, '.idle-powerup-hud-badge::before CSS-Regel gefunden');
  assert(badgeCssMatch && /conic-gradient\(var\(--accent\) calc\(var\(--powerup-progress, 0\) \* 360deg\)/.test(badgeCssMatch[1]),
    'Der Ring wird über conic-gradient(...) aus --powerup-progress gespeist');
  assert(badgeCssMatch && !/transition/.test(badgeCssMatch[1]),
    'Der Ring hat KEINE CSS-transition (reine, synchron gesetzte Zustandsanzeige, kein Animations-Nachlauf)');
  assert(/@keyframes idle-juice-powerup-enter\s*\{[\s\S]*?opacity: 0;[\s\S]*?transform: scale\(/.test(idleCss),
    'Der Eintritts-Keyframe animiert opacity + transform: scale');
  assert(/@keyframes idle-juice-powerup-wash\s*\{[\s\S]*?opacity:/.test(idleCss),
    'Der Wash-Keyframe animiert ausschliesslich opacity');
  assert(/\.idle-juice-powerup-wash \{[\s\S]*?background: var\(--juice-wash-color, transparent\);/.test(idleCss),
    'Der Wash-Farbton kommt aus der JS-gesetzten CSS-Variable --juice-wash-color');

  // Reduced-motion-Block deckt beide neuen Klassen defensiv zusätzlich ab.
  const reducedBlockMatch = idleCss.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/);
  assert(reducedBlockMatch !== null, 'idle.css hat weiterhin genau EINEN @media (prefers-reduced-motion: reduce)-Block');
  assert(reducedBlockMatch && /\.idle-juice-powerup-wash\.is-active \{ animation: none; \}/.test(reducedBlockMatch[1]),
    'Der reduced-motion-Block deaktiviert defensiv .idle-juice-powerup-wash.is-active');
  assert(reducedBlockMatch && /\.idle-powerup-hud-badge\.is-entering \{ animation: none; \}/.test(reducedBlockMatch[1]),
    'Der reduced-motion-Block deaktiviert defensiv .idle-powerup-hud-badge.is-entering');
  assert((idleCss.match(/@media \(prefers-reduced-motion: reduce\)/g) || []).length === 1,
    'idle.css hat weiterhin nur EINEN @media (prefers-reduced-motion: reduce)-Block (kein zweiter angelegt)');

  assert(!/console\.log/.test(idleJs), 'idle.js enthält weiterhin kein console.log');
}

// ============================================================
section('10. feat(juice-crash): Slowmo-Puls/Opacity-Flash VOR der verzögerten Crash-Zusammenfassung');
// ============================================================
{
  const idleJs = read('idle.js');
  const idleCss = read('idle.css');

  // handleRunCrash() ruft triggerCrashJuice() SOFORT auf, verzögert aber NUR das Öffnen des Dialogs.
  const crashFnMatch = idleJs.match(/function handleRunCrash\(nowMs\) \{([\s\S]*?)\n  \}/);
  assert(crashFnMatch !== null, 'handleRunCrash()-Funktionskörper gefunden');
  assert(crashFnMatch && /triggerCollisionFeedback\(\);\s*\n\s*triggerCrashJuice\(\);/.test(crashFnMatch[1]),
    'handleRunCrash() ruft triggerCrashJuice() direkt nach triggerCollisionFeedback() auf');
  assert(crashFnMatch && /setTimeout\(function \(\) \{\s*\n\s*showCrashSummary\(summary\);\s*\n\s*\}, reducedMotion \? CRASH_FLASH_MS : CRASH_SLOWMO_MS\);/.test(crashFnMatch[1]),
    'handleRunCrash() verzögert NUR showCrashSummary() (per setTimeout), reducedMotion nutzt die deutlich kürzere CRASH_FLASH_MS statt CRASH_SLOWMO_MS');
  // IdleCore.endRun() bleibt der EINZIGE, synchron VOR der Verzögerung ausgeführte Mutations-Aufruf.
  assert(crashFnMatch && /^\s*var summary = IdleCore\.endRun\(state, nowMs\);/m.test(crashFnMatch[1]),
    'handleRunCrash() ruft IdleCore.endRun() weiterhin synchron VOR jeglicher Verzögerung auf (kein zweiter Mutations-Aufruf)');

  // triggerCrashJuice() wählt je nach reducedMotion GENAU EINE der beiden Klassen (nie beide).
  const juiceFnMatch = idleJs.match(/function triggerCrashJuice\(\) \{([\s\S]*?)\n  \}/);
  assert(juiceFnMatch !== null, 'triggerCrashJuice()-Funktionskörper gefunden');
  assert(juiceFnMatch && /var flashClass = reducedMotion \? 'is-crash-flash' : 'is-crash-slowmo';/.test(juiceFnMatch[1]),
    'triggerCrashJuice() wählt is-crash-flash (reduced) bzw. is-crash-slowmo (voll) exklusiv über reducedMotion');

  // CSS: Slowmo animiert nur filter, der reduced-motion-Ersatz nur opacity — beides auf dem bestehenden #idleTrackWrap.
  assert(/@keyframes idle-juice-crash-slowmo\s*\{[\s\S]*?filter: saturate\([\s\S]*?\}\s*\n\}/.test(idleCss),
    'Der Crash-Slowmo-Keyframe animiert ausschliesslich filter (saturate/brightness)');
  assert(/@keyframes idle-juice-crash-flash\s*\{[\s\S]*?opacity: 1;[\s\S]*?opacity: 0\.55;/.test(idleCss),
    'Der reduced-motion-Ersatz-Keyframe (is-crash-flash) animiert ausschliesslich opacity');

  const reducedBlockMatch = idleCss.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/);
  assert(reducedBlockMatch !== null, 'idle.css hat weiterhin genau EINEN @media (prefers-reduced-motion: reduce)-Block');
  assert(reducedBlockMatch && /\.idle-track-wrap\.is-crash-slowmo \{ animation: none; \}/.test(reducedBlockMatch[1]),
    'Der reduced-motion-Block deaktiviert defensiv .idle-track-wrap.is-crash-slowmo');
  assert(reducedBlockMatch && !/\.idle-track-wrap\.is-crash-flash/.test(reducedBlockMatch[1]),
    'Der reduced-motion-Ersatz (.is-crash-flash) wird NICHT vom reduced-motion-Block deaktiviert (er IST bereits die reduzierte Alternative)');
  assert((idleCss.match(/@media \(prefers-reduced-motion: reduce\)/g) || []).length === 1,
    'idle.css hat weiterhin nur EINEN @media (prefers-reduced-motion: reduce)-Block (kein zweiter angelegt)');

  assert(!/console\.log/.test(idleJs), 'idle.js enthält weiterhin kein console.log');
}

// ============================================================
section('11. feat(juice-summary): Highscore-Konfetti + prominente Primär-Aktion, count-up-ids unangetastet');
// ============================================================
{
  const idleJs = read('idle.js');
  const idleCss = read('idle.css');

  // Regression (Absicherung gegen count-up-test.js): beide ids + data-count-up bleiben exakt erhalten.
  ['idleRunSummaryScore', 'idleRunSummaryCoins'].forEach((id) => {
    const re = new RegExp('id="' + id + '"[^\']*data-count-up|data-count-up[^\']*id="' + id + '"');
    assert(re.test(idleJs), `idle.js behält id="${id}" + data-count-up in showCrashSummary() exakt bei`);
  });

  // Konfetti wird NUR im newHighscore-Zweig ausgelöst, NACH dem bestehenden Highscore-Hinweis.
  const showFnMatch = idleJs.match(/function showCrashSummary\(summary\) \{([\s\S]*?)\n  \}/);
  assert(showFnMatch !== null, 'showCrashSummary()-Funktionskörper gefunden');
  assert(showFnMatch && /highscoreEl\.textContent = '🏆 Neuer Highscore!';\s*\n\s*container\.appendChild\(highscoreEl\);\s*\n\s*triggerHighscoreConfetti\(container\);/.test(showFnMatch[1]),
    'triggerHighscoreConfetti(container) wird direkt NACH dem bestehenden Highscore-Hinweis, NUR im if(summary.newHighscore)-Zweig aufgerufen');

  const confettiFnMatch = idleJs.match(/function triggerHighscoreConfetti\(container\) \{([\s\S]*?)\n  \}/);
  assert(confettiFnMatch !== null, 'triggerHighscoreConfetti()-Funktionskörper gefunden');
  assert(confettiFnMatch && /if \(reducedMotion \|\| !container\) return;/.test(confettiFnMatch[1]),
    'triggerHighscoreConfetti() bricht bei prefers-reduced-motion sofort ab (KEIN Konfetti — nur der statische Highscore-Hinweis bleibt)');
  assert(confettiFnMatch && /for \(var i = 0; i < CONFETTI_PIECE_COUNT; i\+\+\)/.test(confettiFnMatch[1]),
    'triggerHighscoreConfetti() erzeugt höchstens CONFETTI_PIECE_COUNT Partikel (gedeckelt)');

  // "Nochmal fahren" bleibt die EINZIGE Aktion (prominente Primär-Aktion, kein zweiter Button).
  assert(/actions: \[\{\s*\n\s*label: '🔄 Nochmal fahren',\s*\n\s*id: 'idleRunSummaryRestartBtn',/.test(idleJs),
    "showCrashSummary() behält '🔄 Nochmal fahren' als einzige, autofokussierte Aktion bei");

  // CSS: Konfetti animiert nur transform/opacity, die Primär-Aktion + Count-up-Werte werden rein optisch (nicht animiert) hervorgehoben.
  assert(/@keyframes idle-juice-confetti-fall\s*\{[\s\S]*?transform: translateY\([\s\S]*?rotate\(/.test(idleCss),
    'Der Konfetti-Keyframe animiert transform (translateY + rotate) und opacity');
  assert(/#idleRunSummaryRestartBtn \{[\s\S]*?width: 100%;/.test(idleCss),
    'idle.css hebt #idleRunSummaryRestartBtn (die tatsächliche Button-id aus modal.js buildActionButton) optisch als Primär-Aktion hervor');
  assert(/\.idle-run-summary-stat-value \{[\s\S]*?font-size: 1\.7em;/.test(idleCss),
    'idle.css macht .idle-run-summary-stat-value (Score/Coins-Count-up) optisch prominenter');

  assert(!/console\.log/.test(idleJs), 'idle.js enthält weiterhin kein console.log');
}

// ============================================================
// Ergebnis
// ============================================================
console.log(`\n${'═'.repeat(60)}`);
console.log(`  RESULTS: ${passed}/${passed + failed} passed`);
console.log('═'.repeat(60));

if (failed > 0) process.exit(1);
