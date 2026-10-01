// Référentiels partagés entre l'API et l'interface.

export const ROLES = ['admin', 'medecin', 'infirmier', 'patient'];

// Personnel soignant : accès (tracé) aux dossiers des patients.
export const SOIGNANTS = ['medecin', 'infirmier'];

export const TYPES_SOIN = [
  'Prise des signes vitaux', 'Administration de médicament', 'Injection / perfusion', 'Pansement',
  'Surveillance', 'Éducation du patient', 'Autre',
];

export const PROVINCES = [
  'Bas-Uele', 'Équateur', 'Haut-Katanga', 'Haut-Lomami', 'Haut-Uele', 'Ituri',
  'Kasaï', 'Kasaï-Central', 'Kasaï-Oriental', 'Kinshasa', 'Kongo-Central', 'Kwango',
  'Kwilu', 'Lomami', 'Lualaba', 'Mai-Ndombe', 'Maniema', 'Mongala', 'Nord-Kivu',
  'Nord-Ubangi', 'Sankuru', 'Sud-Kivu', 'Sud-Ubangi', 'Tanganyika', 'Tshopo', 'Tshuapa',
];

export const SEXES = ['M', 'F'];

export const GROUPES_SANGUINS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Inconnu'];

export const ETATS_CIVILS = ['Célibataire', 'Marié(e)', 'Divorcé(e)', 'Veuf(ve)', 'Union libre'];

export const TYPES_ETABLISSEMENT = [
  'Hôpital Général de Référence', 'Hôpital Provincial', 'Cliniques Universitaires',
  'Centre de Santé', 'Centre de Santé de Référence', 'Clinique privée', 'Autre',
];

export const TYPES_EXAMEN = ['Laboratoire', 'Imagerie', 'Autre'];

export const STATUTS_RDV = ['demande', 'confirme', 'annule', 'termine'];

export const MODES_SORTIE = ['Guéri', 'Amélioré', 'Transféré', 'Contre avis médical', 'Décédé'];

export const REFERENTIELS = {
  roles: ROLES,
  provinces: PROVINCES,
  sexes: SEXES,
  groupesSanguins: GROUPES_SANGUINS,
  etatsCivils: ETATS_CIVILS,
  typesEtablissement: TYPES_ETABLISSEMENT,
  typesExamen: TYPES_EXAMEN,
  statutsRdv: STATUTS_RDV,
  modesSortie: MODES_SORTIE,
  typesSoin: TYPES_SOIN,
};
