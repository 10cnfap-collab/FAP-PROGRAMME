/**
 * API — Plateforme de gestion du programme scientifique (FAP)
 * Fonction serverless Vercel. Toutes les règles métier viennent de lib/programme.js.
 *
 * POST /api  { fn, args, token }
 * GET  /api  → état de la configuration (base, mot de passe)
 *
 * Variables d'environnement :
 *   ADMIN_PASSWORD   mot de passe de l'administration (obligatoire)
 *   SESSION_SECRET   clé de signature des sessions (recommandé)
 *   KV_REST_API_URL / KV_REST_API_TOKEN  (ou UPSTASH_REDIS_REST_URL / _TOKEN) — ajoutées par Vercel › Storage
 *   PROPOSAL_CODE    code d'accès facultatif pour le formulaire des présidents de section
 *   DB_PREFIX        préfixe des clés (défaut : prog10). Permet de partager la base Upstash avec la plateforme des résumés.
 */
const crypto = require('crypto');
const { Redis } = require('@upstash/redis');
const PROG = require('../lib/programme.js');

const NS = process.env.DB_PREFIX || 'prog10';
const K = { congress: `${NS}:congress`, sessions: `${NS}:sessions`, persons: `${NS}:persons`, proposals: `${NS}:proposals`, audit: `${NS}:audit`, seq: `${NS}:seq:` };
class UserError extends Error {}
const fail = m => { throw new UserError(m); };

let _r;
function db() {
  if (_r) return _r;
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) fail('Base de données non configurée : connectez Upstash Redis au projet (Vercel › Storage), puis redéployez.');
  _r = new Redis({ url, token, automaticDeserialization: false });
  return _r;
}
const parse = v => { if (v == null) return null; if (typeof v === 'object') return v; try { return JSON.parse(v); } catch (e) { return null; } };
const hAll = async k => { const h = await db().hgetall(k); return h ? Object.values(h).map(parse).filter(Boolean) : []; };

/* Adaptateur de stockage Redis pour le service partagé */
const store = {
  getCongress: async () => parse(await db().get(K.congress)),
  setCongress: async c => { await db().set(K.congress, JSON.stringify(c)); },
  sessions: () => hAll(K.sessions),
  getSession: async id => parse(await db().hget(K.sessions, id)),
  putSession: async s => { await db().hset(K.sessions, { [s.id]: JSON.stringify(s) }); },
  delSession: async id => { await db().hdel(K.sessions, id); },
  persons: () => hAll(K.persons),
  getPerson: async id => parse(await db().hget(K.persons, id)),
  putPerson: async p => { await db().hset(K.persons, { [p.id]: JSON.stringify(p) }); },
  delPerson: async id => { await db().hdel(K.persons, id); },
  proposals: () => hAll(K.proposals),
  getProposal: async id => parse(await db().hget(K.proposals, id)),
  putProposal: async p => { await db().hset(K.proposals, { [p.id]: JSON.stringify(p) }); },
  delProposal: async id => { await db().hdel(K.proposals, id); },
  audit: async n => ((await db().lrange(K.audit, 0, (n || 300) - 1)) || []).map(parse).filter(Boolean),
  addAudit: async e => { await db().lpush(K.audit, JSON.stringify(e)); await db().ltrim(K.audit, 0, 4999); },
  nextId: async kind => kind + String(await db().incr(K.seq + kind)).padStart(3, '0'),
  setSeq: async (s, p) => { await db().set(K.seq + 'S', String(s)); await db().set(K.seq + 'P', String(p)); }
};
const svc = PROG.createService(store);

/* Authentification : jeton signé (8 h) portant le nom de l'administrateur, utilisé dans le journal. */
const secret = () => process.env.SESSION_SECRET || ('prog:' + (process.env.ADMIN_PASSWORD || ''));
const sign = p => crypto.createHmac('sha256', secret()).update(p).digest('base64url');
function makeToken(name) { const p = Buffer.from(JSON.stringify({ name, exp: Date.now() + 8 * 3600e3 })).toString('base64url'); return p + '.' + sign(p); }
function auth(token) {
  const [p, s] = String(token || '').split('.');
  if (!p || !s) fail('Connexion requise.');
  const a = Buffer.from(sign(p)), b = Buffer.from(s);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) fail('Session expirée. Reconnectez-vous.');
  const o = JSON.parse(Buffer.from(p, 'base64url').toString());
  if (Date.now() > o.exp) fail('Session expirée. Reconnectez-vous.');
  return o.name || 'Administrateur';
}
async function rateLimit(ip, bucket, max, sec) {
  const k = `${NS}:rl:${bucket}:${ip}:${Math.floor(Date.now() / 1000 / sec)}`;
  const n = await db().incr(k); if (n === 1) await db().expire(k, sec + 5);
  if (n > max) fail('Trop de tentatives. Patientez quelques minutes.');
}

