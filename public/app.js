// Interface web – Dossier Patient GovStack Santé RDC (JavaScript natif, sans dépendance).

// ============================================================ Utilitaires
const $ = (sel, el = document) => el.querySelector(sel);
const app = $('#app');
const state = { me: null, ref: null, etablissements: [], medecins: [], fiche: null, tab: 'resume', audit: [] };

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nl = (v) => esc(v).replace(/\n/g, '<br>');

function parseDate(v) {
  if (!v) return null;
  // Une date seule (AAAA-MM-JJ) est interprétée en heure locale.
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { const [y, m, d] = v.split('-').map(Number); return new Date(y, m - 1, d); }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
const fmtDate = (v) => { const d = parseDate(v); return d ? d.toLocaleDateString('fr-FR') : '—'; };
const fmtDateTime = (v) => {
  const d = parseDate(v);
  return d ? d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
};
function age(dob) {
  const d = parseDate(dob);
  if (!d) return null;
  const now = new Date();
  let a = now.getFullYear() - d.getFullYear();
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) a--;
  return a;
}
const fullName = (p) => [p.nom, p.postnom, p.prenom].filter(Boolean).join(' ');
const drName = (nom, prenom) => (nom ? `Dr ${[prenom, nom].filter(Boolean).join(' ')}` : '—');
const toLocalInput = (d = new Date()) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const dash = (v) => (v === null || v === undefined || v === '' ? '—' : esc(v));

