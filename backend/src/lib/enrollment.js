// src/lib/enrollment.js
import crypto from "crypto";

export function generateEnrollmentCode() {
  return crypto.randomBytes(9).toString("base64url");
}

export async function ensureEnrollment(customerDoc) {
  if (!customerDoc.settings) customerDoc.settings = {};

  if (!customerDoc.settings.enrollment) {
    customerDoc.settings.enrollment = {
      code: generateEnrollmentCode(),
      status: "active",
      rotatedAt: new Date().toISOString(),
      rotations: [], // ? historie rotací
    };
    await customerDoc.save();
  }

  // zajištení defaultu i pro staré dokumenty
  if (!Array.isArray(customerDoc.settings.enrollment.rotations)) {
    customerDoc.settings.enrollment.rotations = [];
  }
  if (customerDoc.settings.enrollment.rotatedAt instanceof Date) {
    customerDoc.settings.enrollment.rotatedAt = customerDoc.settings.enrollment.rotatedAt.toISOString();
  }

  return customerDoc.settings.enrollment;
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
