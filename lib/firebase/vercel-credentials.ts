import "server-only";

import { getVercelOidcToken } from "@vercel/oidc";
import { IdentityPoolClient, GoogleAuth } from "google-auth-library";
import type { Credential } from "firebase-admin/app";

let client: IdentityPoolClient | undefined;

export const usesVercelFederation = () => process.env.FIREBASE_USE_VERCEL_OIDC === "true";

export const vercelGoogleAuth = () => {
  if (!usesVercelFederation() || process.env.VERCEL_ENV !== "production") {
    throw new Error("Firebase workload identity is restricted to Vercel production.");
  }
  const projectNumber = process.env.GCP_PROJECT_NUMBER?.trim();
  const email = process.env.GCP_SERVICE_ACCOUNT_EMAIL?.trim();
  const pool = process.env.GCP_WORKLOAD_IDENTITY_POOL_ID?.trim();
  const provider = process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID?.trim();
  if (!/^\d+$/.test(projectNumber ?? "") || !/^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(email ?? "") || !/^[a-z0-9-]+$/.test(pool ?? "") || !/^[a-z0-9-]+$/.test(provider ?? "")) {
    throw new Error("Firebase workload identity configuration is missing or invalid.");
  }
  client ??= new IdentityPoolClient({
    audience: `//iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/${pool}/providers/${provider}`,
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    token_url: "https://sts.googleapis.com/v1/token",
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${email}:generateAccessToken`,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    subject_token_supplier: { getSubjectToken: () => getVercelOidcToken() },
  });
  return new GoogleAuth({ authClient: client });
};

export const vercelFirebaseCredential = (): Credential => ({
  async getAccessToken() {
    const auth = vercelGoogleAuth();
    const current = await auth.getClient();
    const { token } = await current.getAccessToken();
    if (!token || !current.credentials.expiry_date) throw new Error("Firebase workload identity token exchange failed.");
    return { access_token: token, expires_in: Math.max(0, Math.floor((current.credentials.expiry_date - Date.now()) / 1000)) };
  },
});