function toast(message, type = '') {
  const t = $('#toast');
  t.textContent = message;
  t.className = `show ${type}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.className = ''; }, 3500);
}

// ============================================================ API
class ApiError extends Error {
  constructor(status, data) {
    super(data?.error || `Erreur ${status}`);
    this.status = status;
    this.data = data;
  }
}

async function api(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, { error: 'Serveur injoignable. Vérifiez votre connexion internet.' });
  }
  const data = (res.headers.get('content-type') || '').includes('json') ? await res.json() : null;
  if (!res.ok) {
    const err = new ApiError(res.status, data);
    if (res.status === 401 && path !== '/api/auth/login') {
      err.handled = true;
      state.me = null;
      renderLogin(state.loggedOut ? '' : 'Votre session a expiré. Veuillez vous reconnecter.');
    } else if (res.status === 403 && data?.error === 'Vous devez changer votre mot de passe') {
      err.handled = true;
      renderForcedPassword();
    }
    throw err;
  }
  return data;
}

function errorHtml(err) {
  const details = err?.data?.details;
  const list = Array.isArray(details) && details.every((d) => typeof d === 'string')
    ? `<ul>${details.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : '';
  return `<strong>${esc(err?.message || 'Erreur inattendue')}</strong>${list}`;
}

// ============================================================ Formulaires
/*
 * Champ : { name, label, type, required, options, full, min, max, step, placeholder }
 * Types : text, textarea, select, date, datetime, number, email, tel, password
 */
function fieldHtml(f, values = {}) {
  const v = values[f.name];
  const req = f.required ? ' required' : '';
  const star = f.required ? ' <span class="req">*</span>' : '';
  const attrs = [
    f.min !== undefined && `min="${f.min}"`, f.max !== undefined && `max="${f.max}"`,
    f.step && `step="${f.step}"`, f.placeholder && `placeholder="${esc(f.placeholder)}"`,
    f.autocomplete && `autocomplete="${f.autocomplete}"`,
  ].filter(Boolean).join(' ');
  let input;
  if (f.type === 'textarea') {
    input = `<textarea name="${f.name}"${req} ${attrs}>${esc(v)}</textarea>`;
  } else if (f.type === 'select') {
    const opts = (f.options || []).map((o) => (typeof o === 'object' ? o : { value: o, label: o }));
    input = `<select name="${f.name}"${req}>
      <option value="">${esc(f.empty || '— Sélectionner —')}</option>
      ${opts.map((o) => `<option value="${esc(o.value)}"${String(o.value) === String(v ?? '') ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}
    </select>`;
  } else {
    const type = f.type === 'datetime' ? 'datetime-local' : f.type || 'text';
    let val = v ?? '';
    if (f.type === 'datetime' && val) val = toLocalInput(new Date(val));
    input = `<input type="${type}" name="${f.name}" value="${esc(val)}"${req} ${attrs}>`;
  }
  return `<label class="${f.full ? 'full' : ''}">${esc(f.label)}${star}${input}</label>`;
}

const gridHtml = (fields, values) => `<div class="form-grid">${fields.map((f) => fieldHtml(f, values)).join('')}</div>`;
const sectionsHtml = (sections, values) =>
  sections.map((s) => `<fieldset><legend>${esc(s.legend)}</legend>${gridHtml(s.fields, values)}</fieldset>`).join('');

function readFields(form, fields) {
  const out = {};
  for (const f of fields) {
    const el = form.elements[f.name];
    if (!el) continue;
    const raw = el.value.trim();
    if (raw === '') { out[f.name] = null; continue; }
    if (f.type === 'number') out[f.name] = Number(raw.replace(',', '.'));
    else if (f.type === 'datetime') out[f.name] = new Date(raw).toISOString();
    else if (f.type === 'select' && f.numeric) out[f.name] = Number(raw);
    else out[f.name] = raw;
  }
  return out;
}

// ============================================================ Dialogue
const dlg = $('#dialog');

function openDialog({ title, body, submitLabel = 'Enregistrer', onSubmit, cancel = true }) {
  $('#dialog-title').textContent = title;
  $('#dialog-body').innerHTML = body;
  $('#dialog-errors').innerHTML = '';
  const submit = $('#dialog-submit');
  submit.textContent = submitLabel;
  $('#dialog-footer [data-action="close-dialog"]').hidden = !cancel;
  const form = $('#dialog-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!onSubmit) return dlg.close();
    submit.disabled = true;
    $('#dialog-errors').innerHTML = '';
    try {
      const next = await onSubmit(form);
      if (next === false) return;
      dlg.close();
      if (typeof next === 'function') next();
    } catch (err) {
      if (!err.handled) $('#dialog-errors').innerHTML = errorHtml(err);
    } finally {
      submit.disabled = false;
    }
  };
  dlg.showModal();
  const first = $('#dialog-body input, #dialog-body select, #dialog-body textarea');
  if (first) first.focus();
}

function showSecret(title, intro, username, password) {
  openDialog({
    title,
    submitLabel: 'J\'ai noté ces informations',
    cancel: false,
    body: `<div class="alert info">${esc(intro)}</div>
      <p>Identifiant : <span class="secret">${esc(username)}</span></p>
      <p>Mot de passe temporaire : <span class="secret">${esc(password)}</span></p>
      <p class="muted small">Ce mot de passe ne sera plus affiché. Il devra être changé à la première connexion.</p>`,
  });
}

// ============================================================ Connexion
function renderLogin(message = '') {
  dlg.open && dlg.close();
  $('#topbar').hidden = true;
  app.innerHTML = `
    <div class="login-wrap">
      <div class="card login-card">
        <div class="flag"></div>
        <h1>Dossier Patient</h1>
        <p class="muted">République Démocratique du Congo · Solution GovStack Santé</p>
        ${message ? `<div class="alert info">${esc(message)}</div>` : ''}
        <form id="login-form" novalidate>
          <label>Identifiant (ou NUP pour les patients)
            <input name="username" autocomplete="username" required autofocus></label>
          <label>Mot de passe
            <input name="password" type="password" autocomplete="current-password" required></label>
          <div class="form-errors" id="login-errors" role="alert"></div>
          <button class="btn primary" type="submit">Se connecter</button>
        </form>
        <p class="muted small">Patients : votre identifiant est votre Numéro Unique Patient (NUP) remis par l'hôpital.</p>
      </div>
    </div>`;
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('button');
    btn.disabled = true;
    try {
      await api('POST', '/api/auth/login', { username: f.username.value.trim(), password: f.password.value });
      state.loggedOut = false;
      await boot();
    } catch (err) {
      $('#login-errors').innerHTML = errorHtml(err);
    } finally {
      btn.disabled = false;
    }
  });
}

const passwordFields = [
  { name: 'current_password', label: 'Mot de passe actuel', type: 'password', required: true, autocomplete: 'current-password' },
  { name: 'new_password', label: 'Nouveau mot de passe', type: 'password', required: true, autocomplete: 'new-password' },
  { name: 'confirm', label: 'Confirmer le nouveau mot de passe', type: 'password', required: true, autocomplete: 'new-password' },
];

async function submitPassword(form) {
  const d = readFields(form, passwordFields);
  if (d.new_password !== d.confirm) throw new ApiError(400, { error: 'Les deux mots de passe ne correspondent pas' });
  await api('POST', '/api/auth/password', { current_password: d.current_password, new_password: d.new_password });
}

function renderForcedPassword() {
  dlg.open && dlg.close();
  $('#topbar').hidden = true;
  app.innerHTML = `
    <div class="login-wrap">
      <div class="card login-card">
        <div class="flag"></div>
        <h1>Nouveau mot de passe</h1>
        <div class="alert info">Pour sécuriser votre dossier, choisissez un mot de passe personnel
          (8 caractères minimum, avec au moins une lettre et un chiffre).</div>
        <form id="pwd-form" novalidate>
          ${passwordFields.map((f) => fieldHtml(f)).join('')}
          <div class="form-errors" id="pwd-errors" role="alert"></div>
          <button class="btn primary" type="submit">Valider</button>
          <button class="btn ghost" type="button" data-action="logout">Annuler et se déconnecter</button>
        </form>
      </div>
    </div>`;
  $('#pwd-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await submitPassword(e.target);
      toast('Mot de passe modifié');
      await boot();
    } catch (err) {
      $('#pwd-errors').innerHTML = errorHtml(err);
    }
  });
}

// ============================================================ Navigation
const NAV = {
  medecin: [['#/', 'Tableau de bord'], ['#/patients', 'Patients'], ['#/rendez-vous', 'Rendez-vous'], ['#/compte', 'Mon compte']],
  patient: [['#/', 'Ma fiche'], ['#/rendez-vous', 'Mes rendez-vous'], ['#/compte', 'Mon compte']],
  admin: [['#/', 'Tableau de bord'], ['#/etablissements', 'Établissements'], ['#/utilisateurs', 'Utilisateurs'], ['#/audit', "Journal d'audit"], ['#/compte', 'Mon compte']],
};

const ROUTES = {
  medecin: [
    [/^\/$/, viewDoctorHome], [/^\/patients$/, viewPatients], [/^\/patients\/(\d+)$/, (id) => viewFiche(Number(id))],
    [/^\/rendez-vous$/, viewDoctorRdv], [/^\/compte$/, viewCompte],
  ],
  patient: [[/^\/$/, () => viewFiche(state.me.patient_id)], [/^\/rendez-vous$/, viewPatientRdv], [/^\/compte$/, viewCompte]],
  admin: [
    [/^\/$/, viewAdminHome], [/^\/etablissements$/, viewEtablissements], [/^\/utilisateurs$/, viewUsers],
    [/^\/audit$/, viewAudit], [/^\/compte$/, viewCompte],
  ],
};

async function route() {
  if (!state.me) return;
  const path = (location.hash || '#/').slice(1) || '/';
  const role = state.me.role;
  document.querySelectorAll('#nav a').forEach((a) => {
    const href = a.getAttribute('href').slice(1);
    a.classList.toggle('active', href === '/' ? path === '/' : path.startsWith(href));
  });
  for (const [re, view] of ROUTES[role]) {
    const m = path.match(re);
    if (m) {
      app.innerHTML = '<p class="loading">Chargement…</p>';
      try {
        await view(...m.slice(1));
      } catch (err) {
        if (!err.handled) app.innerHTML = `<div class="alert danger">${errorHtml(err)}</div>`;
      }
      app.focus({ preventScroll: true });
      return;
    }
  }
  location.hash = '#/';
}

async function boot() {
  try {
    state.me = await api('GET', '/api/auth/me');
  } catch (err) {
    if (!err.handled) renderLogin();
    return;
  }
  if (state.me.must_change_password) return renderForcedPassword();
  [state.ref, state.etablissements, state.medecins] = await Promise.all([
    api('GET', '/api/referentiels'), api('GET', '/api/etablissements'), api('GET', '/api/medecins'),
  ]);
  const me = state.me;
  $('#topbar').hidden = false;
  $('#nav').innerHTML = NAV[me.role].map(([href, label]) => `<a href="${href}">${esc(label)}</a>`).join('');
  const roleLabel = { admin: 'Administrateur', medecin: 'Médecin', patient: 'Patient' }[me.role];
  $('#whoami').innerHTML = `${esc(me.role === 'medecin' ? drName(me.nom, me.prenom) : [me.prenom, me.nom].filter(Boolean).join(' '))}
    <span class="badge blue">${roleLabel}</span>${me.etablissement_nom ? ` <span class="muted small etab" title="${esc(me.etablissement_nom)}">${esc(me.etablissement_nom)}</span>` : ''}`;
  await route();
}

window.addEventListener('hashchange', route);

// ============================================================ Actions (délégation d'événements)
const actions = {};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || !actions[el.dataset.action]) return;
  e.preventDefault();
  Promise.resolve(actions[el.dataset.action](el, e)).catch((err) => {
    if (!err.handled) toast(err.message, 'error');
  });
});

actions['close-dialog'] = () => dlg.close();
actions.logout = async () => {
  state.loggedOut = true;
  try { await api('POST', '/api/auth/logout', {}); } catch { /* déjà déconnecté */ }
  state.me = null;
  location.hash = '#/';
  renderLogin('Vous êtes déconnecté.');
};
actions['open-patient'] = (el) => { location.hash = `#/patients/${el.dataset.id}`; };

// ============================================================ Médecin : tableau de bord
const STATUT_RDV = {
  demande: ['Demande', 'orange'], confirme: ['Confirmé', 'blue'], annule: ['Annulé', 'red'], termine: ['Terminé', 'green'],
};
const rdvBadge = (s) => `<span class="badge ${STATUT_RDV[s]?.[1] || ''}">${esc(STATUT_RDV[s]?.[0] || s)}</span>`;

function rdvTable(rows, { withPatient = true, withActions = true, patientCancel = false } = {}) {
  if (!rows.length) return '<p class="empty">Aucun rendez-vous.</p>';
  return `<div class="table-wrap"><table>
    <thead><tr><th>Date</th>${withPatient ? '<th>Patient</th>' : ''}<th>Médecin</th><th>Établissement</th><th>Motif</th><th>Statut</th>${withActions || patientCancel ? '<th></th>' : ''}</tr></thead>
    <tbody>${rows.map((r) => `<tr>
      <td>${fmtDateTime(r.date_heure)}</td>
      ${withPatient ? `<td><a href="#/patients/${r.patient_id}">${esc(fullName({ nom: r.patient_nom, postnom: r.patient_postnom, prenom: r.patient_prenom }))}</a>
        <div class="muted small">${esc(r.nup)}${r.patient_telephone ? ' · ' + esc(r.patient_telephone) : ''}</div></td>` : ''}
      <td>${r.medecin_nom ? esc(drName(r.medecin_nom, r.medecin_prenom)) : '<span class="muted">Non attribué</span>'}</td>
      <td>${dash(r.etablissement_nom)}</td>
      <td>${dash(r.motif)}</td>
      <td>${rdvBadge(r.statut)}</td>
      ${withActions ? `<td class="actions">
        ${r.statut === 'demande' ? `<button class="btn small primary" data-action="rdv-status" data-id="${r.id}" data-statut="confirme">Confirmer</button>` : ''}
        ${r.statut === 'confirme' ? `<button class="btn small" data-action="rdv-status" data-id="${r.id}" data-statut="termine">Terminé</button>` : ''}
        ${['demande', 'confirme'].includes(r.statut) ? `<button class="btn small danger" data-action="rdv-status" data-id="${r.id}" data-statut="annule">Annuler</button>` : ''}
      </td>` : ''}
      ${patientCancel ? `<td>${['demande', 'confirme'].includes(r.statut) && parseDate(r.date_heure) > new Date()
        ? `<button class="btn small danger" data-action="rdv-status" data-id="${r.id}" data-statut="annule">Annuler</button>` : ''}</td>` : ''}
    </tr>`).join('')}</tbody></table></div>`;
}

actions['rdv-status'] = async (el) => {
  const labels = { confirme: 'confirmer', termine: 'marquer comme terminé', annule: 'annuler' };
  if (el.dataset.statut === 'annule' && !confirm(`Voulez-vous ${labels.annule} ce rendez-vous ?`)) return;
  await api('PATCH', `/api/rendez-vous/${el.dataset.id}`, { statut: el.dataset.statut });
  toast('Rendez-vous mis à jour');
  if (state.fiche && location.hash.startsWith('#/patients/')) return reloadFiche();
  route();
};

async function viewDoctorHome() {
  const [stats, rdv] = await Promise.all([
    api('GET', '/api/stats'),
    api('GET', `/api/rendez-vous?du=${encodeURIComponent(startOfToday().toISOString())}`),
  ]);
  const active = rdv.filter((r) => ['demande', 'confirme'].includes(r.statut));
  app.innerHTML = `
    <div class="page-head"><h1>Bonjour, ${esc(drName(state.me.nom, state.me.prenom))}</h1>
      <div class="actions"><button class="btn primary" data-action="new-patient">+ Nouveau patient</button></div></div>
    <form class="search-bar" id="quick-search">
      <input name="q" type="search" placeholder="Rechercher un patient : nom, NUP ou téléphone…" aria-label="Rechercher un patient">
      <button class="btn primary">Rechercher</button>
    </form>
    <div class="stats">
      ${stat(stats.mes_consultations_jour, 'Mes consultations du jour')}
      ${stat(stats.consultations_jour, 'Consultations du jour (total)')}
      ${stat(stats.hospitalises, 'Patients hospitalisés')}
      ${stat(stats.examens_en_attente, 'Examens en attente')}
      ${stat(stats.rdv_demandes, 'Demandes de rendez-vous')}
      ${stat(stats.patients, 'Patients enregistrés')}
    </div>
    <div class="card"><h2>Rendez-vous à venir</h2>${rdvTable(active)}</div>`;
  $('#quick-search').addEventListener('submit', (e) => {
    e.preventDefault();
    state.lastSearch = e.target.q.value.trim();
    location.hash = '#/patients';
  });
}

const stat = (value, label) => `<div class="stat"><div class="value">${esc(value)}</div><div class="label">${esc(label)}</div></div>`;

// ============================================================ Médecin : patients
async function viewPatients() {
  app.innerHTML = `
    <div class="page-head"><h1>Patients</h1>
      <div class="actions"><button class="btn primary" data-action="new-patient">+ Nouveau patient</button></div></div>
    <form class="search-bar" id="search-form">
      <input name="q" type="search" placeholder="Nom, postnom, prénom, NUP ou téléphone…" value="${esc(state.lastSearch || '')}" aria-label="Rechercher">
      <button class="btn primary">Rechercher</button>
    </form>
    <div class="card" id="results"><p class="loading">Chargement…</p></div>`;
  const form = $('#search-form');
  const run = async () => {
    state.lastSearch = form.q.value.trim();
    const rows = await api('GET', `/api/patients?q=${encodeURIComponent(state.lastSearch)}`);
    $('#results').innerHTML = rows.length ? `<div class="table-wrap"><table>
      <thead><tr><th>NUP</th><th>Nom complet</th><th>Sexe</th><th>Âge</th><th>Téléphone</th><th>Localité</th><th>Dernière consultation</th></tr></thead>
      <tbody>${rows.map((p) => `<tr class="clickable" data-action="open-patient" data-id="${p.id}">
        <td class="nup">${esc(p.nup)}</td>
        <td><strong>${esc(fullName(p))}</strong> ${p.hospitalise ? '<span class="badge orange">Hospitalisé</span>' : ''}</td>
        <td>${esc(p.sexe)}</td><td>${age(p.date_naissance) ?? '—'}</td><td>${dash(p.telephone)}</td>
        <td>${dash([p.ville, p.province].filter(Boolean).join(', '))}</td>
        <td>${p.derniere_consultation ? fmtDate(p.derniere_consultation) : '—'}</td>
      </tr>`).join('')}</tbody></table></div>
      ${!state.lastSearch ? '<p class="muted small">Patients récemment mis à jour. Utilisez la recherche pour retrouver un dossier.</p>' : ''}`
      : `<p class="empty">Aucun patient trouvé.${state.lastSearch ? ' <button class="btn small" data-action="new-patient">Créer une fiche</button>' : ''}</p>`;
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); run().catch((err) => !err.handled && toast(err.message, 'error')); });
  await run();
}

function patientSections() {
  const r = state.ref;
  return [
    { legend: 'Identité', fields: [
      { name: 'nom', label: 'Nom', required: true }, { name: 'postnom', label: 'Postnom' }, { name: 'prenom', label: 'Prénom' },
      { name: 'sexe', label: 'Sexe', type: 'select', required: true, options: [{ value: 'M', label: 'Masculin' }, { value: 'F', label: 'Féminin' }] },
      { name: 'date_naissance', label: 'Date de naissance', type: 'date', max: new Date().toISOString().slice(0, 10) },
      { name: 'lieu_naissance', label: 'Lieu de naissance' },
      { name: 'etat_civil', label: 'État civil', type: 'select', options: r.etatsCivils },
      { name: 'profession', label: 'Profession' },
    ] },
    { legend: 'Coordonnées', fields: [
      { name: 'telephone', label: 'Téléphone', type: 'tel', placeholder: '+243 …' }, { name: 'email', label: 'E-mail', type: 'email' },
      { name: 'province', label: 'Province', type: 'select', options: r.provinces },
      { name: 'ville', label: 'Ville / Territoire' }, { name: 'commune', label: 'Commune' }, { name: 'quartier', label: 'Quartier' },
      { name: 'adresse', label: 'Adresse (avenue, n°)', full: true },
    ] },
    { legend: 'Informations médicales', fields: [
      { name: 'groupe_sanguin', label: 'Groupe sanguin', type: 'select', options: r.groupesSanguins },
      { name: 'assurance', label: 'Assurance / mutuelle' },
      { name: 'allergies', label: 'Allergies', type: 'textarea', full: true },
      { name: 'maladies_chroniques', label: 'Maladies chroniques (HTA, diabète, drépanocytose, VIH…)', type: 'textarea', full: true },
      { name: 'antecedents', label: 'Antécédents médicaux et chirurgicaux', type: 'textarea', full: true },
    ] },
    { legend: "Personne à contacter en cas d'urgence", fields: [
      { name: 'contact_urgence_nom', label: 'Nom complet' }, { name: 'contact_urgence_tel', label: 'Téléphone', type: 'tel' },
      { name: 'contact_urgence_lien', label: 'Lien de parenté' },
    ] },
  ];
}

actions['new-patient'] = () => {
  const sections = patientSections();
  const fields = sections.flatMap((s) => s.fields);
  openDialog({
    title: 'Nouvelle fiche patient',
    body: sectionsHtml(sections, {}),
    submitLabel: 'Créer la fiche',
    onSubmit: async (form) => {
      const data = readFields(form, fields);
      let p;
      try {
        p = await api('POST', '/api/patients', data);
      } catch (err) {
        if (err.status !== 409 || !Array.isArray(err.data?.details)) throw err;
        const list = err.data.details.map((d) => `• ${fullName(d)} (${d.nup})${d.date_naissance ? ' né(e) le ' + fmtDate(d.date_naissance) : ''}`).join('\n');
        if (!confirm(`Patient(s) similaire(s) déjà enregistré(s) :\n${list}\n\nS'agit-il bien d'un NOUVEAU patient ?`)) return false;
        p = await api('POST', '/api/patients', { ...data, confirmer_doublon: true });
      }
      toast(`Fiche créée : ${p.nup}`);
      return () => { location.hash = `#/patients/${p.id}`; };
    },
  });
};

// ============================================================ Fiche patient
async function viewFiche(id) {
  if (!state.fiche || state.fiche.patient.id !== id) state.tab = 'resume';
  state.fiche = await api('GET', `/api/patients/${id}`);
  renderFiche();
}

async function reloadFiche() {
  state.fiche = await api('GET', `/api/patients/${state.fiche.patient.id}`);
  renderFiche();
}

const readOnly = () => state.me.role !== 'medecin';

function renderFiche() {
  const { patient: p, consultations, examens, hospitalisations, rendez_vous, compte } = state.fiche;
  const ro = readOnly();
  const hosp = hospitalisations.find((h) => h.statut === 'en_cours');
  const a = age(p.date_naissance);
  const initials = (p.nom[0] + (p.prenom?.[0] || p.postnom?.[0] || '')).toUpperCase();
  const tabs = [
    ['resume', 'Identité & antécédents'], ['consultations', 'Consultations', consultations.length],
    ['examens', 'Examens', examens.length], ['hospitalisations', 'Hospitalisations', hospitalisations.length],
    ['rdv', 'Rendez-vous', rendez_vous.length], ['acces', 'Journal des accès'],
  ];
  app.innerHTML = `
    ${ro ? '' : '<p class="no-print"><a href="#/patients">← Retour à la liste</a></p>'}
    <div class="print-only"><strong>République Démocratique du Congo – Dossier patient</strong>
      <div class="small">Imprimé le ${fmtDateTime(new Date().toISOString())}</div><hr></div>
    <div class="card">
      <div class="patient-header">
        <div class="avatar" aria-hidden="true">${esc(initials)}</div>
        <div class="info">
          <h1>${esc(fullName(p))}</h1>
          <div class="meta">
            <span>NUP : <span class="nup">${esc(p.nup)}</span></span>
            <span>${p.sexe === 'F' ? 'Féminin' : 'Masculin'}${a !== null ? ` · ${a} an${a > 1 ? 's' : ''}` : ''}</span>
            ${p.date_naissance ? `<span>Né(e) le ${fmtDate(p.date_naissance)}</span>` : ''}
            ${p.groupe_sanguin ? `<span class="badge red">Groupe ${esc(p.groupe_sanguin)}</span>` : ''}
            ${hosp ? `<span class="badge orange">Hospitalisé(e) – ${esc(hosp.service)}</span>` : ''}
          </div>
        </div>
        <div class="actions">
          ${ro ? '' : `
            <button class="btn primary" data-action="new-consultation">+ Consultation</button>
            <button class="btn" data-action="new-examen">Examen</button>
            ${hosp ? '' : '<button class="btn" data-action="hospitaliser">Hospitaliser</button>'}
            <button class="btn" data-action="new-rdv">Rendez-vous</button>
            <button class="btn" data-action="edit-patient">Modifier</button>
            <button class="btn" data-action="compte-patient">${compte ? 'Réinitialiser l\'accès patient' : 'Créer l\'accès patient'}</button>`}
          <button class="btn" data-action="export-fhir" title="Export au format HL7 FHIR R4">Export FHIR</button>
          <button class="btn" data-action="print">Imprimer</button>
        </div>
      </div>
      ${p.allergies ? `<div class="alert danger no-margin"><strong>⚠ Allergies :</strong> ${nl(p.allergies)}</div>` : ''}
    </div>
    <nav class="tabs" role="tablist">${tabs.map(([k, label, n]) => `
      <button role="tab" data-action="tab" data-tab="${k}" class="${state.tab === k ? 'active' : ''}" aria-selected="${state.tab === k}">
        ${esc(label)}${n !== undefined ? `<span class="count">${n}</span>` : ''}</button>`).join('')}
    </nav>
    ${panel('resume', 'Identité & antécédents', resumeHtml(p, compte))}
    ${panel('consultations', 'Consultations', consultationsHtml(consultations))}
    ${panel('examens', 'Examens', examensHtml(examens, ro))}
    ${panel('hospitalisations', 'Hospitalisations', hospitalisationsHtml(hospitalisations, ro))}
    ${panel('rdv', 'Rendez-vous', `<div class="card">${rdvTable(rendez_vous, { withPatient: false, withActions: !ro, patientCancel: ro })}</div>`)}
    ${panel('acces', 'Journal des accès', `<div class="card" id="acces-panel"><p class="loading">Chargement…</p></div>`, true)}`;
  if (state.tab === 'acces') loadAcces();
}

const panel = (key, title, html, noPrint = false) =>
  `<section class="tab-panel ${state.tab === key ? '' : 'hidden'} ${noPrint ? 'no-print' : ''}" data-panel="${key}">
     <h2 class="print-only">${esc(title)}</h2>${html}</section>`;

actions.tab = (el) => {
  state.tab = el.dataset.tab;
  document.querySelectorAll('.tabs button').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === state.tab);
    b.setAttribute('aria-selected', b.dataset.tab === state.tab);
  });
  document.querySelectorAll('.tab-panel').forEach((s) => s.classList.toggle('hidden', s.dataset.panel !== state.tab));
  if (state.tab === 'acces') loadAcces();
};

