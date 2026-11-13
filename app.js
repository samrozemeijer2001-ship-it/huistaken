/* ============================================================
   APP.JS — Huistaken voor elk huis
   ============================================================
   Wat is er anders dan de BR-versie?
   - Geen vaste namen/taken in de code meer: elk huis heeft zijn
     eigen bewoners, klussen en huisregels in de database.
   - Iemand maakt een huis aan, de rest joint met een code/link.
   - Het rooster rouleert automatisch: elke week schuift iedereen
     één klus op. Meer bewoners dan klussen? Dan heeft er iemand
     vrij. Meer klussen dan bewoners? Dan krijgt iemand er twee.
   - Kruisjes (strikes) zijn per huis aan/uit te zetten.

   Week- en kruisjeslogica is hetzelfde gebleven:
   - Een week loopt van maandag t/m zondag 23:59.
   - Niet op tijd afgevinkt = +1 kruisje (max 3).
   - Een week wél op tijd = er gaat 1 kruisje af.
   ============================================================ */

// -------------------- BACKEND KIEZEN --------------------
const FORCE_DEMO = new URLSearchParams(location.search).has("demo");
const backend = (!FORCE_DEMO && firebaseConfig && firebaseConfig.apiKey)
  ? createFirebaseBackend(firebaseConfig)
  : createLocalBackend();

// -------------------- DATUM HELPERS --------------------
function toDateOnly(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function mondayOf(date) {
  const d = toDateOnly(date);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d;
}
function addDays(date, n) { const d = new Date(date); d.setDate(d.getDate() + n); return d; }
function isoDate(d) {
  // Niet toISOString(): die rekent naar UTC en kan een dag verschuiven
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fromIso(iso) { return new Date(iso + "T00:00:00"); }
function deadlineOf(monday) { const s = addDays(monday, 6); s.setHours(23, 59, 59, 999); return s; }

const MONTHS = ["JAN","FEB","MRT","APR","MEI","JUN","JUL","AUG","SEP","OKT","NOV","DEC"];
const DAYS = ["ZO","MA","DI","WO","DO","VR","ZA"];

function formatWeekRange(monday) {
  const sunday = addDays(monday, 6);
  const a = sunday.getMonth() === monday.getMonth() ? `${monday.getDate()}` : `${monday.getDate()} ${MONTHS[monday.getMonth()]}`;
  return `${a} – ${sunday.getDate()} ${MONTHS[sunday.getMonth()]}`;
}
function isoWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}
function formatDoneMoment(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return `AFGEVINKT ${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} · ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const CURRENT_WEEK = mondayOf(new Date());
const CURRENT_ISO = isoDate(CURRENT_WEEK);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && isoDate(mondayOf(new Date())) !== CURRENT_ISO) location.reload();
});

// -------------------- KLEINE HULPJES --------------------
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const rand = (a, b) => a + Math.random() * (b - a);

function replay(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }

function applyColor(el, colorClass) {
  MEMBER_COLORS.forEach(c => el.classList.remove(c));
  if (colorClass) el.classList.add(colorClass);
}

let toastTimer = null;
function toast(text) {
  const t = $("toast");
  t.textContent = text;
  replay(t, "show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2400);
}

// Knop die pas bij de tweede tik iets doet (geen browser-pop-ups nodig)
function confirmTap(btn, label, action) {
  if (btn.dataset.armed === "1") { action(); return; }
  btn.dataset.armed = "1";
  const old = btn.innerHTML;
  btn.textContent = label;
  btn.classList.add("armed");
  setTimeout(() => {
    if (!btn.isConnected) return;
    btn.dataset.armed = "";
    btn.innerHTML = old;
    btn.classList.remove("armed");
  }, 3000);
}

// Uitnodigingscode: 6 tekens, zonder verwarrende letters (0/O, 1/I/L)
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function randomCode() {
  let c = "";
  for (let i = 0; i < 6; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return c;
}
function inviteLink(code) {
  return `${location.origin}${location.pathname}?code=${code}`;
}

// Foto verkleinen tot max 480px JPEG (~40 kB), zodat hij in de database past
function resizePhoto(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const max = 480;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL("image/jpeg", 0.75));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// ============================================================
// STAAT
// ============================================================
let uid = null;
let hid = null;
let data = null;          // { household, members, tasks, weeks, completions }
let me = null;            // mijn bewoner-profiel in dit huis
let unsubscribe = null;

const sortedTasks = () => (data ? data.tasks.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id)) : []);
const sortedMembers = () => (data ? data.members.slice().sort((a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0) || a.id.localeCompare(b.id)) : []);
const memberById = (id) => data && data.members.find(m => m.id === id);
const taskById = (id) => data && data.tasks.find(t => t.id === id);

// ============================================================
// ROOSTER — automatisch rouleren
// ============================================================
function weekIndexOf(monday) {
  const start = fromIso(data.household.startWeek || CURRENT_ISO);
  return Math.round((monday - start) / (7 * 86400000));
}

// Klus i gaat naar bewoner (i + weeknummer) — iedereen schuift elke week één op
function computeAssignments(monday) {
  const tasks = sortedTasks();
  const members = sortedMembers();
  const out = {};
  if (!members.length) return out;
  const w = weekIndexOf(monday);
  const n = members.length;
  tasks.forEach((t, i) => { out[t.id] = members[(((i + w) % n) + n) % n].id; });
  return out;
}

// Wie heeft welke klus in een week?
// - Afgelopen weken: zoals vastgelegd (bevroren).
// - Deze week en later: berekend; een al afgevinkte klus blijft bij wie hem deed.
function assignmentsFor(monday) {
  const iso = isoDate(monday);
  if (iso < CURRENT_ISO) {
    return (data.weeks[iso] && data.weeks[iso].assignments) || null;
  }
  const a = computeAssignments(monday);
  if (iso === CURRENT_ISO) {
    for (const taskId of Object.keys(a)) {
      const c = data.completions[`${iso}_${taskId}`];
      if (c && c.memberId && memberById(c.memberId)) a[taskId] = c.memberId;
    }
  }
  return a;
}

const sameAssign = (a, b) => JSON.stringify(Object.entries(a || {}).sort()) === JSON.stringify(Object.entries(b || {}).sort());

// Leg de stand van deze week vast, zodat hij na zondag 'bevroren' is
let lastSavedWeek = null;
function syncCurrentWeek() {
  const a = assignmentsFor(CURRENT_WEEK);
  const saved = data.weeks[CURRENT_ISO] && data.weeks[CURRENT_ISO].assignments;
  const key = JSON.stringify(Object.entries(a).sort());
  if (sameAssign(a, saved) || lastSavedWeek === key) return;
  lastSavedWeek = key;
  backend.saveWeek(hid, CURRENT_ISO, a).catch(err => { console.error(err); lastSavedWeek = null; });
}

function tasksFor(memberId, monday) {
  const a = assignmentsFor(monday) || {};
  return sortedTasks().filter(t => a[t.id] === memberId);
}

// -------------------- KRUISJES --------------------
function calculateStrikes(memberId) {
  if (!data.household.strikesEnabled) return 0;
  let strikes = 0;
  const pastWeeks = Object.keys(data.weeks).filter(w => w < CURRENT_ISO).sort();
  for (const iso of pastWeeks) {
    const a = data.weeks[iso].assignments || {};
    const mine = Object.keys(a).filter(t => a[t] === memberId);
    if (!mine.length) continue;
    const deadline = deadlineOf(fromIso(iso));
    const madeIt = mine.every(t => {
      const c = data.completions[`${iso}_${t}`];
      return c && new Date(c.completedAt) <= deadline;
    });
    strikes = madeIt ? Math.max(0, strikes - 1) : Math.min(3, strikes + 1);
  }
  return strikes;
}

function stateFor(memberId) {
  const tasks = tasksFor(memberId, CURRENT_WEEK);
  const done = tasks.map(t => data.completions[`${CURRENT_ISO}_${t.id}`] || null);
  const allDone = tasks.length > 0 && done.every(Boolean);
  const last = done.filter(Boolean).map(c => c.completedAt).sort().pop() || null;
  return { tasks, done, allDone, completedAt: last, strikes: calculateStrikes(memberId) };
}

function faceFor(s) {
  if (!s.tasks.length) return "sleepy";
  if (s.allDone) return s.strikes >= 2 ? "relieved" : "happy";
  if (s.strikes >= 3) return "panic";
  if (s.strikes === 2) return "shock";
  return s.strikes === 1 ? "meh" : "smirk";
}

// ============================================================
// SMILEYS TOT LEVEN WEKKEN (ongewijzigd)
// ============================================================
function setFace(holder, expression) {
  if (holder.dataset.face === expression) return;
  holder.dataset.face = expression;
  holder.innerHTML = smileySVG(expression);
  bringToLife(holder.firstElementChild);
}
function bringToLife(svg) {
  if (REDUCED_MOTION || !svg) return;
  const eyes = svg.querySelector(".eyes");
  const blink = svg.querySelector(".blink");
  const mouth = svg.querySelector(".mouth");
  function blinkOnce(after) {
    const dur = rand(170, 230);
    blink.style.transitionDuration = `${dur / 2}ms`;
    blink.classList.add("shut");
    setTimeout(() => { blink.classList.remove("shut"); setTimeout(after, dur / 2); }, dur / 2);
  }
  function scheduleBlink() {
    setTimeout(() => {
      if (!svg.isConnected) return;
      blinkOnce(() => {
        if (Math.random() < 0.18) setTimeout(() => blinkOnce(scheduleBlink), rand(90, 150));
        else scheduleBlink();
      });
    }, rand(2400, 6500));
  }
  function scheduleLook() {
    setTimeout(() => {
      if (!svg.isConnected) return;
      if (Math.random() < 0.3) { eyes.style.transform = ""; mouth.style.transform = ""; }
      else {
        const x = rand(-4.5, 4.5), y = rand(-3, 2.5);
        eyes.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`;
        mouth.style.transform = `translate(${(x * 0.45).toFixed(2)}px, ${(y * 0.35).toFixed(2)}px)`;
      }
      scheduleLook();
    }, rand(1300, 3800));
  }
  scheduleBlink();
  scheduleLook();
}

