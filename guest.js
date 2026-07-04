import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getDatabase, ref, set, update, onValue, onDisconnect, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import { firebaseConfig, SESSION_ID } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const readyBtn = document.getElementById("readyBtn");
const resetBtn = document.getElementById("resetBtn");
const statusEl = document.getElementById("status");
const countdownEl = document.getElementById("countdown");
const debugEl = document.getElementById("debug");
const livePanel = document.getElementById("livePanel");
const youtubeLinkBig = document.getElementById("youtubeLinkBig");
const playEmbeddedBtn = document.getElementById("playEmbeddedBtn");
const jumpLiveBtn = document.getElementById("jumpLiveBtn");

const clientId = crypto.randomUUID();
const clientRef = ref(db, `sessions/${SESSION_ID}/clients/${clientId}`);
const startRef = ref(db, `sessions/${SESSION_ID}/startAt`);
const resetRef = ref(db, `sessions/${SESSION_ID}/resetCounter`);
const youtubeUrlRef = ref(db, `sessions/${SESSION_ID}/youtubeLiveUrl`);
const offsetRef = ref(db, ".info/serverTimeOffset");

let serverOffsetMs = 0;
let isReady = false;
let startAt = null;
let timer = null;
let lastResetCounter = null;
let youtubeLiveUrl = "";
let youtubeVideoId = "";
let player = null;
let youtubeApiReady = false;
let playerReady = false;
let hasTriedStart = false;
let liveEdgeTimer = null;
let mediaUnlocked = false;
let lastPlayerState = null;

function serverNow() { return Date.now() + serverOffsetMs; }

function debug(extra = {}) {
  debugEl.textContent = JSON.stringify({
    clientId,
    serverOffsetMs: Math.round(serverOffsetMs),
    ready: isReady,
    startAt,
    youtubeLiveUrl,
    youtubeVideoId,
    youtubeApiReady,
    playerReady,
    playerExists: Boolean(player),
    hasTriedStart,
    mediaUnlocked,
    lastPlayerState,
    ...extra
  }, null, 2);
}

function updateReadyButtonState() {
  if (isReady) return;

  if (!youtubeLiveUrl || !youtubeVideoId) {
    readyBtn.disabled = true;
    readyBtn.textContent = "Väntar på YouTube-länk...";
    statusEl.textContent = "Ansluten. Väntar på att YouTube-länken ska laddas.";
    return;
  }

  if (!youtubeApiReady || !playerReady) {
    readyBtn.disabled = true;
    readyBtn.textContent = "Laddar spelare...";
    statusEl.textContent = "Ansluten. Laddar YouTube-spelaren...";
    return;
  }

  readyBtn.disabled = false;
  readyBtn.textContent = "🔊 Jag är redo";
  statusEl.textContent = "Ansluten. Tryck 'Jag är redo'.";
}

function getYouTubeId(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) return u.pathname.replace("/", "");
    if (u.pathname.startsWith("/live/")) return u.pathname.split("/")[2] || "";
    if (u.pathname.startsWith("/embed/")) return u.pathname.split("/")[2] || "";
    return u.searchParams.get("v") || "";
  } catch {
    return "";
  }
}

function setYoutubeUrl(url) {
  youtubeLiveUrl = url || "";
  youtubeVideoId = getYouTubeId(youtubeLiveUrl);
  youtubeLinkBig.href = youtubeLiveUrl || "#";
  playerReady = false;
  if (youtubeApiReady && youtubeVideoId) createOrLoadPlayer();
  updateReadyButtonState();
  debug({ youtubeUrlUpdated: true });
}

function markYouTubeApiReady() {
  if (youtubeApiReady) return;
  youtubeApiReady = true;
  if (youtubeVideoId) createOrLoadPlayer();
  updateReadyButtonState();
  debug({ youtubeApiReady: true });
}

window.onYouTubeIframeAPIReady = markYouTubeApiReady;

const youtubeApiCheck = setInterval(() => {
  if (window.YT && window.YT.Player) {
    clearInterval(youtubeApiCheck);
    markYouTubeApiReady();
  }
}, 100);

