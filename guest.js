import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getDatabase, ref, set, update, onValue, onDisconnect, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import { firebaseConfig, SESSION_ID } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const video = document.getElementById("video");
video.controls = false;
video.disablePictureInPicture = true;
video.addEventListener("contextmenu", (e) => e.preventDefault());
video.addEventListener("click", (e) => e.preventDefault());
video.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });

const readyBtn = document.getElementById("readyBtn");
const soundTestPanel = document.getElementById("soundTestPanel");
const playSoundTestBtn = document.getElementById("playSoundTestBtn");
const soundYesBtn = document.getElementById("soundYesBtn");
const soundNoBtn = document.getElementById("soundNoBtn");
const manualStartBtn = document.getElementById("manualStartBtn");
const resetBtn = document.getElementById("resetBtn");
const statusEl = document.getElementById("status");
const countdownEl = document.getElementById("countdown");
const debugEl = document.getElementById("debug");

const clientId = crypto.randomUUID();
const clientRef = ref(db, `sessions/${SESSION_ID}/clients/${clientId}`);
const startRef = ref(db, `sessions/${SESSION_ID}/startAt`);
const stopRef = ref(db, `sessions/${SESSION_ID}/stopCounter`);
const resetFilmRef = ref(db, `sessions/${SESSION_ID}/resetFilmCounter`);
const resetRef = ref(db, `sessions/${SESSION_ID}/resetCounter`);
const offsetRef = ref(db, ".info/serverTimeOffset");

let serverOffsetMs = 0;
let isReady = false;
let videoPrepared = false;
let soundVerified = false;
let startAt = null;
let timer = null;
let lastStopCounter = null;
let lastResetFilmCounter = null;
let lastResetCounter = null;
let audioCtx = null;

function serverNow() {
  return Date.now() + serverOffsetMs;
}

function debug(extra = {}) {
  debugEl.textContent = JSON.stringify({
    clientId,
    localTime: new Date(Date.now()).toISOString(),
    estimatedServerTime: new Date(serverNow()).toISOString(),
    serverOffsetMs: Math.round(serverOffsetMs),
    startAt,
    ready: isReady,
    videoPrepared,
    soundVerified,
    paused: video.paused,
    currentTime: Number(video.currentTime.toFixed(3)),
    ...extra
  }, null, 2);
}

onValue(offsetRef, (snap) => {
  serverOffsetMs = snap.val() || 0;
  if (!isReady) statusEl.textContent = "Synkad. Tryck 'Jag är redo'.";
  debug();
});

await set(clientRef, {
  connected: true,
  ready: false,
  videoPrepared: false,
  soundVerified: false,
  joinedAt: serverTimestamp(),
  userAgent: navigator.userAgent
});

onDisconnect(clientRef).remove();

readyBtn.addEventListener("click", async () => {
  statusEl.textContent = "Förbereder...";

  try {
    // Viktigt: spela INTE huvudfilmen här.
    video.pause();
    video.muted = false;
    video.currentTime = 0;
    video.load();

    videoPrepared = true;
    isReady = true;
    readyBtn.disabled = true;
    soundTestPanel.classList.remove("hidden");

    await update(clientRef, {
      ready: true,
      videoPrepared: true,
      soundVerified: false,
      readyAt: serverTimestamp()
    });

    statusEl.textContent = "Redo. Gör ljudtestet.";
    debug();

    if (startAt) runCountdown();
  } catch (err) {
    statusEl.textContent = "Kunde inte förbereda video. Ladda om sidan och testa igen.";
    console.error(err);
    debug({ error: String(err) });
  }
});

playSoundTestBtn.addEventListener("click", async () => {
  statusEl.textContent = "Spelar ljudtest...";

  try {
    await playBeep();
    soundYesBtn.classList.remove("hidden");
    soundNoBtn.classList.remove("hidden");
    statusEl.textContent = "Hörde du tonen?";
    debug({ soundTestPlayed: true });
  } catch (err) {
    soundYesBtn.classList.remove("hidden");
    soundNoBtn.classList.remove("hidden");
    statusEl.textContent = "Ljudtestet kunde inte verifieras automatiskt. Hörde du något?";
    console.error(err);
    debug({ soundTestError: String(err) });
  }
});

soundYesBtn.addEventListener("click", async () => {
  soundVerified = true;

  await update(clientRef, {
    soundVerified: true,
    soundVerifiedAt: serverTimestamp()
  });

  soundTestPanel.classList.add("hidden");
  statusEl.textContent = "Redo. Ljud verifierat. Väntar på start.";
  debug();
});

soundNoBtn.addEventListener("click", async () => {
  soundVerified = false;

  await update(clientRef, {
    soundVerified: false,
    soundProblemAt: serverTimestamp()
  });

  statusEl.textContent = "Redo, men ljudet är inte verifierat på denna enhet.";
  debug();
});