function renderStrikes(container, count) {
  if (container.children.length !== 3) {
    container.innerHTML = "";
    for (let i = 0; i < 3; i++) {
      const span = document.createElement("span");
      span.className = "strike";
      span.innerHTML = ICONS.cross;
      container.appendChild(span);
    }
  }
  const previous = container.dataset.count === undefined ? null : Number(container.dataset.count);
  [...container.children].forEach((span, i) => {
    const active = i < count;
    span.classList.toggle("strike-active", active);
    if (previous !== null && active && i >= previous) replay(span, "pop");
  });
  container.dataset.count = String(count);
  container.setAttribute("aria-label", `${count} van 3 kruisjes`);
}

// Foto of (als die er niet is) een grote beginletter
function paintPhoto(el, initialEl, member) {
  if (member.photo) {
    el.style.backgroundImage = `url("${member.photo}")`;
    initialEl.textContent = "";
  } else {
    el.style.backgroundImage = "";
    initialEl.textContent = (member.name || "?").trim().charAt(0).toUpperCase();
  }
}

// ============================================================
// SCHERM A — HOME
// ============================================================
const app = $("app");
const homeScreen = $("home-screen");
const detailScreen = $("detail-screen");
const cardsContainer = $("cards-container");
let cardRefs = {};
let cardsSignature = "";

function buildCards() {
  const members = sortedMembers();
  cardsContainer.innerHTML = "";
  cardRefs = {};
  cardsContainer.classList.toggle("single", members.length === 1);
  members.forEach((member, i) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "person-card";
    card.style.setProperty("--i", i);
    card.innerHTML = `
      <span class="card-photo"><span class="photo-initial"></span>
        <span class="card-me">JIJ</span>
        <span class="card-task"></span>
        <span class="card-done">KLAAR</span>
      </span>
      <span class="card-foot">
        <span class="card-name"></span>
        <span class="card-face face"></span>
      </span>
      <span class="strikes"></span>`;
    card.addEventListener("click", () => openDetail(member.id, card));
    cardsContainer.appendChild(card);
    cardRefs[member.id] = {
      card,
      photo: card.querySelector(".card-photo"),
      initial: card.querySelector(".photo-initial"),
      name: card.querySelector(".card-name"),
      task: card.querySelector(".card-task"),
      face: card.querySelector(".card-face"),
      strikes: card.querySelector(".strikes")
    };
  });
  replay(cardsContainer, "enter");
}

function renderHome() {
  const h = data.household;
  app.classList.toggle("no-strikes", !h.strikesEnabled);
  $("home-eyebrow").textContent = backend.mode === "local" ? "HUISTAKEN · DEMO" : "HUISTAKEN";
  // Huisnaam als grote titel, verdeeld over max. 2 regels
  const words = (h.name || "ONS HUIS").toUpperCase().split(/\s+/);
  const titleEl = $("house-title");
  titleEl.textContent = "";
  if (words.length > 1) {
    const mid = Math.ceil(words.length / 2);
    titleEl.append(words.slice(0, mid).join(" "), document.createElement("br"), words.slice(mid).join(" "));
  } else titleEl.textContent = words[0];
  titleEl.style.setProperty("--len", Math.max(4, ...words.map(w => w.length)));

  $("week-num").textContent = isoWeekNumber(CURRENT_WEEK);
  $("week-range-label").textContent = formatWeekRange(CURRENT_WEEK);
  const daysLeft = Math.ceil((deadlineOf(CURRENT_WEEK) - new Date()) / 86400000);
  $("week-left-label").textContent = daysLeft <= 1 ? "LAATSTE DAG" : `NOG ${daysLeft} DAGEN`;

  const members = sortedMembers();
  const sig = members.map(m => m.id).join(",");
  if (sig !== cardsSignature) { cardsSignature = sig; buildCards(); }

  members.forEach(member => {
    const s = stateFor(member.id);
    const ref = cardRefs[member.id];
    if (!ref) return;
    applyColor(ref.card, member.color);
    ref.card.classList.toggle("is-me", !!me && member.id === me.id);
    paintPhoto(ref.photo, ref.initial, member);
    ref.name.textContent = (member.name || "").toUpperCase();
    ref.name.style.setProperty("--len", Math.max(4, (member.name || "").length));

    const iconKey = s.tasks.length ? (s.tasks.find((t, i) => !s.done[i]) || s.tasks[0]).icon : "moon";
    if (ref.task.dataset.icon !== iconKey) {
      ref.task.dataset.icon = iconKey;
      ref.task.innerHTML = ICONS[iconKey] || ICONS.sparkle;
    }
    ref.task.classList.toggle("multi", s.tasks.length > 1);
    ref.task.dataset.count = s.tasks.length > 1 ? s.tasks.length : "";
    ref.card.classList.toggle("is-done", s.allDone);
    ref.card.classList.toggle("is-free", !s.tasks.length);
    ref.card.setAttribute("aria-label",
      `${member.name} — ${s.tasks.length ? s.tasks.map(t => t.name).join(", ") : "Vrij deze week"}${s.allDone ? " — klaar" : ""}${h.strikesEnabled ? `, ${s.strikes} kruisjes` : ""}`);
    setFace(ref.face, faceFor(s));
    renderStrikes(ref.strikes, s.strikes);
  });

  // Alleen? Dan een uitnodig-kaart
  const nudge = $("invite-nudge");
  nudge.hidden = members.length > 1;
  $("invite-nudge-code").textContent = h.code || "";
}
$("invite-nudge").addEventListener("click", shareInvite);

