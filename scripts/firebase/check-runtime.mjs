// Vercel production builds must prove access before generating cached public pages.
// Local development and fixture CI use their existing credential paths.
if (process.env.FIREBASE_USE_VERCEL_OIDC === "true") {
  const { vercelGoogleAuth, vercelFirebaseCredential } = await import("../../lib/firebase/vercel-credentials.ts");
  const { Firestore } = await import("@google-cloud/firestore");
  const { initializeApp, deleteApp } = await import("firebase-admin/app");
  const { getAuth } = await import("firebase-admin/auth");
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error("Firebase project ID is missing.");
  const app = initializeApp({ projectId, credential: vercelFirebaseCredential() }, "deployment-preflight");
  const db = new Firestore({ projectId, auth: vercelGoogleAuth() });
  try {
    await Promise.all([db.collection("site_settings").limit(1).get(), getAuth(app).listUsers(1)]);
    console.log("Firebase deployment preflight passed: Firestore and Auth are accessible through workload identity.");
  } finally {
    await Promise.all([db.terminate(), deleteApp(app)]);
  }
}
