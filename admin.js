import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getDatabase, ref, set, update, remove, onValue, serverTimestamp, increment
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import { firebaseConfig, SESSION_ID } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const connectedCountEl = document.getElementById("connectedCount");
const readyCountEl = document.getElementById("readyCount");
const preparedCountEl = document.getElementById("preparedCount");
const soundCountEl = document.getElementById("soundCount");
const delayInput = document.getElementById("delay");
const startBtn = document.getElementById("startBtn");
const clearStartBtn = document.getElementById("clearStartBtn");
const stopBtn = document.getElementById("stopBtn");
const resetFilmBtn = document.getElementById("resetFilmBtn");
const resetBtn = document.getElementById("resetBtn");
const statusEl = document.getElementById("status");
const guestLink = document.getElementById("guestLink");
const copyLinkBtn = document.getElementById("copyLinkBtn");

const clientsRef = ref(db, `sessions/${SESSION_ID}/clients`);
const startRef = ref(db, `sessions/${SESSION_ID}/startAt`);
const stopRef = ref(db, `sessions/${SESSION_ID}/stopCounter`);
const resetFilmRef = ref(db, `sessions/${SESSION_ID}/resetFilmCounter`);
const sessionRef = ref(db, `sessions/${SESSION_ID}`);
const offsetRef = ref(db, ".info/serverTimeOffset");

let serverOffsetMs = 0;

function serverNow() {
  return Date.now() + serverOffsetMs;
}

const guestUrl = new URL("index.html", window.location.href).toString();
guestLink.value = guestUrl;

new QRCode(document.getElementById("qrcode"), {
  text: guestUrl,
  width: 256,
  height: 256,
  correctLevel: QRCode.CorrectLevel.M
});

onValue(offsetRef, (snap) => {
  serverOffsetMs = snap.val() || 0;
  statusEl.textContent = `Admin synkad. Offset: ${Math.round(serverOffsetMs)} ms.`;
});

onValue(clientsRef, (snap) => {
  const clients = snap.val() || {};
  const list = Object.values(clients);
  connectedCountEl.textContent = list.length;
  readyCountEl.textContent = list.filter(c => c.ready).length;
  preparedCountEl.textContent = list.filter(c => c.videoPrepared).length;
  soundCountEl.textContent = list.filter(c => c.soundVerified).length;
});

startBtn.addEventListener("click", async () => {
  const delaySeconds = Math.max(3, Number(delayInput.value || 5));
  const startAt = Math.round(serverNow() + delaySeconds * 1000);

  await set(startRef, startAt);
  await update(sessionRef, {
    lastStartCommandAt: serverTimestamp()
  });

  statusEl.textContent = `Start skickad. Filmen startar om ${delaySeconds} sekunder.`;
});

clearStartBtn.addEventListener("click", async () => {
  await remove(startRef);
  statusEl.textContent = "Start avbruten.";
});

stopBtn.addEventListener("click", async () => {
  await remove(startRef);
  await update(sessionRef, {
    stopCounter: increment(1),
    stoppedAt: serverTimestamp()
  });
  statusEl.textContent = "Stoppsignal skickad.";
});

resetFilmBtn.addEventListener("click", async () => {
  await remove(startRef);
  await update(sessionRef, {
    resetFilmCounter: increment(1),
    filmResetAt: serverTimestamp()
  });
  statusEl.textContent = "Filmen återställd till början. Gästernas redo-status behålls.";
});

resetBtn.addEventListener("click", async () => {
  await remove(startRef);
  await remove(clientsRef);
  await update(sessionRef, {
    resetCounter: increment(1),
    resetAt: serverTimestamp()
  });
  statusEl.textContent = "Session nollställd.";
});

copyLinkBtn.addEventListener("click", async () => {
  await navigator.clipboard.writeText(guestLink.value);
  statusEl.textContent = "Gästlänk kopierad.";
});
