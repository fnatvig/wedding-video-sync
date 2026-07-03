import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getDatabase, ref, set, update, remove, onValue, serverTimestamp, increment } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import { firebaseConfig, SESSION_ID } from "./firebase-config.js";

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
const streamCommandRef = ref(db, `sessions/${SESSION_ID}/streamCommand`);

const videoCommandBtns = document.querySelectorAll(".videoCommandBtn");
const customVideoInput = document.getElementById("customVideoInput");
const playCustomVideoBtn = document.getElementById("playCustomVideoBtn");
const standbyStreamBtn = document.getElementById("standbyStreamBtn");
const streamCommandStatus = document.getElementById("streamCommandStatus");

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

async function sendStreamCommand(command) {
  const payload = {
    commandId: Date.now(),
    sentAt: serverTimestamp(),
    ...command
  };

  await set(streamCommandRef, payload);

  if (command.action === "play") {
    const delaySeconds = await sendGuestStartSignal(command.video);
    streamCommandStatus.textContent = `Kommando skickat: spela ${command.video}. Gästerna startas om ${delaySeconds} s.`;
    statusEl.textContent = `Spelar ${command.video}. Gästerna får startsignal om ${delaySeconds} s.`;
  } else if (command.action === "standby") {
    await remove(startRef);
    streamCommandStatus.textContent = "Kommando skickat: tillbaka till svart bild.";
    statusEl.textContent = "Streamkommando skickat: svart bild. Gästspelaren dold.";
  }
}

function normalizeVideoFilename(value) {
  return (value || "").trim().replaceAll("\\", "/").split("/").pop();
}

async function sendGuestStartSignal(label = "film") {
  const delaySeconds = Math.max(3, Number(delayInput.value || 5));
  const startAt = Math.round(serverNow() + delaySeconds * 1000);

  await set(startRef, startAt);
  await update(sessionRef, {
    lastStartCommandAt: serverTimestamp(),
    lastStartLabel: label
  });

  return delaySeconds;
}

videoCommandBtns.forEach((btn) => {
  btn.addEventListener("click", async () => {
    const video = normalizeVideoFilename(btn.dataset.video);
    if (!video) return;
    await sendStreamCommand({ action: "play", video });
  });
});

playCustomVideoBtn.addEventListener("click", async () => {
  const video = normalizeVideoFilename(customVideoInput.value);
  if (!video) {
    streamCommandStatus.textContent = "Skriv ett filnamn först.";
    return;
  }
  await sendStreamCommand({ action: "play", video });
});

standbyStreamBtn.addEventListener("click", async () => {
  await sendStreamCommand({ action: "standby" });
});

saveYoutubeUrlBtn.addEventListener("click", async () => {
  const url = youtubeUrlInput.value.trim();

  if (!url.startsWith("https://")) {
    youtubeUrlStatus.textContent = "Ange en giltig https-länk.";
    return;
  }

  await set(youtubeUrlRef, url);
  await update(sessionRef, {
    youtubeLiveUrlUpdatedAt: serverTimestamp()
  });

  youtubeUrlStatus.textContent = "YouTube-länk sparad.";
});

startBtn.addEventListener("click", async () => {
  const delaySeconds = Math.max(3, Number(delayInput.value || 5));
  const startAt = Math.round(serverNow() + delaySeconds * 1000);

  await set(startRef, startAt);
  await update(sessionRef, {
    lastStartCommandAt: serverTimestamp()
  });

  statusEl.textContent = `Start skickad. Nedräkning: ${delaySeconds} sekunder.`;
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
