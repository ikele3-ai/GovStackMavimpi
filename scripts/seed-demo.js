// Données de démonstration (formation / tests). NE PAS UTILISER EN PRODUCTION.
// Usage : npm run seed:demo
import { hashPassword } from '../src/auth.js';
import { config } from '../src/config.js';
import { insert, openDatabase, tx } from '../src/db.js';
import { makeNup } from '../src/routes/patients.js';

if (config.env === 'production' && process.env.FORCE !== '1') {
  console.error('Refusé en production. Définissez FORCE=1 si vous êtes certain de vouloir insérer des données fictives.');
  process.exit(1);
}

const db = openDatabase(config.databasePath);
if (db.prepare("SELECT 1 FROM users WHERE username = 'dr.demo'").get()) {
  console.log('Les données de démonstration sont déjà présentes.');
  process.exit(0);
}

const DEMO_PASSWORD = 'Demo2026!';
const hash = await hashPassword(DEMO_PASSWORD);
const daysAgo = (n, h = 9) => { const d = new Date(Date.now() - n * 864e5); d.setHours(h, 0, 0, 0); return d.toISOString(); };

tx(db, () => {
  const kin = insert(db, 'etablissements', {
    code: 'DEMO-HGR-KIN', nom: 'Hôpital Général de Référence (démo) – Kinshasa', type: 'Hôpital Général de Référence',
    province: 'Kinshasa', zone_sante: 'Gombe', adresse: 'Avenue de la Démo, Gombe', telephone: '+243 000 000 001',
  });
  const lub = insert(db, 'etablissements', {
    code: 'DEMO-CS-LUB', nom: 'Centre de Santé (démo) – Lubumbashi', type: 'Centre de Santé',
    province: 'Haut-Katanga', zone_sante: 'Kampemba',
  });

  if (!db.prepare("SELECT 1 FROM users WHERE username = 'admin'").get()) {
    insert(db, 'users', { username: 'admin', password_hash: hash, role: 'admin', nom: 'Administrateur', must_change_password: 0 });
  }
  const dr = insert(db, 'users', {
    username: 'dr.demo', password_hash: hash, role: 'medecin', nom: 'Demo', prenom: 'Médecin', specialite: 'Médecine interne',
    numero_ordre: 'CNOM-DEMO-001', etablissement_id: kin, must_change_password: 0,
  });
  const inf = insert(db, 'users', {
    username: 'inf.demo', password_hash: hash, role: 'infirmier', nom: 'Demo', prenom: 'Infirmière',
    etablissement_id: kin, must_change_password: 0,
  });
  insert(db, 'users', {
    username: 'dr.pediatre', password_hash: hash, role: 'medecin', nom: 'Pédiatre', prenom: 'Démo', specialite: 'Pédiatrie',
    etablissement_id: lub, must_change_password: 0,
  });

  const patients = [
    { nom: 'Exemple', postnom: 'Demo', prenom: 'Marie', sexe: 'F', date_naissance: '1988-03-14', telephone: '+243 000 000 010',
      province: 'Kinshasa', ville: 'Kinshasa', commune: 'Lemba', quartier: 'Salongo', groupe_sanguin: 'O+',
      allergies: 'Pénicilline', maladies_chroniques: 'Hypertension artérielle', contact_urgence_nom: 'Exemple Paul',
      contact_urgence_tel: '+243 000 000 011', contact_urgence_lien: 'Époux' },
    { nom: 'Fictif', postnom: 'Test', prenom: 'Joseph', sexe: 'M', date_naissance: '2019-07-02', province: 'Kinshasa',
      ville: 'Kinshasa', commune: 'Ngaliema', groupe_sanguin: 'A+', antecedents: 'Drépanocytose SS' },
    { nom: 'Modele', postnom: 'Essai', prenom: 'Aline', sexe: 'F', date_naissance: '1995-11-20', province: 'Haut-Katanga',
      ville: 'Lubumbashi', commune: 'Kampemba' },
  ];
  const ids = patients.map((p) => {
    const id = insert(db, 'patients', { ...p, nup: `TMP-${Math.random()}`, etablissement_id: kin, created_by: dr });
    db.prepare('UPDATE patients SET nup = ? WHERE id = ?').run(makeNup(id), id);
    return id;
  });

  const c1 = insert(db, 'consultations', {
    patient_id: ids[0], medecin_id: dr, etablissement_id: kin, date: daysAgo(20), motif: 'Céphalées et vertiges',
    temperature: 36.8, tension_sys: 165, tension_dia: 100, pouls: 84, poids: 72, taille: 162,
    diagnostic: 'Hypertension artérielle mal contrôlée', code_cim10: 'I10',
    traitement: 'Ajustement du traitement antihypertenseur', recommandations: 'Réduire le sel. Contrôle dans 3 semaines.',
  });
  insert(db, 'prescriptions', { consultation_id: c1, patient_id: ids[0], medicament: 'Amlodipine', dosage: '10 mg', posologie: '1 cp le matin', duree: '30 jours' });
  const c2 = insert(db, 'consultations', {
    patient_id: ids[0], medecin_id: dr, etablissement_id: kin, date: daysAgo(2), motif: 'Fièvre et frissons depuis 3 jours',
    temperature: 39.1, tension_sys: 140, tension_dia: 85, pouls: 102, symptomes: 'Fièvre, céphalées, courbatures',
    diagnostic: 'Paludisme simple', code_cim10: 'B54',
  });
  insert(db, 'prescriptions', { consultation_id: c2, patient_id: ids[0], medicament: 'Artéméther-Luméfantrine', dosage: '80/480 mg', posologie: '1 cp x 2/jour', duree: '3 jours' });
  insert(db, 'prescriptions', { consultation_id: c2, patient_id: ids[0], medicament: 'Paracétamol', dosage: '500 mg', posologie: '2 cp x 3/jour si fièvre', duree: '3 jours' });
  insert(db, 'examens', {
    patient_id: ids[0], consultation_id: c2, medecin_id: dr, etablissement_id: kin, type: 'Laboratoire', libelle: 'Goutte épaisse',
    statut: 'resultat', resultat: 'Positive – P. falciparum (++)', date_demande: daysAgo(2), date_resultat: daysAgo(2, 11), resultat_par: dr,
  });
  insert(db, 'examens', {
    patient_id: ids[0], medecin_id: dr, etablissement_id: kin, type: 'Laboratoire', libelle: 'Créatinine, ionogramme',
    date_demande: daysAgo(2),
  });

  const c3 = insert(db, 'consultations', {
    patient_id: ids[1], medecin_id: dr, etablissement_id: kin, date: daysAgo(1), motif: 'Douleurs osseuses intenses',
    temperature: 38.2, pouls: 120, poids: 18, diagnostic: 'Crise vaso-occlusive drépanocytaire', code_cim10: 'D57.0',
  });
  insert(db, 'hospitalisations', {
    patient_id: ids[1], medecin_id: dr, etablissement_id: kin, service: 'Pédiatrie', chambre: '12', lit: 'B',
    motif: 'Crise vaso-occlusive – hydratation et antalgiques IV', date_admission: daysAgo(1, 14),
  });
  void c3;
  insert(db, 'soins', {
    patient_id: ids[1], auteur_id: inf, etablissement_id: kin, date: daysAgo(0, 8), type: 'Surveillance',
    temperature: 37.6, pouls: 104, saturation: 97, note: 'Douleur en baisse (EVA 4/10). Perfusion en cours, bonne diurèse.',
    hospitalisation_id: db.prepare("SELECT id FROM hospitalisations WHERE patient_id = ? AND statut = 'en_cours'").get(ids[1]).id,
  });

  const future = new Date(Date.now() + 2 * 864e5); future.setHours(10, 30, 0, 0);
  insert(db, 'rendez_vous', { patient_id: ids[0], medecin_id: dr, etablissement_id: kin, date_heure: future.toISOString(), motif: 'Contrôle tension artérielle', statut: 'confirme', cree_par: dr });
  const future2 = new Date(Date.now() + 5 * 864e5); future2.setHours(8, 0, 0, 0);
  insert(db, 'rendez_vous', { patient_id: ids[2], etablissement_id: kin, date_heure: future2.toISOString(), motif: 'Consultation prénatale', statut: 'demande' });

  insert(db, 'users', {
    username: makeNup(ids[0]), password_hash: hash, role: 'patient', nom: 'Exemple', prenom: 'Marie',
    patient_id: ids[0], must_change_password: 0,
  });
  console.log('Données de démonstration créées :');
  console.log(`  Médecin   : dr.demo / ${DEMO_PASSWORD}`);
  console.log(`  Infirmière: inf.demo / ${DEMO_PASSWORD}`);
  console.log(`  Patient : ${makeNup(ids[0])} / ${DEMO_PASSWORD}`);
  console.log(`  Admin   : admin / ${DEMO_PASSWORD} (si créé par ce script)`);
});
db.close();