async function playReadySound() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return false;

  try {
    const ctx = new AudioContext();
    if (ctx.state === "suspended") await ctx.resume();

    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, ctx.currentTime);

    oscillator.connect(gain);
    gain.connect(ctx.destination);

    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.45, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.65);

    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.7);

    setTimeout(() => ctx.close(), 1000);
    return true;
  } catch (err) {
    debug({ readySoundError: String(err) });
    return false;
  }
}

function primeYouTubePlayer() {
  if (!youtubeVideoId) return;
  if (!player && youtubeApiReady) createOrLoadPlayer();

  if (!player || typeof player.playVideo !== "function") {
    debug({ primePlayer: false, reason: "player not ready" });
    return;
  }

  try {
    player.mute?.();
    player.playVideo();

    setTimeout(() => {
      try {
        player.pauseVideo?.();
        player.unMute?.();
        debug({ primePlayer: true });
      } catch (err) {
        debug({ primePlayerPauseError: String(err) });
      }
    }, 450);
  } catch (err) {
    debug({ primePlayerError: String(err) });
  }
}

function createOrLoadPlayer() {
  if (!youtubeVideoId || !window.YT || !window.YT.Player) return;

  if (player && typeof player.loadVideoById === "function") {
    playerReady = false;
    player.loadVideoById(youtubeVideoId);
    return;
  }

  player = new YT.Player("player", {
    width: "100%",
    height: "390",
    videoId: youtubeVideoId,
    playerVars: {
      autoplay: 0,
      controls: 1,
      playsinline: 1,
      modestbranding: 1,
      rel: 0
    },
    events: {
      onReady: () => {
        playerReady = true;
        updateReadyButtonState();
        debug({ playerEvent: "ready" });
      },
      onStateChange: (event) => {
        lastPlayerState = event.data;
        debug({ playerState: event.data });
      },
      onError: (event) => {
        statusEl.textContent = "YouTube-spelaren gav ett fel. Använd 'Öppna i YouTube'.";
        debug({ playerError: event.data });
      }
    }
  });
}

function stopPlayer() {
  stopLiveEdgeMonitor();

  if (player) {
    try { player.stopVideo?.(); } catch {}
    try { player.pauseVideo?.(); } catch {}
  }

  hasTriedStart = false;
}

onValue(offsetRef, (snap) => {
  serverOffsetMs = snap.val() || 0;
  updateReadyButtonState();
  debug();
});

onValue(youtubeUrlRef, (snap) => setYoutubeUrl(snap.val() || ""));

await set(clientRef, {
  connected: true,
  ready: false,
  joinedAt: serverTimestamp(),
  userAgent: navigator.userAgent
});

onDisconnect(clientRef).remove();

readyBtn.addEventListener("click", async () => {
  readyBtn.disabled = true;
  statusEl.textContent = "Förbereder spelaren...";

  // Kör detta direkt från klicket, före await, för maximal chans att webbläsaren accepterar media.
  primeYouTubePlayer();

  const soundOk = await playReadySound();
  mediaUnlocked = soundOk;

  isReady = true;
  await update(clientRef, {
    ready: true,
    readyAt: serverTimestamp(),
    mediaUnlocked: soundOk
  });

  statusEl.textContent = "Du är redo. Vänta här tills filmen börjar.";

  debug({ readyClicked: true, soundOk });
  if (startAt) runCountdown();
});

resetBtn.addEventListener("click", async () => {
  isReady = false;
  mediaUnlocked = false;
  readyBtn.disabled = false;
  stopPlayer();
  livePanel.classList.add("hidden");
  countdownEl.textContent = "";
  statusEl.textContent = "Redo ångrat. Tryck igen när du är redo.";
  await update(clientRef, { ready: false });
  updateReadyButtonState();
  debug({ localReset: true });
});

youtubeLinkBig.addEventListener("click", (event) => {
  if (!youtubeLiveUrl) {
    event.preventDefault();
    statusEl.textContent = "YouTube-länk saknas ännu.";
  }
});

playEmbeddedBtn.addEventListener("click", () => playEmbedded(false));
jumpLiveBtn.addEventListener("click", () => jumpToLiveEdge());

onValue(startRef, (snap) => {
  startAt = snap.val();

  if (!startAt) {
    clearTimeout(timer);
    countdownEl.textContent = "";
    livePanel.classList.add("hidden");
    stopPlayer();
    if (isReady) statusEl.textContent = "Redo. Väntar på start.";
    debug({ startCleared: true });
    return;
  }

  if (isReady) runCountdown();
  else statusEl.textContent = "Filmen börjar snart. Tryck 'Jag är redo'.";
  debug();
});