const dl = (items) => `<dl class="details">${items.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v === undefined || v === null || v === '' ? '—' : v}</dd></div>`).join('')}</dl>`;

function resumeHtml(p, compte) {
  return `
    <div class="card"><h2>Identité</h2>${dl([
      ['Nom', esc(p.nom)], ['Postnom', esc(p.postnom)], ['Prénom', esc(p.prenom)],
      ['Sexe', p.sexe === 'F' ? 'Féminin' : 'Masculin'], ['Date de naissance', p.date_naissance ? fmtDate(p.date_naissance) : ''],
      ['Lieu de naissance', esc(p.lieu_naissance)], ['État civil', esc(p.etat_civil)], ['Profession', esc(p.profession)],
    ])}</div>
    <div class="card"><h2>Coordonnées</h2>${dl([
      ['Téléphone', esc(p.telephone)], ['E-mail', esc(p.email)], ['Province', esc(p.province)], ['Ville / Territoire', esc(p.ville)],
      ['Commune', esc(p.commune)], ['Quartier', esc(p.quartier)], ['Adresse', esc(p.adresse)],
    ])}</div>
    <div class="card"><h2>Informations médicales</h2>${dl([
      ['Groupe sanguin', esc(p.groupe_sanguin)], ['Assurance / mutuelle', esc(p.assurance)],
      ['Allergies', nl(p.allergies)], ['Maladies chroniques', nl(p.maladies_chroniques)], ['Antécédents', nl(p.antecedents)],
    ])}</div>
    <div class="card"><h2>Contact d'urgence</h2>${dl([
      ['Nom', esc(p.contact_urgence_nom)], ['Téléphone', esc(p.contact_urgence_tel)], ['Lien', esc(p.contact_urgence_lien)],
    ])}</div>
    <div class="card no-print"><h2>Dossier</h2>${dl([
      ['Enregistré le', fmtDateTime(p.created_at)], ['Établissement d\'enregistrement', esc(p.etablissement_nom)],
      ['Dernière mise à jour', fmtDateTime(p.updated_at)],
      ['Accès en ligne du patient', compte ? `Actif (identifiant ${esc(compte.username)})${compte.last_login_at ? ` · dernière connexion ${fmtDateTime(compte.last_login_at)}` : ''}` : 'Non créé'],
    ])}</div>`;
}

function vitalsHtml(c) {
  const v = [];
  if (c.temperature != null) v.push(`T° ${c.temperature} °C`);
  if (c.tension_sys != null) v.push(`TA ${c.tension_sys}/${c.tension_dia ?? '?'} mmHg`);
  if (c.pouls != null) v.push(`Pouls ${c.pouls}/min`);
  if (c.frequence_resp != null) v.push(`FR ${c.frequence_resp}/min`);
  if (c.saturation != null) v.push(`SpO₂ ${c.saturation} %`);
  if (c.poids != null) v.push(`Poids ${c.poids} kg`);
  if (c.taille != null) v.push(`Taille ${c.taille} cm`);
  if (c.poids && c.taille) v.push(`IMC ${(c.poids / (c.taille / 100) ** 2).toFixed(1)}`);
  return v.length ? `<div class="vitals">${v.map((x) => `<span>${esc(x)}</span>`).join('')}</div>` : '';
}

const block = (label, value) => (value ? `<div class="section-label">${esc(label)}</div><div>${nl(value)}</div>` : '');

function consultationsHtml(list) {
  if (!list.length) return '<div class="card"><p class="empty">Aucune consultation enregistrée.</p></div>';
  return `<div class="card">${list.map((c) => `
    <article class="timeline-item">
      <h3>${esc(c.motif)}</h3>
      <div class="muted small">${fmtDateTime(c.date)} · ${esc(drName(c.medecin_nom, c.medecin_prenom))}${c.medecin_specialite ? ` (${esc(c.medecin_specialite)})` : ''}${c.etablissement_nom ? ` · ${esc(c.etablissement_nom)}` : ''}</div>
      ${vitalsHtml(c)}
      ${block('Symptômes', c.symptomes)}
      ${block('Examen clinique', c.examen_clinique)}
      ${c.diagnostic || c.code_cim10 ? `<div class="section-label">Diagnostic</div><div>${nl(c.diagnostic)} ${c.code_cim10 ? `<span class="badge blue">CIM-10 ${esc(c.code_cim10)}</span>` : ''}</div>` : ''}
      ${block('Traitement', c.traitement)}
      ${c.prescriptions.length ? `<div class="section-label">Ordonnance</div><div class="table-wrap"><table>
        <thead><tr><th>Médicament</th><th>Dosage</th><th>Posologie</th><th>Durée</th><th>Instructions</th></tr></thead>
        <tbody>${c.prescriptions.map((r) => `<tr><td><strong>${esc(r.medicament)}</strong></td><td>${dash(r.dosage)}</td><td>${dash(r.posologie)}</td><td>${dash(r.duree)}</td><td>${dash(r.instructions)}</td></tr>`).join('')}</tbody>
      </table></div>` : ''}
      ${block('Recommandations', c.recommandations)}
    </article>`).join('')}</div>`;
}

function examensHtml(list, ro) {
  if (!list.length) return '<div class="card"><p class="empty">Aucun examen demandé.</p></div>';
  return `<div class="card"><div class="table-wrap"><table>
    <thead><tr><th>Demandé le</th><th>Examen</th><th>Prescripteur</th><th>Statut</th><th>Résultat</th></tr></thead>
    <tbody>${list.map((x) => `<tr>
      <td>${fmtDateTime(x.date_demande)}</td>
      <td><strong>${esc(x.libelle)}</strong> <span class="badge">${esc(x.type)}</span>${x.notes ? `<div class="muted small">${nl(x.notes)}</div>` : ''}</td>
      <td>${esc(drName(x.medecin_nom, x.medecin_prenom))}<div class="muted small">${dash(x.etablissement_nom)}</div></td>
      <td>${x.statut === 'resultat' ? '<span class="badge green">Résultat disponible</span>' : '<span class="badge orange">En attente</span>'}</td>
      <td>${x.statut === 'resultat'
        ? `${nl(x.resultat)}${x.interpretation ? `<div class="muted small">${nl(x.interpretation)}</div>` : ''}<div class="muted small">${fmtDateTime(x.date_resultat)}</div>`
        : ro ? '—' : `<button class="btn small primary" data-action="saisir-resultat" data-id="${x.id}">Saisir le résultat</button>`}</td>
    </tr>`).join('')}</tbody></table></div></div>`;
}

function hospitalisationsHtml(list, ro) {
  if (!list.length) return '<div class="card"><p class="empty">Aucune hospitalisation.</p></div>';
  return `<div class="card">${list.map((h) => `
    <article class="timeline-item">
      <h3>${esc(h.service)} ${h.statut === 'en_cours' ? '<span class="badge orange">En cours</span>' : '<span class="badge green">Terminée</span>'}</h3>
      <div class="muted small">${esc(h.etablissement_nom || '')}${h.chambre ? ` · Chambre ${esc(h.chambre)}` : ''}${h.lit ? ` · Lit ${esc(h.lit)}` : ''} · ${esc(drName(h.medecin_nom, h.medecin_prenom))}</div>
      ${dl([
        ['Admission', fmtDateTime(h.date_admission)], ['Sortie', h.date_sortie ? fmtDateTime(h.date_sortie) : ''],
        ['Mode de sortie', esc(h.mode_sortie)],
      ])}
      ${block("Motif d'admission", h.motif)}
      ${block('Résumé de sortie', h.resume_sortie)}
      ${h.statut === 'en_cours' && !ro ? `<p><button class="btn primary small" data-action="sortie" data-id="${h.id}">Enregistrer la sortie</button></p>` : ''}
    </article>`).join('')}</div>`;
}

const ACTION_LABELS = {
  LECTURE_FICHE: 'Consultation du dossier', CREATION_FICHE: 'Création du dossier', MODIFICATION_FICHE: 'Modification du dossier',
  AJOUT_CONSULTATION: 'Ajout d\'une consultation', DEMANDE_EXAMEN: "Demande d'examen", RESULTAT_EXAMEN: "Résultat d'examen",
  ADMISSION: 'Hospitalisation', SORTIE: 'Sortie d\'hospitalisation', CREATION_RDV: 'Rendez-vous créé', MODIFICATION_RDV: 'Rendez-vous modifié',
  CREATION_COMPTE_PATIENT: 'Création de l\'accès patient', REINITIALISATION_COMPTE_PATIENT: "Réinitialisation de l'accès patient",
  FHIR_LECTURE_PATIENT: 'Lecture FHIR', FHIR_EXPORT_DOSSIER: 'Export FHIR du dossier', CONNEXION: 'Connexion du patient',
};

async function loadAcces() {
  const el = $('#acces-panel');
  if (!el) return;
  const rows = await api('GET', `/api/patients/${state.fiche.patient.id}/acces`);
  el.innerHTML = `<p class="muted small">Toute consultation ou modification de ce dossier est tracée. Ce journal est visible par le patient.</p>
    ${rows.length ? `<div class="table-wrap"><table>
    <thead><tr><th>Date</th><th>Action</th><th>Par</th><th>Établissement</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td>${fmtDateTime(r.ts)}</td><td>${esc(ACTION_LABELS[r.action] || r.action)}</td>
      <td>${r.role === 'medecin' ? esc(drName(r.nom, r.prenom)) : r.role === 'patient' ? 'Le patient' : esc([r.prenom, r.nom].filter(Boolean).join(' ') || r.role)}
        ${r.specialite ? `<span class="muted small">(${esc(r.specialite)})</span>` : ''}</td>
      <td>${dash(r.etablissement_nom)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">Aucun accès enregistré.</p>'}`;
}

