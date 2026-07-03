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
let hasTriedStart = false;
let liveEdgeTimer = null;

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
    playerReady: Boolean(player),
    hasTriedStart,
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
  if (youtubeApiReady && youtubeVideoId) createOrLoadPlayer();
  debug({ youtubeUrlUpdated: true });
}

window.onYouTubeIframeAPIReady = () => {
  youtubeApiReady = true;
  if (youtubeVideoId) createOrLoadPlayer();
  debug({ youtubeApiReady: true });
};

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
        debug({ playerError: event.data });
      }
    }
  });
}

onValue(offsetRef, (snap) => {
  serverOffsetMs = snap.val() || 0;
  if (!isReady) statusEl.textContent = "Ansluten. Tryck 'Jag är redo'.";
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
  isReady = true;
  readyBtn.disabled = true;
  await update(clientRef, { ready: true, readyAt: serverTimestamp() });
  statusEl.textContent = "Redo. Vänta här tills filmen börjar.";
  debug();
  if (startAt) runCountdown();
});

resetBtn.addEventListener("click", async () => {
  isReady = false;
  readyBtn.disabled = false;
  livePanel.classList.add("hidden");
  countdownEl.textContent = "";
  stopLiveEdgeMonitor();
  statusEl.textContent = "Redo ångrat. Tryck igen när du är redo.";
  await update(clientRef, { ready: false });
  debug();
});

youtubeLinkBig.addEventListener("click", (event) => {
  if (!youtubeLiveUrl) {
    event.preventDefault();
    statusEl.textContent = "YouTube-länk saknas ännu.";
  }
});

playEmbeddedBtn.addEventListener("click", () => playEmbedded());
jumpLiveBtn.addEventListener("click", () => jumpToLiveEdge());

onValue(startRef, (snap) => {
  startAt = snap.val();

  if (!startAt) {
    clearTimeout(timer);
    stopLiveEdgeMonitor();
    countdownEl.textContent = "";
    livePanel.classList.add("hidden");
    hasTriedStart = false;
    if (isReady) statusEl.textContent = "Redo. Väntar på start.";
    debug();
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
    hasTriedStart = false;
    readyBtn.disabled = false;
    livePanel.classList.add("hidden");
    countdownEl.textContent = "";
    stopLiveEdgeMonitor();
    statusEl.textContent = "Sessionen nollställd. Tryck 'Jag är redo'.";
    await update(clientRef, { ready: false });
    debug({ reset: true });
  }
});

function runCountdown() {
  clearTimeout(timer);

  const tick = () => {
    const remainingMs = startAt - serverNow();

    if (remainingMs > 0) {
      countdownEl.textContent = `Filmen börjar om ${Math.ceil(remainingMs / 1000)} s`;
      timer = setTimeout(tick, 100);
      return;
    }

    countdownEl.textContent = "";
    livePanel.classList.remove("hidden");

    if (!youtubeLiveUrl || !youtubeVideoId) {
      statusEl.textContent = "Filmen börjar, men YouTube-länken saknas.";
      return;
    }

    statusEl.textContent = "Startar YouTube-spelaren...";
    debug({ live: true });

    if (!hasTriedStart) {
      hasTriedStart = true;
      setTimeout(() => {
        playEmbedded();
        startLiveEdgeMonitor();
      }, 500);
    }
  };

  tick();
}

function playEmbedded() {
  if (!player || typeof player.playVideo !== "function") {
    statusEl.textContent = "Spelaren är inte redo ännu. Använd 'Öppna i YouTube'.";
    debug({ playError: "player not ready" });
    return;
  }

  try {
    player.playVideo();
    setTimeout(jumpToLiveEdge, 800);
    statusEl.textContent = "Spelar YouTube Live.";
    debug({ playCalled: true });
  } catch (err) {
    statusEl.textContent = "Kunde inte starta inbäddad spelare. Använd 'Öppna i YouTube'.";
    debug({ playError: String(err) });
  }
}

function jumpToLiveEdge() {
  if (!player) return;

  try {
    const duration = player.getDuration?.();
    const current = player.getCurrentTime?.();

    if (Number.isFinite(duration) && duration > 0) {
      player.seekTo(Math.max(0, duration - 0.5), true);
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
        if (behind > 3) {
          player.seekTo(Math.max(0, duration - 0.5), true);
          debug({ autoCatchup: true, behind });
        }
      }
    } catch (err) {
      debug({ liveEdgeMonitorError: String(err) });
    }
  }, 3000);
}

function stopLiveEdgeMonitor() {
  if (liveEdgeTimer) {
    clearInterval(liveEdgeTimer);
    liveEdgeTimer = null;
  }
}
