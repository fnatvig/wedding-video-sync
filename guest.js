import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getDatabase, ref, set, update, onValue, onDisconnect, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import { firebaseConfig, SESSION_ID } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const readyBtn = document.getElementById("readyBtn");
const resetBtn = document.getElementById("resetBtn");
const readyPanel = document.getElementById("readyPanel");
const statusEl = document.getElementById("status");
const countdownEl = document.getElementById("countdown");
const countdownOverlay = document.getElementById("countdownOverlay");
const debugEl = document.getElementById("debug");
const livePanel = document.getElementById("livePanel");
const rescueControls = document.getElementById("rescueControls");
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
let rescueTimer = null;
let liveEdgeTimer = null;
let movieStartedAt = 0;
let lastResetCounter = null;
let youtubeLiveUrl = "";
let youtubeVideoId = "";
let player = null;
let youtubeApiReady = false;
let hasStartedForThisCommand = false;
let mediaUnlocked = false;

function serverNow() {
  return Date.now() + serverOffsetMs;
}

function debug(extra = {}) {
  debugEl.textContent = JSON.stringify({
    clientId,
    serverOffsetMs: Math.round(serverOffsetMs),
    ready: isReady,
    startAt,
    youtubeLiveUrl,
    youtubeVideoId,
    youtubeApiReady,
    playerReady: Boolean(player),
    hasStartedForThisCommand,
    mediaUnlocked,
    movieStartedAt,
    liveEdgeMonitorActive: Boolean(liveEdgeTimer),
    ...extra
  }, null, 2);
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

  if (youtubeApiReady && youtubeVideoId) {
    createOrLoadPlayer();
  }

  debug({ youtubeUrlUpdated: true });
}

function markYouTubeApiReady() {
  if (youtubeApiReady) return;

  youtubeApiReady = true;

  if (youtubeVideoId) {
    createOrLoadPlayer();
  }

  debug({ youtubeApiReady: true });
}

window.onYouTubeIframeAPIReady = markYouTubeApiReady;

const youtubeApiCheck = setInterval(() => {
  if (window.YT && window.YT.Player) {
    clearInterval(youtubeApiCheck);
    markYouTubeApiReady();
  }
}, 100);

function createOrLoadPlayer() {
  if (!youtubeVideoId || !window.YT || !window.YT.Player) return;

  if (player && typeof player.loadVideoById === "function") {
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
      onReady: () => debug({ playerEvent: "ready" }),
      onStateChange: (event) => debug({ playerState: event.data }),
      onError: (event) => {
        statusEl.textContent = "YouTube-spelaren gav ett fel. Använd 'Öppna i YouTube'.";
        rescueControls.classList.remove("hidden");
        debug({ playerError: event.data });
      }
    }
  });
}

async function playReadySound() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return false;

  try {
    const ctx = new AudioContext();

    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, ctx.currentTime);
    oscillator.connect(gain);
    gain.connect(ctx.destination);

    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);

    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.5);

    setTimeout(() => ctx.close(), 800);

    return true;
  } catch (err) {
    debug({ readySoundError: String(err) });
    return false;
  }
}

function primeYouTubePlayer() {
  if (!youtubeVideoId) return;

  if (!player && youtubeApiReady) {
    createOrLoadPlayer();
  }

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

onValue(offsetRef, (snap) => {
  serverOffsetMs = snap.val() || 0;

  if (!isReady) {
    statusEl.textContent = "Ansluten. Tryck 'Jag är redo'.";
  }

  debug();
});

onValue(youtubeUrlRef, (snap) => {
  setYoutubeUrl(snap.val() || "");
});

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

  // Ska köras direkt i klicket, före await.
  primeYouTubePlayer();

  const soundOk = await playReadySound();

  mediaUnlocked = soundOk;
  isReady = true;

  await update(clientRef, {
    ready: true,
    readyAt: serverTimestamp(),
    mediaUnlocked: soundOk
  });

  statusEl.textContent = "Du är redo. Vänta här tills nedräkningen börjar.";
  debug({ readyClicked: true, soundOk });

  if (startAt) {
    runCountdownAndPrebuffer();
  }
});

resetBtn.addEventListener("click", async () => {
  await localReset("Redo ångrat. Tryck igen när du är redo.");
  await update(clientRef, { ready: false });
});

youtubeLinkBig.addEventListener("click", (event) => {
  if (!youtubeLiveUrl) {
    event.preventDefault();
    statusEl.textContent = "YouTube-länk saknas ännu.";
  }
});

playEmbeddedBtn.addEventListener("click", () => {
  playEmbedded(true);
});

jumpLiveBtn.addEventListener("click", () => {
  jumpToLiveEdge();
});

onValue(startRef, (snap) => {
  const newStartAt = snap.val();

  if (!newStartAt) {
    startAt = null;
    clearTimeout(timer);
    clearTimeout(rescueTimer);
    stopLiveEdgeMonitor();
    hasStartedForThisCommand = false;
    hideVideoAndStopPlayer();

    if (isReady) {
      statusEl.textContent = "Redo. Väntar på start.";
    }

    debug({ startCleared: true });
    return;
  }

  startAt = newStartAt;
  hasStartedForThisCommand = false;

  if (isReady) {
    runCountdownAndPrebuffer();
  } else {
    statusEl.textContent = "Filmen börjar snart. Tryck 'Jag är redo'.";
  }

  debug({ startReceived: true });
});