// ---------- Actions de la fiche
actions.print = () => window.print();

actions['export-fhir'] = async () => {
  const nup = state.fiche.patient.nup;
  const bundle = await api('GET', `/fhir/r4/Patient/${encodeURIComponent(nup)}/$everything`);
  const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/fhir+json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `dossier-${nup}.fhir.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Dossier exporté au format FHIR R4');
};

actions['edit-patient'] = () => {
  const sections = patientSections();
  const fields = sections.flatMap((s) => s.fields);
  openDialog({
    title: 'Modifier la fiche patient',
    body: sectionsHtml(sections, state.fiche.patient),
    onSubmit: async (form) => {
      await api('PATCH', `/api/patients/${state.fiche.patient.id}`, readFields(form, fields));
      toast('Fiche mise à jour');
      return reloadFiche;
    },
  });
};

actions['compte-patient'] = async () => {
  const exists = !!state.fiche.compte;
  const msg = exists
    ? 'Réinitialiser le mot de passe du patient ? L\'ancien mot de passe ne fonctionnera plus.'
    : 'Créer un accès en ligne pour ce patient ? Il pourra consulter sa fiche, ses résultats et ses rendez-vous.';
  if (!confirm(msg)) return;
  const r = await api('POST', `/api/patients/${state.fiche.patient.id}/compte`, {});
  await reloadFiche();
  showSecret('Accès patient', 'Remettez ces informations au patient (sur papier, de manière confidentielle).', r.username, r.temp_password);
};

const consultationFields = [
  { name: 'date', label: 'Date et heure', type: 'datetime' },
  { name: 'motif', label: 'Motif de consultation', required: true },
  { name: 'symptomes', label: 'Symptômes / plaintes', type: 'textarea', full: true },
];
const vitalFields = [
  { name: 'temperature', label: 'Température (°C)', type: 'number', step: '0.1', min: 30, max: 45 },
  { name: 'tension_sys', label: 'TA systolique (mmHg)', type: 'number', min: 40, max: 300 },
  { name: 'tension_dia', label: 'TA diastolique (mmHg)', type: 'number', min: 20, max: 200 },
  { name: 'pouls', label: 'Pouls (/min)', type: 'number', min: 20, max: 250 },
  { name: 'frequence_resp', label: 'Fréq. respiratoire (/min)', type: 'number', min: 5, max: 80 },
  { name: 'saturation', label: 'SpO₂ (%)', type: 'number', min: 50, max: 100 },
  { name: 'poids', label: 'Poids (kg)', type: 'number', step: '0.1', min: 0.3, max: 400 },
  { name: 'taille', label: 'Taille (cm)', type: 'number', step: '0.1', min: 20, max: 250 },
];
const diagnosticFields = [
  { name: 'examen_clinique', label: 'Examen clinique', type: 'textarea', full: true },
  { name: 'diagnostic', label: 'Diagnostic', type: 'textarea', full: true },
  { name: 'code_cim10', label: 'Code CIM-10 (ex. B54)', placeholder: 'B54' },
  { name: 'traitement', label: 'Traitement / conduite à tenir', type: 'textarea', full: true },
  { name: 'recommandations', label: 'Recommandations au patient', type: 'textarea', full: true },
];

const rxRow = () => `<div class="rx-row">
  <label>Médicament<input name="rx_medicament" placeholder="ex. Paracétamol"></label>
  <label>Dosage<input name="rx_dosage" placeholder="500 mg"></label>
  <label>Posologie<input name="rx_posologie" placeholder="1 cp x 3/jour"></label>
  <label>Durée<input name="rx_duree" placeholder="5 jours"></label>
  <button type="button" class="btn small danger" data-action="remove-rx" aria-label="Retirer">×</button>
</div>`;

actions['add-rx'] = () => $('#rx-list').insertAdjacentHTML('beforeend', rxRow());
actions['remove-rx'] = (el) => el.closest('.rx-row').remove();

actions['new-consultation'] = () => {
  openDialog({
    title: `Nouvelle consultation – ${fullName(state.fiche.patient)}`,
    body: `
      <fieldset><legend>Consultation</legend>${gridHtml(consultationFields, { date: new Date().toISOString() })}</fieldset>
      <fieldset><legend>Signes vitaux</legend>${gridHtml(vitalFields, {})}</fieldset>
      <fieldset><legend>Examen & diagnostic</legend>${gridHtml(diagnosticFields, {})}</fieldset>
      <fieldset><legend>Ordonnance</legend><div id="rx-list">${rxRow()}</div>
        <button type="button" class="btn small" data-action="add-rx">+ Ajouter un médicament</button></fieldset>`,
    onSubmit: async (form) => {
      const data = readFields(form, [...consultationFields, ...vitalFields, ...diagnosticFields]);
      data.prescriptions = [...form.querySelectorAll('.rx-row')].map((row) => ({
        medicament: row.querySelector('[name=rx_medicament]').value.trim(),
        dosage: row.querySelector('[name=rx_dosage]').value.trim() || null,
        posologie: row.querySelector('[name=rx_posologie]').value.trim() || null,
        duree: row.querySelector('[name=rx_duree]').value.trim() || null,
      })).filter((r) => r.medicament);
      await api('POST', `/api/patients/${state.fiche.patient.id}/consultations`, data);
      toast('Consultation enregistrée');
      state.tab = 'consultations';
      return reloadFiche;
    },
  });
};

actions['new-examen'] = () => {
  const consultations = state.fiche.consultations.map((c) => ({ value: c.id, label: `${fmtDate(c.date)} – ${c.motif}` }));
  const fields = [
    { name: 'type', label: "Type d'examen", type: 'select', required: true, options: state.ref.typesExamen },
    { name: 'libelle', label: 'Examen demandé', required: true, placeholder: 'ex. Goutte épaisse, NFS, Échographie…' },
    { name: 'consultation_id', label: 'Consultation liée', type: 'select', numeric: true, options: consultations, empty: '— Aucune —' },
    { name: 'notes', label: 'Renseignements cliniques', type: 'textarea', full: true },
  ];
  openDialog({
    title: "Demande d'examen",
    body: gridHtml(fields, { type: 'Laboratoire', consultation_id: state.fiche.consultations[0]?.id }),
    submitLabel: 'Demander',
    onSubmit: async (form) => {
      await api('POST', `/api/patients/${state.fiche.patient.id}/examens`, readFields(form, fields));
      toast('Examen demandé');
      state.tab = 'examens';
      return reloadFiche;
    },
  });
};

actions['saisir-resultat'] = (el) => {
  const x = state.fiche.examens.find((e) => e.id === Number(el.dataset.id));
  const fields = [
    { name: 'resultat', label: 'Résultat', type: 'textarea', required: true, full: true },
    { name: 'interpretation', label: 'Interprétation', type: 'textarea', full: true },
  ];
  openDialog({
    title: `Résultat – ${x.libelle}`,
    body: gridHtml(fields, {}),
    onSubmit: async (form) => {
      await api('PATCH', `/api/examens/${x.id}/resultat`, readFields(form, fields));
      toast('Résultat enregistré');
      return reloadFiche;
    },
  });
};

actions.hospitaliser = () => {
  const fields = [
    { name: 'service', label: 'Service', required: true, placeholder: 'Médecine interne, Pédiatrie, Maternité…' },
    { name: 'chambre', label: 'Chambre' }, { name: 'lit', label: 'Lit' },
    { name: 'date_admission', label: "Date d'admission", type: 'datetime' },
    { name: 'motif', label: "Motif d'admission", type: 'textarea', required: true, full: true },
  ];
  openDialog({
    title: `Hospitalisation – ${fullName(state.fiche.patient)}`,
    body: gridHtml(fields, { date_admission: new Date().toISOString() }),
    submitLabel: 'Admettre',
    onSubmit: async (form) => {
      await api('POST', `/api/patients/${state.fiche.patient.id}/hospitalisations`, readFields(form, fields));
      toast('Patient admis');
      state.tab = 'hospitalisations';
      return reloadFiche;
    },
  });
};

actions.sortie = (el) => {
  const fields = [
    { name: 'date_sortie', label: 'Date de sortie', type: 'datetime' },
    { name: 'mode_sortie', label: 'Mode de sortie', type: 'select', required: true, options: state.ref.modesSortie },
    { name: 'resume_sortie', label: 'Résumé de sortie', type: 'textarea', full: true },
  ];
  openDialog({
    title: "Sortie d'hospitalisation",
    body: gridHtml(fields, { date_sortie: new Date().toISOString() }),
    onSubmit: async (form) => {
      await api('PATCH', `/api/hospitalisations/${el.dataset.id}/sortie`, readFields(form, fields));
      toast('Sortie enregistrée');
      return reloadFiche;
    },
  });
};

const medecinOptions = () => state.medecins.map((m) => ({
  value: m.id, label: `${drName(m.nom, m.prenom)}${m.specialite ? ` – ${m.specialite}` : ''}${m.etablissement_nom ? ` (${m.etablissement_nom})` : ''}`,
}));

actions['new-rdv'] = () => {
  const fields = [
    { name: 'date_heure', label: 'Date et heure', type: 'datetime', required: true },
    { name: 'medecin_id', label: 'Médecin', type: 'select', numeric: true, options: medecinOptions() },
    { name: 'motif', label: 'Motif', full: true },
  ];
  openDialog({
    title: `Rendez-vous – ${fullName(state.fiche.patient)}`,
    body: gridHtml(fields, { medecin_id: state.me.id }),
    onSubmit: async (form) => {
      await api('POST', '/api/rendez-vous', { ...readFields(form, fields), patient_id: state.fiche.patient.id });
      toast('Rendez-vous enregistré');
      state.tab = 'rdv';
      return reloadFiche;
    },
  });
};

// ============================================================ Rendez-vous
async function viewDoctorRdv() {
  const tous = state.rdvTous ? '1' : '0';
  const rows = await api('GET', `/api/rendez-vous?tous=${tous}&du=${encodeURIComponent(startOfToday().toISOString())}`);
  app.innerHTML = `
    <div class="page-head"><h1>Rendez-vous à venir</h1>
      <label class="no-print"><span>Afficher</span>
        <select id="rdv-scope">
          <option value="0"${tous === '0' ? ' selected' : ''}>Mes rendez-vous et demandes non attribuées</option>
          <option value="1"${tous === '1' ? ' selected' : ''}>Tout mon établissement</option>
        </select></label></div>
    <div class="card">${rdvTable(rows)}</div>
    <p class="muted small">Pour programmer un rendez-vous, ouvrez la fiche du patient puis « Rendez-vous ».</p>`;
  $('#rdv-scope').addEventListener('change', (e) => { state.rdvTous = e.target.value === '1'; route(); });
}

async function viewPatientRdv() {
  const rows = await api('GET', '/api/rendez-vous');
  app.innerHTML = `
    <div class="page-head"><h1>Mes rendez-vous</h1>
      <div class="actions"><button class="btn primary" data-action="rdv-request">+ Demander un rendez-vous</button></div></div>
    <div class="card">${rdvTable(rows, { withPatient: false, withActions: false, patientCancel: true })}</div>
    <p class="muted small">Une demande de rendez-vous doit être confirmée par l'établissement. Le statut passera alors à « Confirmé ».</p>`;
}

