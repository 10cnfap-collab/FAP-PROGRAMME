/**
 * FAP — Plateforme de gestion du programme scientifique
 * Noyau partagé (navigateur + serveur Vercel) : modèle, règles, conflits, publication.
 *
 * Le même code tourne :
 *   - dans le navigateur (mode démo, stockage local) via window.PROG ;
 *   - sur le serveur (api/index.js) via require('../lib/programme.js').
 * Les règles de publication et de conflit sont donc identiques partout,
 * et c'est toujours le serveur qui fait foi en production.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PROG = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ======================= Référentiels ======================= */
  const STATUS = {
    brouillon:      { label: 'Brouillon',                  order: 0 },
    en_preparation: { label: 'En préparation',             order: 1 },
    a_valider:      { label: 'À valider',                  order: 2 },
    valide:         { label: 'Validé',                     order: 3 },
    publie:         { label: 'Publié',                     order: 4 },
    modifie:        { label: 'Modifié après publication',  order: 5 },
    annule:         { label: 'Annulé',                     order: 6 },
    archive:        { label: 'Archivé',                    order: 7 }
  };
  const TYPES = {
    lectures:  { label: 'Session scientifique',  short: 'Conférences', color: '#2855A6' },
    panel:     { label: 'Panel scientifique',    short: 'Panel',       color: '#6B3FA0' },
    workshop:  { label: 'Atelier',               short: 'Atelier',     color: '#00A6A6' },
    symposium: { label: 'Symposium sponsorisé',  short: 'Symposium',   color: '#C9A45C' },
    break:     { label: 'Pause',                 short: 'Pause',       color: '#8A94A6' },
    ceremony:  { label: 'Cérémonie / événement', short: 'Cérémonie',   color: '#142B49' }
  };
  const CEREMONY_KINDS = ['Cérémonie officielle', 'Allocution d\'ouverture', 'Inauguration officielle', 'Allocutions institutionnelles',
    'Remise de distinctions', 'Prix scientifiques', 'Présentation institutionnelle', 'Séance plénière spéciale', 'Pause networking', 'Cérémonie de clôture'];
  const SPONSOR_STATUS = { disponible: 'Disponible', reserve: 'Réservé', attribue: 'Attribué' };
  const TITLES = ['Pr', 'Dr', 'M.', 'Mme'];
  const LIVE = ['publie', 'modifie'];
  const INACTIVE = ['annule', 'archive'];

  /* ======================= Temps ======================= */
  const toMin = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '')); return m ? (+m[1]) * 60 + (+m[2]) : NaN; };
  const fromMin = n => String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
  const dur = s => toMin(s.end) - toMin(s.start);
  const overlap = (a, b) => a.day === b.day && toMin(a.start) < toMin(b.end) && toMin(b.start) < toMin(a.end);
  /** Date et heure actuelles dans le fuseau du congrès, indépendamment du fuseau de l'appareil. */
  function nowIn(tz) {
    const p = new Intl.DateTimeFormat('fr-CA', { timeZone: tz || 'Africa/Algiers', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date()).reduce((o, x) => (o[x.type] = x.value, o), {});
    return { day: `${p.year}-${p.month}-${p.day}`, min: (+p.hour) * 60 + (+p.minute) };
  }

  /* ======================= Configuration par défaut ======================= */
  const THEMES = ['Pharmacie clinique et hospitalière', 'Officine et soins pharmaceutiques', 'Industrie pharmaceutique et biotechnologies',
    'Réglementation et économie de la santé', 'Biologie clinique et toxicologie', 'Pharmacologie et pharmacovigilance',
    'Sciences pharmaceutiques', 'Santé publique et prévention', 'Dermopharmacie et cosmétologie', 'Santé numérique et intelligence artificielle'];
  const TEMPLATE = [
    { start: '09:00', end: '10:30', kind: 'session',   label: 'Session scientifique 1' },
    { start: '10:30', end: '10:50', kind: 'symposium', label: 'Symposium sponsor 1' },
    { start: '10:50', end: '11:20', kind: 'break',     label: 'Pause-café' },
    { start: '11:20', end: '12:50', kind: 'session',   label: 'Session scientifique 2' },
    { start: '12:50', end: '13:10', kind: 'symposium', label: 'Symposium sponsor 2' },
    { start: '13:10', end: '14:10', kind: 'break',     label: 'Déjeuner' },
    { start: '14:10', end: '15:40', kind: 'session',   label: 'Session scientifique 3' },
    { start: '15:40', end: '16:00', kind: 'symposium', label: 'Symposium sponsor 3' },
    { start: '16:00', end: '16:30', kind: 'break',     label: 'Pause-café' },
    { start: '16:30', end: '18:00', kind: 'session',   label: 'Session scientifique 4' },
    { start: '18:00', end: '18:20', kind: 'symposium', label: 'Symposium sponsor 4 (optionnel)' }
  ];
  function defaultCongress() {
    return {
      id: 'fap10', version: 1,
      name: '10e Congrès de la Fédération Algérienne de Pharmacie', short: '10e Congrès FAP',
      city: 'Alger', venue: 'Centre International de Conférences', country: 'Algérie', timezone: 'Africa/Algiers', locale: 'fr',
      days: [{ date: '2026-12-22', label: 'Jour 1' }, { date: '2026-12-23', label: 'Jour 2' }],
      rooms: [
        { id: 'R1', name: 'Auditorium Djamila', main: true },
        { id: 'R2', name: 'Salle A' }, { id: 'R3', name: 'Salle B' }, { id: 'R4', name: 'Salle C' }, { id: 'R5', name: 'Salle D' }
      ],
      dayStart: '08:30', dayEnd: '20:30',
      blocks: [{ id: 'BL1', day: '2026-12-22', from: '16:30', to: '20:30', rooms: ['R2', 'R3', 'R4', 'R5'],
        label: 'Séquence plénière et cérémonie d\'ouverture — Auditorium Djamila' }],
      template: TEMPLATE.map(x => Object.assign({}, x)),
      themes: THEMES.slice(),
      proposalsOpen: true, sections: []
    };
  }

  /* ======================= Personnes et typographie ======================= */
  const PARTICLES = new Set(['de', 'du', 'des', 'd', 'la', 'le', 'les', 'et', 'en', 'à', 'au', 'aux', 'l']);
  const ACRONYMS = new Set(['CHU', 'EHS', 'EPH', 'EPSP', 'USTHB', 'USS', 'CNRS', 'INSP', 'IPA', 'LNCPP', 'ANPP', 'CAP', 'CNT', 'FAP', 'SATOX', 'ASCO', 'ASPEC', 'OMS', 'PCH', 'UFAS', 'UMMTO', 'UMBB', 'CRBT']);
  const ACCENTS = { UNIVERSITE: 'Université', FACULTE: 'Faculté', HOPITAL: 'Hôpital', SANTE: 'Santé', ECOLE: 'École', CENTRE: 'Centre',
    PHARMACIE: 'Pharmacie', MEDECINE: 'Médecine', SCIENCES: 'Sciences', LABORATOIRE: 'Laboratoire', INSTITUT: 'Institut', SERVICE: 'Service',
    TOXICOLOGIE: 'Toxicologie', SPECIALISE: 'spécialisé', ETABLISSEMENT: 'Établissement', PUBLIC: 'public', HOSPITALIER: 'hospitalier' };
  const cap = w => w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w;
  const capName = w => w.split('-').map(p => p.split('\'').map((q, i, arr) => (i < arr.length - 1 && q.length <= 2) ? q.toLowerCase() : cap(q)).join('\'')).join('-');
  /** Propose une forme normalisée d'un nom : « dr MOHAMED benali » → « Dr Mohamed Benali ». Ne modifie jamais sans confirmation. */
  function suggestName(raw) {
    let s = String(raw || '').replace(/\s+/g, ' ').replace(/\s*([,;])\s*/g, '$1 ').trim().replace(/[.,;]+$/, '');
    if (!s) return '';
    return s.split(' ').map((w, i) => {
      const l = w.toLowerCase().replace(/\.$/, '');
      if (i === 0 && ['dr', 'docteur'].includes(l)) return 'Dr';
      if (i === 0 && ['pr', 'prof', 'professeur'].includes(l)) return 'Pr';
      if (i > 0 && PARTICLES.has(l)) return l;
      return capName(w);
    }).join(' ');
  }
  /** Propose une forme normalisée d'un établissement, en préservant les sigles connus. */
  function suggestInstitution(raw) {
    let s = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!s) return '';
    s = s.replace(/\b([DL])\s+(?=[AEIOUYÉH])/gi, (m, l) => l + '\'');
    return s.split(' ').map((w, i) => {
      const bare = w.replace(/[(),.]/g, '');
      if (ACRONYMS.has(bare.toUpperCase()) && bare === bare.toUpperCase()) return w;
      if (/^[dl]'/i.test(w)) return w.charAt(0).toLowerCase() + '\'' + cap(w.slice(2));
      const up = bare.toUpperCase();
      if (ACCENTS[up]) return w.replace(bare, i === 0 ? cap(ACCENTS[up]) : ACCENTS[up]);
      if (i > 0 && PARTICLES.has(bare.toLowerCase())) return w.toLowerCase();
      if (bare === bare.toUpperCase() && bare.length <= 4 && /[A-Z]/.test(bare)) return w;
      return w === w.toUpperCase() || w === w.toLowerCase() ? capName(w) : w;
    }).join(' ');
  }
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
  const displayName = p => p ? [p.title, p.firstName, p.lastName].filter(Boolean).join(' ') : '';
  /** Doublons probables : même e-mail, ou même prénom + nom (insensible aux accents et à la casse). */
  function duplicates(persons) {
    const out = [], seen = {};
    persons.forEach(p => {
      const keys = [];
      if (p.email) keys.push('e:' + p.email.trim().toLowerCase());
      if (p.firstName && p.lastName) keys.push('n:' + norm(p.firstName) + '|' + norm(p.lastName));
      keys.forEach(k => { if (seen[k] && seen[k] !== p.id) out.push({ a: seen[k], b: p.id, reason: k[0] === 'e' ? 'Même adresse e-mail' : 'Même prénom et nom' }); else seen[k] = p.id; });
    });
    const uniq = {}; return out.filter(d => { const k = [d.a, d.b].sort().join('|'); return uniq[k] ? false : (uniq[k] = true); });
  }

  /* ======================= Sessions ======================= */
  const ROLE_FIELDS = { moderators: 'Modérateur', panelists: 'Panéliste', facilitators: 'Animateur', instructors: 'Formateur', speakers: 'Intervenant' };
  /** Toutes les personnes impliquées dans une session, avec leur rôle. */
  function peopleOf(s) {
    const out = [];
    Object.keys(ROLE_FIELDS).forEach(f => (s[f] || []).forEach(id => id && out.push({ id, role: ROLE_FIELDS[f] })));
    (s.lectures || []).forEach(l => l.speakerId && out.push({ id: l.speakerId, role: 'Orateur', lecture: l.title }));
    if (s.sponsor && s.sponsor.speakerId) out.push({ id: s.sponsor.speakerId, role: 'Orateur (symposium)' });
    return out;
  }
  function blankSession(type, day, roomId, start, end) {
    const s = { id: '', type, title: '', subtitle: '', description: '', theme: '', day, roomId: roomId || null, allRooms: false,
      start, end, status: 'brouillon', visible: true, moderators: [], notes: '', version: 0 };
    if (type === 'lectures') { s.lectures = [1, 2, 3].map(i => ({ id: 'L' + i, title: '', speakerId: '', duration: 20, abstractRef: '', visible: true })); s.discussion = 30; }
    if (type === 'panel') { s.panelists = []; }
    if (type === 'workshop') { s.facilitators = []; s.instructors = []; s.objectives = ''; s.audience = ''; s.capacity = ''; s.registration = false; s.logistics = ''; }
    if (type === 'symposium') { s.sponsor = { company: '', speakerId: '', presentationTitle: '', commercial: 'disponible', logo: '', detailsVisible: true }; }
    if (type === 'ceremony') { s.kind = 'Cérémonie officielle'; s.speakers = []; }
    if (type === 'break') { s.allRooms = true; s.roomId = null; }
    return s;
  }

  /* ======================= Analyse : conflits et complétude ======================= */
  /**
   * Retourne la liste des problèmes du programme.
   * level 'critique'  : bloque la publication ;
   * level 'alerte'    : à corriger, ne bloque pas.
   */
  function analyze(state) {
    const C = state.congress, P = {}; (state.persons || []).forEach(p => P[p.id] = p);
    const S = (state.sessions || []).filter(s => !INACTIVE.includes(s.status));
    const issues = [], push = (s, level, code, msg) => issues.push({ sessionId: s.id, level, code, message: msg });
    const roomName = id => ((C.rooms || []).find(r => r.id === id) || {}).name || id;
    const dayOk = d => (C.days || []).some(x => x.date === d);

    S.forEach(s => {
      const label = s.title || TYPES[s.type].label;
      if (!String(s.title || '').trim()) push(s, 'critique', 'titre', 'Titre obligatoire manquant.');
      if (!dayOk(s.day)) push(s, 'critique', 'jour', `La date ${s.day} ne fait pas partie du congrès.`);
      if (!(toMin(s.end) > toMin(s.start))) push(s, 'critique', 'horaire', 'Horaire invalide : la fin doit suivre le début.');
      if (!s.allRooms && !(C.rooms || []).some(r => r.id === s.roomId)) push(s, 'critique', 'salle', 'Salle non attribuée.');
      // Période bloquée (séquence plénière)
      (C.blocks || []).forEach(b => {
        if (s.type === 'break' || s.allRooms) return;
        if (b.day === s.day && (b.rooms || []).includes(s.roomId) && toMin(s.start) < toMin(b.to) && toMin(b.from) < toMin(s.end))
          push(s, 'critique', 'bloque', `${roomName(s.roomId)} est fermée de ${b.from} à ${b.to} (${b.label}).`);
      });
      // Durée et contenu par type
      const D = dur(s);
      if (s.type === 'lectures') {
        const L = s.lectures || [];
        const used = L.reduce((t, l) => t + (+l.duration || 0), 0) + (+s.discussion || 0);
        if (used > D) push(s, 'critique', 'duree', `Durée dépassée : ${used} min prévues pour ${D} min.`);
        else if (used < D) push(s, 'alerte', 'duree', `${D - used} min non attribuées dans la session.`);
        if (!L.length) push(s, 'alerte', 'orateurs', 'Aucune conférence dans la session.');
        L.forEach((l, i) => {
          if (!String(l.title || '').trim()) push(s, 'alerte', 'conf', `Conférence ${i + 1} : titre manquant.`);
          if (!l.speakerId) push(s, 'alerte', 'orateur', `Conférence ${i + 1} : orateur non attribué.`);
        });
        if (!(s.moderators || []).length) push(s, 'alerte', 'moderateur', 'Aucun modérateur.');
        if ((s.moderators || []).length > 3) push(s, 'alerte', 'moderateur', 'Plus de trois modérateurs.');
      }
      if (s.type === 'panel') {
        if (!(s.panelists || []).length) push(s, 'alerte', 'panelistes', 'Aucun panéliste.');
        if (!(s.moderators || []).length) push(s, 'alerte', 'moderateur', 'Aucun modérateur.');
      }
      if (s.type === 'workshop' && !(s.facilitators || []).length) push(s, 'alerte', 'animateur', 'Aucun animateur d\'atelier.');
      if (s.type === 'symposium') {
        if (!s.sponsor || !s.sponsor.company) push(s, 'alerte', 'sponsor', 'En attente d\'attribution à un sponsor.');
        else if (!s.sponsor.speakerId) push(s, 'alerte', 'orateur', 'Orateur du symposium non désigné.');
      }
      (s.moderators || []).concat(s.panelists || [], s.facilitators || [], s.instructors || [], s.speakers || []).forEach(id => {
        if (id && !P[id]) push(s, 'critique', 'personne', 'Une personne affectée n\'existe plus dans l\'annuaire.');
      });
      void label;
    });
    // Conflits entre sessions
    for (let i = 0; i < S.length; i++) for (let j = i + 1; j < S.length; j++) {
      const a = S[i], b = S[j];
      if (!overlap(a, b)) continue;
      // Salle occupée deux fois
      if (!a.allRooms && !b.allRooms && a.roomId && a.roomId === b.roomId) {
        const lvl = 'critique', m = `Salle ${roomName(a.roomId)} réservée deux fois (${a.start}–${a.end} et ${b.start}–${b.end}).`;
        push(a, lvl, 'salle2', m); push(b, lvl, 'salle2', m);
      } else if (a.allRooms !== b.allRooms && (a.type === 'break' || b.type === 'break')) {
        const x = a.type === 'break' ? b : a, y = a.type === 'break' ? a : b;
        push(x, 'alerte', 'pause', `Chevauche « ${y.title || 'Pause'} » (${y.start}–${y.end}).`);
      }
      // Personne présente dans deux activités simultanées
      const pa = peopleOf(a), pb = peopleOf(b);
      pa.forEach(x => pb.forEach(y => {
        if (x.id !== y.id) return;
        const who = displayName(P[x.id]) || 'Une personne';
        push(a, 'critique', 'personne2', `${who} (${x.role.toLowerCase()}) est aussi ${y.role.toLowerCase()} dans « ${b.title || TYPES[b.type].label} » à la même heure.`);
        push(b, 'critique', 'personne2', `${who} (${y.role.toLowerCase()}) est aussi ${x.role.toLowerCase()} dans « ${a.title || TYPES[a.type].label} » à la même heure.`);
      }));
    }
    // Même personne deux fois dans une même session sur des rôles incompatibles : signalé seulement
    S.forEach(s => {
      const seen = {}; peopleOf(s).forEach(x => { if (seen[x.id] && x.role !== seen[x.id]) push(s, 'alerte', 'double-role', `${displayName(P[x.id])} a deux rôles dans cette session (${seen[x.id].toLowerCase()} et ${x.role.toLowerCase()}).`); seen[x.id] = x.role; });
    });
    // Dédoublonnage des messages identiques
    const u = {}; return issues.filter(x => { const k = x.sessionId + '|' + x.message; return u[k] ? false : (u[k] = true); });
  }
  /** Indice de préparation d'une session (0–100), basé sur les champs requis selon son format. */
  function readiness(s) {
    const checks = [!!String(s.title || '').trim(), !!s.roomId || s.allRooms];
    if (s.type === 'lectures') { checks.push((s.moderators || []).length > 0); (s.lectures || []).forEach(l => checks.push(!!l.title, !!l.speakerId)); }
    if (s.type === 'panel') checks.push((s.moderators || []).length > 0, (s.panelists || []).length > 0, !!s.description);
    if (s.type === 'workshop') checks.push((s.facilitators || []).length > 0, !!s.objectives, !!s.description);
    if (s.type === 'symposium') checks.push(!!(s.sponsor && s.sponsor.company), !!(s.sponsor && s.sponsor.speakerId), !!(s.sponsor && s.sponsor.presentationTitle));
    return Math.round(checks.filter(Boolean).length / checks.length * 100);
  }

  /* ======================= Numérotation des sessions ======================= */
  // S = sessions scientifiques (conférences, panels, ateliers) · SY = symposiums · C = cérémonies. Les pauses ne sont pas numérotées.
  const FAMILY = { lectures: 'S', panel: 'S', workshop: 'S', symposium: 'SY', ceremony: 'C', break: '' };
  const familyOf = s => FAMILY[s.type] || '';
  const codeOf = s => (familyOf(s) && +s.num > 0) ? familyOf(s) + String(+s.num).padStart(2, '0') : '';
  function chronoSort(list, C) {
    const di = d => (C.days || []).findIndex(x => x.date === d), ri = r => (C.rooms || []).findIndex(x => x.id === r);
    return list.slice().sort((a, b) => di(a.day) - di(b.day) || toMin(a.start) - toMin(b.start) || ri(a.roomId) - ri(b.roomId));
  }
  /** Attribue un numéro aux sessions qui n'en ont pas (renumber = true : renumérote tout dans l'ordre chronologique). Retourne les sessions modifiées. */
  function assignNumbers(sessions, C, renumber) {
    const changed = [], active = sessions.filter(s => !INACTIVE.includes(s.status) && familyOf(s));
    ['S', 'SY', 'C'].forEach(f => {
      const fam = chronoSort(active.filter(s => familyOf(s) === f), C);
      if (renumber) fam.forEach((s, i) => { if (+s.num !== i + 1) { s.num = i + 1; changed.push(s); } });
      else { let max = Math.max(0, ...fam.map(s => +s.num || 0)); const seen = new Set();
        fam.forEach(s => { if (+s.num > 0 && !seen.has(+s.num)) { seen.add(+s.num); return; } s.num = ++max; changed.push(s); }); }
    });
    return changed;
  }
  /* ======================= Échange de contenu entre deux sessions ======================= */
  // Le créneau (jour, heure, salle, numéro) reste en place ; tout le reste (titre, format, intervenants, conférences…) est interverti.
  const SLOT_KEYS = ['id', 'num', 'day', 'start', 'end', 'roomId', 'allRooms', 'version', 'createdAt', 'createdBy', 'snapshot', 'publishedAt', 'publishedBy', 'updatedAt', 'updatedBy', 'status'];
  function swapContent(a, b) {
    const take = (slot, content) => {
      const o = {}; Object.keys(content).forEach(k => { if (!SLOT_KEYS.includes(k)) o[k] = JSON.parse(JSON.stringify(content[k])); });
      SLOT_KEYS.forEach(k => { if (k in slot) o[k] = slot[k]; });
      // Statut : un créneau déjà en ligne passe en « Modifié après publication » ; sinon le contenu garde son avancement (hors publication).
      o.status = slot.snapshot ? 'modifie' : (LIVE.includes(content.status) ? 'valide' : content.status);
      if (o.type === 'break') { o.allRooms = slot.allRooms; }
      return o;
    };
    return [take(a, b), take(b, a)];
  }
  /** Simule l'échange et compare les conflits avant / après. */
  function swapCheck(state, idA, idB) {
    const A = state.sessions.find(s => s.id === idA), B = state.sessions.find(s => s.id === idB);
    if (!A || !B) throw new Error('Session introuvable.');
    if (A.id === B.id) throw new Error('Choisissez deux sessions différentes.');
    if (A.type === 'break' || B.type === 'break') throw new Error('Les pauses ne peuvent pas être échangées.');
    if (INACTIVE.includes(A.status) || INACTIVE.includes(B.status)) throw new Error('Une session annulée ou archivée ne peut pas être échangée.');
    const [a2, b2] = swapContent(A, B);
    const after = Object.assign({}, state, { sessions: state.sessions.map(s => s.id === A.id ? a2 : s.id === B.id ? b2 : s) });
    const key = i => i.sessionId + '|' + i.message;
    const before = new Set(analyze(state).map(key));
    const touched = new Set([A.id, B.id]);
    const iss = analyze(after);
    // Conflits nouveaux concernant les deux créneaux, ou les sessions qui chevauchent avec eux
    const newCrit = iss.filter(i => i.level === 'critique' && !before.has(key(i)) && (touched.has(i.sessionId) || /même heure|réservée deux fois/.test(i.message)));
    const newWarn = iss.filter(i => i.level === 'alerte' && !before.has(key(i)) && touched.has(i.sessionId));
    const solved = analyze(state).filter(i => i.level === 'critique' && touched.has(i.sessionId) && !iss.some(j => key(j) === key(i)));
    return { a: a2, b: b2, newCrit, newWarn, solved };
  }

  /* ======================= Publication : instantané public ======================= */
  /**
   * Instantané public figé au moment de la publication.
   * Ne contient jamais : e-mail, téléphone, notes internes, statut commercial, éléments masqués.
   */
  function publicSnapshot(s, persons) {
    const P = {}; persons.forEach(p => P[p.id] = p);
    const pub = id => { const p = P[id]; if (!p) return null; if (p.visible === false) return { id: '', name: 'Intervenant à confirmer', institution: '', country: '' };
      return { id: p.id, name: displayName(p), title: p.title || '', institution: p.institution || '', country: p.country || '', specialties: p.specialties || '', bio: p.bioPublic ? (p.bio || '') : '' }; };
    const list = ids => (ids || []).map(pub).filter(Boolean);
    const o = { id: s.id, code: codeOf(s), type: s.type, title: s.title, subtitle: s.subtitle || '', description: s.description || '', theme: s.theme || '',
      day: s.day, start: s.start, end: s.end, roomId: s.roomId, allRooms: !!s.allRooms, moderators: list(s.moderators), publishedAt: new Date().toISOString() };
    if (s.type === 'lectures') { let t = toMin(s.start); o.lectures = (s.lectures || []).map(l => { const st = t; t += (+l.duration || 0); return l.visible === false ? null : { title: l.title, speaker: pub(l.speakerId), duration: +l.duration || 0, start: fromMin(st) }; }).filter(Boolean); o.discussion = +s.discussion || 0; }
    if (s.type === 'panel') o.panelists = list(s.panelists);
    if (s.type === 'workshop') Object.assign(o, { facilitators: list(s.facilitators), instructors: list(s.instructors), objectives: s.objectives || '', audience: s.audience || '', capacity: s.capacity || '', registration: !!s.registration });
    if (s.type === 'symposium') o.sponsor = s.sponsor && s.sponsor.company && s.sponsor.detailsVisible !== false
      ? { company: s.sponsor.company, presentationTitle: s.sponsor.presentationTitle || '', speaker: pub(s.sponsor.speakerId), logo: s.sponsor.logo || '' } : null;
    if (s.type === 'ceremony') Object.assign(o, { kind: s.kind || '', speakers: list(s.speakers) });
    return o;
  }

  /* ======================= Nettoyage des entrées ======================= */
  const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n || 500);
  const ids = v => Array.isArray(v) ? v.map(x => str(x, 40)).filter(Boolean).slice(0, 30) : [];
  const time = v => /^\d{2}:\d{2}$/.test(String(v)) && toMin(v) < 24 * 60 ? v : null;
  function cleanSession(i, C) {
    if (!TYPES[i.type]) throw new Error('Format de session inconnu.');
    const s = blankSession(i.type, str(i.day, 10), str(i.roomId, 10) || null, time(i.start), time(i.end));
    if (!s.start || !s.end) throw new Error('Horaire invalide (format HH:MM).');
    Object.assign(s, { id: str(i.id, 40), title: str(i.title, 250), subtitle: str(i.subtitle, 250), description: str(i.description, 4000), theme: str(i.theme, 200),
      status: STATUS[i.status] ? i.status : 'brouillon', visible: i.visible !== false, moderators: ids(i.moderators), notes: str(i.notes, 4000),
      version: +i.version || 0, allRooms: i.type === 'break' ? i.allRooms !== false : false, num: Math.max(0, Math.min(999, parseInt(i.num, 10) || 0)) });
    if (s.allRooms) s.roomId = null;
    if (s.type === 'lectures') { s.lectures = (Array.isArray(i.lectures) ? i.lectures : []).slice(0, 8).map((l, k) => ({ id: str(l.id, 20) || 'L' + (k + 1), title: str(l.title, 300), speakerId: str(l.speakerId, 40), duration: Math.max(0, Math.min(240, +l.duration || 0)), abstractRef: str(l.abstractRef, 40), visible: l.visible !== false })); s.discussion = Math.max(0, Math.min(240, +i.discussion || 0)); }
    if (s.type === 'panel') s.panelists = ids(i.panelists);
    if (s.type === 'workshop') Object.assign(s, { facilitators: ids(i.facilitators), instructors: ids(i.instructors), objectives: str(i.objectives, 3000), audience: str(i.audience, 500), capacity: str(i.capacity, 10), registration: !!i.registration, logistics: str(i.logistics, 3000) });
    if (s.type === 'symposium') { const p = i.sponsor || {}; s.sponsor = { company: str(p.company, 200), speakerId: str(p.speakerId, 40), presentationTitle: str(p.presentationTitle, 300), commercial: SPONSOR_STATUS[p.commercial] ? p.commercial : 'disponible', logo: /^https:\/\//.test(p.logo || '') ? str(p.logo, 500) : '', detailsVisible: p.detailsVisible !== false }; }
    if (s.type === 'ceremony') { s.kind = str(i.kind, 100) || 'Cérémonie officielle'; s.speakers = ids(i.speakers); }
    if (C && !(C.days || []).some(d => d.date === s.day)) throw new Error('Jour hors des dates du congrès.');
    return s;
  }
  function cleanPerson(i) {
    const p = { id: str(i.id, 40), title: TITLES.includes(i.title) ? i.title : str(i.title, 20), firstName: str(i.firstName, 80), lastName: str(i.lastName, 80),
      displayAs: str(i.displayAs, 160), func: str(i.func, 160), institution: str(i.institution, 250), department: str(i.department, 250), affiliation: str(i.affiliation, 400),
      city: str(i.city, 80), country: str(i.country, 80) || 'Algérie', email: str(i.email, 160).toLowerCase(), phone: str(i.phone, 40), bio: str(i.bio, 3000), bioPublic: !!i.bioPublic,
      specialties: str(i.specialties, 300), visible: i.visible !== false, externalId: str(i.externalId, 60), version: +i.version || 0 };
    if (!p.firstName || !p.lastName) throw new Error('Prénom et nom obligatoires.');
    if (p.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(p.email)) throw new Error('Adresse e-mail non valide.');
    return p;
  }
  function cleanCongress(i, prev) {
    const c = Object.assign(defaultCongress(), prev || {});
    ['name', 'short', 'city', 'venue', 'country'].forEach(k => { if (k in i) c[k] = str(i[k], 200) || c[k]; });
    if (Array.isArray(i.days)) { const d = i.days.filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x.date)).slice(0, 7).map(x => ({ date: x.date, label: str(x.label, 40) })); if (d.length) c.days = d; }
    if (Array.isArray(i.rooms)) { const r = i.rooms.slice(0, 12).map((x, k) => ({ id: str(x.id, 10) || 'R' + (k + 1), name: str(x.name, 80) || 'Salle ' + (k + 1), main: !!x.main })); if (r.length) c.rooms = r; }
    if (Array.isArray(i.blocks)) c.blocks = i.blocks.slice(0, 20).filter(b => time(b.from) && time(b.to)).map((b, k) => ({ id: str(b.id, 10) || 'BL' + (k + 1), day: str(b.day, 10), from: b.from, to: b.to, rooms: ids(b.rooms), label: str(b.label, 200) }));
    if (Array.isArray(i.template)) c.template = i.template.slice(0, 30).filter(t => time(t.start) && time(t.end)).map(t => ({ start: t.start, end: t.end, kind: ['session', 'symposium', 'break'].includes(t.kind) ? t.kind : 'session', label: str(t.label, 120) }));
    if (Array.isArray(i.themes)) c.themes = i.themes.map(t => str(t, 200)).filter(Boolean).slice(0, 40);
    if ('proposalsOpen' in i) c.proposalsOpen = !!i.proposalsOpen;
    if (Array.isArray(i.sections)) c.sections = i.sections.map(t => str(t, 120)).filter(Boolean).slice(0, 80);
    if (time(i.dayStart)) c.dayStart = i.dayStart; if (time(i.dayEnd)) c.dayEnd = i.dayEnd;
    c.version = (prev && prev.version || 0) + 1;
    return c;
  }

  /* ======================= Propositions des présidents de section ======================= */
  const PROPOSAL_TYPES = ['lectures', 'panel', 'workshop'];
  const PROPOSAL_STATUS = { nouvelle: 'Nouvelle', importee: 'Importée au programme', refusee: 'Non retenue' };
  const okEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
  function cleanPersonInput(i, label, needEmail) {
    i = i || {};
    const p = { title: TITLES.includes(i.title) ? i.title : str(i.title, 20), firstName: str(i.firstName, 80), lastName: str(i.lastName, 80), func: str(i.func, 160),
      institution: str(i.institution, 250), city: str(i.city, 80), country: str(i.country, 80) || 'Algérie', email: str(i.email, 160).toLowerCase(), phone: str(i.phone, 40), whatsapp: i.whatsapp === 'Oui' ? 'Oui' : i.whatsapp === 'Non' ? 'Non' : '' };
    if (!p.firstName || !p.lastName) throw new Error(label + ' : prénom et nom obligatoires.');
    if (!p.institution) throw new Error(label + ' : établissement obligatoire.');
    if (needEmail && !p.email) throw new Error(label + ' : adresse e-mail obligatoire.');
    if (p.email && !okEmail(p.email)) throw new Error(label + ' : adresse e-mail non valide.');
    return p;
  }
  function cleanProposal(i, C) {
    i = i || {};
    if (!PROPOSAL_TYPES.includes(i.type)) throw new Error('Choisissez le format de la session.');
    const pr = { section: str(i.section, 120), president: cleanPersonInput(i.president, 'Président de section', true), type: i.type,
      title: str(i.title, 250), theme: str(i.theme, 200), description: str(i.description, 3000), preferredDay: str(i.preferredDay, 10),
      preferredPeriod: ['matin', 'apres-midi', ''].includes(i.preferredPeriod) ? i.preferredPeriod : '', comment: str(i.comment, 2000),
      moderators: [], lectures: [], discussion: 0, panelists: [], facilitators: [], instructors: [], objectives: '', audience: '', capacity: '' };
    if (!pr.section) throw new Error('Indiquez votre section.');
    if (!pr.title) throw new Error('Le titre de la session est obligatoire.');
    if (!pr.president.phone) throw new Error('Président de section : téléphone obligatoire.');
    const list = (arr, label, max) => (Array.isArray(arr) ? arr : []).slice(0, max).map((x, k) => cleanPersonInput(x, label + ' ' + (k + 1), false));
    if (pr.type !== 'workshop') { pr.moderators = list(i.moderators, 'Modérateur', 3); if (!pr.moderators.length) throw new Error('Indiquez au moins un modérateur.'); }
    if (pr.type === 'lectures') {
      pr.lectures = (Array.isArray(i.lectures) ? i.lectures : []).slice(0, 6).map((l, k) => ({ title: str(l.title, 300), duration: Math.max(5, Math.min(60, +l.duration || 20)), speaker: cleanPersonInput(l.speaker, 'Orateur ' + (k + 1), false) }));
      pr.lectures.forEach((l, k) => { if (!l.title) throw new Error('Conférence ' + (k + 1) + ' : titre obligatoire.'); });
      if (!pr.lectures.length) throw new Error('Indiquez au moins une conférence.');
      pr.discussion = Math.max(0, Math.min(60, +i.discussion || 0));
      const tot = pr.lectures.reduce((t, l) => t + l.duration, 0) + pr.discussion;
      if (tot > 90) throw new Error(`Durée totale de ${tot} min : une session dure 90 minutes au maximum.`);
    }
    if (pr.type === 'panel') { pr.panelists = list(i.panelists, 'Panéliste', 8); if (!pr.panelists.length) throw new Error('Indiquez au moins un panéliste.'); }
    if (pr.type === 'workshop') {
      pr.facilitators = list(i.facilitators, 'Animateur', 4); pr.instructors = list(i.instructors, 'Formateur', 6);
      if (!pr.facilitators.length) throw new Error('Indiquez au moins un animateur.');
      Object.assign(pr, { objectives: str(i.objectives, 2000), audience: str(i.audience, 300), capacity: str(i.capacity, 10) });
    }
    if (C && pr.preferredDay && !(C.days || []).some(d => d.date === pr.preferredDay)) pr.preferredDay = '';
    return pr;
  }
  /** Créneaux vides du programme pouvant accueillir une proposition (aucun titre ni intervenant). */
  function emptySlots(st) {
    return chronoSort(st.sessions.filter(s => ['lectures', 'panel', 'workshop'].includes(s.type) && !INACTIVE.includes(s.status) && !s.snapshot
      && !String(s.title || '').trim() && !peopleOf(s).length), st.congress);
  }

  /* ======================= Trame et démonstration ======================= */
  /** Génère la trame vide d'un jour à partir du gabarit horaire, en respectant les salles fermées. */
  function templateSessions(C, day) {
    const out = [], blocked = (room, a, b) => (C.blocks || []).some(x => x.day === day && x.rooms.includes(room) && toMin(a) < toMin(x.to) && toMin(x.from) < toMin(b));
    C.template.forEach(t => {
      if (t.kind === 'break') { const s = blankSession('break', day, null, t.start, t.end); s.title = t.label; s.status = 'valide'; out.push(s); return; }
      C.rooms.forEach(r => {
        if (blocked(r.id, t.start, t.end)) return;
        const s = blankSession(t.kind === 'symposium' ? 'symposium' : 'lectures', day, r.id, t.start, t.end);
        s.title = t.kind === 'symposium' ? t.label + ' — En attente d\'attribution' : ''; out.push(s);
      });
    });
    return out;
  }
  function demoData() {
    const C = defaultCongress();
    const F = ['Amel', 'Karim', 'Nadia', 'Yacine', 'Leila', 'Sofiane', 'Meriem', 'Rachid', 'Samira', 'Hichem', 'Lynda', 'Walid', 'Imane', 'Farid', 'Nesrine', 'Mourad', 'Dalila', 'Anis', 'Houria', 'Bilal', 'Sabrina', 'Nabil', 'Kenza', 'Omar', 'Lamia', 'Redouane', 'Assia', 'Fethi', 'Yasmine', 'Djamel', 'Nawel', 'Tarek'];
    const L = ['Benali', 'Hamdi', 'Kaci', 'Mansouri', 'Saidi', 'Bouzid', 'Cherif', 'Haddad', 'Belkacem', 'Rahmani', 'Ziani', 'Ouali', 'Meziane', 'Brahimi', 'Toumi', 'Ferhat', 'Amrani', 'Lounis', 'Bensaid', 'Djebbar', 'Khelifi', 'Slimani', 'Larbi', 'Moussaoui', 'Guerfi', 'Hamel', 'Aouadi', 'Benyahia', 'Chaib', 'Derradji', 'Yahiaoui', 'Bouaziz'];
    const INST = ['Faculté de pharmacie (fictive), Alger', 'CHU de démonstration, Oran', 'Université de démonstration, Constantine', 'EHS fictif, Alger', 'Laboratoire de démonstration, Sétif', 'Faculté de pharmacie (fictive), Tlemcen', 'CHU de démonstration, Annaba', 'Université de démonstration, Ouargla'];
    const SPEC = ['Toxicologie', 'Pharmacie clinique', 'Pharmacologie', 'Galénique', 'Biologie clinique', 'Économie de la santé', 'Pharmacognosie', 'Santé publique'];
    const N = 300; // un grand annuaire fictif : chaque intervenant n'a qu'une ou deux interventions, comme dans un vrai congrès
    const persons = Array.from({ length: N }, (_, i) => [F[i % 32], L[(i + Math.floor(i / 32) * 5) % 32], i]).map(([f, l, i]) => ({ id: 'P' + String(i + 1).padStart(3, '0'), title: i % 3 === 0 ? 'Pr' : 'Dr', firstName: f, lastName: l, displayAs: '', func: i % 3 === 0 ? 'Professeur hospitalo-universitaire' : 'Maître-assistant',
      institution: INST[i % INST.length], department: '', affiliation: '', city: INST[i % INST.length].split(', ')[1], country: 'Algérie', email: `${f.toLowerCase()}.${l.toLowerCase()}${i >= 32 ? i : ''}@exemple.dz`, phone: '0555 00 0' + String(i).padStart(2, '0') + ' ' + String(10 + i),
      bio: '', bioPublic: false, specialties: SPEC[i % SPEC.length], visible: true, externalId: '', version: 1 }));
    persons.push({ id: 'P900', title: 'Dr', firstName: 'amel', lastName: 'BENALI', displayAs: '', func: '', institution: 'FACULTE DE PHARMACIE D ALGER', department: '', affiliation: '', city: 'Alger', country: 'Algérie', email: 'amel.benali@exemple.dz', phone: '', bio: '', bioPublic: false, specialties: '', visible: true, externalId: '', version: 1 });
    const pid = n => 'P' + String(n).padStart(3, '0');
    const sessions = [];
    C.days.forEach(d => templateSessions(C, d.date).forEach(s => sessions.push(s)));
    let k = 0; sessions.forEach(s => s.id = 'S' + String(++k).padStart(3, '0'));
    const sci = sessions.filter(s => s.type === 'lectures');
    const topics = [
      ['Pharmacie clinique à l\'hôpital : nouveaux rôles', 'Pharmacie clinique et hospitalière', ['Conciliation médicamenteuse aux urgences', 'Suivi thérapeutique pharmacologique des anti-infectieux', 'Pharmacien clinicien en oncologie']],
      ['Toxicologie analytique et urgences', 'Biologie clinique et toxicologie', ['Nouvelles substances psychoactives : défis analytiques', 'Intoxications médicamenteuses chez l\'enfant', 'Antidotes : disponibilité et gestion des stocks']],
      ['Officine : le pharmacien acteur de santé publique', 'Officine et soins pharmaceutiques', ['Vaccination en officine : retours d\'expérience', 'Entretiens pharmaceutiques et observance', 'Dépistage du diabète à l\'officine']],
      ['Industrie et accès au médicament', 'Industrie pharmaceutique et biotechnologies', ['Biosimilaires : enjeux réglementaires', 'Production locale et souveraineté sanitaire', 'Bonnes pratiques de fabrication : actualités']],
      ['Pharmacovigilance et bon usage', 'Pharmacologie et pharmacovigilance', ['Signal de pharmacovigilance : de la notification à la décision', 'Usage détourné des médicaments', 'Interactions médicamenteuses chez le sujet âgé']],
      ['Économie de la santé et régulation', 'Réglementation et économie de la santé', ['Évaluation médico-économique des innovations', 'Politique du générique', 'Prix et remboursement : comparaisons internationales']],
      ['Dermopharmacie et cosmétologie', 'Dermopharmacie et cosmétologie', ['Sécurité des produits cosmétiques', 'Photoprotection : formulation et conseil', 'Dermocosmétique et pathologies cutanées']],
      ['Santé numérique et intelligence artificielle', 'Santé numérique et intelligence artificielle', ['IA et validation pharmaceutique', 'Données de santé et protection', 'Télépharmacie : cadre et perspectives']]
    ];
    let pn = 1; const nextP = () => pid(((pn++ - 1) % N) + 1);
    sci.forEach((s, i) => {
      const t = topics[i % topics.length];
      if (i % 9 === 4) { Object.assign(s, blankSession('panel', s.day, s.roomId, s.start, s.end), { id: s.id, title: 'Panel — ' + t[0], theme: t[1], description: 'Table ronde interactive réunissant praticiens, enseignants et représentants institutionnels.', moderators: [nextP()], panelists: [nextP(), nextP(), nextP(), nextP()] }); }
      else if (i % 9 === 7) { Object.assign(s, blankSession('workshop', s.day, s.roomId, s.start, s.end), { id: s.id, title: 'Atelier — ' + t[2][0], theme: t[1], description: 'Atelier pratique en petits groupes.', facilitators: [nextP()], instructors: [nextP()], objectives: 'Maîtriser les étapes clés et les outils pratiques.', audience: 'Pharmaciens hospitaliers et d\'officine, résidents', capacity: '40', registration: true }); }
      else { s.title = t[0]; s.theme = t[1]; s.moderators = [nextP(), nextP()]; s.lectures.forEach((l, j) => { l.title = t[2][j]; l.speakerId = nextP(); }); }
      s.status = i % 4 === 0 ? 'en_preparation' : i % 5 === 0 ? 'a_valider' : 'publie';
    });
    // Conflit volontaire pour la démonstration : même orateur dans deux salles simultanées
    const d1 = sci.filter(s => s.day === '2026-12-22' && s.start === '11:20' && s.type === 'lectures');
    if (d1.length >= 2) d1[1].lectures[0].speakerId = d1[0].lectures[0].speakerId;
    // Symposiums : quelques-uns attribués
    sessions.filter(s => s.type === 'symposium').forEach((s, i) => {
      if (i % 3 === 0) { s.title = 'Symposium — Prise en charge de la douleur'; s.sponsor = { company: 'Laboratoire Démo ' + 'ABCDEFGH'[i % 8], speakerId: pid(((i * 7) % 32) + 1), presentationTitle: 'Actualités thérapeutiques (exemple)', commercial: 'attribue', logo: '', detailsVisible: true }; s.status = 'publie'; }
      else if (i % 3 === 1) { s.sponsor.commercial = 'reserve'; s.sponsor.company = 'Laboratoire Démo réservé'; s.title = s.title.replace(' — En attente d\'attribution', ' — Réservé'); }
    });
    // Jour 1 : séquence plénière et cérémonie dans l'auditorium
    const add = (type, start, end, extra) => { const s = Object.assign(blankSession(type, '2026-12-22', 'R1', start, end), extra); s.id = 'S' + String(++k).padStart(3, '0'); sessions.push(s); return s; };
    const r1last = sessions.find(s => s.day === '2026-12-22' && s.roomId === 'R1' && s.start === '16:30');
    if (r1last) { Object.assign(r1last, { title: 'Séance plénière — Le pharmacien dans le système de santé de demain', theme: 'Santé publique et prévention', status: 'valide' }); }
    add('ceremony', '18:20', '18:50', { title: 'Inauguration officielle du 10e Congrès', kind: 'Inauguration officielle', status: 'valide', speakers: [pid(1)] });
    add('ceremony', '18:50', '19:20', { title: 'Allocutions institutionnelles', kind: 'Allocutions institutionnelles', status: 'valide', speakers: [pid(4), pid(7)] });
    add('ceremony', '19:20', '20:00', { title: 'Remise des distinctions et prix scientifiques', kind: 'Remise de distinctions', status: 'brouillon', speakers: [] });
    sessions.forEach(s => { if (s.type === 'break') s.status = 'publie'; if (s.type === 'ceremony' && s.status === 'valide') s.status = 'publie'; });
    if (r1last) r1last.status = 'publie';
    sessions.forEach(s => { s.version = 1; s.createdBy = 'Démonstration'; s.createdAt = '2026-11-01T09:00:00.000Z'; s.updatedBy = 'Démonstration'; s.updatedAt = '2026-11-01T09:00:00.000Z'; });
    return { congress: C, persons, sessions };
  }

  /* ======================= Service (règles métier + audit) ======================= */
  /**
   * store : { getCongress, setCongress, sessions, getSession, putSession, delSession,
   *           persons, getPerson, putPerson, delPerson, audit(n), addAudit(e), nextId(kind) }
   */
  function createService(store) {
    const now = () => new Date().toISOString();
    async function state() { const [congress, sessions, persons] = await Promise.all([store.getCongress(), store.sessions(), store.persons()]); return { congress: congress || defaultCongress(), sessions, persons }; }
    function diff(a, b) {
      const out = []; const keys = new Set(Object.keys(a || {}).concat(Object.keys(b || {})));
      ['version', 'updatedAt', 'updatedBy', 'createdAt', 'createdBy', 'snapshot', 'publishedAt', 'publishedBy'].forEach(k => keys.delete(k));
      keys.forEach(k => { const x = JSON.stringify((a || {})[k]), y = JSON.stringify((b || {})[k]); if (x !== y) out.push({ field: k, before: x === undefined ? '' : String(x).slice(0, 300), after: y === undefined ? '' : String(y).slice(0, 300) }); });
      return out;
    }
    const log = (actor, action, target, label, changes) => store.addAudit({ at: now(), by: actor, action, target, label: label || '', changes: changes || [] });
    function blocking(st, id) { return analyze(st).filter(x => x.sessionId === id && x.level === 'critique'); }

    async function publishOne(st, s, actor) {
      const crit = blocking(st, s.id);
      if (crit.length) return { ok: false, id: s.id, error: crit.map(c => c.message).join(' ') };
      if (!s.visible) return { ok: false, id: s.id, error: 'Élément masqué : activez « Visible au public » pour le publier.' };
      s.snapshot = publicSnapshot(s, st.persons); s.status = 'publie'; s.publishedAt = now(); s.publishedBy = actor;
      s.version = (s.version || 0) + 1; s.updatedAt = now(); s.updatedBy = actor;
      await store.putSession(s); await log(actor, 'Publication', s.id, s.title);
      return { ok: true, id: s.id, session: s };
    }

    const svc = {
      /** Programme public : uniquement les instantanés publiés et visibles. */
      async getPublic() {
        const st = await state(), C = st.congress;
        return { congress: { name: C.name, short: C.short, city: C.city, venue: C.venue, country: C.country, timezone: C.timezone, days: C.days, rooms: C.rooms, blocks: C.blocks, themes: C.themes, proposalsOpen: C.proposalsOpen !== false, sections: C.sections || [] },
          sessions: st.sessions.filter(s => s.snapshot && s.visible && !INACTIVE.includes(s.status)).map(s => s.snapshot), generatedAt: now() };
      },
      async getState(n) {
        const st = await state();
        st.proposals = store.proposals ? (await store.proposals()).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))) : [];
        const ch = assignNumbers(st.sessions, st.congress, false); // migration : numérote les sessions qui n'en ont pas
        for (const s of ch) { if (s.snapshot) s.snapshot.code = codeOf(s); await store.putSession(s); }
        st.audit = await store.audit(n || 300); return st;
      },
      async renumber(actor) {
        const st = await state(); const ch = assignNumbers(st.sessions, st.congress, true);
        for (const s of ch) { if (s.snapshot) s.snapshot.code = codeOf(s); s.version++; await store.putSession(s); }
        await log(actor, 'Renumérotation chronologique', 'programme', ch.length + ' session(s) renumérotée(s)'); return ch.length;
      },
      /** Intervertit le contenu de deux créneaux. Refuse si de nouveaux conflits critiques apparaissent, sauf confirmation explicite (force). */
      async swapSessions(actor, idA, idB, versions, force) {
        const st = await state(); const chk = swapCheck(st, idA, idB);
        const A = st.sessions.find(s => s.id === idA), B = st.sessions.find(s => s.id === idB);
        if (versions && (+versions[0] !== +A.version || +versions[1] !== +B.version)) throw new Error('Une des deux sessions a été modifiée entre-temps. Rechargez puis recommencez.');
        if (chk.newCrit.length && !force) return { ok: false, needConfirm: true, conflicts: chk.newCrit, warnings: chk.newWarn };
        for (const x of [chk.a, chk.b]) { x.version = (x.version || 0) + 1; x.updatedAt = now(); x.updatedBy = actor; await store.putSession(x); }
        await log(actor, 'Échange de contenu', A.id, `${codeOf(A) || A.id} ⇄ ${codeOf(B) || B.id}`, [
          { field: codeOf(A) || A.id, before: A.title, after: chk.a.title }, { field: codeOf(B) || B.id, before: B.title, after: chk.b.title }]);
        return { ok: true, a: chk.a, b: chk.b, conflicts: chk.newCrit, warnings: chk.newWarn };
      },
      async saveCongress(actor, input) {
        const prev = await store.getCongress(); const c = cleanCongress(input || {}, prev);
        await store.setCongress(c); await log(actor, 'Configuration du congrès', 'congress', c.short, diff(prev, c)); return c;
      },
      async saveSession(actor, input, expectedVersion) {
        const st = await state(); const s = cleanSession(input || {}, st.congress);
        const prev = s.id ? await store.getSession(s.id) : null;
        if (prev && expectedVersion != null && +expectedVersion !== +prev.version) throw new Error('Cette session a été modifiée entre-temps par un autre administrateur. Rechargez puis recommencez.');
        if (!prev) { s.id = await store.nextId('S'); s.createdAt = now(); s.createdBy = actor; s.version = 0; }
        if (!familyOf(s)) s.num = 0;
        else if (!(+s.num > 0)) { if (prev && familyOf(prev) === familyOf(s) && +prev.num > 0) s.num = prev.num; else { const tmp = st.sessions.filter(x => x.id !== s.id).concat([Object.assign({}, s, { num: 0 })]); assignNumbers(tmp, st.congress, false); s.num = tmp[tmp.length - 1].num; } }
        else if (st.sessions.some(x => x.id !== s.id && !INACTIVE.includes(x.status) && familyOf(x) === familyOf(s) && +x.num === +s.num)) throw new Error(`Le numéro ${codeOf(s)} est déjà utilisé par une autre session.`);
        else { s.createdAt = prev.createdAt; s.createdBy = prev.createdBy; s.snapshot = prev.snapshot; s.publishedAt = prev.publishedAt; s.publishedBy = prev.publishedBy; }
        // Le statut ne change que par setStatus ; une modification d'un élément publié le fait passer en « Modifié après publication ».
        s.status = prev ? prev.status : (s.status === 'publie' || s.status === 'modifie' ? 'brouillon' : s.status);
        const changes = diff(prev, s);
        if (prev && prev.status === 'publie' && changes.length) s.status = 'modifie';
        if (prev && !prev.visible !== !s.visible) { if (!s.visible) s.snapshot = null; }
        s.version = (prev ? prev.version : 0) + 1; s.updatedAt = now(); s.updatedBy = actor;
        await store.putSession(s);
        await log(actor, prev ? 'Modification' : 'Création', s.id, s.title || TYPES[s.type].label, changes);
        return s;
      },
      async importSessions(actor, list) {
        const st = await state(), out = [];
        for (const i of (list || []).slice(0, 400)) { const s = cleanSession(i, st.congress); s.num = 0; s.id = await store.nextId('S'); s.createdAt = now(); s.createdBy = actor; s.updatedAt = now(); s.updatedBy = actor; s.version = 1; if (LIVE.includes(s.status)) s.status = 'brouillon'; out.push(s); }
        assignNumbers(st.sessions.concat(out), st.congress, false);
        for (const s of out) await store.putSession(s);
        await log(actor, 'Génération de la trame', 'programme', out.length + ' créneaux'); return out;
      },
      async deleteSession(actor, id) {
        const s = await store.getSession(id); if (!s) throw new Error('Session introuvable.');
        if (s.snapshot || LIVE.includes(s.status)) { s.status = 'archive'; s.snapshot = null; s.version++; s.updatedAt = now(); s.updatedBy = actor; await store.putSession(s); await log(actor, 'Archivage', id, s.title); return { archived: true, session: s }; }
        await store.delSession(id); await log(actor, 'Suppression', id, s.title); return { deleted: true };
      },
      async setStatus(actor, id, status) {
        if (!STATUS[status]) throw new Error('Statut inconnu.');
        const st = await state(); const s = st.sessions.find(x => x.id === id); if (!s) throw new Error('Session introuvable.');
        if (status === 'publie') return publishOne(st, s, actor);
        if (status === 'modifie') throw new Error('Ce statut est attribué automatiquement.');
        const before = s.status; s.status = status;
        if (INACTIVE.includes(status)) s.snapshot = null; // retrait immédiat du public
        s.version++; s.updatedAt = now(); s.updatedBy = actor; await store.putSession(s);
        await log(actor, 'Changement de statut', id, s.title, [{ field: 'status', before: STATUS[before].label, after: STATUS[status].label }]);
        return { ok: true, id, session: s };
      },
      async setVisible(actor, id, visible) {
        const st = await state(); const s = st.sessions.find(x => x.id === id); if (!s) throw new Error('Session introuvable.');
        s.visible = !!visible;
        if (!s.visible) s.snapshot = null; // masquage immédiat
        else if (s.status === 'publie' || s.status === 'modifie') { if (!blocking(st, id).length) s.snapshot = publicSnapshot(s, st.persons); }
        s.version++; s.updatedAt = now(); s.updatedBy = actor; await store.putSession(s);
        await log(actor, visible ? 'Rendu visible au public' : 'Masqué au public', id, s.title); return { ok: true, id, session: s };
      },
      async publishMany(actor, idsList) {
        const st = await state(), res = [];
        for (const id of (idsList || []).slice(0, 400)) { const s = st.sessions.find(x => x.id === id); if (!s) continue; res.push(await publishOne(st, s, actor)); }
        return res;
      },
      async savePerson(actor, input) {
        const p = cleanPerson(input || {}); const prev = p.id ? await store.getPerson(p.id) : null;
        if (prev && input.version != null && +input.version !== +prev.version) throw new Error('Cette fiche a été modifiée entre-temps. Rechargez puis recommencez.');
        if (!prev) p.id = await store.nextId('P');
        p.version = (prev ? prev.version : 0) + 1; p.updatedAt = now(); p.updatedBy = actor;
        await store.putPerson(p); await log(actor, prev ? 'Modification d\'une fiche' : 'Création d\'une fiche', p.id, displayName(p), diff(prev, p)); return p;
      },
      async deletePerson(actor, id) {
        const st = await state(); if (st.sessions.some(s => !INACTIVE.includes(s.status) && peopleOf(s).some(x => x.id === id))) throw new Error('Cette personne est affectée à au moins une session. Retirez-la des sessions ou fusionnez-la avec une autre fiche.');
        const p = await store.getPerson(id); await store.delPerson(id); await log(actor, 'Suppression d\'une fiche', id, displayName(p)); return true;
      },
      /** Fusionne deux fiches : toutes les affectations de dropId passent sur keepId. */
      async mergePersons(actor, keepId, dropId) {
        if (keepId === dropId) throw new Error('Choisissez deux fiches différentes.');
        const st = await state(); const keep = st.persons.find(p => p.id === keepId), drop = st.persons.find(p => p.id === dropId);
        if (!keep || !drop) throw new Error('Fiche introuvable.');
        const sw = a => (a || []).map(x => x === dropId ? keepId : x).filter((x, i, arr) => arr.indexOf(x) === i);
        let n = 0;
        for (const s of st.sessions) {
          const before = JSON.stringify(s);
          ['moderators', 'panelists', 'facilitators', 'instructors', 'speakers'].forEach(f => { if (s[f]) s[f] = sw(s[f]); });
          (s.lectures || []).forEach(l => { if (l.speakerId === dropId) l.speakerId = keepId; });
          if (s.sponsor && s.sponsor.speakerId === dropId) s.sponsor.speakerId = keepId;
          if (JSON.stringify(s) !== before) { n++; s.version++; s.updatedAt = now(); s.updatedBy = actor; if (s.snapshot) s.snapshot = publicSnapshot(s, st.persons); await store.putSession(s); }
        }
        ['email', 'phone', 'institution', 'department', 'affiliation', 'city', 'bio', 'specialties', 'func', 'externalId'].forEach(k => { if (!keep[k] && drop[k]) keep[k] = drop[k]; });
        keep.version++; await store.putPerson(keep); await store.delPerson(dropId);
        await log(actor, 'Fusion de fiches', keepId, displayName(keep) + ' ← ' + displayName(drop), [{ field: 'sessions', before: '', after: n + ' session(s) mises à jour' }]);
        return keep;
      },
      async seedDemo(actor) {
        const cur = await store.sessions(); if (cur.length) throw new Error('Le programme contient déjà des sessions. Videz-le avant de charger la démonstration.');
        const d = demoData(); await store.setCongress(d.congress);
        for (const p of d.persons) await store.putPerson(p);
        const st = { congress: d.congress, persons: d.persons, sessions: d.sessions };
        assignNumbers(d.sessions, d.congress, true);
        const crit = new Set(analyze(st).filter(x => x.level === 'critique').map(x => x.sessionId));
        for (const s of d.sessions) { if (s.status === 'publie' && crit.has(s.id)) s.status = 'a_valider'; if (s.status === 'publie') { s.snapshot = publicSnapshot(s, d.persons); s.publishedAt = now(); s.publishedBy = actor; } await store.putSession(s); }
        await store.setSeq && await store.setSeq(d.sessions.length + 1, 1000);
        await log(actor, 'Chargement des données de démonstration', 'programme', d.sessions.length + ' sessions, ' + d.persons.length + ' personnes'); return true;
      },
      async clearProgramme(actor) {
        const ss = await store.sessions(); for (const s of ss) await store.delSession(s.id);
        const ps = await store.persons(); for (const p of ps) await store.delPerson(p.id);
        await log(actor, 'Programme vidé', 'programme', ss.length + ' sessions, ' + ps.length + ' personnes supprimées'); return true;
      },

      /* ----- Propositions des présidents de section ----- */
      async submitProposal(input) {
        const C = (await store.getCongress()) || defaultCongress();
        if (C.proposalsOpen === false) throw new Error('Le dépôt des propositions de sessions est clos.');
        const pr = cleanProposal(input, C);
        pr.id = await store.nextId('PR'); pr.createdAt = now(); pr.status = 'nouvelle'; pr.sessionId = ''; pr.adminNote = '';
        await store.putProposal(pr);
        await log('Président de section · ' + displayName(pr.president), 'Proposition de session reçue', pr.id, pr.title);
        return { id: pr.id };
      },
      async setProposalStatus(actor, id, status, note) {
        if (!PROPOSAL_STATUS[status]) throw new Error('Statut inconnu.');
        const pr = await store.getProposal(id); if (!pr) throw new Error('Proposition introuvable.');
        pr.status = status; if (note != null) pr.adminNote = str(note, 2000); pr.updatedAt = now(); pr.updatedBy = actor;
        await store.putProposal(pr); await log(actor, 'Proposition : ' + PROPOSAL_STATUS[status], id, pr.title); return pr;
      },
      async deleteProposal(actor, id) {
        const pr = await store.getProposal(id); if (!pr) throw new Error('Proposition introuvable.');
        await store.delProposal(id); await log(actor, 'Suppression d\'une proposition', id, pr.title); return true;
      },
      /**
       * Importe une proposition dans le programme.
       * target : { slotId } pour remplir un créneau vide, ou { day, roomId, start } pour créer un créneau de 90 min.
       * Les personnes sont rapprochées de l'annuaire par e-mail, puis par prénom + nom ; sinon une fiche est créée.
       */
      async importProposal(actor, id, target) {
        const pr = await store.getProposal(id); if (!pr) throw new Error('Proposition introuvable.');
        if (pr.status === 'importee' && pr.sessionId) { const ex = await store.getSession(pr.sessionId); if (ex) throw new Error('Cette proposition est déjà importée (session ' + (codeOf(ex) || ex.id) + ').'); }
        let st = await state(); target = target || {};
        const index = {}; st.persons.forEach(p => { if (p.email) index['e:' + p.email.toLowerCase()] = p.id; index['n:' + norm(p.firstName) + '|' + norm(p.lastName)] = p.id; });
        let created = 0, matched = 0;
        const resolve = async x => {
          if (!x) return '';
          const k1 = x.email ? 'e:' + x.email : '', k2 = 'n:' + norm(x.firstName) + '|' + norm(x.lastName);
          const hit = (k1 && index[k1]) || index[k2];
          if (hit) { matched++; return hit; }
          const p = cleanPerson(Object.assign({}, x, { firstName: suggestName(x.firstName), lastName: suggestName(x.lastName) }));
          p.id = await store.nextId('P'); p.version = 1; p.updatedAt = now(); p.updatedBy = actor; p.bio = ''; p.bioPublic = false; p.visible = true; p.specialties = ''; p.department = ''; p.affiliation = ''; p.displayAs = ''; p.externalId = pr.id;
          await store.putPerson(p); created++;
          if (p.email) index['e:' + p.email] = p.id; index[k2] = p.id; return p.id;
        };
        let base;
        if (target.slotId) {
          base = st.sessions.find(s => s.id === target.slotId);
          if (!base) throw new Error('Créneau introuvable.');
          if (!emptySlots(st).some(s => s.id === base.id)) throw new Error('Ce créneau n\'est plus vide : choisissez-en un autre.');
        } else {
          if (!target.day || !target.roomId || !/^\d{2}:\d{2}$/.test(target.start || '')) throw new Error('Choisissez un créneau vide, ou un jour, une salle et une heure de début.');
          base = blankSession(pr.type, target.day, target.roomId, target.start, fromMin(toMin(target.start) + 90));
        }
        const s = blankSession(pr.type, base.day, base.roomId, base.start, base.end);
        Object.assign(s, { id: base.id || '', num: base.num || 0, version: base.version || 0, title: pr.title, theme: pr.theme, description: pr.description,
          notes: `Proposée par la section ${pr.section} — ${displayName(pr.president)} (${pr.president.email}, ${pr.president.phone}). Réf. ${pr.id}.` + (pr.comment ? ' Commentaire : ' + pr.comment : '') });
        s.moderators = []; for (const m of pr.moderators || []) s.moderators.push(await resolve(m));
        if (pr.type === 'lectures') {
          s.lectures = []; for (const [k, l] of (pr.lectures || []).entries()) s.lectures.push({ id: 'L' + (k + 1), title: l.title, speakerId: await resolve(l.speaker), duration: l.duration, abstractRef: '', visible: true });
          s.discussion = pr.discussion;
        }
        if (pr.type === 'panel') { s.panelists = []; for (const m of pr.panelists) s.panelists.push(await resolve(m)); }
        if (pr.type === 'workshop') { s.facilitators = []; for (const m of pr.facilitators) s.facilitators.push(await resolve(m)); s.instructors = []; for (const m of pr.instructors) s.instructors.push(await resolve(m)); Object.assign(s, { objectives: pr.objectives, audience: pr.audience, capacity: pr.capacity }); }
        s.status = 'en_preparation';
        const saved = await svc.saveSession(actor, s, base.id ? base.version : null);
        if (saved.status === 'brouillon') { saved.status = 'en_preparation'; await store.putSession(saved); }
        pr.status = 'importee'; pr.sessionId = saved.id; pr.importedAt = now(); pr.importedBy = actor; await store.putProposal(pr);
        await log(actor, 'Import d\'une proposition', saved.id, `${pr.id} → ${codeOf(saved) || saved.id} · ${pr.title}`, [{ field: 'personnes', before: '', after: `${matched} reconnue(s) dans l'annuaire, ${created} créée(s)` }]);
        st = await state();
        return { session: saved, created, matched, issues: analyze(st).filter(x => x.sessionId === saved.id) };
      }
    };
    return svc;
  }

  return { PROPOSAL_TYPES, PROPOSAL_STATUS, cleanProposal, emptySlots, familyOf, codeOf, assignNumbers, chronoSort, swapContent, swapCheck, STATUS, TYPES, CEREMONY_KINDS, SPONSOR_STATUS, TITLES, LIVE, INACTIVE, THEMES, TEMPLATE, ROLE_FIELDS,
    toMin, fromMin, dur, overlap, nowIn, defaultCongress, suggestName, suggestInstitution, displayName, duplicates, peopleOf,
    blankSession, analyze, readiness, publicSnapshot, cleanSession, cleanPerson, cleanCongress, templateSessions, demoData, createService };
});
