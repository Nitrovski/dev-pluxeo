// src/lib/enrollment.js
import crypto from "crypto";

export function generateEnrollmentCode() {
  return crypto.randomBytes(9).toString("base64url");
}

export async function ensureEnrollment(customerDoc) {
  if (!customerDoc.settings) customerDoc.settings = {};
  if (!customerDoc.settings.enrollment) customerDoc.settings.enrollment = {};

  const e = customerDoc.settings.enrollment;

  // ? generuj kód i kdy enrollment existuje, ale code je null / prázdnı
  if (!e.code || typeof e.code !== "string" || !e.code.trim()) {
    e.code = generateEnrollmentCode();
    e.status = "active";
    e.rotatedAt = new Date();
    e.rotations = []; // init rotations
    await customerDoc.save();
  }

  // ? jistota kompatibility (kdyby se nekde uloil string)
  if (e.rotatedAt && !(e.rotatedAt instanceof Date)) {
    const d = new Date(e.rotatedAt);
    e.rotatedAt = Number.isFinite(d.getTime()) ? d : null;
  }

  if (!Array.isArray(e.rotations)) {
    e.rotations = [];
  }

  return e;
}


export function enforceRotationLimit(enrollment, maxPerDay = 3) {
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;

  const rotations = Array.isArray(enrollment.rotations) ? enrollment.rotations : [];
  const recent = rotations.filter((ts) => {
    const t = new Date(ts).getTime();
    return Number.isFinite(t) && now - t < DAY;
  });

  const allowed = recent.length < maxPerDay;
  const remaining = Math.max(0, maxPerDay - recent.length);

  return { allowed, recent, remaining, maxPerDay };
}