actions['rdv-request'] = () => {
  const fields = [
    { name: 'etablissement_id', label: 'Établissement', type: 'select', numeric: true, required: true,
      options: state.etablissements.map((e) => ({ value: e.id, label: `${e.nom} (${e.province})` })) },
    { name: 'medecin_id', label: 'Médecin (facultatif)', type: 'select', numeric: true, options: medecinOptions(), empty: '— Indifférent —' },
    { name: 'date_heure', label: 'Date et heure souhaitées', type: 'datetime', required: true },
    { name: 'motif', label: 'Motif', full: true },
  ];
  openDialog({
    title: 'Demander un rendez-vous',
    body: gridHtml(fields, {}),
    submitLabel: 'Envoyer la demande',
    onSubmit: async (form) => {
      await api('POST', '/api/rendez-vous', readFields(form, fields));
      toast('Demande envoyée');
      return route;
    },
  });
};

// ============================================================ Mon compte
async function viewCompte() {
  const me = state.me;
  app.innerHTML = `
    <h1>Mon compte</h1>
    <div class="card"><h2>Profil</h2>${dl([
      ['Identifiant', esc(me.username)], ['Nom', esc([me.prenom, me.nom].filter(Boolean).join(' '))],
      ['Rôle', esc(me.role)], ['Établissement', esc(me.etablissement_nom)], ['Spécialité', esc(me.specialite)],
      ['Dernière connexion', fmtDateTime(me.last_login_at)],
    ])}</div>
    <div class="card"><h2>Changer mon mot de passe</h2>
      <form id="pwd-form" novalidate>${gridHtml(passwordFields, {})}
        <div class="form-errors" id="pwd-errors" role="alert"></div>
        <p><button class="btn primary" type="submit">Modifier le mot de passe</button></p>
      </form></div>`;
  $('#pwd-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#pwd-errors').innerHTML = '';
    try {
      await submitPassword(e.target);
      e.target.reset();
      toast('Mot de passe modifié');
    } catch (err) {
      if (!err.handled) $('#pwd-errors').innerHTML = errorHtml(err);
    }
  });
}

