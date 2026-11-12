/* ============================================================
   BACKEND-LOCAL.JS — Demo-modus (zonder Firebase)
   ============================================================
   Bewaart alles in de browser (localStorage). Elk tabblad is een
   aparte "gebruiker" (sessionStorage), zodat je in twee tabbladen
   kunt testen hoe joinen met een code werkt. Tabbladen houden
   elkaar live bij via het 'storage'-event.
   Zelfde functies als backend-firebase.js.
   ============================================================ */

function createLocalBackend() {
  const KEY = "huistaken-demo-db";
  const rid = () => Math.random().toString(36).slice(2, 12);

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || { households: {}, codes: {}, users: {} }; }
    catch (e) { return { households: {}, codes: {}, users: {} }; }
  }
  function save(db) {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* vol of geblokkeerd */ }
    notify();
  }

  let uid = null;
  const listeners = new Set();
  function notify() { listeners.forEach(fn => fn()); }
  window.addEventListener("storage", (e) => { if (e.key === KEY) notify(); });

  function house(db, hid) {
    const h = db.households[hid];
    if (!h) throw new Error("Huis niet gevonden");
    return h;
  }

  return {
    mode: "local",

    async init() {
      try { uid = sessionStorage.getItem("huistaken-demo-uid"); } catch (e) {}
      if (!uid) {
        uid = "u_" + rid();
        try { sessionStorage.setItem("huistaken-demo-uid", uid); } catch (e) {}
      }
      return uid;
    },
    get uid() { return uid; },

    async getMyHousehold() {
      const db = load();
      const hid = db.users[uid] && db.users[uid].householdId;
      return hid && db.households[hid] && db.households[hid].doc.memberIds.includes(uid) ? hid : null;
    },

    async codeExists(code) { return !!load().codes[code]; },

    async createHousehold({ name, code, startWeek, template, member }) {
      const db = load();
      const hid = "h_" + rid();
      const tasks = {};
      template.tasks.forEach((t, i) => { const id = "t_" + rid(); tasks[id] = { ...t, id, order: i }; });
      const mid = "m_" + rid();
      db.households[hid] = {
        doc: {
          name, code, startWeek, createdAt: Date.now(), memberIds: [uid],
          rules: template.rules.slice(), strikesEnabled: template.strikesEnabled, strikePenalty: template.strikePenalty
        },
        members: { [mid]: { ...member, id: mid, uids: [uid], joinedAt: Date.now() } },
        tasks, weeks: {}, completions: {}
      };
      db.codes[code] = { householdId: hid, householdName: name };
      db.users[uid] = { householdId: hid };
      save(db);
      return hid;
    },

    async lookupCode(code) {
      return load().codes[code] || null;
    },

    async joinHousehold(code) {
      const db = load();
      const entry = db.codes[code];
      if (!entry) throw new Error("Code bestaat niet");
      const h = house(db, entry.householdId);
      if (!h.doc.memberIds.includes(uid)) h.doc.memberIds.push(uid);
      db.users[uid] = { householdId: entry.householdId };
      save(db);
      return entry.householdId;
    },

    subscribe(hid, cb) {
      const emit = () => {
        const db = load();
        const h = db.households[hid];
        if (!h || !h.doc.memberIds.includes(uid)) { cb(null); return; }
        cb({
          household: { id: hid, ...h.doc },
          members: Object.values(h.members),
          tasks: Object.values(h.tasks),
          weeks: { ...h.weeks },
          completions: { ...h.completions }
        });
      };
      listeners.add(emit);
      setTimeout(emit, 250); // kleine vertraging, zoals een echte verbinding
      return () => listeners.delete(emit);
    },

    async addMember(hid, member) {
      const db = load();
      const mid = "m_" + rid();
      house(db, hid).members[mid] = { ...member, id: mid, uids: [uid], joinedAt: Date.now() };
      save(db);
      return mid;
    },
    async claimMember(hid, mid) {
      const db = load();
      const m = house(db, hid).members[mid];
      if (!m.uids.includes(uid)) m.uids.push(uid);
      save(db);
    },
    async updateMember(hid, mid, patch) {
      const db = load();
      Object.assign(house(db, hid).members[mid], patch);
      save(db);
    },
    async removeMember(hid, mid) {
      const db = load();
      const h = house(db, hid);
      const m = h.members[mid];
      if (!m) return;
      h.doc.memberIds = h.doc.memberIds.filter(u => !m.uids.includes(u));
      delete h.members[mid];
      save(db);
    },
    async updateHousehold(hid, patch) {
      const db = load();
      Object.assign(house(db, hid).doc, patch);
      save(db);
    },
    async saveTask(hid, task) {
      const db = load();
      const h = house(db, hid);
      const id = task.id || "t_" + rid();
      h.tasks[id] = { ...(h.tasks[id] || {}), ...task, id };
      save(db);
      return id;
    },
    async deleteTask(hid, tid) {
      const db = load();
      delete house(db, hid).tasks[tid];
      save(db);
    },
    async saveWeek(hid, weekIso, assignments) {
      const db = load();
      house(db, hid).weeks[weekIso] = { assignments };
      save(db);
    },
    async setCompletion(hid, weekIso, taskId, memberId) {
      const db = load();
      house(db, hid).completions[`${weekIso}_${taskId}`] = { week: weekIso, taskId, memberId, completedAt: new Date().toISOString() };
      save(db);
    },
    async leaveHousehold(hid, mid) {
      const db = load();
      const h = house(db, hid);
      if (mid && h.members[mid]) {
        const m = h.members[mid];
        m.uids = m.uids.filter(u => u !== uid);
        if (!m.uids.length) delete h.members[mid];
      }
      h.doc.memberIds = h.doc.memberIds.filter(u => u !== uid);
      delete db.users[uid];
      save(db);
    }
  };
}