manualStartBtn.addEventListener("click", async () => {
  await startPlayback("manual");
});

resetBtn.addEventListener("click", async () => {
  resetLocal("Återställd lokalt. Tryck 'Jag är redo'.");
  await update(clientRef, { ready: false, videoPrepared: false, soundVerified: false });
});

onValue(startRef, (snap) => {
  startAt = snap.val();

  if (!startAt) {
    clearTimeout(timer);
    countdownEl.textContent = "";
    manualStartBtn.classList.add("hidden");
    if (isReady) statusEl.textContent = soundVerified ? "Redo. Ljud verifierat. Väntar på start." : "Redo. Väntar på start.";
    debug();
    return;
  }

  if (isReady) {
    runCountdown();
  } else {
    statusEl.textContent = "Start är schemalagd. Tryck 'Jag är redo' snabbt.";
  }

  debug();
});


onValue(stopRef, (snap) => {
  const value = snap.val();
  if (lastStopCounter === null) {
    lastStopCounter = value;
    return;
  }

  if (value !== lastStopCounter) {
    lastStopCounter = value;
    stopPlayback("Admin stoppade filmen.");
  }
});

function stopPlayback(message) {
  clearTimeout(timer);
  video.pause();
  video.currentTime = 0;
  manualStartBtn.classList.add("hidden");
  countdownEl.textContent = "";
  statusEl.textContent = message || "Filmen stoppad.";
  debug({ stopped: true });
}


onValue(resetFilmRef, (snap) => {
  const value = snap.val();
  if (lastResetFilmCounter === null) {
    lastResetFilmCounter = value;
    return;
  }

  if (value !== lastResetFilmCounter) {
    lastResetFilmCounter = value;
    resetFilmToBeginning("Filmen återställd till början. Väntar på ny start.");
  }
});

function resetFilmToBeginning(message) {
  clearTimeout(timer);
  video.pause();
  video.currentTime = 0;
  video.muted = false;
  manualStartBtn.classList.add("hidden");
  countdownEl.textContent = "";
  statusEl.textContent = message || "Filmen återställd.";
  debug({ filmReset: true });
}

onValue(resetRef, async (snap) => {
  const value = snap.val();
  if (lastResetCounter === null) {
    lastResetCounter = value;
    return;
  }

  if (value !== lastResetCounter) {
    lastResetCounter = value;
    resetLocal("Admin nollställde. Tryck 'Jag är redo'.");
    await update(clientRef, { ready: false, videoPrepared: false, soundVerified: false });
  }
});

async function playBeep() {
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") {
    await audioCtx.resume();
  }

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = "sine";
  osc.frequency.value = 880;

  gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.35, audioCtx.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.22);

  osc.connect(gain);
  gain.connect(audioCtx.destination);

  osc.start();
  osc.stop(audioCtx.currentTime + 0.25);

  await new Promise(resolve => setTimeout(resolve, 300));
}

function resetLocal(message) {
  clearTimeout(timer);
  video.pause();
  video.currentTime = 0;
  video.muted = false;
  isReady = false;
  videoPrepared = false;
  soundVerified = false;
  readyBtn.disabled = false;
  soundTestPanel.classList.add("hidden");
  soundYesBtn.classList.add("hidden");
  soundNoBtn.classList.add("hidden");
  manualStartBtn.classList.add("hidden");
  countdownEl.textContent = "";
  statusEl.textContent = message;
  debug();
}

function runCountdown() {
  clearTimeout(timer);
  manualStartBtn.classList.add("hidden");

  const tick = async () => {
    const remainingMs = startAt - serverNow();

    if (remainingMs > 1000) {
      countdownEl.textContent = `Startar om ${Math.ceil(remainingMs / 1000)} s`;
      timer = setTimeout(tick, 100);
      return;
    }

    if (remainingMs > 80) {
      countdownEl.textContent = "Startar strax";
      timer = setTimeout(tick, 10);
      return;
    }

    if (remainingMs > 0) {
      requestAnimationFrame(tick);
      return;
    }

    await startPlayback("auto");
  };

  tick();
}

async function startPlayback(mode) {
  clearTimeout(timer);
  countdownEl.textContent = "Startar nu";
  statusEl.textContent = "Spelar film.";

  try {
    video.muted = false;
    const missedSeconds = startAt ? Math.max(0, (serverNow() - startAt) / 1000) : 0;
    video.currentTime = missedSeconds;
    await video.play();

    manualStartBtn.classList.add("hidden");
    statusEl.textContent = "Spelar film.";
    debug({ mode, missedSeconds });
  } catch (err) {
    console.error(err);

    manualStartBtn.classList.remove("hidden");
    statusEl.textContent = "Webbläsaren blockerade autostart. Tryck på knappen för att starta filmen.";
    debug({ mode, error: String(err) });
  }
}