// ============================================================ Administration
async function viewAdminHome() {
  const s = await api('GET', '/api/stats');
  app.innerHTML = `
    <h1>Administration</h1>
    <div class="stats">
      ${stat(s.etablissements, 'Établissements')}${stat(s.medecins, 'Médecins actifs')}
      ${stat(s.patients, 'Patients enregistrés')}${stat(s.comptes_patients, 'Patients avec accès en ligne')}
      ${stat(s.acces_24h, 'Événements tracés (24 h)')}
    </div>
    <div class="card"><h2>Mise en route</h2>
      <ol>
        <li>Déclarez les <a href="#/etablissements">établissements</a> (hôpitaux, centres de santé).</li>
        <li>Créez les comptes des <a href="#/utilisateurs">médecins</a> et remettez-leur leur mot de passe temporaire.</li>
        <li>Les médecins créent les fiches patients et, si souhaité, l'accès en ligne de chaque patient.</li>
        <li>Surveillez les accès dans le <a href="#/audit">journal d'audit</a>.</li>
      </ol>
      <p class="muted small">Par principe de confidentialité, le compte administrateur n'a pas accès au contenu médical des dossiers.</p>
    </div>`;
}

async function viewEtablissements() {
  state.etablissements = await api('GET', '/api/etablissements');
  app.innerHTML = `
    <div class="page-head"><h1>Établissements</h1>
      <div class="actions"><button class="btn primary" data-action="new-etab">+ Nouvel établissement</button></div></div>
    <div class="card">${state.etablissements.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Code</th><th>Nom</th><th>Type</th><th>Province</th><th>Zone de santé</th><th>Téléphone</th></tr></thead>
      <tbody>${state.etablissements.map((e) => `<tr><td class="nup">${esc(e.code)}</td><td><strong>${esc(e.nom)}</strong><div class="muted small">${dash(e.adresse)}</div></td>
        <td>${esc(e.type)}</td><td>${esc(e.province)}</td><td>${dash(e.zone_sante)}</td><td>${dash(e.telephone)}</td></tr>`).join('')}</tbody>
    </table></div>` : '<p class="empty">Aucun établissement. Commencez par en créer un.</p>'}</div>`;
}

actions['new-etab'] = () => {
  const fields = [
    { name: 'code', label: 'Code (ex. HGR-KIN)', required: true },
    { name: 'nom', label: 'Nom', required: true },
    { name: 'type', label: 'Type', type: 'select', required: true, options: state.ref.typesEtablissement },
    { name: 'province', label: 'Province', type: 'select', required: true, options: state.ref.provinces },
    { name: 'zone_sante', label: 'Zone de santé' }, { name: 'telephone', label: 'Téléphone', type: 'tel' },
    { name: 'adresse', label: 'Adresse', full: true },
  ];
  openDialog({
    title: 'Nouvel établissement',
    body: gridHtml(fields, {}),
    onSubmit: async (form) => {
      await api('POST', '/api/etablissements', readFields(form, fields));
      toast('Établissement créé');
      return route;
    },
  });
};

async function viewUsers() {
  const [users, etabs] = await Promise.all([api('GET', '/api/users'), api('GET', '/api/etablissements')]);
  state.etablissements = etabs;
  const roleBadge = { admin: 'red', medecin: 'blue', patient: '' };
  app.innerHTML = `
    <div class="page-head"><h1>Utilisateurs</h1>
      <div class="actions"><button class="btn primary" data-action="new-user">+ Nouveau compte (médecin / admin)</button></div></div>
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Identifiant</th><th>Nom</th><th>Rôle</th><th>Établissement</th><th>Statut</th><th>Dernière connexion</th><th></th></tr></thead>
      <tbody>${users.map((u) => `<tr>
        <td class="nup">${esc(u.username)}</td>
        <td>${esc([u.prenom, u.nom].filter(Boolean).join(' '))}${u.specialite ? `<div class="muted small">${esc(u.specialite)}</div>` : ''}</td>
        <td><span class="badge ${roleBadge[u.role]}">${esc(u.role)}</span></td>
        <td>${dash(u.etablissement_nom)}</td>
        <td>${u.actif ? '<span class="badge green">Actif</span>' : '<span class="badge red">Désactivé</span>'}
          ${u.must_change_password ? '<span class="badge orange">MDP temporaire</span>' : ''}</td>
        <td>${u.last_login_at ? fmtDateTime(u.last_login_at) : '—'}</td>
        <td class="actions">${u.role !== 'patient' ? `<button class="btn small" data-action="reset-password" data-id="${u.id}" data-username="${esc(u.username)}">Réinitialiser MDP</button>` : ''}
          ${u.id !== state.me.id ? `<button class="btn small ${u.actif ? 'danger' : ''}" data-action="toggle-user" data-id="${u.id}" data-actif="${u.actif ? 1 : 0}">${u.actif ? 'Désactiver' : 'Réactiver'}</button>` : ''}</td>
      </tr>`).join('')}</tbody></table></div></div>`;
}

actions['new-user'] = () => {
  const fields = [
    { name: 'role', label: 'Rôle', type: 'select', required: true, options: [{ value: 'medecin', label: 'Médecin' }, { value: 'admin', label: 'Administrateur' }] },
    { name: 'username', label: 'Identifiant de connexion (ex. dr.mbuyi)', required: true },
    { name: 'nom', label: 'Nom', required: true }, { name: 'prenom', label: 'Prénom' },
    { name: 'specialite', label: 'Spécialité' }, { name: 'numero_ordre', label: "N° d'ordre (CNOM)" },
    { name: 'etablissement_id', label: 'Établissement', type: 'select', numeric: true,
      options: state.etablissements.map((e) => ({ value: e.id, label: e.nom })) },
    { name: 'telephone', label: 'Téléphone', type: 'tel' }, { name: 'email', label: 'E-mail', type: 'email' },
  ];
  openDialog({
    title: 'Nouveau compte',
    body: gridHtml(fields, { role: 'medecin' }),
    submitLabel: 'Créer le compte',
    onSubmit: async (form) => {
      const r = await api('POST', '/api/users', readFields(form, fields));
      return () => {
        route();
        showSecret('Compte créé', 'Communiquez ces informations à l\'utilisateur de manière confidentielle.', r.username, r.temp_password);
      };
    },
  });
};

actions['reset-password'] = async (el) => {
  if (!confirm(`Réinitialiser le mot de passe de ${el.dataset.username} ?`)) return;
  const r = await api('POST', `/api/users/${el.dataset.id}/reset-password`, {});
  showSecret('Mot de passe réinitialisé', 'Communiquez ce nouveau mot de passe temporaire à l\'utilisateur.', el.dataset.username, r.temp_password);
  route();
};

actions['toggle-user'] = async (el) => {
  const activate = el.dataset.actif !== '1';
  if (!activate && !confirm('Désactiver ce compte ? L\'utilisateur sera immédiatement déconnecté.')) return;
  await api('PATCH', `/api/users/${el.dataset.id}`, { actif: activate });
  toast(activate ? 'Compte réactivé' : 'Compte désactivé');
  route();
};

async function viewAudit() {
  state.audit = [];
  state.auditAction = state.auditAction || '';
  app.innerHTML = `
    <div class="page-head"><h1>Journal d'audit</h1>
      <label class="no-print">Action
        <select id="audit-filter"><option value="">Toutes</option>
          ${['CONNEXION', 'CONNEXION_ECHEC', ...Object.keys(ACTION_LABELS).filter((k) => k !== 'CONNEXION'), 'CREATION_UTILISATEUR', 'MODIFICATION_UTILISATEUR', 'REINITIALISATION_MOT_DE_PASSE', 'RECHERCHE_PATIENT']
            .map((a) => `<option${a === state.auditAction ? ' selected' : ''}>${a}</option>`).join('')}
        </select></label></div>
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>Utilisateur</th><th>Rôle</th><th>Action</th><th>Ressource</th><th>Patient</th><th>IP</th></tr></thead>
      <tbody id="audit-rows"></tbody></table></div>
      <p><button class="btn" data-action="audit-more" id="audit-more">Afficher plus</button></p></div>`;
  $('#audit-filter').addEventListener('change', (e) => { state.auditAction = e.target.value; viewAudit(); });
  await actions['audit-more']();
}

actions['audit-more'] = async () => {
  const q = new URLSearchParams({ limit: 100, offset: state.audit.length });
  if (state.auditAction) q.set('action', state.auditAction);
  const rows = await api('GET', `/api/audit?${q}`);
  state.audit.push(...rows);
  $('#audit-rows').insertAdjacentHTML('beforeend', rows.map((a) => `<tr>
    <td>${fmtDateTime(a.ts)}</td><td>${dash(a.username)}</td><td>${dash(a.role)}</td>
    <td><span class="badge ${a.action.includes('ECHEC') ? 'red' : ''}">${esc(a.action)}</span></td>
    <td>${a.resource_type ? `${esc(a.resource_type)} #${esc(a.resource_id ?? '')}` : '—'}${a.details ? `<div class="muted small">${esc(a.details)}</div>` : ''}</td>
    <td class="nup">${dash(a.patient_nup)}</td><td class="small">${dash(a.ip)}</td></tr>`).join(''));
  $('#audit-more').hidden = rows.length < 100;
  if (!state.audit.length) $('#audit-rows').innerHTML = '<tr><td colspan="7" class="empty">Aucun événement.</td></tr>';
};

// ============================================================ Démarrage
boot();
