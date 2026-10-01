import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { insert, openDatabase } from '../src/db.js';

let server;
let base;
let db;

before(async () => {
  db = openDatabase(':memory:');
  insert(db, 'users', {
    username: 'admin', password_hash: await hashPassword('Admin12345'), role: 'admin', nom: 'Admin', must_change_password: 0,
  });
  server = createApp(db).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  db.close();
});

// Petit client HTTP conservant le cookie de session.
function client() {
  let cookie = '';
  return async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined && { 'content-type': 'application/json' }), ...(cookie && { cookie }) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  };
}

async function login(username, password) {
  const c = client();
  const r = await c('POST', '/api/auth/login', { username, password });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return c;
}

async function activate(username, tempPassword, newPassword) {
  const c = await login(username, tempPassword);
  const blocked = await c('GET', '/api/patients');
  assert.equal(blocked.status, 403, 'un mot de passe temporaire doit être changé');
  const r = await c('POST', '/api/auth/password', { current_password: tempPassword, new_password: newPassword });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return c;
}

describe('Parcours complet', () => {
  let admin, doc, doc2, inf, pat, etabId, patientId, nup, patientUser;

  test('santé du service', async () => {
    const r = await client()('GET', '/health');
    assert.equal(r.data.status, 'ok');
  });

  test('refus sans authentification', async () => {
    const r = await client()('GET', '/api/patients');
    assert.equal(r.status, 401);
  });

  test('mauvais mot de passe', async () => {
    const r = await client()('POST', '/api/auth/login', { username: 'admin', password: 'faux' });
    assert.equal(r.status, 401);
  });

  test("l'admin crée un établissement et des médecins", async () => {
    admin = await login('admin', 'Admin12345');
    const e = await admin('POST', '/api/etablissements', {
      code: 'hgr-kin', nom: 'HGR de Kinshasa', type: 'Hôpital Général de Référence', province: 'Kinshasa',
    });
    assert.equal(e.status, 201, JSON.stringify(e.data));
    assert.equal(e.data.code, 'HGR-KIN');
    etabId = e.data.id;

    const invalid = await admin('POST', '/api/users', { username: 'x', role: 'medecin', nom: '' });
    assert.equal(invalid.status, 400);

    const m = await admin('POST', '/api/users', {
      username: 'dr.mbuyi', role: 'medecin', nom: 'Mbuyi', prenom: 'Jean', specialite: 'Médecine interne', etablissement_id: etabId,
    });
    assert.equal(m.status, 201, JSON.stringify(m.data));
    doc = await activate('dr.mbuyi', m.data.temp_password, 'Docteur2026');

    const m2 = await admin('POST', '/api/users', { username: 'dr.kabila', role: 'medecin', nom: 'Kabila', etablissement_id: etabId });
    doc2 = await activate('dr.kabila', m2.data.temp_password, 'Docteur2027');
  });

  test("l'admin n'a pas accès aux données cliniques", async () => {
    const r = await admin('GET', '/api/patients');
    assert.equal(r.status, 403);
  });

  test('le médecin crée une fiche patient avec NUP', async () => {
    const r = await doc('POST', '/api/patients', {
      nom: 'Kalala', postnom: 'Mukendi', prenom: 'Grâce', sexe: 'F', date_naissance: '1990-05-12',
      telephone: '+243 810 000 000', province: 'Kinshasa', commune: 'Lemba', groupe_sanguin: 'O+', allergies: 'Pénicilline',
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    patientId = r.data.id;
    nup = r.data.nup;
    assert.match(nup, /^CD-\d{4}-000001-\d$/);

    const dup = await doc('POST', '/api/patients', { nom: 'KALALA', postnom: 'mukendi', prenom: 'Grâce', sexe: 'F' });
    assert.equal(dup.status, 409);
    const bad = await doc('POST', '/api/patients', { nom: 'Test', sexe: 'X', date_naissance: '2999-01-01' });
    assert.equal(bad.status, 400);
    assert.equal(bad.data.details.length, 2);
  });

  test('recherche de patients', async () => {
    const r = await doc('GET', '/api/patients?q=mukendi');
    assert.equal(r.data.length, 1);
    const r2 = await doc('GET', '/api/patients?q=' + encodeURIComponent(nup));
    assert.equal(r2.data[0].id, patientId);
    const r3 = await doc('GET', '/api/patients?q=%25');
    assert.equal(r3.data.length, 0, 'les jokers SQL sont échappés');
  });

  test('consultation avec prescriptions, examen, hospitalisation', async () => {
    const c = await doc('POST', `/api/patients/${patientId}/consultations`, {
      motif: 'Fièvre', temperature: 39.2, tension_sys: 120, tension_dia: 80, diagnostic: 'Paludisme simple',
      code_cim10: 'b54', prescriptions: [{ medicament: 'Artéméther-Luméfantrine', posologie: '2 cp x 2/j', duree: '3 jours' }, { medicament: '' }],
    });
    assert.equal(c.status, 201, JSON.stringify(c.data));

    const badVitals = await doc('POST', `/api/patients/${patientId}/consultations`, { motif: 'x', temperature: 80 });
    assert.equal(badVitals.status, 400);

    const x = await doc('POST', `/api/patients/${patientId}/examens`, { type: 'Laboratoire', libelle: 'Goutte épaisse', consultation_id: c.data.id });
    assert.equal(x.status, 201, JSON.stringify(x.data));
    const res = await doc2('PATCH', `/api/examens/${x.data.id}/resultat`, { resultat: 'Positive (++)' });
    assert.equal(res.status, 200);

    const h = await doc('POST', `/api/patients/${patientId}/hospitalisations`, { service: 'Médecine interne', motif: 'Paludisme grave' });
    assert.equal(h.status, 201);
    const h2 = await doc('POST', `/api/patients/${patientId}/hospitalisations`, { service: 'X', motif: 'Y' });
    assert.equal(h2.status, 409);
    const s = await doc('PATCH', `/api/hospitalisations/${h.data.id}/sortie`, { mode_sortie: 'Guéri', resume_sortie: 'RAS' });
    assert.equal(s.status, 200, JSON.stringify(s.data));

    const fiche = await doc('GET', `/api/patients/${patientId}`);
    assert.equal(fiche.status, 200);
    assert.equal(fiche.data.consultations.length, 1);
    assert.equal(fiche.data.consultations[0].code_cim10, 'B54');
    assert.equal(fiche.data.consultations[0].prescriptions.length, 1);
    assert.equal(fiche.data.examens[0].statut, 'resultat');
    assert.equal(fiche.data.hospitalisations[0].statut, 'terminee');
  });

  test('création du compte patient et accès à sa propre fiche uniquement', async () => {
    const r = await doc('POST', `/api/patients/${patientId}/compte`, {});
    assert.equal(r.status, 201);
    assert.equal(r.data.username, nup);
    pat = await activate(nup.toLowerCase(), r.data.temp_password, 'Patiente2026');

    const me = await pat('GET', '/api/auth/me');
    assert.equal(me.data.patient_id, patientId);
    patientUser = me.data;

    const own = await pat('GET', `/api/patients/${patientId}`);
    assert.equal(own.status, 200);
    assert.equal(own.data.patient.nup, nup);

    const other = await doc('POST', '/api/patients', { nom: 'Autre', sexe: 'M' });
    const denied = await pat('GET', `/api/patients/${other.data.id}`);
    assert.equal(denied.status, 403);
    const list = await pat('GET', '/api/patients');
    assert.equal(list.status, 403);
    const write = await pat('PATCH', `/api/patients/${patientId}`, { nom: 'Pirate' });
    assert.equal(write.status, 403);
  });

  test('le patient voit qui a consulté son dossier', async () => {
    const r = await pat('GET', `/api/patients/${patientId}/acces`);
    assert.equal(r.status, 200);
    assert.ok(r.data.some((a) => a.action === 'LECTURE_FICHE' && a.nom === 'Mbuyi'));
  });

  test('rendez-vous : demande du patient puis confirmation', async () => {
    const past = await pat('POST', '/api/rendez-vous', { date_heure: '2000-01-01T10:00', etablissement_id: etabId });
    assert.equal(past.status, 400);
    const future = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 16);
    const r = await pat('POST', '/api/rendez-vous', { date_heure: future, etablissement_id: etabId, motif: 'Contrôle' });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.statut, 'demande');

    const list = await doc('GET', '/api/rendez-vous');
    assert.ok(list.data.some((x) => x.id === r.data.id));
    const conf = await doc('PATCH', `/api/rendez-vous/${r.data.id}`, { statut: 'confirme' });
    assert.equal(conf.data.statut, 'confirme');
    assert.equal(conf.data.medecin_id, null);

    const hack = await pat('PATCH', `/api/rendez-vous/${r.data.id}`, { statut: 'termine' });
    assert.equal(hack.status, 403);
    const cancel = await pat('PATCH', `/api/rendez-vous/${r.data.id}`, { statut: 'annule' });
    assert.equal(cancel.data.statut, 'annule');
  });

  test("l'admin crée un compte infirmier (établissement obligatoire)", async () => {
    const sansEtab = await admin('POST', '/api/users', { username: 'inf.sans', role: 'infirmier', nom: 'Sans' });
    assert.equal(sansEtab.status, 400);
    const r = await admin('POST', '/api/users', { username: 'inf.mbala', role: 'infirmier', nom: 'Mbala', prenom: 'Esther', etablissement_id: etabId });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    inf = await activate('inf.mbala', r.data.temp_password, 'Infirmiere2026');
    const me = await inf('GET', '/api/auth/me');
    assert.equal(me.data.role, 'infirmier');
  });

  test("l'infirmière : accueil, lecture des fiches, soins et résultats", async () => {
    const list = await inf('GET', '/api/patients?q=kalala');
    assert.equal(list.status, 200);
    assert.equal(list.data.length, 1);

    const fiche = await inf('GET', `/api/patients/${patientId}`);
    assert.equal(fiche.status, 200);

    const p = await inf('POST', '/api/patients', { nom: 'Accueil', prenom: 'Triage', sexe: 'F' });
    assert.equal(p.status, 201, JSON.stringify(p.data));
    const edit = await inf('PATCH', `/api/patients/${p.data.id}`, { telephone: '+243 820 000 000' });
    assert.equal(edit.status, 200);

    const soin = await inf('POST', `/api/patients/${patientId}/soins`, {
      type: 'Prise des signes vitaux', temperature: 38.4, tension_sys: 130, tension_dia: 85, glycemie: 5.6, note: 'Patiente fébrile, hydratation encouragée',
    });
    assert.equal(soin.status, 201, JSON.stringify(soin.data));
    const badSoin = await inf('POST', `/api/patients/${patientId}/soins`, { type: 'Inventé' });
    assert.equal(badSoin.status, 400);

    const x = await doc('POST', `/api/patients/${patientId}/examens`, { type: 'Laboratoire', libelle: 'Glycémie à jeun' });
    const res = await inf('PATCH', `/api/examens/${x.data.id}/resultat`, { resultat: '5,2 mmol/L' });
    assert.equal(res.status, 200);

    const after = await inf('GET', `/api/patients/${patientId}`);
    assert.equal(after.data.soins.length, 1);
    assert.equal(after.data.soins[0].auteur_role, 'infirmier');
    assert.equal(after.data.soins[0].auteur_nom, 'Mbala');

    const stats = await inf('GET', '/api/stats');
    assert.equal(stats.data.mes_soins_jour, 1);
  });

  test("l'infirmière ne diagnostique pas, ne prescrit pas, n'hospitalise pas", async () => {
    const c = await inf('POST', `/api/patients/${patientId}/consultations`, { motif: 'x', prescriptions: [{ medicament: 'Amoxicilline' }] });
    assert.equal(c.status, 403);
    const x = await inf('POST', `/api/patients/${patientId}/examens`, { type: 'Laboratoire', libelle: 'NFS' });
    assert.equal(x.status, 403);
    const h = await inf('POST', `/api/patients/${patientId}/hospitalisations`, { service: 'X', motif: 'Y' });
    assert.equal(h.status, 403);
    const compte = await inf('POST', `/api/patients/${patientId}/compte`, {});
    assert.equal(compte.status, 403);
    const audit = await inf('GET', '/api/audit');
    assert.equal(audit.status, 403);
    const users = await inf('POST', '/api/users', { username: 'pirate', role: 'admin', nom: 'P' });
    assert.equal(users.status, 403);
  });

  test("l'infirmière gère les rendez-vous de son établissement", async () => {
    const future = new Date(Date.now() + 2 * 864e5).toISOString();
    const r = await inf('POST', '/api/rendez-vous', { patient_id: patientId, date_heure: future, motif: 'Pansement' });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.medecin_id, null, 'un infirmier ne s\'attribue pas le rendez-vous');
    assert.equal(r.data.etablissement_id, etabId);
    const list = await inf('GET', '/api/rendez-vous');
    assert.ok(list.data.some((x) => x.id === r.data.id));
    const conf = await inf('PATCH', `/api/rendez-vous/${r.data.id}`, { statut: 'termine' });
    assert.equal(conf.data.statut, 'termine');
  });

  test("le patient voit les soins et l'infirmière dans son journal d'accès", async () => {
    const own = await pat('GET', `/api/patients/${patientId}`);
    assert.equal(own.data.soins.length, 1);
    const acces = await pat('GET', `/api/patients/${patientId}/acces`);
    assert.ok(acces.data.some((a) => a.action === 'AJOUT_SOIN' && a.role === 'infirmier' && a.nom === 'Mbala'));
    const soin = await pat('POST', `/api/patients/${patientId}/soins`, { type: 'Autre' });
    assert.equal(soin.status, 403);
  });

  test('FHIR R4 : Patient et $everything', async () => {
    const meta = await client()('GET', '/fhir/r4/metadata');
    assert.equal(meta.data.resourceType, 'CapabilityStatement');

    const p = await doc('GET', `/fhir/r4/Patient/${nup}`);
    assert.equal(p.status, 200);
    assert.match(p.headers.get('content-type'), /application\/fhir\+json/);
    assert.equal(p.data.gender, 'female');
    assert.equal(p.data.name[0].family, 'Kalala Mukendi');

    const b = await pat('GET', `/fhir/r4/Patient/${nup}/$everything`);
    assert.equal(b.status, 200, JSON.stringify(b.data));
    const types = b.data.entry.map((e) => e.resource.resourceType);
    for (const t of ['Patient', 'Encounter', 'Condition', 'Observation', 'MedicationRequest', 'DiagnosticReport', 'AllergyIntolerance']) {
      assert.ok(types.includes(t), `ressource ${t} attendue`);
    }
    const ids = b.data.entry.map((e) => e.resource.id);
    assert.ok(ids.some((id) => id.startsWith('soin-glycemie-')), 'glycémie du soin infirmier attendue');
    assert.ok(ids.some((id) => id.startsWith('note-soin-')), 'note de soins attendue');
    const nf = await doc('GET', '/fhir/r4/Patient/CD-0000-000000-0');
    assert.equal(nf.status, 404);
    assert.equal(nf.data.resourceType, 'OperationOutcome');
  });

  test("journal d'audit (admin)", async () => {
    const r = await admin('GET', '/api/audit');
    assert.equal(r.status, 200);
    const actions = new Set(r.data.map((a) => a.action));
    for (const a of ['CONNEXION', 'CREATION_FICHE', 'LECTURE_FICHE', 'AJOUT_CONSULTATION', 'FHIR_EXPORT_DOSSIER']) {
      assert.ok(actions.has(a), `action ${a} attendue`);
    }
  });

  test('désactivation d\'un compte et déconnexion', async () => {
    const users = await admin('GET', '/api/users?role=medecin');
    const kabila = users.data.find((u) => u.username === 'dr.kabila');
    await admin('PATCH', `/api/users/${kabila.id}`, { actif: false });
    const r = await doc2('GET', '/api/auth/me');
    assert.equal(r.status, 401);

    await doc('POST', '/api/auth/logout', {});
    const r2 = await doc('GET', '/api/auth/me');
    assert.equal(r2.status, 401);
  });

  test('protection CSRF : JSON obligatoire', async () => {
    const res = await fetch(base + '/api/auth/login', { method: 'POST', body: 'username=admin&password=x', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    assert.equal(res.status, 415);
  });
});