onValue(resetRef, async (snap) => {
  const value = snap.val();

  if (lastResetCounter === null) {
    lastResetCounter = value;
    return;
  }

  if (value !== lastResetCounter) {
    lastResetCounter = value;
    await localReset("Sessionen nollställd. Tryck 'Jag är redo'.");
    await update(clientRef, { ready: false });
    debug({ reset: true });
  }
});

function runCountdownAndPrebuffer() {
  clearTimeout(timer);
  clearTimeout(rescueTimer);
  stopLiveEdgeMonitor();

  livePanel.classList.remove("hidden");
  countdownOverlay.classList.remove("hidden");
  rescueControls.classList.add("hidden");
  readyPanel.classList.add("hidden");

  // Starta spelaren direkt under nedräkningen så YouTube hinner ladda svart standby..
  startPlayerAttemptsDuringCountdown();

  const tick = () => {
    const remainingMs = startAt - serverNow();
    const remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));

    countdownEl.textContent = String(remainingSeconds);

    if (remainingMs > 0) {
      statusEl.textContent = "Förbereder filmen...";
      timer = setTimeout(tick, 100);
      return;
    }

    countdownOverlay.classList.add("hidden");
    statusEl.textContent = "Filmen startar nu.";

    setTimeout(() => {
      jumpToLiveEdge();
    }, 500);

    movieStartedAt = Date.now();

    // Snäll auto-catchup. Väntar 15 sek innan första möjliga korrigering.
    startLiveEdgeMonitor();

    // Visa räddningsknappar först efter några sekunder, så de inte stör normalflödet.
    rescueTimer = setTimeout(() => {
      rescueControls.classList.remove("hidden");
      statusEl.textContent = "Filmen ska vara igång. Om inte, tryck Starta filmen.";
    }, 5000);
  };

  tick();
}

function startPlayerAttemptsDuringCountdown() {
  if (hasStartedForThisCommand) return;
  hasStartedForThisCommand = true;

  const tryPlay = (attempt = 1) => {
    playEmbedded(false);

    if (attempt < 8 && startAt && serverNow() < startAt) {
      setTimeout(() => tryPlay(attempt + 1), 1000);
    }
  };

  tryPlay();
}

function playEmbedded(userVisible) {
  if (!youtubeLiveUrl || !youtubeVideoId) {
    statusEl.textContent = "YouTube-länk saknas ännu.";
    debug({ playError: "missing youtube url" });
    return;
  }

  if (!player || typeof player.playVideo !== "function") {
    if (youtubeApiReady) {
      createOrLoadPlayer();
    }

    if (userVisible) {
      statusEl.textContent = "Spelaren är inte redo ännu. Försök igen eller öppna i YouTube.";
    }

    debug({ playError: "player not ready" });
    return;
  }

  try {
    player.playVideo();
    debug({ playCalled: true, userVisible });
  } catch (err) {
    if (userVisible) {
      statusEl.textContent = "Kunde inte starta inbäddad spelare. Använd 'Öppna i YouTube'.";
    }

    debug({ playError: String(err) });
  }
}

function jumpToLiveEdge() {
  if (!player) return;

  try {
    const duration = player.getDuration?.();
    const current = player.getCurrentTime?.();

    if (Number.isFinite(duration) && duration > 0) {
      player.seekTo(Math.max(0, duration - 1.0), true);
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

    // Låt YouTube få lite arbetsro precis i början.
    if (Date.now() - movieStartedAt < 15000) return;

    try {
      const duration = player.getDuration?.();
      const current = player.getCurrentTime?.();

      if (
        Number.isFinite(duration) &&
        Number.isFinite(current) &&
        duration > 0
      ) {
        const behind = duration - current;

        // Konservativ gräns. Sänk till 7 om du vill vara lite mer aggressiv.
        // Gå helst inte ner till 2, eftersom seekTo kan kasta bufferten och ge mer hack.
        
        if (behind > 8) {
          player.seekTo(Math.max(0, duration - 8), true);
          debug({ autoCatchup: true, behind });
        }
      }
    } catch (err) {
      debug({ liveEdgeMonitorError: String(err) });
    }
  }, 30000);

  debug({ liveEdgeMonitorStarted: true });
}

function stopLiveEdgeMonitor() {
  if (liveEdgeTimer) {
    clearInterval(liveEdgeTimer);
    liveEdgeTimer = null;
    debug({ liveEdgeMonitorStopped: true });
  }
}

async function localReset(message) {
  isReady = false;
  mediaUnlocked = false;
  hasStartedForThisCommand = false;
  movieStartedAt = 0;
  readyBtn.disabled = false;
  readyPanel.classList.remove("hidden");

  clearTimeout(timer);
  clearTimeout(rescueTimer);
  stopLiveEdgeMonitor();

  hideVideoAndStopPlayer();

  statusEl.textContent = message;
  debug({ localReset: true });
}

function hideVideoAndStopPlayer() {
  stopLiveEdgeMonitor();

  countdownOverlay.classList.add("hidden");
  rescueControls.classList.add("hidden");
  livePanel.classList.add("hidden");
  countdownEl.textContent = "";

  try {
    player?.stopVideo?.();
    player?.pauseVideo?.();
  } catch (err) {
    debug({ stopError: String(err) });
  }
}