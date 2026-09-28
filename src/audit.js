// Traçabilité des accès aux données de santé (exigence de sécurité GovStack).
export function audit(db, req, action, { type = null, id = null, patientId = null, details = null } = {}) {
  const u = req.user || {};
  db.prepare(`INSERT INTO audit_log (user_id, username, role, action, resource_type, resource_id, patient_id, ip, details)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(u.id ?? null, u.username ?? null, u.role ?? null, action, type, id == null ? null : String(id),
      patientId, req.ip || null, details == null ? null : (typeof details === 'string' ? details : JSON.stringify(details)));
}