// ============================================================
// SCHERM B — PERSOONLIJK TAAKSCHERM
// ============================================================
const detailButton = $("detail-button");
const themeColorMeta = document.querySelector('meta[name="theme-color"]');
let currentMemberId = null;
let currentColorClass = null;
let savingFor = null;
let celebrateFor = null;
let errorTimer = null;

function renderDetail(memberId) {
  const member = memberById(memberId);
  if (!member) { closeDetail(); return; }
  const s = stateFor(memberId);
  const isMe = !!me && me.id === memberId;

  if (currentColorClass !== member.color) {
    applyColor(detailScreen, member.color);
    currentColorClass = member.color;
  }
  const NAME = (member.name || "").toUpperCase();
  $("detail-week-label").textContent = `WK ${isoWeekNumber(CURRENT_WEEK)} · ${formatWeekRange(CURRENT_WEEK)}`;
  $("detail-greeting").textContent = !s.tasks.length ? `HOI ${NAME}` : isMe ? `HOI ${NAME}, DIT IS JOUW KLUS` : `DIT IS DE KLUS VAN`;
  $("detail-name").textContent = NAME;
  $("detail-name").style.setProperty("--len", Math.max(3, NAME.length));
  paintPhoto($("hero-photo"), $("hero-initial"), member);
  renderStrikes($("detail-strikes-row"), s.strikes);
  setFace($("detail-face"), faceFor(s));

  const focus = s.tasks.find((t, i) => !s.done[i]) || s.tasks[0];
  const iconKey = focus ? focus.icon : "moon";
  const detailIcon = $("detail-icon");
  if (detailIcon.dataset.icon !== iconKey) {
    detailIcon.dataset.icon = iconKey;
    detailIcon.innerHTML = ICONS[iconKey] || ICONS.sparkle;
  }

  detailScreen.classList.toggle("no-task", !s.tasks.length);
  detailScreen.classList.toggle("is-done", s.allDone);
  detailScreen.classList.toggle("not-mine", !isMe);

  // Takenlijst in het paneel
  const list = $("detail-tasks");
  if (!s.tasks.length) {
    $("task-eyebrow").textContent = "DEZE WEEK";
    $("detail-task-name").textContent = "VRIJ!";
    list.innerHTML = `<span class="eyebrow">NIKS TE DOEN</span><p class="instructions">Er zijn deze week meer bewoners dan klussen. Geniet ervan, volgende week ben je weer aan de beurt.</p>`;
  } else if (s.tasks.length === 1) {
    $("task-eyebrow").textContent = "KLUS VAN DE WEEK";
    $("detail-task-name").textContent = s.tasks[0].name.toUpperCase();
    list.innerHTML = `<span class="eyebrow">ZO DOE JE HET</span><p class="instructions">${esc(s.tasks[0].instructions || "Geen uitleg nodig, toch?")}</p>`;
  } else {
    $("task-eyebrow").textContent = "KLUSSEN VAN DE WEEK";
    $("detail-task-name").textContent = `${s.tasks.length} KLUSSEN`;
    list.innerHTML = s.tasks.map((t, i) => `
      <div class="multi-task ${s.done[i] ? "is-done" : ""}">
        <span class="multi-icon">${ICONS[t.icon] || ICONS.sparkle}</span>
        <div class="multi-body">
          <span class="multi-name">${esc(t.name)}</span>
          <p>${esc(t.instructions || "")}</p>
        </div>
        ${isMe ? `<button type="button" class="multi-check" data-task="${t.id}" ${s.done[i] ? "disabled" : ""} aria-label="${esc(t.name)} afvinken">${ICONS.check}</button>`
               : `<span class="multi-check ${s.done[i] ? "" : "is-open"}">${ICONS.check}</span>`}
      </div>`).join("");
    list.querySelectorAll("button.multi-check").forEach(b => holdToConfirm(b, () => complete([b.dataset.task])));
  }
  $("done-meta").textContent = s.allDone ? formatDoneMoment(s.completedAt) : "";

  // Actieknop
  const note = $("action-note");
  note.textContent = "";
  if (!s.tasks.length) return;
  if (!isMe) {
    detailButton.hidden = true;
    note.textContent = s.allDone
      ? `${member.name} heeft geleverd. Respect.`
      : `Alleen ${member.name} kan dit afvinken. Ga maar even porren.`;
    return;
  }
  detailButton.hidden = false;
  if (s.allDone) {
    savingFor = null;
    detailButton.disabled = true;
    detailButton.classList.remove("is-saving", "is-error");
    detailButton.innerHTML = `<span class="btn-icon">${ICONS.check}</span>GEDAAN VOOR DEZE WEEK`;
    if (celebrateFor === memberId) { celebrateFor = null; celebrate(member); }
  } else if (savingFor === memberId) {
    detailButton.disabled = true;
    detailButton.classList.add("is-saving");
    detailButton.textContent = "BEZIG...";
  } else if (!detailButton.classList.contains("is-error")) {
    detailButton.disabled = false;
    detailButton.classList.remove("is-saving");
    detailButton.textContent = s.tasks.length > 1 ? "IK HEB ALLES GEDAAN" : "IK HEB HET GEDAAN";
    note.textContent = "Houd de knop ingedrukt om af te vinken";
  }
}

function openDetail(memberId, originEl) {
  currentMemberId = memberId;
  clearTimeout(errorTimer);
  detailButton.classList.remove("is-error");
  renderDetail(memberId);
  if (originEl) {
    const a = app.getBoundingClientRect();
    const r = originEl.getBoundingClientRect();
    detailScreen.style.setProperty("--ox", `${r.left + r.width / 2 - a.left}px`);
    detailScreen.style.setProperty("--oy", `${r.top + r.height / 2 - a.top}px`);
  }
  detailScreen.scrollTop = 0;
  detailScreen.classList.remove("closing");
  replay(detailScreen, "active");
  detailScreen.setAttribute("aria-hidden", "false");
  homeScreen.setAttribute("aria-hidden", "true");
  homeScreen.inert = true;
  updateStatusCover();
  if (themeColorMeta) themeColorMeta.content = getComputedStyle(detailScreen).getPropertyValue("--c-dark").trim() || "#141210";
}

function closeDetail() {
  if (!currentMemberId) return;
  currentMemberId = null;
  homeScreen.inert = false;
  homeScreen.setAttribute("aria-hidden", "false");
  detailScreen.setAttribute("aria-hidden", "true");
  if (themeColorMeta) themeColorMeta.content = "#141210";
  statusCover.classList.remove("show");
  if (data) renderHome();
  replay(cardsContainer, "enter");
  if (REDUCED_MOTION) { detailScreen.classList.remove("active"); return; }
  detailScreen.classList.add("closing");
  setTimeout(() => {
    if (!currentMemberId) { detailScreen.classList.remove("active", "closing"); updateStatusCover(); }
  }, 380);
}

