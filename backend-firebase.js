/* ============================================================
   BACKEND-FIREBASE.JS — Echte, gedeelde opslag (Firestore)
   ============================================================
   Datamodel:
   users/{uid}                         { householdId }
   inviteCodes/{CODE}                  { householdId, householdName }
   households/{hid}                    { name, code, startWeek, memberIds[], rules[],
                                         strikesEnabled, strikePenalty, createdAt }
   households/{hid}/members/{mid}      { name, color, photo, uids[], joinedAt }
   households/{hid}/tasks/{tid}        { name, icon, instructions, order }
   households/{hid}/weeks/{YYYY-MM-DD} { week, assignments: { taskId: memberId } }
   households/{hid}/completions/{week_taskId} { week, taskId, memberId, completedAt }

   Inloggen gebeurt anoniem (geen account nodig). Toegang tot een
   huis loopt via memberIds — zie firestore.rules.
   ============================================================ */

function createFirebaseBackend(config) {
  firebase.initializeApp(config);
  const auth = firebase.auth();
  const db = firebase.firestore();
  const FV = firebase.firestore.FieldValue;
  let uid = null;

  const H = (hid) => db.collection("households").doc(hid);

  // Hoeveel weken terug we inladen (genoeg voor de kruisjes)
  const HISTORY_WEEKS = 12;

  return {
    mode: "firebase",

    init() {
      return new Promise((resolve, reject) => {
        const off = auth.onAuthStateChanged((user) => {
          if (user) { off(); uid = user.uid; resolve(uid); }
        });
        auth.signInAnonymously().catch(reject);
      });
    },
    get uid() { return uid; },

    async getMyHousehold() {
      const u = await db.collection("users").doc(uid).get();
      const hid = u.exists ? u.data().householdId : null;
      if (!hid) return null;
      try {
        const h = await H(hid).get();
        return h.exists && (h.data().memberIds || []).includes(uid) ? hid : null;
      } catch (e) {
        return null; // geen toegang meer (bv. verwijderd uit het huis)
      }
    },

    async codeExists(code) {
      return (await db.collection("inviteCodes").doc(code).get()).exists;
    },

    async createHousehold({ name, code, startWeek, template, member }) {
      const href = db.collection("households").doc();
      const batch = db.batch();
      batch.set(href, {
        name, code, startWeek, createdAt: Date.now(), memberIds: [uid],
        rules: template.rules, strikesEnabled: template.strikesEnabled, strikePenalty: template.strikePenalty
      });
      batch.set(db.collection("inviteCodes").doc(code), { householdId: href.id, householdName: name });
      template.tasks.forEach((t, i) => {
        batch.set(href.collection("tasks").doc(), { name: t.name, icon: t.icon, instructions: t.instructions, order: i });
      });
      batch.set(href.collection("members").doc(), { ...member, uids: [uid], joinedAt: Date.now() });
      batch.set(db.collection("users").doc(uid), { householdId: href.id });
      await batch.commit();
      return href.id;
    },

    async lookupCode(code) {
      const snap = await db.collection("inviteCodes").doc(code).get();
      return snap.exists ? snap.data() : null;
    },

    async joinHousehold(code) {
      const entry = await this.lookupCode(code);
      if (!entry) throw new Error("Code bestaat niet");
      await H(entry.householdId).update({ memberIds: FV.arrayUnion(uid), joinCode: code });
      await db.collection("users").doc(uid).set({ householdId: entry.householdId });
      return entry.householdId;
    },

    subscribe(hid, cb) {
      const state = { household: null, members: null, tasks: null, weeks: null, completions: null };
      const emit = () => {
        if (Object.values(state).some(v => v === null)) return; // wacht op eerste lading van alles
        cb({ ...state });
      };
      const fail = (err) => { console.error(err); cb(null, err); };

      const from = new Date();
      from.setDate(from.getDate() - HISTORY_WEEKS * 7);
      const fromIso = from.toISOString().slice(0, 10);

      const offs = [
        H(hid).onSnapshot(s => {
          if (!s.exists) { cb(null); return; }
          state.household = { id: s.id, ...s.data() }; emit();
        }, fail),
        H(hid).collection("members").onSnapshot(s => {
          state.members = s.docs.map(d => ({ id: d.id, ...d.data() })); emit();
        }, fail),
        H(hid).collection("tasks").onSnapshot(s => {
          state.tasks = s.docs.map(d => ({ id: d.id, ...d.data() })); emit();
        }, fail),
        H(hid).collection("weeks").where("week", ">=", fromIso).onSnapshot(s => {
          const w = {}; s.docs.forEach(d => { w[d.id] = d.data(); });
          state.weeks = w; emit();
        }, fail),
        H(hid).collection("completions").where("week", ">=", fromIso).onSnapshot(s => {
          const c = {}; s.docs.forEach(d => { c[d.id] = d.data(); });
          state.completions = c; emit();
        }, fail)
      ];
      return () => offs.forEach(off => off());
    },

    async addMember(hid, member) {
      const ref = H(hid).collection("members").doc();
      await ref.set({ ...member, uids: [uid], joinedAt: Date.now() });
      return ref.id;
    },
    claimMember(hid, mid) {
      return H(hid).collection("members").doc(mid).update({ uids: FV.arrayUnion(uid) });
    },
    updateMember(hid, mid, patch) {
      return H(hid).collection("members").doc(mid).update(patch);
    },
    async removeMember(hid, mid) {
      const ref = H(hid).collection("members").doc(mid);
      const m = await ref.get();
      if (!m.exists) return;
      const batch = db.batch();
      const uids = m.data().uids || [];
      if (uids.length) batch.update(H(hid), { memberIds: FV.arrayRemove(...uids) });
      batch.delete(ref);
      await batch.commit();
    },
    updateHousehold(hid, patch) {
      return H(hid).update(patch);
    },
    async saveTask(hid, task) {
      const { id, ...data } = task;
      const ref = id ? H(hid).collection("tasks").doc(id) : H(hid).collection("tasks").doc();
      await ref.set(data, { merge: true });
      return ref.id;
    },
    deleteTask(hid, tid) {
      return H(hid).collection("tasks").doc(tid).delete();
    },
    saveWeek(hid, weekIso, assignments) {
      return H(hid).collection("weeks").doc(weekIso).set({ week: weekIso, assignments });
    },
    setCompletion(hid, weekIso, taskId, memberId) {
      return H(hid).collection("completions").doc(`${weekIso}_${taskId}`).set({
        week: weekIso, taskId, memberId, completedAt: new Date().toISOString()
      });
    },
    async leaveHousehold(hid, mid) {
      // Eerst je profiel opruimen (dat mag alleen zolang je nog lid bent)…
      if (mid) {
        const ref = H(hid).collection("members").doc(mid);
        const m = await ref.get();
        if (m.exists) {
          const rest = (m.data().uids || []).filter(u => u !== uid);
          if (rest.length) await ref.update({ uids: rest });
          else await ref.delete();
        }
      }
      // …en daarna jezelf uit het huis halen
      const batch = db.batch();
      batch.update(H(hid), { memberIds: FV.arrayRemove(uid) });
      batch.delete(db.collection("users").doc(uid));
      await batch.commit();
    }
  };
}
