import { getSeatMapCallable, joinActivityCallable, restoreActivityCallable, leaveActivityCallable, setRealtimeClientConfig, subscribeSeatMap } from "./functions-client.js";

export function buildMusicPayload(sessionId, idea, style, lyrics, requestId) {
  return { sessionId, idea: idea.trim(), style: style.trim(), lyrics: lyrics.trim(), requestId };
}
export function safeAudioUrl(value) {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : ""; } catch { return ""; }
}
export function canGenerateMusic(state, lyrics, style) {
  return Boolean(state.sessionId && !state.busy && state.remaining > 0 && lyrics.trim() && style.trim());
}

function startMusicLab() {
  const el = (id) => document.getElementById(id);
  const idea = el("songIdea"), lyrics = el("songLyrics"), style = el("musicStyle");
  const code = el("musicClassCode"), name = el("musicStudentName");
  const state = { sessionId: "", busy: false, remaining: 0, seat: 0, seats: [], unsubscribe: null, seatVersion: 0, requestId: "", requestSignature: "", active: true };
  const sessionKey = "funlab-music-session", draftKey = "funlab-music-draft";
  function read(key) { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; } }
  function save(key, value) { try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)); } catch { /* The lesson works when storage is unavailable. */ } }
  function status(message, error = false) { el("musicStatus").textContent = message; el("musicStatus").dataset.error = String(error); }
  function sync() {
    el("musicBuilder").hidden = !state.sessionId;
    el("musicLeaveButton").hidden = !state.sessionId;
    el("musicJoinButton").hidden = Boolean(state.sessionId);
    el("musicJoinButton").disabled = state.busy || !state.seat || !code.value.trim();
    el("musicRefreshSeats").disabled = state.busy || Boolean(state.sessionId);
    el("musicLeaveButton").disabled = state.busy;
    code.disabled = name.disabled = state.busy || Boolean(state.sessionId);
    idea.disabled = lyrics.disabled = style.disabled = state.busy;
    el("prepareLyricsButton").disabled = state.busy || !state.sessionId || !idea.value.trim();
    el("pointLyricsButton").disabled = state.busy || !state.sessionId || !lyrics.value.trim();
    el("generateMusicButton").disabled = !canGenerateMusic(state, lyrics.value, style.value);
    el("clearMusicButton").disabled = state.busy;
    document.querySelectorAll("[data-music-style]").forEach((button) => { button.disabled = state.busy; button.setAttribute("aria-pressed", String(style.value === button.dataset.musicStyle)); });
    el("musicRemainingBadge").hidden = !state.sessionId;
    el("musicRemainingBadge").textContent = `נשארו ${state.remaining} שירים`;
    el("musicSessionBadge").textContent = state.sessionId ? `מחוברים · מקום ${state.seat}` : "עדיין לא התחברתם";
    el("musicBuilder").setAttribute("aria-busy", String(state.busy));
  }
  async function busy(work) {
    if (state.busy) return;
    state.busy = true; sync();
    try { await work(); } catch (error) { status(error.message || "קרתה תקלה. נסו שוב בעוד רגע.", true); }
    finally { state.busy = false; sync(); renderSeats(); }
  }
  async function callMusic(functionName, data) {
    const local = ["localhost", "127.0.0.1"].includes(location.hostname);
    const origin = local ? "http://127.0.0.1:5001/groovetech-9a3fb/europe-west1" : "https://europe-west1-groovetech-9a3fb.cloudfunctions.net";
    const response = await fetch(`${origin}/${functionName}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data }) });
    let payload;
    try { payload = await response.json(); } catch { throw new Error("השרת לא החזיר תשובה תקינה. בדקו את החיבור ונסו שוב."); }
    if (!response.ok || payload.error) throw new Error(payload.error?.message || "הבקשה לא הושלמה. נסו שוב בעוד רגע.");
    const result = payload.result;
    if (!result || result.ok === false) throw new Error(result?.message || "לא ניתן להשלים את הבקשה כרגע.");
    return result;
  }
  function persistDraft() {
    save(draftKey, { idea: idea.value, lyrics: lyrics.value, style: style.value, requestId: state.requestId, requestSignature: state.requestSignature });
  }
  function renderSeats() {
    const board = el("musicSeatBoard"); board.replaceChildren();
    for (const seat of state.seats) {
      const button = document.createElement("button"), mine = Boolean(state.sessionId && seat.seatNumber === state.seat);
      const taken = seat.status === "taken" && !mine;
      button.type = "button"; button.className = `seat-button ${mine ? "is-mine" : taken ? "is-taken" : "is-available"} ${seat.seatNumber === state.seat ? "is-selected" : ""}`;
      button.textContent = `${seat.seatNumber} · ${mine ? "שלי" : taken ? "תפוס" : "פנוי"}`;
      button.disabled = state.busy || Boolean(state.sessionId) || taken;
      button.setAttribute("aria-pressed", String(seat.seatNumber === state.seat));
      button.onclick = () => { state.seat = seat.seatNumber; renderSeats(); sync(); };
      board.append(button);
    }
  }
  function applySeats(payload) {
    state.seats = Array.isArray(payload.seats) ? payload.seats.filter((seat) => Number.isInteger(seat.seatNumber) && seat.seatNumber > 0 && ["available", "taken"].includes(seat.status)) : [];
    if (!state.sessionId && !state.seats.some((seat) => seat.seatNumber === state.seat && seat.status !== "taken")) state.seat = 0;
    renderSeats(); sync();
  }
  async function loadSeats() {
    if (!code.value.trim()) { status("כתבו את קוד הכיתה שקיבלתם מהמורה."); return; }
    const version = ++state.seatVersion;
    state.unsubscribe?.(); state.unsubscribe = null;
    const response = await getSeatMapCallable({ classCode: code.value, lessonKey: "music-lab" });
    if (version !== state.seatVersion) return;
    applySeats(response.data);
    if (response.data.firebaseConfig && response.data.publicSeatMapId) {
      try {
        setRealtimeClientConfig(response.data.firebaseConfig);
        state.unsubscribe = subscribeSeatMap(response.data.publicSeatMapId, {
          onData: (data) => { if (version === state.seatVersion) applySeats(data); },
          onError: () => { if (!state.sessionId) status("העדכון החי הופסק. אפשר לרענן את המקומות."); }
        });
      } catch { /* Manual refresh remains available. */ }
    }
    status("בחרו מקום פנוי ואז לחצו על כניסה לפעילות.");
  }
  function applySession(data) {
    if (data.lessonKey !== "music-lab") throw new Error("החיבור הזה שייך לשיעור אחר. הכניסו קוד לכיתת המוזיקה.");
    state.sessionId = data.sessionId; state.seat = data.seatNumber; state.remaining = Number(data.remainingGenerations || 0);
    code.value = data.classCode || code.value; name.value = data.studentName || name.value;
    save(sessionKey, { sessionId: state.sessionId }); sync();
  }
  function showResult(data) {
    const url = safeAudioUrl(data.audioDownloadUrl);
    if (!url) throw new Error("השיר נוצר אבל קישור ההאזנה אינו זמין. בדקו שוב ברשימת השירים.");
    el("musicAudio").pause(); el("musicAudio").src = url;
    el("downloadMusicButton").href = safeAudioUrl(data.downloadUrl) || url; el("musicResult").hidden = false;
  }
  async function loadHistory() {
    const sessionId = state.sessionId;
    const data = await callMusic("getMusicCreations", { sessionId });
    if (sessionId !== state.sessionId) return;
    const list = el("musicHistoryList"); list.replaceChildren();
    for (const item of data.items || []) {
      const url = safeAudioUrl(item.audioDownloadUrl); if (!url) continue;
      const article = document.createElement("article"); article.className = "music-history-item";
      const heading = document.createElement("p"); heading.textContent = item.style || "השיר שלי";
      const audio = document.createElement("audio"); audio.controls = true; audio.preload = "none"; audio.src = url; audio.setAttribute("aria-label", "האזנה לשיר שנשמר");
      const details = document.createElement("details"), summary = document.createElement("summary"), text = document.createElement("pre"); summary.textContent = "מילות השיר"; text.textContent = item.lyrics || ""; details.append(summary, text);
      const download = document.createElement("a"); download.href = safeAudioUrl(item.downloadUrl) || url; download.download = "funlab-song.mp3"; download.textContent = "הורדת השיר";
      article.append(heading, audio, download, details); list.append(article);
    }
    el("musicHistory").hidden = !list.children.length;
  }
  async function resolveGeneration(result) {
    // Polling only retrieves the existing job; it never submits a second generation.
    for (let attempt = 0; result.status === "processing" && attempt < 45; attempt += 1) {
      status("השיר עדיין בהכנה… אפשר לחזור לעמוד בהמשך והיצירה תישמר.");
      await new Promise((resolve) => window.setTimeout(resolve, 4000));
      if (!state.active) return null;
      result = await callMusic("getMusicGeneration", { sessionId: state.sessionId, requestId: state.requestId });
    }
    if (result.status === "processing") throw new Error("השיר עדיין בהכנה. חזרו לעמוד בהמשך כדי לבדוק אם הוא מוכן.");
    if (result.status === "failed") throw new Error(result.message || "לא הצלחנו להשלים את השיר. נסו שוב בעוד רגע.");
    return result;
  }
  function finishGeneration(result) {
    if (!result || !state.active) return;
    if (typeof result.remainingGenerations === "number") state.remaining = result.remainingGenerations;
    showResult(result); state.requestId = ""; state.requestSignature = ""; persistDraft();
    status("השיר מוכן! לחצו על ניגון כדי להאזין.");
  }
  async function recoverGeneration() {
    if (!state.requestId || !state.sessionId) return;
    status("בודקים אם השיר שהתחלתם כבר מוכן…");
    const result = await callMusic("getMusicGeneration", { sessionId: state.sessionId, requestId: state.requestId });
    finishGeneration(await resolveGeneration(result));
  }
  function stopAudio() { document.querySelectorAll("audio").forEach((audio) => audio.pause()); }
  el("musicRefreshSeats").onclick = () => busy(loadSeats);
  code.oninput = () => { ++state.seatVersion; state.unsubscribe?.(); state.unsubscribe = null; state.seats = []; state.seat = 0; renderSeats(); sync(); };
  el("musicJoinForm").onsubmit = (event) => { event.preventDefault(); if (!state.seat || state.sessionId) return; void busy(async () => {
    const response = await joinActivityCallable({ classCode: code.value, studentName: name.value, seatNumber: state.seat, lessonKey: "music-lab" });
    applySession(response.data); status("התחברתם! כתבו רעיון לשיר שלכם.");
    try { await loadHistory(); } catch { status("התחברתם. רשימת השירים עדיין לא זמינה, אפשר להתחיל ברעיון."); }
  }); };
  el("musicLeaveButton").onclick = () => busy(async () => {
    await leaveActivityCallable({ sessionId: state.sessionId });
    state.sessionId = ""; state.seat = 0; state.remaining = 0; state.requestId = ""; state.requestSignature = "";
    save(sessionKey, null); save(draftKey, null); idea.value = lyrics.value = style.value = "";
    stopAudio(); el("musicAudio").removeAttribute("src"); el("musicResult").hidden = el("musicHistory").hidden = true;
    await loadSeats(); status("קמתם מהמקום. אפשר להתחבר שוב עם קוד כיתה.");
  });
  [idea, lyrics, style].forEach((input) => input.addEventListener("input", () => { persistDraft(); sync(); }));
  document.querySelectorAll("[data-music-style]").forEach((button) => { button.onclick = () => { if (state.busy) return; style.value = button.dataset.musicStyle; persistDraft(); sync(); }; });
  el("prepareLyricsButton").onclick = () => busy(async () => {
    if (!state.sessionId || !idea.value.trim()) return;
    status("כותבים מילים מנוקדות מהרעיון שלכם…");
    const result = await callMusic("prepareMusicLyrics", buildMusicPayload(state.sessionId, idea.value, style.value, "", crypto.randomUUID()));
    if (typeof result.lyrics !== "string" || !result.lyrics.trim()) throw new Error("לא התקבלו מילים לשיר. נסו שוב.");
    lyrics.value = result.lyrics; persistDraft(); status("המילים מוכנות! קראו, תקנו אם צריך ובחרו סגנון.");
  });
  el("pointLyricsButton").onclick = () => {
    if (state.busy || !state.sessionId || !lyrics.value.trim()) return;
    void busy(async () => {
      status("מנקדים את המילים שערכתם…");
      const result = await callMusic("pointMusicLyrics", buildMusicPayload(state.sessionId, idea.value, style.value, lyrics.value, crypto.randomUUID()));
      if (typeof result.lyrics !== "string" || !result.lyrics.trim()) throw new Error("לא התקבל ניקוד. המילים שערכתם נשמרו, ואפשר לנסות שוב.");
      if (!state.active) return;
      lyrics.value = result.lyrics; persistDraft();
      status("הניקוד עודכן. אפשר להמשיך לערוך או ליצור את השיר.");
    });
  };
  el("generateMusicButton").onclick = () => {
    if (!canGenerateMusic(state, lyrics.value, style.value)) return;
    void busy(async () => {
      const signature = JSON.stringify([state.sessionId, idea.value, lyrics.value, style.value]);
      if (state.requestSignature !== signature || !state.requestId) { state.requestId = crypto.randomUUID(); state.requestSignature = signature; persistDraft(); }
      status("יוצרים את השיר שלכם… זה יכול לקחת כמה דקות. אין צורך ללחוץ שוב.");
      const result = await callMusic("generateMusic", buildMusicPayload(state.sessionId, idea.value, style.value, lyrics.value, state.requestId));
      finishGeneration(await resolveGeneration(result));
      if (!state.active) return;
      try { await loadHistory(); } catch { status("השיר מוכן להאזנה. רשימת השירים תתעדכן בחיבור הבא."); }
    });
  };
  el("clearMusicButton").onclick = () => { if (state.busy) return; idea.value = lyrics.value = style.value = ""; state.requestId = state.requestSignature = ""; persistDraft(); stopAudio(); el("musicResult").hidden = true; sync(); idea.focus(); status("מוכנים לרעיון חדש."); };
  window.addEventListener("pagehide", () => { state.active = false; state.unsubscribe?.(); stopAudio(); });
  window.addEventListener("pageshow", (event) => { state.active = true; if (event.persisted && state.requestId && !state.busy) void busy(recoverGeneration); });
  window.addEventListener("beforeunload", (event) => { if (state.busy) { event.preventDefault(); event.returnValue = ""; } });
  const draft = read(draftKey);
  if (draft) { idea.value = String(draft.idea || "").slice(0, 600); lyrics.value = String(draft.lyrics || "").slice(0, 4000); style.value = String(draft.style || "").slice(0, 500); state.requestId = String(draft.requestId || ""); state.requestSignature = String(draft.requestSignature || ""); }
  sync();
  const saved = read(sessionKey);
  if (saved?.sessionId) void busy(async () => {
    status("משחזרים את המקום שלכם…");
    try { const response = await restoreActivityCallable({ sessionId: saved.sessionId }); applySession(response.data); }
    catch (error) { save(sessionKey, null); throw error; }
    status("חזרתם למקום שלכם. אפשר להמשיך ליצור.");
    if (state.requestId) await recoverGeneration();
    try { await loadHistory(); } catch { status("התחברתם מחדש. רשימת השירים עדיין לא זמינה."); }
  });
}
if (typeof document !== "undefined") startMusicLab();