// Afvinken (één klus, of alle openstaande)
function complete(taskIds) {
  if (!currentMemberId || !me || currentMemberId !== me.id) return;
  const memberId = currentMemberId;
  const s = stateFor(memberId);
  const willFinish = s.tasks.every((t, i) => s.done[i] || taskIds.includes(t.id));
  savingFor = memberId;
  if (willFinish) celebrateFor = memberId;
  detailButton.disabled = true;
  detailButton.classList.add("is-saving");
  detailButton.textContent = "BEZIG...";

  Promise.all(taskIds.map(t => backend.setCompletion(hid, CURRENT_ISO, t, memberId)))
    .then(() => { if (!willFinish) { savingFor = null; detailButton.classList.remove("is-saving"); renderDetail(memberId); } })
    .catch((err) => {
      console.error(err);
      savingFor = null;
      celebrateFor = null;
      hideCelebrate();
      if (currentMemberId !== memberId) return;
      detailButton.classList.remove("is-saving");
      detailButton.classList.add("is-error");
      detailButton.disabled = false;
      detailButton.textContent = "MISLUKT — PROBEER OPNIEUW";
      clearTimeout(errorTimer);
      errorTimer = setTimeout(() => { detailButton.classList.remove("is-error"); if (currentMemberId) renderDetail(currentMemberId); }, 3500);
    });
}

// ============================================================
// VASTHOUDEN OM TE BEVESTIGEN
// ============================================================
// De knop vult zich met je kleur zolang je hem ingedrukt houdt.
// Pas als hij vol is, gaat de actie door. Te vroeg los = niks.
const HOLD_MS = 1000;

function holdToConfirm(btn, onConfirm) {
  let timer = null;
  let fill = null;

  function start(e) {
    if (btn.disabled || timer) return;
    if (e && e.pointerId !== undefined) {
      if (e.button > 0) return;
      try { btn.setPointerCapture(e.pointerId); } catch (err) {}
    }
    // Kopie van de knopinhoud in de vulkleur, die van links naar rechts zichtbaar wordt
    fill = document.createElement("span");
    fill.className = "hold-fill";
    fill.setAttribute("aria-hidden", "true");
    fill.innerHTML = btn.innerHTML;
    btn.appendChild(fill);
    void fill.offsetWidth;
    btn.classList.add("holding");
    if (navigator.vibrate) navigator.vibrate(8);
    timer = setTimeout(() => {
      timer = null;
      btn.classList.remove("holding");
      btn.classList.add("held");
      if (navigator.vibrate) navigator.vibrate([18, 40, 30]);
      setTimeout(() => { btn.classList.remove("held"); removeFill(); }, 260);
      onConfirm();
    }, HOLD_MS);
  }

  function removeFill() {
    const f = fill;
    fill = null;
    if (f) setTimeout(() => f.remove(), 220);
  }

  function cancel() {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
    btn.classList.remove("holding");
    removeFill();
    replay(btn, "nudge");
    const note = $("action-note");
    if (note && btn === detailButton) { note.textContent = "Houd de knop ingedrukt om af te vinken"; replay(note, "flash"); }
  }

  btn.addEventListener("pointerdown", start);
  btn.addEventListener("pointerup", cancel);
  btn.addEventListener("pointercancel", cancel);
  btn.addEventListener("pointermove", (e) => {
    if (!timer) return;
    const r = btn.getBoundingClientRect();
    const m = 24; // beetje speling voor een bibberende duim
    if (e.clientX < r.left - m || e.clientX > r.right + m || e.clientY < r.top - m || e.clientY > r.bottom + m) cancel();
  });
  btn.addEventListener("contextmenu", (e) => e.preventDefault());
  // Toetsenbord: spatie/enter ingedrukt houden
  btn.addEventListener("keydown", (e) => {
    if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); start(); }
  });
  btn.addEventListener("keyup", (e) => { if (e.key === " " || e.key === "Enter") cancel(); });
  btn.addEventListener("blur", cancel);
}

holdToConfirm(detailButton, () => {
  if (!currentMemberId || detailButton.disabled) return;
  const s = stateFor(currentMemberId);
  complete(s.tasks.filter((t, i) => !s.done[i]).map(t => t.id));
});
$("back-button").addEventListener("click", closeDetail);

// ============================================================
// SCHERM C — VOLTOOID-ANIMATIE
// ============================================================
const celebrateEl = $("celebrate");
const CONFETTI_COLORS = ["#ffcc2e", "#7fe0a8", "#7fb7ff", "#b98cff", "#ff8a3d", "#ff5a3c", "#ff8fc8", "#fff6ea"];
let celebrateTimer = null;

function celebrate(member) {
  applyColor(celebrateEl, member.color);
  $("celebrate-sub").textContent = `${(member.name || "").toUpperCase()} HEEFT DEZE WEEK GELEVERD`;
  $("celebrate-face").dataset.face = "";
  setFace($("celebrate-face"), "stars");
  const confettiEl = $("confetti");
  confettiEl.innerHTML = "";
  if (!REDUCED_MOTION) {
    for (let i = 0; i < 22; i++) {
      const bit = document.createElement("i");
      const angle = rand(0, Math.PI * 2), dist = rand(140, 320);
      bit.style.setProperty("--tx", `${Math.cos(angle) * dist}px`);
      bit.style.setProperty("--ty", `${Math.sin(angle) * dist}px`);
      bit.style.setProperty("--rot", `${rand(-260, 260)}deg`);
      bit.style.setProperty("--s", `${rand(12, 26)}px`);
      bit.style.setProperty("--d", `${rand(0, 140)}ms`);
      bit.style.setProperty("--k", CONFETTI_COLORS[i % CONFETTI_COLORS.length]);
      confettiEl.appendChild(bit);
    }
  }
  celebrateEl.classList.remove("hide");
  replay(celebrateEl, "show");
  clearTimeout(celebrateTimer);
  celebrateTimer = setTimeout(hideCelebrate, 1700);
}
function hideCelebrate() {
  clearTimeout(celebrateTimer);
  if (!celebrateEl.classList.contains("show")) return;
  celebrateEl.classList.remove("show");
  celebrateEl.classList.add("hide");
  setTimeout(() => celebrateEl.classList.remove("hide"), REDUCED_MOTION ? 0 : 340);
}
celebrateEl.addEventListener("click", hideCelebrate);

// -------------------- STATUSBALK-KAPJE --------------------
const statusCover = $("status-cover");
function updateStatusCover() {
  const onDetail = detailScreen.classList.contains("active") && !detailScreen.classList.contains("closing");
  const screen = onDetail ? detailScreen : homeScreen;
  const band = screen.querySelector(onDetail ? ".detail-bar" : ".home-topbar");
  const cover = statusCover.offsetHeight;
  const show = cover > 0 && band && screen.scrollTop > band.offsetHeight - cover - 4;
  statusCover.classList.toggle("on-detail", onDetail);
  if (onDetail) applyColor(statusCover, currentColorClass);
  statusCover.classList.toggle("show", !!show);
}
homeScreen.addEventListener("scroll", updateStatusCover, { passive: true });
detailScreen.addEventListener("scroll", updateStatusCover, { passive: true });

// -------------------- STATISCHE ICONEN --------------------
document.querySelector(".back-icon").innerHTML = ICONS.back;
$("rules-fab-icon").innerHTML = ICONS.book;
$("settings-fab-icon").innerHTML = ICONS.gear;
document.querySelectorAll(".sheet-close").forEach(b => { b.innerHTML = `<span>${ICONS.cross}</span>`; });

// -------------------- LAADSCHERM --------------------
const loadingOverlay = $("loading-overlay");
setFace($("loading-face"), "sleepy");
function showLoadingOverlay(text, isError) {
  $("loading-text").textContent = text || "Verbinden...";
  loadingOverlay.classList.toggle("is-error", !!isError);
  setFace($("loading-face"), isError ? "panic" : "sleepy");
  loadingOverlay.style.display = "flex";
  loadingOverlay.classList.remove("is-hidden");
}
function hideLoadingOverlay() {
  if (loadingOverlay.style.display === "none") return;
  loadingOverlay.classList.add("is-hidden");
  setTimeout(() => { if (loadingOverlay.classList.contains("is-hidden")) loadingOverlay.style.display = "none"; }, REDUCED_MOTION ? 0 : 320);
}

