import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getDatabase, ref, set, update, remove, onValue, serverTimestamp, increment } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import { firebaseConfig, SESSION_ID } from "./firebase-config.js";

// ===== Admin-lösenord =====
const ADMIN_PASSWORD = "calle2026";

const authenticated = sessionStorage.getItem("adminAuthenticated");

if (authenticated !== ADMIN_PASSWORD) {
  const entered = prompt("Lösenord:");

  if (entered !== ADMIN_PASSWORD) {
    document.body.innerHTML = "<main class='card'><h1>Åtkomst nekad</h1></main>";
    throw new Error("Wrong password");
  }

  sessionStorage.setItem("adminAuthenticated", ADMIN_PASSWORD);
}

document.getElementById("adminApp").classList.remove("hidden");

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const connectedCountEl = document.getElementById("connectedCount");
const readyCountEl = document.getElementById("readyCount");
const missingCountEl = document.getElementById("missingCount");
const delayInput = document.getElementById("delay");
const startBtn = document.getElementById("startBtn");
const clearStartBtn = document.getElementById("clearStartBtn");
const resetBtn = document.getElementById("resetBtn");
const statusEl = document.getElementById("status");
const guestLink = document.getElementById("guestLink");
const copyLinkBtn = document.getElementById("copyLinkBtn");
const youtubeUrlInput = document.getElementById("youtubeUrlInput");
const saveYoutubeUrlBtn = document.getElementById("saveYoutubeUrlBtn");
const youtubeUrlStatus = document.getElementById("youtubeUrlStatus");

const clientsRef = ref(db, `sessions/${SESSION_ID}/clients`);
const startRef = ref(db, `sessions/${SESSION_ID}/startAt`);
const sessionRef = ref(db, `sessions/${SESSION_ID}`);
const youtubeUrlRef = ref(db, `sessions/${SESSION_ID}/youtubeLiveUrl`);
const offsetRef = ref(db, ".info/serverTimeOffset");

let serverOffsetMs = 0;
function serverNow() { return Date.now() + serverOffsetMs; }

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
  const connected = list.length;
  const ready = list.filter(c => c.ready).length;

  connectedCountEl.textContent = connected;
  readyCountEl.textContent = ready;
  missingCountEl.textContent = Math.max(0, connected - ready);
});

onValue(youtubeUrlRef, (snap) => {
  const url = snap.val() || "";
  youtubeUrlInput.value = url;
  youtubeUrlStatus.textContent = url ? "YouTube-länk sparad." : "Ingen länk sparad ännu.";
});

saveYoutubeUrlBtn.addEventListener("click", async () => {
  const url = youtubeUrlInput.value.trim();

  if (!url.startsWith("https://")) {
    youtubeUrlStatus.textContent = "Ange en giltig https-länk.";
    return;
  }

  await set(youtubeUrlRef, url);
  await update(sessionRef, { youtubeLiveUrlUpdatedAt: serverTimestamp() });
  youtubeUrlStatus.textContent = "YouTube-länk sparad.";
});

startBtn.addEventListener("click", async () => {
  const delaySeconds = Math.max(10, Number(delayInput.value || 15));
  const startAt = Math.round(serverNow() + delaySeconds * 1000);

  await set(startRef, startAt);
  await update(sessionRef, { lastStartCommandAt: serverTimestamp() });

  statusEl.textContent = `Nedräkning skickad. Gästspelare startar under nedräkningen. Film vid 0.`;
});

clearStartBtn.addEventListener("click", async () => {
  await remove(startRef);
  statusEl.textContent = "Nedräkning avbruten.";
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
