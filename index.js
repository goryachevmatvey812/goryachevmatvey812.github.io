/* Орден: серверная часть для push-уведомлений при закрытом сайте.
   Работает на Firebase Cloud Functions (нужен тариф Blaze, небольшой объём бесплатный). */
const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');

admin.initializeApp();
setGlobalOptions({ region: 'europe-west1', maxInstances: 5 });
const db = admin.firestore();
const OWNER_EMAIL = 'goryachevmatvey812@gmail.com';

const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

async function nm(uid) {
  try { const d = await db.collection('members').doc(uid).get(); return (d.exists && d.data().name) || 'Участник'; }
  catch (e) { return 'Участник'; }
}

async function tokensOf(uids) {
  const out = [];
  for (const ch of chunk(uids, 10)) {
    const s = await db.collection('tokens').where(admin.firestore.FieldPath.documentId(), 'in', ch).get();
    s.forEach(d => { const x = d.data(); if (x.on !== false) (x.list || []).forEach(t => out.push({ t, uid: d.id })); });
  }
  return out;
}

async function push(uids, title, body, url, tag, high) {
  uids = [...new Set(uids)].filter(Boolean);
  if (!uids.length) return;
  const toks = await tokensOf(uids);
  if (!toks.length) return;
  const res = await admin.messaging().sendEachForMulticast({
    tokens: toks.map(x => x.t),
    data: { title, body: String(body || '').slice(0, 140), url: url || './', tag: tag || 'orden' },
    webpush: { headers: { Urgency: high ? 'high' : 'normal', TTL: high ? '60' : '3600' } }
  });
  const bad = [];
  res.responses.forEach((r, i) => {
    if (!r.success && r.error && /not-registered|invalid-registration/.test(r.error.code)) bad.push(toks[i]);
  });
  for (const b of bad) {
    await db.collection('tokens').doc(b.uid).update({ list: admin.firestore.FieldValue.arrayRemove(b.t) }).catch(() => {});
  }
}

// @упоминания в общем чате (люди, роли, @все)
exports.onChat = onDocumentCreated('chat/{id}', async ev => {
  const d = ev.data && ev.data.data();
  if (!d || !d.men || !d.men.length) return;
  const name = await nm(d.by);
  let to = [];
  for (const m of d.men) {
    if (m === '*') { const s = await db.collection('members').limit(500).get(); s.forEach(x => to.push(x.id)); }
    else if (String(m).startsWith('r:')) { const s = await db.collection('roles').where('rids', 'array-contains', String(m).slice(2)).get(); s.forEach(x => to.push(x.id)); }
    else to.push(m);
  }
  to = to.filter(u => u !== d.by);
  await push(to, '🔔 ' + name, d.x || '🎤', './#chat', 'men-' + d.by);
});

// личные сообщения
exports.onDm = onDocumentCreated('dms/{pair}/msgs/{id}', async ev => {
  const d = ev.data && ev.data.data();
  if (!d || d.sys) return;
  const [a, b] = ev.params.pair.split('_');
  const to = d.by === a ? b : a;
  const name = await nm(d.by);
  await push([to], '✉ ' + name, d.x || '🎤', './#chat', 'dm-' + d.by);
});

// входящий звонок (когда в документ звонка добавлен offer)
exports.onCall = onDocumentUpdated('calls/{id}', async ev => {
  const before = ev.data.before.data(), after = ev.data.after.data();
  if (!after || before.offer || !after.offer || after.state !== 'ringing') return;
  const name = await nm(after.from);
  await push([after.to], '📞 Входящий звонок', name, './#chat', 'call', true);
});

// новая жалоба: владелец и роли с правом «Читать жалобы»
exports.onReport = onDocumentCreated('reports/{id}', async ev => {
  const d = ev.data && ev.data.data();
  if (!d) return;
  const to = [];
  try { const u = await admin.auth().getUserByEmail(OWNER_EMAIL); to.push(u.uid); } catch (e) {}
  const s = await db.collection('roles').where('perms.reports', '==', true).get();
  s.forEach(x => to.push(x.id));
  const who = await nm(d.by);
  const target = d.target ? await nm(d.target) : '';
  await push(to.filter(u => u !== d.by), '🚩 Жалоба', who + (target ? ' → ' + target : ''), './#rep', 'rep');
});