// ============================================================
// ONDERPANELEN (regels, instellingen, formulier)
// ============================================================
const sheetOverlay = $("sheet-overlay");
const sheetStack = [];

function openSheet(el) {
  if (!sheetStack.includes(el)) sheetStack.push(el);
  el.style.zIndex = 61 + sheetStack.length * 2;
  sheetOverlay.style.zIndex = 60 + sheetStack.length * 2;
  sheetOverlay.classList.add("active");
  el.classList.add("active");
  el.setAttribute("aria-hidden", "false");
  el.scrollTop = 0;
}
function closeSheet(el) {
  const i = sheetStack.indexOf(el);
  if (i >= 0) sheetStack.splice(i, 1);
  el.classList.remove("active");
  el.setAttribute("aria-hidden", "true");
  if (!sheetStack.length) sheetOverlay.classList.remove("active");
  else sheetOverlay.style.zIndex = 60 + sheetStack.length * 2;
}
function closeTopSheet() { if (sheetStack.length) closeSheet(sheetStack[sheetStack.length - 1]); }
sheetOverlay.addEventListener("click", closeTopSheet);
document.querySelectorAll(".sheet-close").forEach(b => b.addEventListener("click", () => closeSheet(b.closest(".rules-sheet"))));
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (sheetStack.length) closeTopSheet();
  else if (currentMemberId) closeDetail();
});

// -------------------- HUISREGELS --------------------
const RULE_COLORS = [
  ["--yellow", "--yellow-ink"], ["--lilac", "--lilac-ink"], ["--mint", "--mint-ink"],
  ["--red", "--red-ink"], ["--sky", "--sky-ink"], ["--purple", "--purple-ink"],
  ["--orange", "--orange-ink"], ["--pink", "--pink-ink"], ["--cobalt", "--cobalt-ink"]
];
function renderRules() {
  const list = $("rules-list");
  const rules = data.household.rules || [];
  list.innerHTML = "";
  if (!rules.length) {
    list.innerHTML = `<p class="empty-note">Nog geen huisregels. Anarchie! Voeg ze toe via instellingen.</p>`;
  }
  rules.forEach((rule, i) => {
    const item = document.createElement("div");
    item.className = "rule-item";
    const [bg, ink] = RULE_COLORS[i % RULE_COLORS.length];
    item.style.setProperty("--k-bg", `var(${bg})`);
    item.style.setProperty("--k-ink", `var(${ink})`);
    item.style.setProperty("--i", i);
    item.innerHTML = `<span class="rule-icon">${ICONS[rule.icon] || ICONS.info}</span><span class="rule-text"></span>`;
    item.querySelector(".rule-text").textContent = rule.text;
    list.appendChild(item);
  });
  const pen = data.household.strikesEnabled && data.household.strikePenalty;
  $("penalty-card").hidden = !pen;
  $("penalty-text").textContent = pen || "";
}
$("rules-fab").addEventListener("click", () => { renderRules(); openSheet($("rules-sheet")); });

// -------------------- DELEN --------------------
async function shareInvite() {
  const code = data.household.code;
  const url = inviteLink(code);
  const text = `Doe mee met ${data.household.name} in Huistaken. Code: ${code}`;
  if (navigator.share) {
    try { await navigator.share({ title: data.household.name, text, url }); return; }
    catch (e) { if (e && e.name === "AbortError") return; }
  }
  try { await navigator.clipboard.writeText(`${text}\n${url}`); toast("Link gekopieerd"); }
  catch (e) { toast(`Code: ${code}`); }
}

// -------------------- INSTELLINGEN --------------------
function settingsRow({ icon, photo, color, title, sub, action, actionLabel, danger }) {
  return `<div class="set-row">
    ${photo !== undefined
      ? `<span class="set-avatar ${color || ""}" style="${photo ? `background-image:url('${photo}')` : ""}">${photo ? "" : esc(title.charAt(0).toUpperCase())}</span>`
      : `<span class="set-icon">${ICONS[icon] || ICONS.info}</span>`}
    <span class="set-text"><span class="set-title">${esc(title)}</span>${sub ? `<span class="set-sub">${esc(sub)}</span>` : ""}</span>
    ${action ? `<button type="button" class="set-btn ${danger ? "danger" : ""}" data-action="${action}">${actionLabel}</button>` : ""}
  </div>`;
}

function renderSettings() {
  const h = data.household;
  const members = sortedMembers();
  const tasks = sortedTasks();
  const next = addDays(CURRENT_WEEK, 7);
  const nextA = assignmentsFor(next);

  $("settings-body").innerHTML = `
    <div class="set-section invite-card">
      <span class="eyebrow">UITNODIGINGSCODE</span>
      <span class="invite-code">${esc(h.code)}</span>
      <button type="button" class="pill-button" data-action="share"><span class="pill-icon">${ICONS.share}</span>DEEL UITNODIGING</button>
    </div>

    <div class="set-section">
      <span class="eyebrow">JIJ</span>
      ${me ? settingsRow({ photo: me.photo || "", color: me.color, title: me.name, sub: "Naam, kleur en foto", action: `edit-me`, actionLabel: ICONS.pencil }) : ""}
    </div>

    <div class="set-section">
      <span class="eyebrow">BEWONERS · ${members.length}</span>
      ${members.map(m => settingsRow({
        photo: m.photo || "", color: m.color, title: m.name,
        sub: me && m.id === me.id ? "Dat ben jij" : `Volgende week: ${tasks.filter(t => nextA[t.id] === m.id).map(t => t.name).join(", ") || "vrij"}`,
        action: me && m.id === me.id ? "" : `remove-member:${m.id}`, actionLabel: "WEG", danger: true
      })).join("")}
    </div>

    <div class="set-section">
      <span class="eyebrow">KLUSSEN · ${tasks.length}</span>
      ${tasks.map(t => settingsRow({ icon: t.icon, title: t.name, sub: t.instructions, action: `edit-task:${t.id}`, actionLabel: ICONS.pencil })).join("")}
      <button type="button" class="add-button" data-action="add-task"><span>${ICONS.plus}</span>KLUS TOEVOEGEN</button>
      <p class="set-hint">Het rooster rouleert elke maandag automatisch. Afgevinkte klussen blijven staan.</p>
    </div>

    <div class="set-section">
      <span class="eyebrow">HUISREGELS · ${(h.rules || []).length}</span>
      ${(h.rules || []).map((r, i) => settingsRow({ icon: r.icon, title: r.text, action: `edit-rule:${i}`, actionLabel: ICONS.pencil })).join("")}
      <button type="button" class="add-button" data-action="add-rule"><span>${ICONS.plus}</span>REGEL TOEVOEGEN</button>
    </div>

    <div class="set-section">
      <span class="eyebrow">KRUISJES</span>
      <label class="toggle-row">
        <span class="set-text"><span class="set-title">Kruisjes bijhouden</span><span class="set-sub">Klus niet op tijd af = kruisje. Week wél op tijd = er gaat er één af.</span></span>
        <input type="checkbox" class="toggle" data-action="toggle-strikes" ${h.strikesEnabled ? "checked" : ""}>
      </label>
      ${h.strikesEnabled ? settingsRow({ icon: "bell", title: h.strikePenalty || "Nog geen straf ingesteld", sub: "Straf bij 3 kruisjes", action: "edit-penalty", actionLabel: ICONS.pencil }) : ""}
    </div>

    <div class="set-section">
      <span class="eyebrow">HUIS</span>
      ${settingsRow({ icon: "info", title: h.name, sub: "Naam van het huis", action: "edit-house", actionLabel: ICONS.pencil })}
      <button type="button" class="leave-button" data-action="leave">HUIS VERLATEN</button>
      ${backend.mode === "local" ? `<p class="set-hint">Demo-modus: alles staat alleen in deze browser. Open een tweede tabblad en join met de code om een huisgenoot na te spelen.</p>` : ""}
    </div>`;

  $("settings-body").querySelectorAll("[data-action]").forEach(el => {
    const [action, arg] = el.dataset.action.split(":");
    const evt = el.type === "checkbox" ? "change" : "click";
    el.addEventListener(evt, () => onSettingsAction(action, arg, el));
  });
}

