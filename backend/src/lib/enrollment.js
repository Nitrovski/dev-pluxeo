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
      rotatedAt: null,
    };
    await customerDoc.save();
  }

  return customerDoc.settings.enrollment;
}
