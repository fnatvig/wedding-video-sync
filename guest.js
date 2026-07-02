import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getDatabase, ref, set, update, onValue, onDisconnect, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import { firebaseConfig, SESSION_ID, YOUTUBE_LIVE_URL } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const readyBtn = document.getElementById("readyBtn");
const resetBtn = document.getElementById("resetBtn");
const statusEl = document.getElementById("status");
const countdownEl = document.getElementById("countdown");
const debugEl = document.getElementById("debug");
const livePanel = document.getElementById("livePanel");
const youtubeLink = document.getElementById("youtubeLink");
const youtubeLinkBig = document.getElementById("youtubeLinkBig");

youtubeLink.href = YOUTUBE_LIVE_URL;
youtubeLinkBig.href = YOUTUBE_LIVE_URL;

const clientId = crypto.randomUUID();
const clientRef = ref(db, `sessions/${SESSION_ID}/clients/${clientId}`);
const startRef = ref(db, `sessions/${SESSION_ID}/startAt`);
const resetRef = ref(db, `sessions/${SESSION_ID}/resetCounter`);
const offsetRef = ref(db, ".info/serverTimeOffset");

let serverOffsetMs = 0;
let isReady = false;
let startAt = null;
let timer = null;
let lastResetCounter = null;

function serverNow() { return Date.now() + serverOffsetMs; }

function debug(extra = {}) {
  debugEl.textContent = JSON.stringify({
    clientId,
    serverOffsetMs: Math.round(serverOffsetMs),
    ready: isReady,
    startAt,
    youtubeLiveUrl: YOUTUBE_LIVE_URL,
    ...extra
  }, null, 2);
}

onValue(offsetRef, (snap) => {
  serverOffsetMs = snap.val() || 0;
  if (!isReady) statusEl.textContent = "Ansluten. Tryck 'Jag är redo'.";
  debug();
});

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
  statusEl.textContent = "Redo. Lämna denna sida öppen och ha YouTube Live redo.";
  debug();
  if (startAt) runCountdown();
});

resetBtn.addEventListener("click", async () => {
  isReady = false;
  readyBtn.disabled = false;
  livePanel.classList.add("hidden");
  countdownEl.textContent = "";
  statusEl.textContent = "Redo ångrat. Tryck igen när du är redo.";
  await update(clientRef, { ready: false });
  debug();
});

onValue(startRef, (snap) => {
  startAt = snap.val();
  if (!startAt) {
    clearTimeout(timer);
    countdownEl.textContent = "";
    livePanel.classList.add("hidden");
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
    readyBtn.disabled = false;
    livePanel.classList.add("hidden");
    countdownEl.textContent = "";
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
    statusEl.textContent = "Nu börjar filmen. Titta på YouTube Live.";
    debug({ live: true });
  };
  tick();
}