function onSettingsAction(action, arg, el) {
  const h = data.household;
  switch (action) {
    case "share": shareInvite(); break;
    case "edit-me": openProfileForm(); break;
    case "remove-member": {
      const m = memberById(arg);
      confirmTap(el, "ZEKER?", () => backend.removeMember(hid, arg).then(() => toast(`${m ? m.name : "Bewoner"} is uit het huis`)).catch(fail));
      break;
    }
    case "add-task": openTaskForm(null); break;
    case "edit-task": openTaskForm(taskById(arg)); break;
    case "add-rule": openRuleForm(null); break;
    case "edit-rule": openRuleForm(Number(arg)); break;
    case "toggle-strikes": backend.updateHousehold(hid, { strikesEnabled: el.checked }).catch(fail); break;
    case "edit-penalty":
      openForm({
        title: "STRAF",
        fields: [{ key: "penalty", type: "textarea", label: "Wat gebeurt er bij 3 kruisjes?", value: h.strikePenalty || "", placeholder: "Bv. koken voor het hele huis" }],
        onSave: (v) => backend.updateHousehold(hid, { strikePenalty: v.penalty.trim() })
      });
      break;
    case "edit-house":
      openForm({
        title: "HUIS",
        fields: [{ key: "name", type: "text", label: "Naam van het huis", value: h.name, required: true, max: 28 }],
        onSave: (v) => backend.updateHousehold(hid, { name: v.name.trim() })
      });
      break;
    case "leave":
      confirmTap(el, "ECHT WEG? TIK NOG EEN KEER", async () => {
        try {
          await backend.leaveHousehold(hid, me && me.id);
          closeSheet($("settings-sheet"));
          stopHousehold();
          showOnboarding("welcome");
        } catch (e) { fail(e); }
      });
      break;
  }
}
function fail(err) { console.error(err); toast("Dat ging mis. Probeer het opnieuw."); }

$("settings-fab").addEventListener("click", () => { renderSettings(); openSheet($("settings-sheet")); });

// -------------------- FORMULIEREN --------------------
let formConfig = null;
const formBody = $("form-body");

function openForm(cfg) {
  formConfig = cfg;
  $("form-title").textContent = cfg.title;
  formBody.innerHTML = cfg.fields.map(f => fieldHTML(f)).join("") + `
    <button type="submit" class="done-button form-save">OPSLAAN</button>
    ${cfg.onDelete ? `<button type="button" class="leave-button form-delete">VERWIJDEREN</button>` : ""}`;
  wireFields(formBody, cfg.fields);
  const del = formBody.querySelector(".form-delete");
  if (del) del.addEventListener("click", () => confirmTap(del, "ZEKER WETEN?", async () => {
    try { await cfg.onDelete(); closeSheet($("form-sheet")); refreshOpenSheets(); } catch (e) { fail(e); }
  }));
  openSheet($("form-sheet"));
  const first = formBody.querySelector("input[type=text], textarea");
  if (first && !("ontouchstart" in window)) setTimeout(() => first.focus(), 350);
}

formBody.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!formConfig) return;
  const values = readFields(formBody, formConfig.fields);
  const missing = formConfig.fields.find(f => f.required && !String(values[f.key] || "").trim());
  if (missing) { toast(`${missing.label} is nog leeg`); return; }
  const btn = formBody.querySelector(".form-save");
  btn.disabled = true; btn.textContent = "BEZIG...";
  try {
    await formConfig.onSave(values);
    closeSheet($("form-sheet"));
    refreshOpenSheets();
  } catch (err) { fail(err); btn.disabled = false; btn.textContent = "OPSLAAN"; }
});

// Herbruikbare velden (ook voor onboarding)
function fieldHTML(f) {
  const id = `f-${f.key}`;
  switch (f.type) {
    case "text":
      return `<label class="field"><span class="eyebrow">${esc(f.label)}</span>
        <input id="${id}" type="text" value="${esc(f.value || "")}" maxlength="${f.max || 60}" placeholder="${esc(f.placeholder || "")}" ${f.upper ? 'class="upper"' : ""}></label>`;
    case "textarea":
      return `<label class="field"><span class="eyebrow">${esc(f.label)}</span>
        <textarea id="${id}" rows="3" maxlength="300" placeholder="${esc(f.placeholder || "")}">${esc(f.value || "")}</textarea></label>`;
    case "icons":
      return `<div class="field"><span class="eyebrow">${esc(f.label)}</span><div class="icon-picker" id="${id}">
        ${f.options.map(k => `<button type="button" class="pick ${k === f.value ? "on" : ""}" data-v="${k}" aria-label="${k}">${ICONS[k]}</button>`).join("")}
      </div></div>`;
    case "colors":
      return `<div class="field"><span class="eyebrow">${esc(f.label)}</span><div class="color-picker" id="${id}">
        ${MEMBER_COLORS.map(c => `<button type="button" class="swatch ${c} ${c === f.value ? "on" : ""}" data-v="${c}" aria-label="kleur"></button>`).join("")}
      </div></div>`;
    case "photo":
      return `<div class="field photo-field" id="${id}" data-v="${esc(f.value || "")}">
        <span class="photo-preview" style="${f.value ? `background-image:url('${f.value}')` : ""}">${f.value ? "" : ICONS.camera}</span>
        <span class="photo-actions">
          <span class="eyebrow">${esc(f.label)}</span>
          <label class="pill-button small"><input type="file" accept="image/*" hidden>FOTO KIEZEN</label>
          <button type="button" class="link-button photo-remove" ${f.value ? "" : "hidden"}>Foto weghalen</button>
        </span>
      </div>`;
  }
  return "";
}
function wireFields(root, fields) {
  fields.forEach(f => {
    const el = root.querySelector(`#f-${f.key}`);
    if (!el) return;
    if (f.type === "icons" || f.type === "colors") {
      el.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
        el.querySelectorAll("button").forEach(x => x.classList.remove("on"));
        b.classList.add("on");
        if (f.onChange) f.onChange(b.dataset.v);
      }));
    }
    if (f.type === "photo") {
      const preview = el.querySelector(".photo-preview");
      const remove = el.querySelector(".photo-remove");
      el.querySelector("input[type=file]").addEventListener("change", async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        try {
          const url = await resizePhoto(file);
          el.dataset.v = url;
          preview.style.backgroundImage = `url('${url}')`;
          preview.innerHTML = "";
          remove.hidden = false;
        } catch (err) { toast("Deze foto lukt niet"); }
      });
      remove.addEventListener("click", () => {
        el.dataset.v = "";
        preview.style.backgroundImage = "";
        preview.innerHTML = ICONS.camera;
        remove.hidden = true;
      });
    }
    if (f.upper) el.addEventListener("input", () => { el.value = el.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); });
  });
}
function readFields(root, fields) {
  const v = {};
  fields.forEach(f => {
    const el = root.querySelector(`#f-${f.key}`);
    if (!el) return;
    if (f.type === "text" || f.type === "textarea") v[f.key] = el.value;
    else if (f.type === "icons" || f.type === "colors") { const on = el.querySelector(".on"); v[f.key] = on ? on.dataset.v : f.value; }
    else if (f.type === "photo") v[f.key] = el.dataset.v || "";
  });
  return v;
}