onValue(resetRef, async (snap) => {
  const value = snap.val();
  if (lastResetCounter === null) {
    lastResetCounter = value;
    return;
  }

  if (value !== lastResetCounter) {
    lastResetCounter = value;
    isReady = false;
    mediaUnlocked = false;
    readyBtn.disabled = false;
    clearTimeout(timer);
    countdownEl.textContent = "";
    livePanel.classList.add("hidden");
    stopPlayer();
    statusEl.textContent = "Sessionen nollställd. Tryck 'Jag är redo'.";
    await update(clientRef, { ready: false });
    updateReadyButtonState();
    debug({ reset: true });
  }
});

function runCountdown() {
  clearTimeout(timer);

  const tick = () => {
    const remainingMs = startAt - serverNow();

    if (remainingMs > 0) {
      countdownEl.textContent = `Spelaren öppnas om ${Math.ceil(remainingMs / 1000)} s`;
      timer = setTimeout(tick, 100);
      return;
    }

    countdownEl.textContent = "";
    livePanel.classList.remove("hidden");

    if (!youtubeLiveUrl || !youtubeVideoId) {
      statusEl.textContent = "Filmen börjar, men YouTube-länken saknas.";
      return;
    }

    statusEl.textContent = "Startar spelaren. Tryck ▶ Starta filmen om den inte går igång direkt.";
    debug({ live: true });

    if (!hasTriedStart) {
      hasTriedStart = true;

      // Försök automatiskt, men gör inte systemet beroende av autoplay.
      setTimeout(() => playEmbedded(true), 100);
      setTimeout(() => playEmbedded(true), 2500);
      setTimeout(() => playEmbedded(true), 6000);

      // Snäll catch-up långt efter start. Den ska inte störa YouTubes buffert i början.
      setTimeout(startLiveEdgeMonitor, 25000);
    }
  };

  tick();
}

function playEmbedded(isAutoAttempt = false) {
  if (!player || typeof player.playVideo !== "function") {
    statusEl.textContent = "Spelaren är inte redo ännu. Tryck igen eller använd 'Öppna i YouTube'.";
    debug({ playError: "player not ready", isAutoAttempt });
    return;
  }

  try {
    player.unMute?.();
    player.playVideo();

    statusEl.textContent = isAutoAttempt
      ? "Försöker starta automatiskt. Om inget händer: tryck ▶ Starta filmen."
      : "Spelar YouTube Live.";

    debug({ playCalled: true, isAutoAttempt });
  } catch (err) {
    statusEl.textContent = "Kunde inte starta automatiskt. Tryck ▶ Starta filmen.";
    debug({ playError: String(err), isAutoAttempt });
  }
}

function jumpToLiveEdge() {
  if (!player) return;

  try {
    const duration = player.getDuration?.();
    const current = player.getCurrentTime?.();

    if (Number.isFinite(duration) && duration > 0) {
      player.seekTo(Math.max(0, duration - 1.0), true);
      statusEl.textContent = "Hoppade närmare live. Om det hackar, låt spelaren buffra några sekunder.";
      debug({ jumpToLive: true, duration, current });
    } else {
      debug({ jumpToLive: false, reason: "no duration" });
    }
  } catch (err) {
    debug({ jumpToLiveError: String(err) });
  }
}

function startLiveEdgeMonitor() {
  stopLiveEdgeMonitor();
  liveEdgeTimer = setInterval(() => {
    if (!player) return;

    try {
      const duration = player.getDuration?.();
      const current = player.getCurrentTime?.();

      if (Number.isFinite(duration) && Number.isFinite(current) && duration > 0) {
        const behind = duration - current;

        // Väldigt försiktig korrigering: bara om tittaren ligger långt efter.
        if (behind > 18) {
          player.seekTo(Math.max(0, duration - 2.0), true);
          debug({ autoCatchup: true, behind });
        }
      }
    } catch (err) {
      debug({ liveEdgeMonitorError: String(err) });
    }
  }, 30000);
}

function stopLiveEdgeMonitor() {
  if (liveEdgeTimer) {
    clearInterval(liveEdgeTimer);
    liveEdgeTimer = null;
  }
}