const PUBLIC = {
  getPublic: async () => { const d = await svc.getPublic(); d.congress.codeRequired = !!process.env.PROPOSAL_CODE; return d; },
  submitProposal: async (ctx, input, code) => {
    await rateLimit(ctx.ip, 'prop', 20, 3600);
    const real = process.env.PROPOSAL_CODE;
    if (real) { const h = x => crypto.createHash('sha256').update(String(x || '').trim()).digest(); if (!crypto.timingSafeEqual(h(code), h(real))) fail('Code d\'accès incorrect. Il vous a été communiqué par la FAP.'); }
    return svc.submitProposal(input);
  },
  login: async (ctx, pw, name) => {
    const real = process.env.ADMIN_PASSWORD;
    if (!real) fail('Mot de passe administrateur non configuré (variable ADMIN_PASSWORD).');
    await rateLimit(ctx.ip, 'login', 10, 900);
    const h = x => crypto.createHash('sha256').update(String(x)).digest();
    if (!crypto.timingSafeEqual(h(pw), h(real))) fail('Mot de passe incorrect.');
    const n = String(name || '').trim().slice(0, 80) || 'Administrateur';
    return { token: makeToken(n), name: n };
  }
};
const ADMIN = {
  getState: (a) => svc.getState(300),
  saveCongress: (a, c) => svc.saveCongress(a, c),
  saveSession: (a, s, v) => svc.saveSession(a, s, v),
  importSessions: (a, l) => svc.importSessions(a, l),
  deleteSession: (a, id) => svc.deleteSession(a, id),
  setStatus: (a, id, st) => svc.setStatus(a, id, st),
  setVisible: (a, id, v) => svc.setVisible(a, id, v),
  publishMany: (a, ids) => svc.publishMany(a, ids),
  savePerson: (a, p) => svc.savePerson(a, p),
  deletePerson: (a, id) => svc.deletePerson(a, id),
  mergePersons: (a, k, d) => svc.mergePersons(a, k, d),
  swapSessions: (a, x, y, v, f) => svc.swapSessions(a, x, y, v, f),
  renumber: (a) => svc.renumber(a),
  setProposalStatus: (a, id, st, note) => svc.setProposalStatus(a, id, st, note),
  deleteProposal: (a, id) => svc.deleteProposal(a, id),
  importProposal: (a, id, target) => svc.importProposal(a, id, target),
  seedDemo: (a) => svc.seedDemo(a),
  clearProgramme: (a) => svc.clearProgramme(a)
};

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') return res.status(200).json({ ok: true, service: 'API programme scientifique FAP', db: !!(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL), admin: !!process.env.ADMIN_PASSWORD });
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Méthode non autorisée.' });
  try {
    let b = req.body; if (typeof b === 'string') b = JSON.parse(b || '{}'); if (Buffer.isBuffer(b)) b = JSON.parse(b.toString('utf8') || '{}');
    const args = Array.isArray(b.args) ? b.args : [];
    const ctx = { ip: String(req.headers['x-forwarded-for'] || 'inconnu').split(',')[0].trim() };
    let data;
    if (PUBLIC[b.fn]) data = b.fn === 'getPublic' ? await PUBLIC.getPublic() : await PUBLIC[b.fn](ctx, ...args);
    else if (ADMIN[b.fn]) { const actor = auth(b.token); data = await ADMIN[b.fn](actor, ...args); }
    else fail('Action inconnue.');
    return res.status(200).json({ ok: true, data });
  } catch (e) {
    // Les règles métier lèvent des Error au message déjà rédigé pour l'utilisateur ; les erreurs de programmation restent génériques.
    const known = e instanceof UserError || !(e instanceof TypeError || e instanceof ReferenceError || e instanceof SyntaxError || e instanceof RangeError);
    if (!known) console.error(e);
    return res.status(200).json({ ok: false, error: known ? e.message : 'Erreur serveur : ' + (e.message || e) });
  }
};