function refreshOpenSheets() {
  if (!data) return;
  if (sheetStack.includes($("settings-sheet"))) {
    const top = $("settings-sheet").scrollTop;
    renderSettings();
    $("settings-sheet").scrollTop = top;
  }
  if (sheetStack.includes($("rules-sheet"))) renderRules();
}

function openProfileForm() {
  openForm({
    title: "JIJ",
    fields: [
      { key: "photo", type: "photo", label: "FOTO (MAG OOK ZONDER)", value: me.photo || "" },
      { key: "name", type: "text", label: "Naam", value: me.name, required: true, max: 14 },
      { key: "color", type: "colors", label: "Jouw kleur", value: me.color }
    ],
    onSave: (v) => backend.updateMember(hid, me.id, { name: v.name.trim(), color: v.color, photo: v.photo })
  });
}
function openTaskForm(task) {
  openForm({
    title: task ? "KLUS" : "NIEUWE KLUS",
    fields: [
      { key: "name", type: "text", label: "Naam van de klus", value: task ? task.name : "", required: true, max: 40, placeholder: "Bv. Taaie week maat" },
      { key: "icon", type: "icons", label: "Plaatje", value: task ? task.icon : "sparkle", options: TASK_ICONS },
      { key: "instructions", type: "textarea", label: "Zo doe je het", value: task ? task.instructions : "", placeholder: "Wat moet er precies gebeuren?" }
    ],
    onSave: (v) => backend.saveTask(hid, {
      ...(task ? { id: task.id } : { order: Math.max(-1, ...data.tasks.map(t => t.order ?? 0)) + 1 }),
      name: v.name.trim(), icon: v.icon, instructions: v.instructions.trim()
    }),
    onDelete: task ? () => backend.deleteTask(hid, task.id) : null
  });
}
function openRuleForm(index) {
  const rules = (data.household.rules || []).slice();
  const rule = index === null ? null : rules[index];
  openForm({
    title: rule ? "REGEL" : "NIEUWE REGEL",
    fields: [
      { key: "text", type: "textarea", label: "De regel", value: rule ? rule.text : "", required: true, placeholder: "Bv. Wie kookt, ruimt niet af" },
      { key: "icon", type: "icons", label: "Icoon", value: rule ? rule.icon : "info", options: RULE_ICONS }
    ],
    onSave: (v) => {
      const r = { text: v.text.trim(), icon: v.icon };
      if (rule) rules[index] = r; else rules.push(r);
      return backend.updateHousehold(hid, { rules });
    },
    onDelete: rule ? () => { rules.splice(index, 1); return backend.updateHousehold(hid, { rules }); } : null
  });
}

// ============================================================
// ONBOARDING — huis maken of joinen
// ============================================================
const onboardScreen = $("onboard-screen");
const onboardInner = $("onboard-inner");
let draft = {};

function freeColor(members) {
  const used = new Set((members || []).map(m => m.color));
  return MEMBER_COLORS.find(c => !used.has(c)) || MEMBER_COLORS[Math.floor(Math.random() * MEMBER_COLORS.length)];
}

function showOnboarding(step, opts) {
  hideLoadingOverlay();
  onboardScreen.classList.add("active");
  onboardScreen.setAttribute("aria-hidden", "false");
  homeScreen.inert = true;
  onboardScreen.scrollTop = 0;
  renderOnboardStep(step, opts || {});
}
function hideOnboarding() {
  onboardScreen.classList.remove("active");
  onboardScreen.setAttribute("aria-hidden", "true");
  onboardScreen.dataset.step = "";
  homeScreen.inert = false;
  setTimeout(() => { if (!onboardScreen.classList.contains("active")) onboardInner.innerHTML = ""; }, 50);
}

function obButton(label, action, cls) {
  return `<button type="button" class="${cls || "done-button"}" data-ob="${action}">${label}</button>`;
}

function renderOnboardStep(step, opts) {
  onboardScreen.dataset.step = step;
  let html = "";
  const back = (to) => `<button type="button" class="ob-back" data-ob="go:${to}"><span>${ICONS.back}</span>TERUG</button>`;

  if (step === "welcome") {
    html = `
      <div class="ob-hero"><div class="ob-face face" id="ob-face"></div></div>
      <h1 class="ob-title">WIE DOET<br>WAT?</h1>
      <p class="ob-lead">Eerlijk rouleren, afvinken, klaar. Voor je hele huis, zonder gezeur in de groepsapp.</p>
      <div class="ob-actions">
        ${obButton("NIEUW HUIS MAKEN", "go:create")}
        ${obButton("IK HEB EEN CODE", "go:join", "done-button secondary")}
      </div>
      ${backend.mode === "local" ? `<p class="ob-demo">DEMO-MODUS · alles blijft in deze browser</p>` : ""}`;
  }

  if (step === "create") {
    const tpl = draft.template || "studentenhuis";
    html = `${back("welcome")}
      <span class="eyebrow">STAP 1 VAN 2</span>
      <h1 class="ob-title">JE HUIS</h1>
      ${fieldHTML({ key: "house", type: "text", label: "Hoe heet jullie huis?", value: draft.houseName || "", max: 28, placeholder: "Bv. De Burcht" })}
      <div class="field"><span class="eyebrow">Startpakket</span>
        <div class="tpl-list">
          ${Object.entries(TEMPLATES).map(([k, t]) => `
            <button type="button" class="tpl ${k === tpl ? "on" : ""}" data-tpl="${k}">
              <span class="tpl-name">${esc(t.label)}</span>
              <span class="tpl-blurb">${esc(t.blurb)}</span>
              ${t.tasks.length ? `<span class="tpl-icons">${t.tasks.map(x => `<i>${ICONS[x.icon]}</i>`).join("")}</span>` : ""}
            </button>`).join("")}
        </div>
        <p class="set-hint">Alles is later aan te passen: klussen, regels en straf.</p>
      </div>
      <div class="ob-actions">${obButton("VERDER", "create-next")}</div>`;
  }

  if (step === "join") {
    html = `${back("welcome")}
      <span class="eyebrow">HUIS JOINEN</span>
      <h1 class="ob-title">CODE<br>INVOEREN</h1>
      <p class="ob-lead">Vraag de code aan iemand uit je huis. Staat in hun instellingen.</p>
      ${fieldHTML({ key: "code", type: "text", label: "Code", value: draft.code || "", max: 6, upper: true, placeholder: "ABC123" })}
      <p class="ob-error" id="ob-error"></p>
      <div class="ob-actions">${obButton("JOINEN", "join-go")}</div>`;
  }

  if (step === "who") {
    const members = sortedMembers();
    html = `
      <span class="eyebrow">${esc((data.household.name || "").toUpperCase())}</span>
      <h1 class="ob-title">WIE BEN<br>JIJ?</h1>
      <p class="ob-lead">Stond je er al in (bv. op een andere telefoon)? Kies jezelf. Anders ben je nieuw.</p>
      <div class="who-list">
        ${members.map(m => `<button type="button" class="who ${m.color}" data-ob="claim:${m.id}">
          <span class="set-avatar" style="${m.photo ? `background-image:url('${m.photo}')` : ""}">${m.photo ? "" : esc((m.name || "?").charAt(0).toUpperCase())}</span>
          <span class="who-name">${esc((m.name || "").toUpperCase())}</span></button>`).join("")}
      </div>
      <div class="ob-actions">${obButton("IK BEN NIEUW", "go:profile")}</div>`;
    draft.mode = "member";
  }

  if (step === "profile") {
    if (!draft.color) draft.color = freeColor(data && data.members);
    const creating = draft.mode === "create";
    html = `${creating ? back("create") : (data && data.members.length ? back("who") : "")}
      <span class="eyebrow">${creating ? "STAP 2 VAN 2" : "LAATSTE STAP"}</span>
      <h1 class="ob-title">EN JIJ?</h1>
      ${fieldHTML({ key: "photo", type: "photo", label: "FOTO (MAG OOK ZONDER)", value: draft.photo || "" })}
      ${fieldHTML({ key: "name", type: "text", label: "Je naam", value: draft.name || "", max: 14, placeholder: "Bv. Sam" })}
      ${fieldHTML({ key: "color", type: "colors", label: "Jouw kleur", value: draft.color })}
      <p class="ob-error" id="ob-error"></p>
      <div class="ob-actions">${obButton(creating ? "HUIS MAKEN" : "KLAAR", "profile-go")}</div>`;
  }

  onboardInner.innerHTML = html;
  replay(onboardInner, "enter");

  if (step === "welcome") setFace($("ob-face"), "smirk");
  wireFields(onboardInner, [
    { key: "code", type: "text", upper: true },
    { key: "photo", type: "photo" },
    { key: "color", type: "colors" }
  ].filter(f => onboardInner.querySelector(`#f-${f.key}`)));

  onboardInner.querySelectorAll(".tpl").forEach(b => b.addEventListener("click", () => {
    onboardInner.querySelectorAll(".tpl").forEach(x => x.classList.remove("on"));
    b.classList.add("on");
    draft.template = b.dataset.tpl;
  }));
  onboardInner.querySelectorAll("[data-ob]").forEach(b => b.addEventListener("click", () => onOnboardAction(b.dataset.ob, b)));
  onboardInner.querySelectorAll("input[type=text]").forEach(inp => inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { const go = onboardInner.querySelector(".ob-actions .done-button"); if (go) go.click(); }
  }));
}

