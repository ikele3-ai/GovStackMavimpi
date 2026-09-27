import { Router } from 'express';
import { audit } from '../audit.js';
import { config } from '../config.js';
import { HttpError } from '../validation.js';
import { assertCanRead, loadFullRecord } from './patients.js';

/*
 * Interface HL7 FHIR R4 (lecture seule) : permet l'échange du dossier patient avec
 * d'autres systèmes via le Building Block GovStack « Information Mediator » (X-Road).
 */

export const NUP_SYSTEM = 'urn:govstack:cd:sante:nup';
const ICD10 = 'http://hl7.org/fhir/sid/icd-10';
const LOINC = 'http://loinc.org';
const UCUM = 'http://unitsofmeasure.org';

const VITALS = [
  ['temperature', '8310-5', 'Température corporelle', 'Cel', '°C'],
  ['tension_sys', '8480-6', 'Pression artérielle systolique', 'mm[Hg]', 'mmHg'],
  ['tension_dia', '8462-4', 'Pression artérielle diastolique', 'mm[Hg]', 'mmHg'],
  ['pouls', '8867-4', 'Fréquence cardiaque', '/min', '/min'],
  ['frequence_resp', '9279-1', 'Fréquence respiratoire', '/min', '/min'],
  ['poids', '29463-7', 'Poids corporel', 'kg', 'kg'],
  ['taille', '8302-2', 'Taille', 'cm', 'cm'],
  ['saturation', '59408-5', 'Saturation en oxygène', '%', '%'],
];

const clean = (obj) => JSON.parse(JSON.stringify(obj, (k, v) => (v === null || v === '' ? undefined : v)));

export function toFhirPatient(p) {
  return clean({
    resourceType: 'Patient',
    id: p.nup,
    meta: { lastUpdated: p.updated_at },
    identifier: [{ use: 'official', system: NUP_SYSTEM, value: p.nup }],
    active: true,
    name: [{
      use: 'official',
      family: [p.nom, p.postnom].filter(Boolean).join(' '),
      given: p.prenom ? [p.prenom] : undefined,
      text: [p.nom, p.postnom, p.prenom].filter(Boolean).join(' '),
    }],
    gender: p.sexe === 'M' ? 'male' : p.sexe === 'F' ? 'female' : 'unknown',
    birthDate: p.date_naissance,
    telecom: [
      p.telephone && { system: 'phone', value: p.telephone },
      p.email && { system: 'email', value: p.email },
    ].filter(Boolean),
    address: [{
      line: [p.adresse, p.quartier].filter(Boolean),
      city: p.ville, district: p.commune, state: p.province, country: 'CD',
    }],
    contact: p.contact_urgence_nom ? [{
      relationship: [{ text: p.contact_urgence_lien || "Contact d'urgence" }],
      name: { text: p.contact_urgence_nom },
      telecom: p.contact_urgence_tel ? [{ system: 'phone', value: p.contact_urgence_tel }] : undefined,
    }] : undefined,
  });
}

