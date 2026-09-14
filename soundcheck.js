/**
 * SOUNDCHECK — Motorrad Exhaust Audio Engine v2
 * Real MP3 audio files (royalty-free) with Web Audio API synthesis fallback
 * Audio path: /audio/{bike-id}-{type}.mp3  (e.g. z900-stock.mp3)
 * Waveform Visualizer + Spectrum Analyzer + Equalizer
 * Favorites (localStorage) + A/B Compare
 */

(function() {
  'use strict';

  /* ============================================================
     TEIL 2 — SOUND-WIEDERGABE GLOBAL DEAKTIVIEREN ("Im Aufbau")
     ============================================================ */
  /**
   * Feature-Flag: Wenn `false`, wird beim Klick auf JEDEN Play-Button
   * (Bike-Karten, Favoriten, Player-Modal, A/B Compare) NICHTS abgespielt —
   * kein `AudioContext`, keine echte MP3-Wiedergabe, keine Web-Audio-
   * Synthese. Play-Buttons werden stattdessen greyed/disabled mit dem
   * Badge "🚧 Im Aufbau" dargestellt und ein Klick zeigt eine kurze,
   * freundliche deutsche Hinweismeldung ("Dieser Sound wird gerade
   * überarbeitet.") statt einen Sound abzuspielen.
   *
   * Alle zugrunde liegenden Play-Funktionen (openPlayer(), playExhaust(),
   * playRealAudio(), fallbackToSynthesis() usw.) bleiben unverändert im
   * Code erhalten — sie werden nur an ihrem zentralen Einstiegspunkt
   * (openPlayer()) gegated und sind dadurch schlicht nicht mehr erreichbar,
   * solange das Flag `false` ist.
   *
   * REAKTIVIERUNG: Diese Konstante auf `true` setzen — die komplette
   * bisherige Play-Funktionalität ist dann sofort wieder aktiv, ohne dass
   * an anderer Stelle im Code etwas geändert werden muss.
   * @const {boolean}
   */
  var SOUND_PLAYBACK_ENABLED = false;

  /**
   * Zeigt eine kurze, nicht-blockierende deutsche Hinweismeldung ("Toast"),
   * wenn ein Nutzer versucht, einen (wegen SOUND_PLAYBACK_ENABLED=false)
   * deaktivierten Play-Button zu benutzen. Erzeugt bei Bedarf das
   * Toast-Element einmalig und blendet es für ein paar Sekunden ein.
   * @returns {void}
   */
  function showComingSoonNotice() {
    var toast = document.getElementById('scSoundDisabledToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'scSoundDisabledToast';
      toast.className = 'sc-toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      document.body.appendChild(toast);
    }
    toast.textContent = '🚧 Dieser Sound wird gerade überarbeitet.';
    toast.classList.add('sc-toast-visible');
    clearTimeout(showComingSoonNotice._timer);
    showComingSoonNotice._timer = setTimeout(function() {
      toast.classList.remove('sc-toast-visible');
    }, 2800);
  }

  /* ============================================================
     MOTORCYCLE DATA
     ============================================================ */
  var BIKES = [
    {
      id: 'zx6r',
      name: 'Kawasaki Ninja ZX-6R',
      icon: '🏎️',
      ps: 130,
      category: 'sport',
      exhausts: [
        { type: 'stock',  label: 'Stock (OEM)',         brand: 'Kawasaki Standard', db: 95,  character: 'Smooth & Revvy',  freq: 180, harmonics: 3 },
        { type: 'racing', label: 'Racing (Akrapovic)',   brand: 'Akrapovic Racing', db: 102, character: 'Aggressive',      freq: 190, harmonics: 4 },
        { type: 'custom', label: 'Custom (Yoshimura)',   brand: 'Yoshimura RS9',   db: 105, character: 'Raw Scream',       freq: 175, harmonics: 5 }
      ]
    },
    {
      id: 'z900',
      name: 'Kawasaki Z900',
      icon: '⚡',
      ps: 125,
      category: 'naked',
      exhausts: [
        { type: 'stock',  label: 'Stock (OEM)',         brand: 'Kawasaki Standard', db: 92,  character: 'Deep Growl',      freq: 140, harmonics: 3 },
        { type: 'racing', label: 'Racing (Arrow)',       brand: 'Arrow Race-Tech',  db: 99,  character: 'Thunderous',      freq: 150, harmonics: 4 },
        { type: 'custom', label: 'Custom (SC-Project)', brand: 'SC-Project CR-T',  db: 104, character: 'Bark & Bite',     freq: 145, harmonics: 5 }
      ]
    },
    {
      id: 'zx10r',
      name: 'Kawasaki Ninja ZX-10R',
      icon: '🚀',
      ps: 210,
      category: 'sport',
      exhausts: [
        { type: 'stock',  label: 'Stock (OEM)',         brand: 'Kawasaki Standard', db: 98,  character: 'Refined Power',   freq: 200, harmonics: 3 },
        { type: 'racing', label: 'Racing (Akrapovic)',   brand: 'Akrapovic Evo',    db: 106, character: 'Screaming Banshee', freq: 210, harmonics: 5 },
        { type: 'custom', label: 'Custom (Termignoni)', brand: 'Termignoni D112',  db: 108, character: 'Track Monster',   freq: 205, harmonics: 6 }
      ]
    },
    {
      // War früher 'z650rs' — dieses Modell existiert im echten Katalog
      // (bikes-data.js) nicht. Ersetzt durch 'w230', ein echtes,
      // ebenfalls klassisch-retro gestimmtes Katalog-Modell (Regel 6-
      // konform, keine Änderung an soundcheck.html nötig, siehe D.3/D.5
      // im Recon). Die "Retro"-Klangcharakteristik der Exhausts passt
      // inhaltlich mindestens so gut zum W230 wie zum vormaligen Z650RS.
      id: 'w230',
      name: 'Kawasaki W230',
      icon: '🛞',
      ps: 19,
      category: 'classic',
      exhausts: [
        { type: 'stock',  label: 'Stock (OEM)',         brand: 'Kawasaki Standard', db: 88,  character: 'Retro Burble',    freq: 110, harmonics: 2 },
        { type: 'racing', label: 'Racing (Vance & Hines)', brand: 'V&H Twin Slash', db: 95, character: 'Classic Roar',    freq: 115, harmonics: 3 },
        { type: 'custom', label: 'Custom (Cobra)',       brand: 'Cobra Speedster',  db: 99,  character: 'Vintage Thunder', freq: 108, harmonics: 4 }
      ]
    },
    {
      // Existierte vorher schon als Karten-Eintrag, war aber nicht mit dem
      // echten Katalog verknüpft. Mit Teil 3 ist 'versys650' ein echtes
      // SHARED_BIKES-Modell — ps an den echten Katalogwert angeglichen.
      id: 'versys650',
      name: 'Kawasaki Versys 650',
      icon: '🗺️',
      ps: 67,
      category: 'naked',
      exhausts: [
        { type: 'stock',  label: 'Stock (OEM)',         brand: 'Kawasaki Standard', db: 86,  character: 'Touring Rumble',  freq: 120, harmonics: 2 },
        { type: 'racing', label: 'Racing (Remus)',       brand: 'Remus Hexacone',   db: 93,  character: 'Adventure Call',  freq: 125, harmonics: 3 },
        { type: 'custom', label: 'Custom (Two Brothers)', brand: '2Bro S1R',        db: 97,  character: 'Trail Bark',      freq: 118, harmonics: 4 }
      ]
    },
    {
      // War früher 'h2r' — dieses Modell existiert im echten Katalog nicht
      // (nur 'h2'). Ersetzt durch das echte 'h2' (Ninja H2, ebenfalls
      // supercharged) — die "Supercharged"-Klangcharakteristik der
      // Exhausts passt unverändert zum echten Modell.
      id: 'h2',
      name: 'Kawasaki Ninja H2',
      icon: '⚡',
      ps: 231,
      category: 'sport',
      exhausts: [
        { type: 'stock',  label: 'Stock (OEM)',         brand: 'Kawasaki Standard', db: 101, character: 'Supercharged Howl', freq: 240, harmonics: 4 },
        { type: 'racing', label: 'Racing (Akrapovic)',   brand: 'Akrapovic Evolution', db: 110, character: 'Banshee Wail', freq: 250, harmonics: 6 },
        { type: 'custom', label: 'Custom (Graves)',      brand: 'Graves Titanium',  db: 112, character: 'Jet Engine',      freq: 245, harmonics: 7 }
      ]
    }
  ];

  /* ============================================================
     WEB AUDIO ENGINE
     ============================================================ */
  var AudioCtx = window.AudioContext || window.webkitAudioContext;
  var audioCtx = null;
  var analyser = null;
  var gainNode = null;
  var masterVolume = 0.8; // 0..1, persisted via localStorage 'soundcheckVolume' (0..100)
  var currentSource = null;
  var isPlaying = false;
  var currentBike = null;
  var currentExhaustIdx = 0;

  // Animation frame ID for visualizers
  var animFrameId = null;

  // A/B compare state
  var compareA = null;
  var compareB = null;
  var compareSourceA = null;
  var compareSourceB = null;
  var isABPlaying = false;

  function ensureAudioCtx() {
    if (!audioCtx) {
      audioCtx = new AudioCtx();
      gainNode = audioCtx.createGain();
      gainNode.gain.value = masterVolume;
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.8;
      gainNode.connect(analyser);
      analyser.connect(audioCtx.destination);
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  }


  /* ============================================================
     REAL AUDIO FILE ENGINE
     Loads MP3 files from /audio/ folder
     Falls back to Web Audio synthesis if file not available
     ============================================================ */

  // Audio-Datei-Zuordnung je Bike/Exhaust-Kombination.
  //
  // WICHTIG (Sound-Fix, siehe Recon §D): `audio/` enthält 21 mp3-Dateien,
  // die sich auf nur 4 tatsächlich unterschiedliche Aufnahmen reduzieren
  // (per md5sum verifiziert) — u. a. war 'audio/versys650-stock.mp3'
  // byte-identisch mit 'audio/harley-engine.mp3' (V2-Bike-Rumpeln als
  // "Stock"-Sound eines japanischen Paralleltwin-Adventure-Bikes,
  // Kategorie-Fehlzuordnung). Diese Zuordnung hier referenziert deshalb
  // NUR Dateien, deren Dateiname tatsächlich zum jeweiligen Bike passt.
  // Für 'versys650' fehlt bewusst der 'stock'-Eintrag: es gibt dafür
  // keine ehrliche Aufnahme (nur die falsch zugeordnete Harley-Datei) —
  // ohne AUDIO_FILES-Eintrag greift automatisch die vorhandene
  // Web-Audio-Synthese (fallbackToSynthesis(), s. u.), parametrisiert mit
  // den freq/harmonics/character-Werten des jeweiligen Exhausts, statt
  // einen falschen Motor-Sound abzuspielen ("Sound folgt"-Verhalten ohne
  // Silent-/Broken-Playback).
  var AUDIO_FILES = {
    zx6r:      { stock: 'audio/zx6r-stock.mp3',      racing: 'audio/zx6r-racing.mp3',      custom: 'audio/zx6r-custom.mp3'      },
    z900:      { stock: 'audio/z900-stock.mp3',       racing: 'audio/z900-racing.mp3',       custom: 'audio/z900-custom.mp3'       },
    zx10r:     { stock: 'audio/zx10r-stock.mp3',      racing: 'audio/zx10r-racing.mp3',      custom: 'audio/zx10r-custom.mp3'      },
    w230:      { stock: 'audio/z650rs-stock.mp3',     racing: 'audio/z650rs-racing.mp3',     custom: 'audio/z650rs-custom.mp3'     },
    versys650: {                                      racing: 'audio/versys650-racing.mp3',  custom: 'audio/versys650-custom.mp3'  },
    h2:        { stock: 'audio/h2r-stock.mp3',        racing: 'audio/h2r-racing.mp3',        custom: 'audio/h2r-custom.mp3'        },
  };

  // Audio buffer cache
  var audioBufferCache = {};
  var loadingState = {};  // 'loading' | 'loaded' | 'error'

  /**
   * Load a real audio file and return decoded AudioBuffer
   * Returns a Promise that resolves with AudioBuffer or rejects on error
   */
  /**
   * Load an MP3 from the /audio/ folder, decode it, and cache the AudioBuffer.
   * @param {string} url - Relative path to the audio file
   * @returns {Promise<AudioBuffer>} - Decoded audio data
   */
  function loadAudioFile(url) {
    if (audioBufferCache[url]) {
      return Promise.resolve(audioBufferCache[url]);
    }
    if (loadingState[url] === 'error') {
      return Promise.reject(new Error('Previously failed: ' + url));
    }

    loadingState[url] = 'loading';
    return fetch(url)
      .then(function(response) {
        if (!response.ok) throw new Error('HTTP ' + response.status + ' for ' + url);
        return response.arrayBuffer();
      })
      .then(function(arrayBuffer) {
        return new Promise(function(resolve, reject) {
          ensureAudioCtx().decodeAudioData(arrayBuffer, resolve, reject);
        });
      })
      .then(function(buffer) {
        audioBufferCache[url] = buffer;
        loadingState[url] = 'loaded';
        return buffer;
      })
      .catch(function(err) {
        loadingState[url] = 'error';
        console.warn('[SoundCheck] Audio load failed for', url, '— using synthesis fallback:', err.message);
        throw err;
      });
  }

  // Current HTML5 Audio element (for real files)
  var currentAudioEl = null;
  var useRealAudio = false;

  /**
   * Play a real audio file using HTML5 Audio + Web Audio API analyser
   */
  /**
   * Play a real audio file using HTML5 Audio connected to the Web Audio API analyser.
   * Falls back to synthesis if loading or playback fails (autoplay block etc).
   * @param {string} url - Path to MP3 file
   * @param {object} exhaust - Exhaust config (for synthesis fallback)
   */
  function playRealAudio(url, exhaust) {
    stopCurrentPlayback();
    ensureAudioCtx();

    // Show loading state
    setPlayerLoadingState(true, 'Lade Audio...');

    var audioEl = new Audio();
    audioEl.crossOrigin = 'anonymous';
    audioEl.loop = true; // loop the audio file
    audioEl.volume = gainNode.gain.value;

    // Connect to analyser via MediaElementSourceNode
    var sourceNode;
    try {
      sourceNode = audioCtx.createMediaElementSource(audioEl);
      sourceNode.connect(analyser);
      analyser.connect(audioCtx.destination);
    } catch(e) {
      // MediaElementSource already created for this element
      console.warn('[SoundCheck] MediaElementSource error:', e);
    }

    audioEl.addEventListener('canplaythrough', function onCanPlay() {
      audioEl.removeEventListener('canplaythrough', onCanPlay);
      setPlayerLoadingState(false);
      // Adjust playback rate for variant character
      // Stock: 1.0x (normal), Racing: 1.15x (higher pitch/revs), Custom: 1.08x (mid-aggressive)
      var rateMap = { stock: 1.0, racing: 1.15, custom: 1.08 };
      audioEl.playbackRate = rateMap[exhaust.type] || 1.0;
      audioEl.play().catch(function(err) {
        console.warn('[SoundCheck] Play error:', err);
        setPlayerLoadingState(false, '⚠️ Klicken zum Abspielen');
        // On autoplay block: show fallback synthesis
        fallbackToSynthesis(exhaust);
      });
      isPlaying = true;
      useRealAudio = true;
      currentAudioEl = audioEl;
      updatePlayButton(true);
      startVisualizers();
      playbackStartTime = Date.now();
      playbackDuration = audioEl.duration || 30;
    }, { once: true });

    audioEl.addEventListener('error', function() {
      setPlayerLoadingState(false, '⚠️ Sound nicht verfügbar');
      console.warn('[SoundCheck] Audio error for', url, '— falling back to synthesis');
      fallbackToSynthesis(exhaust);
    }, { once: true });

    audioEl.src = url;
    audioEl.load();
  }

  /**
   * Fallback: synthesize engine sound with Web Audio API.
   * Called when real audio file fails to load or play.
   * @param {object} exhaust - Exhaust config with freq, harmonics, etc.
   */
  function fallbackToSynthesis(exhaust) {
    setPlayerLoadingState(false);
    playbackDuration = 8;
    playbackStartTime = Date.now();
    currentSource = synthesizeExhaust(exhaust, playbackDuration);
    isPlaying = true;
    useRealAudio = false;
    updatePlayButton(true);
    updatePlayerUI(currentBike, currentExhaustIdx);
    startVisualizers();
    playbackEndTimeout = setTimeout(function() {
      stopCurrentPlayback();
      updateTimeDisplay(0);
    }, playbackDuration * 1000 + 200);
  }

  function setPlayerLoadingState(loading, message) {
    var playBtn = document.getElementById('btnPlayPause');
    if (!playBtn) return;
    if (loading) {
      playBtn.textContent = '⏳';
      playBtn.disabled = true;
    } else {
      playBtn.disabled = false;
      if (message) {
        // Show error/info message briefly
        var infoEl = document.getElementById('scPlayerStatus');
        if (infoEl) {
          infoEl.textContent = message;
          setTimeout(function() { if(infoEl) infoEl.textContent = ''; }, 3000);
        }
      }
    }
  }


  /**
   * Synthesize motorcycle exhaust sound using Web Audio API
   * Creates a rich engine-like sound using multiple oscillators + noise
   */
  function synthesizeExhaust(exhaust, duration) {
    ensureAudioCtx();
    duration = duration || 8;

    var startTime = audioCtx.currentTime;
    var endTime = startTime + duration;
    var nodes = [];

    // --- Engine fundamental tone (oscillator at base freq) ---
    var osc1 = audioCtx.createOscillator();
    osc1.type = 'sawtooth';
    osc1.frequency.value = exhaust.freq;
    var env1 = audioCtx.createGain();
    env1.gain.setValueAtTime(0, startTime);
    env1.gain.linearRampToValueAtTime(0.35, startTime + 0.15);
    env1.gain.setValueAtTime(0.35, endTime - 0.2);
    env1.gain.linearRampToValueAtTime(0, endTime);

    // --- Rev-up automation ---
    osc1.frequency.setValueAtTime(exhaust.freq * 0.8, startTime);
    osc1.frequency.linearRampToValueAtTime(exhaust.freq * 1.6, startTime + 1.5);
    osc1.frequency.linearRampToValueAtTime(exhaust.freq * 1.2, startTime + 2.5);
    osc1.frequency.setValueAtTime(exhaust.freq * 1.2, endTime - 1);
    osc1.frequency.linearRampToValueAtTime(exhaust.freq * 0.7, endTime);

    osc1.connect(env1);
    env1.connect(gainNode);
    osc1.start(startTime);
    osc1.stop(endTime);
    nodes.push(osc1, env1);

    // --- Harmonic overtones ---
    for (var h = 2; h <= Math.min(exhaust.harmonics, 6); h++) {
      var oscH = audioCtx.createOscillator();
      oscH.type = h % 2 === 0 ? 'square' : 'sawtooth';
      oscH.frequency.value = exhaust.freq * h;
      oscH.frequency.setValueAtTime(exhaust.freq * h * 0.8, startTime);
      oscH.frequency.linearRampToValueAtTime(exhaust.freq * h * 1.6, startTime + 1.5);
      oscH.frequency.linearRampToValueAtTime(exhaust.freq * h * 1.2, startTime + 2.5);
      oscH.frequency.linearRampToValueAtTime(exhaust.freq * h * 0.7, endTime);

      var ampH = audioCtx.createGain();
      ampH.gain.setValueAtTime(0, startTime);
      ampH.gain.linearRampToValueAtTime(0.15 / h, startTime + 0.2);
      ampH.gain.setValueAtTime(0.15 / h, endTime - 0.2);
      ampH.gain.linearRampToValueAtTime(0, endTime);

      oscH.connect(ampH);
      ampH.connect(gainNode);
      oscH.start(startTime);
      oscH.stop(endTime);
      nodes.push(oscH, ampH);
    }

    // --- Low sub rumble ---
    var subOsc = audioCtx.createOscillator();
    subOsc.type = 'sine';
    subOsc.frequency.value = exhaust.freq * 0.5;
    subOsc.frequency.setValueAtTime(exhaust.freq * 0.4, startTime);
    subOsc.frequency.linearRampToValueAtTime(exhaust.freq * 0.8, startTime + 1.5);
    subOsc.frequency.linearRampToValueAtTime(exhaust.freq * 0.5, endTime);
    var subGain = audioCtx.createGain();
    subGain.gain.setValueAtTime(0, startTime);
    subGain.gain.linearRampToValueAtTime(0.25, startTime + 0.1);
    subGain.gain.setValueAtTime(0.25, endTime - 0.15);
    subGain.gain.linearRampToValueAtTime(0, endTime);
    subOsc.connect(subGain);
    subGain.connect(gainNode);
    subOsc.start(startTime);
    subOsc.stop(endTime);
    nodes.push(subOsc, subGain);

    // --- Noise burst (exhaust pops) ---
    var bufferSize = audioCtx.sampleRate * duration;
    var noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    var noiseData = noiseBuffer.getChannelData(0);
    for (var i = 0; i < bufferSize; i++) {
      noiseData[i] = (Math.random() * 2 - 1) * 0.3;
    }
    var noiseSource = audioCtx.createBufferSource();
    noiseSource.buffer = noiseBuffer;

    // Bandpass filter for exhaust-like noise
    var bpf = audioCtx.createBiquadFilter();
    bpf.type = 'bandpass';
    bpf.frequency.value = exhaust.freq * 2;
    bpf.Q.value = 0.8;

    var noiseGain = audioCtx.createGain();
    noiseGain.gain.setValueAtTime(0, startTime);
    noiseGain.gain.linearRampToValueAtTime(0.12, startTime + 0.1);
    noiseGain.gain.setValueAtTime(0.12, endTime - 0.2);
    noiseGain.gain.linearRampToValueAtTime(0, endTime);

    noiseSource.connect(bpf);
    bpf.connect(noiseGain);
    noiseGain.connect(gainNode);
    noiseSource.start(startTime);
    noiseSource.stop(endTime);
    nodes.push(noiseSource, bpf, noiseGain);

    return { nodes: nodes, startTime: startTime, duration: duration };
  }

  /* ============================================================
     PLAYBACK MANAGEMENT
     ============================================================ */
  var playbackEndTimeout = null;
  var playbackStartTime = null;
  var playbackDuration = 8;

  function stopCurrentPlayback() {
    // Stop HTML5 real audio element
    if (currentAudioEl) {
      try {
        currentAudioEl.pause();
        currentAudioEl.src = '';
      } catch(e) {}
      currentAudioEl = null;
    }
    useRealAudio = false;

    // Stop Web Audio synthesis nodes
    if (currentSource) {
      try {
        if (currentSource.nodes) {
          currentSource.nodes.forEach(function(node) {
            if (node.stop) { try { node.stop(0); } catch(e) {} }
            if (node.disconnect) { try { node.disconnect(); } catch(e) {} }
          });
        }
      } catch(e) {}
      currentSource = null;
    }
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
    if (playbackEndTimeout) {
      clearTimeout(playbackEndTimeout);
      playbackEndTimeout = null;
    }
    isPlaying = false;
    updatePlayButton(false);
    setPlayerLoadingState(false);
  }

  /**
   * Prüft, ob für eine Bike/Exhaust-Kombination eine echte, korrekt
   * zugeordnete Audio-Datei existiert (siehe AUDIO_FILES-Kommentar oben).
   * Fehlt sie, greift beim Abspielen automatisch die Web-Audio-Synthese
   * und die UI zeigt ein "Sound folgt"-Badge (siehe updateExhaustTabs()/
   * renderBikesGrid()) statt einen falsch zugeordneten Sound zu behaupten.
   * @param {string} bikeId - Bike-ID (z. B. "versys650").
   * @param {string} exhaustType - "stock" | "racing" | "custom".
   * @returns {boolean} true, wenn eine echte Aufnahme hinterlegt ist.
   */
  function hasRealAudio(bikeId, exhaustType) {
    var files = AUDIO_FILES[bikeId];
    return !!(files && files[exhaustType]);
  }

  function playExhaust(bike, exhaustIdx) {
    stopCurrentPlayback();
    currentBike = bike;
    currentExhaustIdx = exhaustIdx;
    var exhaust = bike.exhausts[exhaustIdx];
    updatePlayerUI(bike, exhaustIdx);

    // Try real audio file first
    var audioFiles = AUDIO_FILES[bike.id];
    var audioUrl = audioFiles && audioFiles[exhaust.type];

    if (audioUrl) {
      playRealAudio(audioUrl, exhaust);
    } else {
      // Fallback: Web Audio synthesis
      fallbackToSynthesis(exhaust);
    }
  }

  function togglePlayPause() {
    if (isPlaying) {
      stopCurrentPlayback();
    } else if (currentBike) {
      playExhaust(currentBike, currentExhaustIdx);
    }
  }

  /* ============================================================
     PLAYBACK POSITION TRACKING
     ============================================================ */
  function getPlaybackProgress() {
    if (!isPlaying || !playbackStartTime) return 0;
    var elapsed = (Date.now() - playbackStartTime) / 1000;
    return Math.min(elapsed / playbackDuration, 1);
  }

  function formatTime(secs) {
    var m = Math.floor(secs / 60);
    var s = Math.floor(secs % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function updateTimeDisplay(progress) {
    var currentEl = document.getElementById('playerCurrentTime');
    var durationEl = document.getElementById('playerDuration');
    var timeline = document.getElementById('playerTimeline');
    if (!currentEl) return;
    var elapsed = progress * playbackDuration;
    currentEl.textContent = formatTime(elapsed);
    if (durationEl) durationEl.textContent = formatTime(playbackDuration);
    if (timeline) {
      timeline.value = progress * 100;
      // Update CSS gradient fill
      var pct = (progress * 100).toFixed(1) + '%';
      timeline.style.background = 'linear-gradient(90deg, #00FFE0 ' + pct + ', rgba(0,255,224,0.15) ' + pct + ')';
    }
  }

  /* ============================================================
     VISUALIZERS — SPECTRUM + WAVEFORM + EQUALIZER
     ============================================================ */
  var spectrumCanvas = null;
  var waveformCanvas = null;
  var specCtx = null;
  var waveCtx = null;
  var eqBarsEls = [];

  function initCanvases() {
    spectrumCanvas = document.getElementById('spectrumCanvas');
    waveformCanvas = document.getElementById('waveformCanvas');
    if (spectrumCanvas) specCtx = spectrumCanvas.getContext('2d');
    if (waveformCanvas) waveCtx = waveformCanvas.getContext('2d');

    // Create equalizer bars
    var eqBarsContainer = document.getElementById('eqBars');
    if (eqBarsContainer) {
      eqBarsContainer.innerHTML = '';
      eqBarsEls = [];
      for (var i = 0; i < 24; i++) {
        var bar = document.createElement('div');
        bar.className = 'eq-bar';
        bar.style.height = '4px';
        eqBarsContainer.appendChild(bar);
        eqBarsEls.push(bar);
      }
    }
  }

  function startVisualizers() {
    if (!analyser) return;

    var specDataArray = new Uint8Array(analyser.frequencyBinCount);
    var waveDataArray = new Uint8Array(analyser.fftSize);

    function draw() {
      animFrameId = requestAnimationFrame(draw);

      // ---- Spectrum Analyzer ----
      if (specCtx && spectrumCanvas) {
        analyser.getByteFrequencyData(specDataArray);
        var sw = spectrumCanvas.width;
        var sh = spectrumCanvas.height;
        specCtx.clearRect(0, 0, sw, sh);
        specCtx.fillStyle = '#0A0E27';
        specCtx.fillRect(0, 0, sw, sh);

        var barCount = 64;
        var barW = sw / barCount;
        var step = Math.floor(specDataArray.length / barCount);

        for (var i = 0; i < barCount; i++) {
          var val = specDataArray[i * step] / 255;
          var barH = val * sh;
          // Gradient: cyan bottom → magenta top
          var grad = specCtx.createLinearGradient(0, sh - barH, 0, sh);
          grad.addColorStop(0, '#FF006E');
          grad.addColorStop(0.5, '#00FFE0');
          grad.addColorStop(1, '#00FFE0');
          specCtx.fillStyle = grad;
          specCtx.fillRect(i * barW, sh - barH, barW - 1, barH);

          // Glow effect (brighter core)
          specCtx.fillStyle = 'rgba(0, 255, 224, ' + (val * 0.4) + ')';
          specCtx.fillRect(i * barW + 1, sh - barH + 1, barW - 3, barH > 4 ? barH - 2 : barH);
        }

        // Grid lines
        specCtx.strokeStyle = 'rgba(0, 255, 224, 0.08)';
        specCtx.lineWidth = 1;
        for (var g = 0; g < 4; g++) {
          var y = sh * g / 4;
          specCtx.beginPath();
          specCtx.moveTo(0, y);
          specCtx.lineTo(sw, y);
          specCtx.stroke();
        }
      }

      // ---- Waveform ----
      if (waveCtx && waveformCanvas) {
        analyser.getByteTimeDomainData(waveDataArray);
        var ww = waveformCanvas.width;
        var wh = waveformCanvas.height;
        waveCtx.clearRect(0, 0, ww, wh);
        waveCtx.fillStyle = '#0A0E27';
        waveCtx.fillRect(0, 0, ww, wh);

        // Draw waveform line
        waveCtx.lineWidth = 2;
        waveCtx.strokeStyle = '#FF006E';
        waveCtx.shadowBlur = 10;
        waveCtx.shadowColor = '#FF006E';
        waveCtx.beginPath();
        var sliceWidth = ww / waveDataArray.length;
        var x = 0;
        for (var j = 0; j < waveDataArray.length; j++) {
          var v = waveDataArray[j] / 128.0;
          var y2 = v * wh / 2;
          if (j === 0) {
            waveCtx.moveTo(x, y2);
          } else {
            waveCtx.lineTo(x, y2);
          }
          x += sliceWidth;
        }
        waveCtx.stroke();
        waveCtx.shadowBlur = 0;
      }

      // ---- Equalizer bars ----
      if (eqBarsEls.length > 0) {
        analyser.getByteFrequencyData(specDataArray);
        var step2 = Math.floor(specDataArray.length / eqBarsEls.length);
        eqBarsEls.forEach(function(bar, i) {
          var val2 = specDataArray[i * step2] / 255;
          bar.style.height = Math.max(3, val2 * 48) + 'px';
        });
      }

      // ---- Timeline update ----
      var progress = getPlaybackProgress();
      updateTimeDisplay(progress);
    }

    draw();
  }

  /* ============================================================
     DEMO VISUALIZER (intro section, animated idle)
     ============================================================ */
  function startDemoVisualizer() {
    var canvas = document.getElementById('demoVisualizer');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var t = 0;

    function demoFrame() {
      requestAnimationFrame(demoFrame);
      t += 0.04;
      var w = canvas.width;
      var h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#0A0E27';
      ctx.fillRect(0, 0, w, h);

      var bars = 40;
      var bw = w / bars;
      for (var i = 0; i < bars; i++) {
        // Animated sine wave pattern
        var amp = 0.5 + 0.5 * Math.sin(t + i * 0.4) * Math.sin(t * 0.7 + i * 0.2);
        var barH = amp * h * 0.85;
        var hue = (i / bars) * 180; // cyan to magenta
        var color = hue < 90
          ? 'rgba(0, 255, 224, ' + (0.5 + amp * 0.5) + ')'
          : 'rgba(255, 0, 110, ' + (0.5 + amp * 0.5) + ')';
        ctx.fillStyle = color;
        ctx.fillRect(i * bw, h - barH, bw - 1, barH);
      }
    }

    demoFrame();
  }

  /* ============================================================
     UI UPDATE FUNCTIONS
     ============================================================ */
  function updatePlayButton(playing) {
    var btn = document.getElementById('btnPlayPause');
    if (!btn) return;
    if (playing) {
      btn.textContent = '⏸';
      btn.classList.add('playing');
      btn.setAttribute('aria-label', 'Pause');
    } else {
      btn.textContent = '▶';
      btn.classList.remove('playing');
      btn.setAttribute('aria-label', 'Play');
    }
  }

  function updatePlayerUI(bike, exhaustIdx) {
    var exhaust = bike.exhausts[exhaustIdx];

    // Title
    var title = document.getElementById('playerModalTitle');
    if (title) title.textContent = bike.name.toUpperCase();

    var subtitle = document.getElementById('playerModalSubtitle');
    if (subtitle) subtitle.textContent = exhaust.type.toUpperCase() + ' — ' + exhaust.brand;

    // Metadata
    var metaExhaust = document.getElementById('metaExhaust');
    var metaDb = document.getElementById('metaDb');
    var metaPs = document.getElementById('metaPs');
    var metaChar = document.getElementById('metaChar');
    if (metaExhaust) metaExhaust.textContent = exhaust.brand;
    if (metaDb)      metaDb.textContent = exhaust.db + ' dB';
    if (metaPs)      metaPs.textContent = bike.ps + ' PS';
    if (metaChar)    metaChar.textContent = exhaust.character;

    // Tabs
    updateExhaustTabs(bike, exhaustIdx);

    // Favorite button state
    var favKey = bike.id + '_' + exhaust.type;
    var isFav = isFavorite(favKey);
    var favBtn = document.getElementById('btnFavorite');
    if (favBtn) {
      favBtn.textContent = isFav ? '♥ SAVED' : '♡ FAVORITE';
      favBtn.classList.toggle('active', isFav);
    }
  }

  function updateExhaustTabs(bike, activeIdx) {
    var container = document.getElementById('exhaustTabs');
    if (!container) return;
    container.innerHTML = '';

    bike.exhausts.forEach(function(ex, idx) {
      var tab = document.createElement('div');
      tab.className = 'sc-exhaust-tab tab-' + ex.type + (idx === activeIdx ? ' active' : '');
      tab.setAttribute('role', 'button');
      tab.setAttribute('tabindex', '0');
      var isSynth = !hasRealAudio(bike.id, ex.type);
      tab.setAttribute('aria-label', ex.label + ', ' + ex.db + ' dB' + (isSynth ? ', Sound folgt (synthetisiert)' : ''));
      tab.innerHTML =
        '<span class="tab-type-label">' + ex.type.toUpperCase() + '</span>' +
        '<span class="tab-brand">' + ex.brand + '</span>' +
        '<span class="tab-db">' + ex.db + ' dB</span>' +
        (isSynth ? '<span class="sc-badge-synth" title="Noch keine Original-Aufnahme — Motor-Sound wird live synthetisiert">🎛️ Sound folgt</span>' : '');

      tab.addEventListener('click', function() {
        currentExhaustIdx = idx;
        stopCurrentPlayback();
        playExhaust(bike, idx);
        updateExhaustTabs(bike, idx);
      });

      tab.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          tab.click();
        }
      });

      container.appendChild(tab);
    });
  }

  /* ============================================================
     MODAL MANAGEMENT
     ============================================================ */
  /**
   * TEIL 2: Markiert die statischen Player-Modal-Steuerelemente (Play/Pause,
   * Rewind, Forward) visuell als deaktiviert, solange
   * SOUND_PLAYBACK_ENABLED=false ist. Rein kosmetisch/defensiv — das Modal
   * öffnet sich ohnehin nie (siehe openPlayer()-Gate), diese Elemente sind
   * also praktisch nie sichtbar, sollen aber laut Spezifikation ebenfalls
   * als "Im Aufbau" erkennbar sein, falls sie doch einmal erreicht werden.
   * @returns {void}
   */
  function applySoundDisabledModalUI() {
    if (SOUND_PLAYBACK_ENABLED) return;
    var ids = ['btnPlayPause', 'btnRewind', 'btnForward'];
    ids.forEach(function(id) {
      var btn = document.getElementById(id);
      if (!btn) return;
      btn.setAttribute('aria-disabled', 'true');
      btn.classList.add('sc-play-btn-disabled');
    });
  }

  function openPlayer(bike, exhaustIdx) {
    // TEIL 2: zentraler Kill-Switch — solange SOUND_PLAYBACK_ENABLED=false
    // ist, öffnet sich der Player NIE und es wird NICHTS abgespielt. Alle
    // Play-Buttons (Karten, Favoriten, URL-Param-Autoplay) laufen über
    // diese Funktion, daher genügt der Gate hier zentral.
    if (!SOUND_PLAYBACK_ENABLED) {
      showComingSoonNotice();
      return;
    }

    currentBike = bike;
    currentExhaustIdx = exhaustIdx || 0;

    var modal = document.getElementById('scPlayerModal');
    var overlay = document.getElementById('scModalOverlay');
    if (!modal || !overlay) return;

    modal.hidden = false;
    overlay.hidden = false;
    document.body.style.overflow = 'hidden';

    initCanvases();
    updatePlayerUI(bike, currentExhaustIdx);
    playExhaust(bike, currentExhaustIdx);
  }

  function closePlayer() {
    stopCurrentPlayback();
    var modal = document.getElementById('scPlayerModal');
    var overlay = document.getElementById('scModalOverlay');
    if (modal) modal.hidden = true;
    if (overlay) overlay.hidden = true;
    document.body.style.overflow = '';

    // Clear canvases
    if (specCtx && spectrumCanvas) {
      specCtx.clearRect(0, 0, spectrumCanvas.width, spectrumCanvas.height);
    }
    if (waveCtx && waveformCanvas) {
      waveCtx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
    }
    if (eqBarsEls.length) {
      eqBarsEls.forEach(function(bar) { bar.style.height = '4px'; });
    }
  }

  /* ============================================================
     FAVORITES — localStorage
     ============================================================ */
  function getFavorites() {
    try {
      return JSON.parse(localStorage.getItem('soundcheckFavorites') || '[]');
    } catch(e) {
      return [];
    }
  }

  function saveFavorites(favs) {
    try {
      localStorage.setItem('soundcheckFavorites', JSON.stringify(favs));
    } catch(e) {}
  }

  function isFavorite(key) {
    return getFavorites().indexOf(key) !== -1;
  }

  function toggleFavorite(bike, exhaustIdx) {
    var exhaust = bike.exhausts[exhaustIdx];
    var key = bike.id + '_' + exhaust.type;
    var favs = getFavorites();
    var idx = favs.indexOf(key);

    if (idx === -1) {
      favs.push(key);
    } else {
      favs.splice(idx, 1);
    }
    saveFavorites(favs);
    renderFavoritesSection();

    // Update button
    var isFav = idx === -1; // was just added
    var favBtn = document.getElementById('btnFavorite');
    if (favBtn) {
      favBtn.textContent = isFav ? '♥ SAVED' : '♡ FAVORITE';
      favBtn.classList.toggle('active', isFav);
    }
  }

  function renderFavoritesSection() {
    var section = document.getElementById('scFavoritesSection');
    var grid = document.getElementById('scFavoritesGrid');
    if (!section || !grid) return;

    var favs = getFavorites();
    if (favs.length === 0) {
      section.hidden = true;
      return;
    }
    section.hidden = false;
    grid.innerHTML = '';

    favs.forEach(function(key) {
      var parts = key.split('_');
      var bikeId = parts[0];
      var exType = parts[1];
      var bike = BIKES.find(function(b) { return b.id === bikeId; });
      if (!bike) return;
      var exIdx = bike.exhausts.findIndex(function(e) { return e.type === exType; });
      if (exIdx === -1) return;
      var exhaust = bike.exhausts[exIdx];

      // TEIL 2: Play-Button auch in der Favoriten-Liste sichtbar deaktivieren
      // + "Im Aufbau"-Badge, solange SOUND_PLAYBACK_ENABLED=false ist.
      var favPlayAttrs = !SOUND_PLAYBACK_ENABLED
        ? ' aria-disabled="true" aria-label="Abspielen (bald verfügbar): ' + bike.name + ' ' + exhaust.type + '"'
        : ' aria-label="Abspielen: ' + bike.name + ' ' + exhaust.type + '"';
      var favPlayClass = 'sc-fav-play' + (!SOUND_PLAYBACK_ENABLED ? ' sc-play-btn-disabled' : '');
      var favWipBadge = !SOUND_PLAYBACK_ENABLED ? '<span class="sc-badge-wip" title="Sound-Vorschau wird gerade überarbeitet">🚧 Im Aufbau</span>' : '';

      var item = document.createElement('div');
      item.className = 'sc-fav-item sr-scale';
      item.setAttribute('role', 'article');
      item.innerHTML =
        '<button class="' + favPlayClass + '"' + favPlayAttrs + '>▶</button>' +
        '<div class="sc-fav-info">' +
          '<div class="sc-fav-bike">' + bike.icon + ' ' + bike.name + '</div>' +
          '<div class="sc-fav-type">' + exhaust.type.toUpperCase() + ' · ' + exhaust.brand + ' · ' + exhaust.db + ' dB' + favWipBadge + '</div>' +
        '</div>' +
        '<button class="sc-fav-remove" aria-label="Favorit entfernen">✕</button>';

      item.querySelector('.sc-fav-play').addEventListener('click', function() {
        openPlayer(bike, exIdx);
      });

      item.querySelector('.sc-fav-remove').addEventListener('click', function(e) {
        e.stopPropagation();
        var favArr = getFavorites();
        var fidx = favArr.indexOf(key);
        if (fidx !== -1) { favArr.splice(fidx, 1); }
        saveFavorites(favArr);
        renderFavoritesSection();
      });

      grid.appendChild(item);
    });

    // Re-trigger scroll reveal for new items
    setTimeout(function() {
      grid.querySelectorAll('.sr-scale').forEach(function(el) {
        el.classList.add('sr-visible');
      });
    }, 50);
  }

  /* ============================================================
     A/B COMPARE
     ============================================================ */
  function setCompareSlot(slot, bike, exhaustIdx) {
    var exhaust = bike.exhausts[exhaustIdx];
    var info = {
      bike: bike,
      exhaustIdx: exhaustIdx,
      label: bike.name + ' — ' + exhaust.type.toUpperCase() + ' (' + exhaust.db + 'dB)'
    };

    if (slot === 'A') {
      compareA = info;
      var el = document.getElementById('slotAInfo');
      if (el) el.textContent = info.label;
    } else {
      compareB = info;
      var el2 = document.getElementById('slotBInfo');
      if (el2) el2.textContent = info.label;
    }

    // Enable compare button if both slots filled
    var btn = document.getElementById('btnABPlay');
    if (btn) btn.disabled = !(compareA && compareB);

    // Animate mini EQ for filled slot
    renderMiniEq(slot === 'A' ? 'slotAEq' : 'slotBEq');
  }

  function renderMiniEq(containerId) {
    var container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    for (var i = 0; i < 8; i++) {
      var bar = document.createElement('div');
      bar.className = 'meq-bar';
      var h = 4 + Math.random() * 16;
      bar.style.height = h + 'px';
      bar.style.animationDelay = (i * 0.07) + 's';
      container.appendChild(bar);
    }
  }

  function toggleABCompare() {
    // TEIL 2: A/B Compare läuft nie über openPlayer() und braucht daher ein
    // eigenes Gate (Robustheit — die Slots werden ohnehin nie befüllt, da
    // "A SETZEN"/"B SETZEN" nur im Player-Modal sitzen, das nie öffnet).
    if (!SOUND_PLAYBACK_ENABLED) {
      showComingSoonNotice();
      return;
    }
    if (!compareA || !compareB) return;

    if (isABPlaying) {
      // Stop
      if (compareSourceA) {
        compareSourceA.nodes.forEach(function(n) { if (n.stop) { try { n.stop(0); } catch(e) {} } });
        compareSourceA = null;
      }
      if (compareSourceB) {
        compareSourceB.nodes.forEach(function(n) { if (n.stop) { try { n.stop(0); } catch(e) {} } });
        compareSourceB = null;
      }
      isABPlaying = false;
      var btn = document.getElementById('btnABPlay');
      if (btn) {
        btn.textContent = '▶ COMPARE STARTEN';
        btn.classList.remove('playing');
      }
    } else {
      // Play A then B
      ensureAudioCtx();
      stopCurrentPlayback();

      var exA = compareA.bike.exhausts[compareA.exhaustIdx];
      var exB = compareB.bike.exhausts[compareB.exhaustIdx];

      compareSourceA = synthesizeExhaust(exA, 4);
      // Play B after A finishes (4s later)
      setTimeout(function() {
        if (isABPlaying) {
          compareSourceB = synthesizeExhaust(exB, 4);
          setTimeout(function() { isABPlaying = false; var b = document.getElementById('btnABPlay'); if (b) { b.textContent = '▶ COMPARE STARTEN'; b.classList.remove('playing'); } }, 4200);
        }
      }, 4200);

      isABPlaying = true;
      var btn2 = document.getElementById('btnABPlay');
      if (btn2) {
        btn2.textContent = '⏹ STOP';
        btn2.classList.add('playing');
      }
    }
  }

  /* ============================================================
     BIKE CARD RENDERING
     ============================================================ */
  var activeFilter = 'all';

  function renderBikesGrid() {
    var grid = document.getElementById('scBikesGrid');
    if (!grid) return;
    grid.innerHTML = '';

    var filtered = BIKES.filter(function(bike) {
      return activeFilter === 'all' || bike.category === activeFilter;
    });

    filtered.forEach(function(bike, bIdx) {
      var card = document.createElement('div');
      card.className = 'sc-bike-card sr-left float-card';
      card.setAttribute('data-category', bike.category);
      card.style.transitionDelay = (bIdx * 0.08) + 's';

      var exhaustsHTML = bike.exhausts.map(function(ex, eIdx) {
        var dbPercent = ((ex.db - 80) / 40 * 100).toFixed(0);
        var isSynth = !hasRealAudio(bike.id, ex.type);
        // TEIL 2: Solange die Wiedergabe global deaktiviert ist ("Im
        // Aufbau"), ist das feinere "Sound folgt"-Badge (echte Aufnahme vs.
        // Synthese) irrelevant — stattdessen zeigt jede Zeile einheitlich
        // das "Im Aufbau"-Badge und der Play-Button wirkt sichtbar
        // deaktiviert (bleibt aber klickbar, um die Hinweismeldung zu zeigen).
        var badge = !SOUND_PLAYBACK_ENABLED
          ? '<span class="sc-badge-wip" title="Sound-Vorschau wird gerade überarbeitet">🚧 Im Aufbau</span>'
          : (isSynth ? '<span class="sc-badge-synth" title="Noch keine Original-Aufnahme — Motor-Sound wird live synthetisiert">🎛️ Sound folgt</span>' : '');
        var extraAriaLabel = !SOUND_PLAYBACK_ENABLED ? ', Sound-Vorschau im Aufbau, bald verfügbar' : (isSynth ? ', Sound folgt (synthetisiert)' : '');
        var playBtnAttrs = !SOUND_PLAYBACK_ENABLED ? ' aria-disabled="true" aria-label="Abspielen (bald verfügbar)"' : ' aria-label="Abspielen"';
        var playBtnClass = 'sc-play-btn' + (!SOUND_PLAYBACK_ENABLED ? ' sc-play-btn-disabled' : '');
        return '<div class="sc-exhaust-row" role="button" tabindex="0" aria-label="' + ex.label + ', ' + ex.db + ' dB' + extraAriaLabel + '" data-bike="' + bike.id + '" data-ex-idx="' + eIdx + '">' +
          '<div class="sc-exhaust-type"><span class="sc-exhaust-label label-' + ex.type + '">' + ex.type.toUpperCase() + '</span></div>' +
          '<span class="sc-exhaust-name">' + ex.brand + badge + '</span>' +
          '<div class="sc-db-bar"><div class="sc-db-bar-fill" style="width:' + dbPercent + '%"></div></div>' +
          '<span class="sc-exhaust-db">' + ex.db + 'dB</span>' +
          '<div class="sc-mini-wave">' + generateMiniWave(8) + '</div>' +
          '<button class="' + playBtnClass + '"' + playBtnAttrs + '>▶</button>' +
          '</div>';
      }).join('');

      card.innerHTML =
        '<div class="sc-bike-card-header">' +
          '<span class="sc-bike-icon" aria-hidden="true">' + bike.icon + '</span>' +
          '<div class="sc-bike-info">' +
            '<h3 class="sc-bike-name">' + bike.name + '</h3>' +
            '<div class="sc-bike-meta">' +
              '<span class="sc-chip">' + bike.ps + ' PS</span>' +
              '<span class="sc-chip chip-category">' + bike.category.toUpperCase() + '</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="sc-exhaust-list">' + exhaustsHTML + '</div>';

      // Bind events on exhaust rows
      card.querySelectorAll('.sc-exhaust-row').forEach(function(row) {
        var bikeId = row.getAttribute('data-bike');
        var exIdx = parseInt(row.getAttribute('data-ex-idx'), 10);
        var rowBike = BIKES.find(function(b) { return b.id === bikeId; });

        function handlePlay(e) {
          e.stopPropagation();
          openPlayer(rowBike, exIdx);
        }

        row.querySelector('.sc-play-btn').addEventListener('click', handlePlay);
        row.addEventListener('click', handlePlay);
        row.addEventListener('keydown', function(e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handlePlay(e); }
        });
      });

      grid.appendChild(card);
    });

    // Trigger scroll reveal after render
    setTimeout(function() {
      grid.querySelectorAll('.sr-left').forEach(function(el, i) {
        setTimeout(function() { el.classList.add('sr-visible'); }, i * 80);
      });
    }, 100);
  }

  function generateMiniWave(count) {
    var html = '';
    for (var i = 0; i < count; i++) {
      var h = 2 + Math.random() * 14;
      html += '<div class="sc-mini-wave-bar" style="height:' + h + 'px;animation-delay:' + (i * 0.05) + 's"></div>';
    }
    return html;
  }

  /* ============================================================
     FILTERS
     ============================================================ */
  function initFilters() {
    document.querySelectorAll('.sc-filter-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        document.querySelectorAll('.sc-filter-btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        activeFilter = btn.getAttribute('data-filter');
        renderBikesGrid();
      });
    });
  }

  /* ============================================================
     VOLUME CONTROL
     ============================================================ */
  /**
   * Apply a master volume (0..100) to the gain node, any playing audio element,
   * and keep both volume sliders in sync.
   */
  function applyVolume(vol) {
    vol = Math.max(0, Math.min(100, isNaN(vol) ? 80 : vol));
    masterVolume = vol / 100;
    if (gainNode) gainNode.gain.value = masterVolume;
    if (currentAudioEl) currentAudioEl.volume = masterVolume;

    var masterSlider = document.getElementById('volumeSlider');
    if (masterSlider && String(masterSlider.value) !== String(vol)) masterSlider.value = vol;
    var playerSlider = document.getElementById('playerVolume');
    if (playerSlider) playerSlider.value = masterVolume;
    return vol;
  }

  function initVolumeControl() {
    var volumeSlider = document.getElementById('playerVolume');
    if (!volumeSlider) return;

    volumeSlider.addEventListener('input', function() {
      var vol = Math.round(parseFloat(volumeSlider.value) * 100);
      applyVolume(vol);
      try { localStorage.setItem('soundcheckVolume', vol); } catch(e) {}
    });
  }

  /**
   * Persistent master volume slider (id="volumeSlider", 0..100).
   * Restores the saved value on load and stores changes in localStorage.
   */
  function initPersistentVolume() {
    var stored = null;
    try { stored = localStorage.getItem('soundcheckVolume'); } catch(e) {}
    var vol = stored !== null ? parseInt(stored, 10) : 80;
    if (isNaN(vol)) vol = 80;
    applyVolume(vol);

    var slider = document.getElementById('volumeSlider');
    if (slider) {
      slider.value = vol;
      slider.addEventListener('input', function() {
        var v = applyVolume(parseInt(slider.value, 10));
        try { localStorage.setItem('soundcheckVolume', v); } catch(e) {}
      });
    }
  }

  /* ============================================================
     TIMELINE SCRUBBING (visual only — synthesized audio restarts)
     ============================================================ */
  function initTimeline() {
    var timeline = document.getElementById('playerTimeline');
    if (!timeline) return;

    timeline.addEventListener('input', function() {
      // For synthesized audio, we restart from beginning (scrubbing not supported)
      // Just update visual display
      var val = parseFloat(timeline.value) / 100;
      updateTimeDisplay(val);
    });
  }

  /* ============================================================
     REWIND / FORWARD
     ============================================================ */
  function initRewindForward() {
    var btnRewind = document.getElementById('btnRewind');
    var btnForward = document.getElementById('btnForward');

    if (btnRewind) {
      btnRewind.addEventListener('click', function() {
        // Restart audio from beginning
        if (currentBike) {
          stopCurrentPlayback();
          setTimeout(function() { playExhaust(currentBike, currentExhaustIdx); }, 50);
        }
      });
    }

    if (btnForward) {
      btnForward.addEventListener('click', function() {
        // Skip to next exhaust variant
        if (currentBike) {
          var nextIdx = (currentExhaustIdx + 1) % currentBike.exhausts.length;
          stopCurrentPlayback();
          playExhaust(currentBike, nextIdx);
        }
      });
    }
  }

  /* ============================================================
     SCROLL REVEAL on page elements
     ============================================================ */
  function initPageScrollReveal() {
    var observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('sr-visible');
        }
      });
    }, { threshold: 0.1 });

    document.querySelectorAll('.sr-fade, .sr-left, .sr-right, .sr-scale, .sr-up').forEach(function(el) {
      observer.observe(el);
    });
  }

  /* ============================================================
     MAIN INIT
     ============================================================ */
  function init() {
    renderBikesGrid();
    initFilters();
    initPageScrollReveal();
    startDemoVisualizer();
    renderFavoritesSection();

    // Close button
    var closeBtn = document.getElementById('scPlayerClose');
    if (closeBtn) closeBtn.addEventListener('click', closePlayer);

    // Overlay click to close
    var overlay = document.getElementById('scModalOverlay');
    if (overlay) overlay.addEventListener('click', closePlayer);

    // ESC to close
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') closePlayer();
    });

    // Play/Pause
    var playBtn = document.getElementById('btnPlayPause');
    if (playBtn) playBtn.addEventListener('click', togglePlayPause);

    // Favorite button
    var favBtn = document.getElementById('btnFavorite');
    if (favBtn) {
      favBtn.addEventListener('click', function() {
        if (currentBike) toggleFavorite(currentBike, currentExhaustIdx);
      });
    }

    // A/B compare set buttons
    var btnSetA = document.getElementById('btnSetA');
    var btnSetB = document.getElementById('btnSetB');
    if (btnSetA) {
      btnSetA.addEventListener('click', function() {
        if (currentBike) setCompareSlot('A', currentBike, currentExhaustIdx);
      });
    }
    if (btnSetB) {
      btnSetB.addEventListener('click', function() {
        if (currentBike) setCompareSlot('B', currentBike, currentExhaustIdx);
      });
    }

    // A/B Play
    var btnABPlay = document.getElementById('btnABPlay');
    if (btnABPlay) btnABPlay.addEventListener('click', toggleABCompare);

    // A/B Clear
    var btnABClear = document.getElementById('btnABClear');
    if (btnABClear) {
      btnABClear.addEventListener('click', function() {
        compareA = null;
        compareB = null;
        var slotAInfo = document.getElementById('slotAInfo');
        var slotBInfo = document.getElementById('slotBInfo');
        if (slotAInfo) slotAInfo.textContent = '— Leer —';
        if (slotBInfo) slotBInfo.textContent = '— Leer —';
        document.getElementById('slotAEq').innerHTML = '';
        document.getElementById('slotBEq').innerHTML = '';
        var abBtn = document.getElementById('btnABPlay');
        if (abBtn) abBtn.disabled = true;
        if (isABPlaying) toggleABCompare();
      });
    }

    // Clear all favorites
    var clearFavBtn = document.getElementById('btnClearFavorites');
    if (clearFavBtn) {
      clearFavBtn.addEventListener('click', function() {
        saveFavorites([]);
        renderFavoritesSection();
      });
    }

    initVolumeControl();
    initPersistentVolume();
    initTimeline();
    initRewindForward();
    applySoundDisabledModalUI();

    // Handle URL param ?bike=xxx to auto-open
    var params = new URLSearchParams(window.location.search);
    var bikeParam = params.get('bike');
    if (bikeParam) {
      var matchBike = BIKES.find(function(b) {
        return b.name.toLowerCase().indexOf(bikeParam.toLowerCase()) !== -1;
      });
      if (matchBike) {
        setTimeout(function() { openPlayer(matchBike, 0); }, 500);
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