function obError(text) { const el = $("ob-error"); if (el) { el.textContent = text; replay(el, "shake"); } }
function busy(btn, on, label) { btn.disabled = on; if (label) btn.textContent = label; }

async function onOnboardAction(action, btn) {
  const [cmd, arg] = action.split(":");
  const val = (k) => { const el = $(`f-${k}`); return el ? (el.dataset.v !== undefined && el.type !== "text" ? el.dataset.v : el.value) : ""; };

  if (cmd === "go") {
    if (arg === "create") draft = { mode: "create", template: draft.template };
    if (arg === "join") draft = { mode: "join", code: draft.code };
    renderOnboardStep(arg, {});
    return;
  }

  if (cmd === "create-next") {
    const name = val("house").trim();
    if (!name) { toast("Geef je huis eerst een naam"); return; }
    draft.houseName = name;
    draft.template = draft.template || "studentenhuis";
    renderOnboardStep("profile", {});
    return;
  }

  if (cmd === "join-go") {
    const code = val("code").trim().toUpperCase();
    if (code.length !== 6) { obError("Een code heeft 6 tekens."); return; }
    draft.code = code;
    busy(btn, true, "ZOEKEN...");
    try {
      const entry = await backend.lookupCode(code);
      if (!entry) { busy(btn, false, "JOINEN"); obError("Die code kennen we niet. Typfoutje?"); return; }
      busy(btn, true, "JOINEN...");
      const newHid = await backend.joinHousehold(code);
      startHousehold(newHid); // onData ziet dat je nog geen profiel hebt → 'wie ben jij?'
    } catch (e) {
      console.error(e);
      busy(btn, false, "JOINEN");
      obError("Joinen lukte niet. Check je internet en probeer het opnieuw.");
    }
    return;
  }

  if (cmd === "claim") {
    busy(btn, true);
    try { await backend.claimMember(hid, arg); }
    catch (e) { busy(btn, false); fail(e); }
    return; // onData pakt het verder op
  }

  if (cmd === "profile-go") {
    const name = val("name").trim();
    if (!name) { obError("Hoe heet je?"); return; }
    const colorEl = onboardInner.querySelector("#f-color .on");
    const member = { name, color: colorEl ? colorEl.dataset.v : draft.color, photo: ($("f-photo") && $("f-photo").dataset.v) || "" };
    draft.name = name; draft.color = member.color; draft.photo = member.photo;
    busy(btn, true, "BEZIG...");
    try {
      if (draft.mode === "create") {
        let code = randomCode();
        for (let i = 0; i < 5 && await backend.codeExists(code); i++) code = randomCode();
        const tpl = TEMPLATES[draft.template] || TEMPLATES.studentenhuis;
        const newHid = await backend.createHousehold({
          name: draft.houseName, code, startWeek: CURRENT_ISO,
          template: { tasks: tpl.tasks, rules: tpl.rules, strikesEnabled: tpl.strikesEnabled, strikePenalty: tpl.strikePenalty },
          member
        });
        welcomeNew = true;
        startHousehold(newHid);
      } else {
        await backend.addMember(hid, member);
      }
    } catch (e) {
      console.error(e);
      busy(btn, false, draft.mode === "create" ? "HUIS MAKEN" : "KLAAR");
      obError("Dat ging mis. Check je internet en probeer het opnieuw.");
    }
  }
}

// ============================================================
// OPSTARTEN
// ============================================================
let welcomeNew = false;
let firstRender = true;

function stopHousehold() {
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
  hid = null; data = null; me = null;
  cardsSignature = "";
  firstRender = true;
  closeDetail();
}

function startHousehold(newHid) {
  stopHousehold();
  hid = newHid;
  unsubscribe = backend.subscribe(hid, onData);
}

function onData(d, err) {
  if (!d) {
    // Huis bestaat niet meer, of je bent eruit gehaald
    stopHousehold();
    if (err) showLoadingOverlay("Kan geen verbinding maken. Check je internet.", true);
    else { showOnboarding("welcome"); toast("Je zit niet (meer) in dit huis"); }
    return;
  }
  data = d;
  me = data.members.find(m => (m.uids || []).includes(uid)) || null;

  if (!me) {
    // Wel lid van het huis, nog geen profiel → kiezen of aanmaken
    if (!onboardScreen.classList.contains("active") || !["who", "profile"].includes(onboardScreen.dataset.step)) {
      draft = { mode: "member" };
      showOnboarding(data.members.length ? "who" : "profile");
    }
    return;
  }

  if (onboardScreen.classList.contains("active")) hideOnboarding();
  hideLoadingOverlay();
  syncCurrentWeek();
  renderHome();
  if (currentMemberId) renderDetail(currentMemberId);
  refreshOpenSheets();

  if (firstRender) {
    firstRender = false;
    if (welcomeNew) {
      welcomeNew = false;
      setTimeout(() => { renderSettings(); openSheet($("settings-sheet")); toast("Huis staat! Nodig nu je huisgenoten uit"); }, 700);
    }
  }
}

(async function boot() {
  showLoadingOverlay("Verbinden...");
  try {
    uid = await backend.init();
    const urlCode = (new URLSearchParams(location.search).get("code") || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    const existing = await backend.getMyHousehold();
    if (urlCode) history.replaceState(null, "", location.pathname + (FORCE_DEMO ? "?demo" : ""));
    if (existing) {
      startHousehold(existing);
    } else if (urlCode) {
      draft = { mode: "join", code: urlCode };
      showOnboarding("join");
    } else {
      showOnboarding("welcome");
    }
  } catch (e) {
    console.error(e);
    showLoadingOverlay("Kan geen verbinding maken. Check je internet en firebase-config.js.", true);
  }
})();