function toBundle(record, baseUrl) {
  const { patient: p } = record;
  const subject = { reference: `Patient/${p.nup}` };
  const entries = [toFhirPatient(p)];

  if (p.allergies) {
    entries.push({ resourceType: 'AllergyIntolerance', id: `allergie-${p.id}`, patient: subject, code: { text: p.allergies } });
  }

  for (const c of record.consultations) {
    const enc = `consultation-${c.id}`;
    entries.push(clean({
      resourceType: 'Encounter', id: enc, status: 'finished',
      class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB', display: 'ambulatory' },
      subject, period: { start: c.date }, reasonCode: [{ text: c.motif }],
      participant: [{ individual: { display: `Dr ${[c.medecin_prenom, c.medecin_nom].filter(Boolean).join(' ')}` } }],
      serviceProvider: c.etablissement_nom ? { display: c.etablissement_nom } : undefined,
    }));
    if (c.diagnostic || c.code_cim10) {
      entries.push(clean({
        resourceType: 'Condition', id: `diagnostic-${c.id}`, subject, encounter: { reference: `Encounter/${enc}` },
        code: { coding: c.code_cim10 ? [{ system: ICD10, code: c.code_cim10 }] : undefined, text: c.diagnostic },
        recordedDate: c.date,
      }));
    }
    for (const [field, code, display, unit, human] of VITALS) {
      if (c[field] == null) continue;
      entries.push({
        resourceType: 'Observation', id: `${field}-${c.id}`, status: 'final',
        category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'vital-signs' }] }],
        code: { coding: [{ system: LOINC, code, display }], text: display },
        subject, encounter: { reference: `Encounter/${enc}` }, effectiveDateTime: c.date,
        valueQuantity: { value: c[field], unit: human, system: UCUM, code: unit },
      });
    }
    for (const rx of c.prescriptions) {
      entries.push(clean({
        resourceType: 'MedicationRequest', id: `prescription-${rx.id}`, status: 'active', intent: 'order',
        medicationCodeableConcept: { text: [rx.medicament, rx.dosage].filter(Boolean).join(' ') },
        subject, encounter: { reference: `Encounter/${enc}` }, authoredOn: c.date,
        dosageInstruction: [{ text: [rx.posologie, rx.duree, rx.instructions].filter(Boolean).join(' – ') }],
      }));
    }
  }

  for (const x of record.examens) {
    entries.push(clean({
      resourceType: 'ServiceRequest', id: `examen-${x.id}`, status: x.statut === 'resultat' ? 'completed' : 'active',
      intent: 'order', category: [{ text: x.type }], code: { text: x.libelle }, subject, authoredOn: x.date_demande,
      note: x.notes ? [{ text: x.notes }] : undefined,
    }));
    if (x.statut === 'resultat') {
      entries.push(clean({
        resourceType: 'DiagnosticReport', id: `resultat-${x.id}`, status: 'final', code: { text: x.libelle },
        subject, basedOn: [{ reference: `ServiceRequest/examen-${x.id}` }], issued: x.date_resultat,
        conclusion: [x.resultat, x.interpretation].filter(Boolean).join('\n'),
      }));
    }
  }

  for (const h of record.hospitalisations) {
    entries.push(clean({
      resourceType: 'Encounter', id: `hospitalisation-${h.id}`,
      status: h.statut === 'en_cours' ? 'in-progress' : 'finished',
      class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'IMP', display: 'inpatient encounter' },
      subject, period: { start: h.date_admission, end: h.date_sortie }, reasonCode: [{ text: h.motif }],
      location: [{ location: { display: [h.service, h.chambre && `chambre ${h.chambre}`, h.lit && `lit ${h.lit}`].filter(Boolean).join(', ') } }],
      hospitalization: h.mode_sortie ? { dischargeDisposition: { text: h.mode_sortie } } : undefined,
      serviceProvider: h.etablissement_nom ? { display: h.etablissement_nom } : undefined,
    }));
  }

  return {
    resourceType: 'Bundle',
    type: 'searchset',
    timestamp: new Date().toISOString(),
    total: entries.length,
    entry: entries.map((resource) => ({ fullUrl: `${baseUrl}/${resource.resourceType}/${resource.id}`, resource })),
  };
}

export function fhirRouter(db, auth) {
  const r = Router();

  r.use((req, res, next) => {
    res.type('application/fhir+json');
    next();
  });

  r.get('/metadata', (req, res) => {
    res.json({
      resourceType: 'CapabilityStatement', status: 'active', date: new Date().toISOString(), kind: 'instance',
      software: { name: config.appName, version: '1.0.0' }, fhirVersion: '4.0.1', format: ['json'],
      rest: [{
        mode: 'server',
        resource: [{
          type: 'Patient',
          interaction: [{ code: 'read' }],
          operation: [{ name: 'everything', definition: 'http://hl7.org/fhir/OperationDefinition/Patient-everything' }],
        }],
      }],
    });
  });

  // Toutes les ressources cliniques exigent une authentification.
  r.use(auth);

  const findByNup = (req) => {
    const p = db.prepare('SELECT id FROM patients WHERE nup = ?').get(req.params.nup);
    if (!p) throw new HttpError(404, 'Patient introuvable');
    assertCanRead(req, p.id);
    return p.id;
  };

  r.get('/Patient/:nup', (req, res) => {
    const id = findByNup(req);
    audit(db, req, 'FHIR_LECTURE_PATIENT', { type: 'patient', id, patientId: id });
    res.json(toFhirPatient(db.prepare('SELECT * FROM patients WHERE id = ?').get(id)));
  });

  r.get('/Patient/:nup/\\$everything', (req, res) => {
    const id = findByNup(req);
    audit(db, req, 'FHIR_EXPORT_DOSSIER', { type: 'patient', id, patientId: id });
    const baseUrl = `${req.protocol}://${req.get('host')}/fhir/r4`;
    res.json(toBundle(loadFullRecord(db, id), baseUrl));
  });

  return r;
}
