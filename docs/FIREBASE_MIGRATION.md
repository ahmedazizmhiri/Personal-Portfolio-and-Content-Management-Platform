# Supabase → Firebase migration

The application now uses Firebase Auth for primary identity and Cloud Firestore for CMS and operational data. The selected no-billing path serves existing public files from the repository. Firebase Storage remains an optional adapter and is disabled when no bucket is configured. Next.js and Vercel hosting remain in place. The old `supabase/` SQL files are retained as source-schema history and for rollback reference; application code no longer loads a Supabase SDK.

## Current project status — 4 November 2026

- Target: `portfolio-cb36f`, Google account `j83691595@gmail.com`.
- Firebase web app created: `1:1085657654775:web:5d2a1377993e421d9e7af2`.
- Default Firestore database created in **Paris, `europe-west9`**, with deletion protection.
- Public web configuration saved in the ignored `.env.local`; local Application Default Credentials configured through Google sign-in.
- Source: `qflchsmvszbesfnomdeo`. The approved private backup is under `.artifacts/firebase-migration-baseline/` (Git-ignored): **33 tables, 1,258 rows, one user identity, and metadata for 24 storage objects**.
- A complete local/Git search found no exact copies of those uploads. Sixteen are referenced by current CMS records. See [the asset recovery report](FIREBASE_ASSET_RECOVERY.md) for filenames and the option to host recovered originals as repository assets without paid Storage.
- The SQL connector exported the database because Supabase's HTTP gateway returns `402` with `exceed_egress_quota`. The same restriction prevents downloading all 24 storage files. No file payloads have been backed up.
- The owner enabled free Firebase Auth email/password sign-in. The existing production domain is authorized. Password recovery uses Firebase's built-in hosted action page; API customization of the email-action URL was refused with `EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED`.
- The approved repository-assets manifest has been imported and fully verified: **1,258 Firestore documents and one user identity**. Active uploads/relations were moved to private `_source_uploads` / `_source_project_uploads` archives; current content points at seven existing local assets. Malt and Upwork use bundled icon components; the missing AIESEC logo uses its organization-name fallback.
- The old English/French CVs were recovered and reviewed privately. Their employment dates/availability are outdated and the current El Mouradi role is absent. All three CMS CV records are preserved but unpublished; no Italian file was found. See [the CV review](LEGACY_CV_REVIEW.md).
- No source data has been deleted and no website deployment has been made. The local project points to Firebase; production requires its Firebase server credentials before deployment.
- Firestore client rules were compiled and deployed successfully. The default index configuration uses no paid TTL feature. Expiration is enforced by the application even though expired documents are not automatically deleted by Cloud TTL.
- Validation completed: TypeScript, ESLint, 266 unit/regression/source-preflight tests, six Firebase emulator integration tests, and a production build against live migrated data. Browser verification checks nine public pages, seven real case studies, and protected admin entry on desktop and mobile, with no runtime Supabase requests or uncaught page errors. The emulator transfer test covers dry-run, import, restart, verification, and conflict refusal. Live admin password recovery/login and MFA still need acceptance testing after production configuration; GitHub requires provider credentials, and optional cloud Storage is not provisioned.
- The dependency audit's high/critical gate passes after compatible updates, including Next.js `16.4.5`, Sharp `0.35.5`, and the patched brace-expansion adapter dependency. There are 29 remaining moderate advisories in the dependency tree; no forced major-version downgrades were applied.

## Data and authorization model

### Vercel production credentials

The existing Vercel project is `3-d-portfolio` (`prj_o4g7FqSKiTjo0kECd6rnvbfPRQtZ`) in team `ahmed-aziz-mhiri`. Its production server uses Workload Identity Federation, with no service-account private key. The approved `portfolio-vercel` service account has `roles/datastore.user` and `roles/firebaseauth.admin`. The provider checks the exact team ID, project ID, and `production` environment; preview/development deployments cannot impersonate it. Local development continues to use the owner's Application Default Credentials.

Set `FIREBASE_USE_VERCEL_OIDC=true`, `GCP_PROJECT_NUMBER=1085657654775`, `GCP_SERVICE_ACCOUNT_EMAIL=portfolio-vercel@portfolio-cb36f.iam.gserviceaccount.com`, `GCP_WORKLOAD_IDENTITY_POOL_ID=portfolio-vercel`, and `GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID=production` in Vercel Production only. `FIREBASE_MFA_ENCRYPTION_KEY` is an independent Production secret. Existing hCaptcha and HMAC settings remain in place. Production builds run a credential preflight against both Firestore and Auth before generating cached pages.

The GitHub quality workflow supports manual dispatch on a release branch. A pre-existing ambiguous contact-test selector was corrected to target the email textbox exactly; social email links no longer make that test fail.

Existing table names become top-level Firestore collections. UUIDs, foreign-key fields, array/JSON values, and ISO timestamp strings are preserved, keeping the existing CMS/API contracts. `project_uploads` and builder-request compound keys become stable SHA-256 document IDs. Four legacy collections (`site_profile`, `value_cards`, `experiences`, `skill_clusters`) are preserved by the transfer tool, although the current app does not read them.

The `lib/firebase/` repository adapter provides the chainable query contract used by the current routes. Firestore single-field equality queries narrow reads; remaining filters and sorting run on the server. Reads fail closed above 5,000 candidate documents. Public reads also verify ancestor publication state, so a visible child cannot expose a draft page or project. This adapter is intended for this small portfolio/CMS, not an unbounded general-purpose database. CMS transactions read the bounded content graph to enforce cross-document integrity; write-heavy or substantially larger deployments should move to scoped queries and dedicated uniqueness documents.

Firestore client rules deny all direct reads and writes. Public content is projected by the Next.js server. All administrative routes retain their membership, same-origin, CSRF, rate-limit, and MFA checks. Admin SDK credentials bypass rules and must remain server-only.

Each CMS mutation commits content changes and revision history in one Firestore transaction. Transactions retain optimistic editing checks, duplicate-request idempotency, publication/evidence checks, parent relationships, unique slugs and public ordering, slug history/tombstones, and staged hard deletion. Contact notification claims and durable rate limits also use transactions.

In repository mode, the Media Library lists built-in public files and explains that new files are added through the project and a deployment. Runtime cloud uploads are disabled with a clear response. The optional Firebase Storage adapter uses one physical bucket with four prefixes corresponding to the old logical buckets:

| Prefix | Access |
| --- | --- |
| `public-assets/` | Public individual-file reads |
| `project-images/` | Public individual-file reads |
| `resumes/` | Public individual-file reads |
| `uploads/` | Private, server-signed downloads |

Client listing and writing are denied. Existing server MIME/signature/size checks, metadata, grace windows, and reference checks remain in effect. An unguessable path does not make a public-prefix file private; confidential documents belong in `uploads/`.

## Authentication changes

The server exchanges Firebase email/password or GitHub credentials for an HTTP-only, secure, same-site session cookie. Every protected request verifies that cookie with revocation checking and a server session record. Local logout revokes the individual session; global logout also revokes Firebase refresh tokens. Session expiration is five days and MFA freshness is fifteen minutes.

The existing authenticator UI uses **application-managed TOTP in Firestore**, separate from Firebase's native Identity Platform MFA. Secrets are encrypted with AES-256-GCM using `FIREBASE_MFA_ENCRYPTION_KEY`, bound to the user ID, and never stored in plaintext. Verification advances the last accepted time step atomically to prevent replay. Authenticator enrollment expires after ten minutes. Remembered-device cookies retain their independent HMAC and revocation checks. Keep the encryption key stable and back it up securely; losing it requires authenticator re-enrollment.

User UIDs and available GitHub provider identities are transferred. The export does **not** retrieve password hashes. Email/password users must use Firebase password recovery after import. Supabase sessions, TOTP factors, remembered devices, rate-limit buckets, and completed builder idempotency requests are not transferred. Admins must sign in again and enroll a new authenticator. Firebase-hosted password resets also invalidate remembered devices issued before the account's current auth epoch. The migration never silently disables the configured admin MFA policy.

## Complete Firebase setup

1. In [Firebase Authentication](https://console.firebase.google.com/project/portfolio-cb36f/authentication), choose **Get started** and enable **Email/Password**. Add the production domain and localhost to authorized domains as needed.
2. Firebase's default hosted recovery page works with the configured production continue URL. The application also supports `mode=resetPassword` / `oobCode` at `/admin/reset-password` if an owner later configures a custom action URL in the console. No email was sent by this migration.
3. GitHub is enabled in Firebase using an OAuth app whose callback is `https://ahmedaziz-portfolio.vercel.app/auth/callback`. Keep its Client ID/Secret in Firebase Authentication. The server initializes OAuth with `accounts:createAuthUri` and completes it with `accounts:signInWithIdp`; Firebase exchanges the authorization code using the stored provider credentials. A one-time HTTP-only cookie binds the callback state and Firebase session ID. Vercel does not need a copy of the GitHub OAuth secret. Live initialization has verified the provider, GitHub authorization host, callback URL, state, and session creation; the owner must still complete interactive sign-in.
4. For the selected repository-assets path, leave `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` blank. No Storage bucket or billing-plan upgrade is required. If cloud uploads are wanted later, the owner must separately choose and configure a storage provider.
5. Fill the Firebase variables in `.env.example`. For local development, `gcloud auth application-default login j83691595@gmail.com --project=portfolio-cb36f` supplies Admin SDK credentials. A production server needs a scoped service account or workload identity with Auth administration and Firestore data access. Storage object access and permission to sign private download URLs are only needed if the optional bucket is enabled. Do not deploy local user credentials.
6. Configure independent HMAC secrets, the 32-byte base64 MFA encryption key, existing hCaptcha settings, and existing contact-notification settings. No private key or application secret belongs in a `NEXT_PUBLIC_` variable.
7. Deploy the rules and default index configuration after reviewing them:

   ```sh
   npx firebase deploy --only firestore:rules,firestore:indexes --project portfolio-cb36f
   ```

   Runtime checks enforce session and limiter expiration. Storage rules are only deployed if the optional bucket is enabled later. The application remains on Vercel; this command does not deploy Next.js hosting.

## Export, dry-run, import, verify

The selected no-billing repository migration has already been prepared, applied, and verified with:

```sh
npm run firebase:prepare-repository
npm run firebase:import -- .artifacts/firebase-repository-migration --project=portfolio-cb36f
npm run firebase:import -- .artifacts/firebase-repository-migration --project=portfolio-cb36f --apply
npm run firebase:import -- .artifacts/firebase-repository-migration --project=portfolio-cb36f --verify
```

`firebase/repository-assets.json` records the accepted local image replacements. Repository assets are checked against their file hashes; missing source files are not pretended to have been recovered. Original revisions/audit rows remain unchanged, including old asset URLs as historical data. CV records are unpublished rather than linked to inaccessible or outdated files. The original source metadata remains in private archive collections.

The following full-file export workflow is optional if original uploads become available later; it is **not required** for the selected local-assets migration:

Freeze source CMS writes while taking the final snapshot. The existing backup is a baseline; if the source changes, take a new final snapshot. Keep all exports outside version control and protect them as private data.

The normal read-only export uses the existing source URL and service-role secret, retained locally only for this transfer:

```sh
npm run firebase:export -- .artifacts/firebase-migration-final
```

While the Supabase gateway is restricted, a SQL-connector database snapshot is saved separately. Once downloads are restored, complete the existing approved baseline backup with:

```sh
npm run firebase:export -- .artifacts/firebase-migration-baseline --database-snapshot=.artifacts/firebase-migration-baseline/database-snapshot.json
```

This copies all files and creates `manifest.json` only when the export is complete. `database-snapshot.json` and `recovery-progress.json` alone are **not** complete import manifests. The `objects/` files use hashed filenames; the manifest retains their original logical paths, sizes, MIME types, and SHA-256 checksums. A source egress restriction must be resolved by the project owner; the tool does not alter spend caps or plans.

Then validate without connecting to Firebase:

```sh
npm run firebase:import -- .artifacts/firebase-migration-baseline --project=portfolio-cb36f
```

Review the counts, source backup, and target before applying:

```sh
npm run firebase:import -- .artifacts/firebase-migration-baseline --project=portfolio-cb36f --apply
npm run firebase:import -- .artifacts/firebase-migration-baseline --project=portfolio-cb36f --verify
```

The importer rewrites old public Storage URLs recursively, validates all file checksums, and checks existing target documents, emails/UIDs, and files before writing. Matching data supports safe restart; conflicting target data is never overwritten. Users and files are imported before content, then documents are created in batches of 400. Full verification checks document values/counts, user identity mappings, and downloaded target file checksums. Do not enable target CMS writes between import and final verification.

## Verification and production switch

```sh
npm run type-check
npm run lint
npm test
npm run test:firebase
npm run build
```

The emulator command uses only `demo-portfolio-migration`, loopback Auth/Firestore/Storage emulators, and synthetic data. Java 21 or newer is required. Firestore uses port 8180, Auth 9099, and Storage 9199. Integration tests refuse to mutate a hosted project. They cover client-rule denial, competing CMS edits/revisions, contact claim races, durable limiting, password login, encrypted TOTP, replay rejection, and local logout revocation. Existing publication/security tests remain part of the normal suite.

After import verification, manually validate password recovery, email/password login, GitHub login if enabled, MFA setup/verification/removal, remembered devices, CMS create/edit/archive, upload/download/deletion, contact persistence, and public metadata/assets. Configure production environment variables and deploy a preview first. Only promote the preview after the complete flow succeeds.

Keep Supabase and the complete snapshot available through the rollback window. A rollback requires deploying the previous application build/environment. New Firebase writes do not automatically sync back to Supabase; reconcile them before reverting providers. Remove the old source credentials from production only after the migration is accepted.

## Official references

- [Firebase Admin SDK setup](https://firebase.google.com/docs/admin/setup)
- [Firebase session cookies](https://firebase.google.com/docs/auth/admin/manage-cookies)
- [Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions)
- [Firebase Auth REST API](https://firebase.google.com/docs/reference/rest/auth)
- [Firebase Storage billing changes](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024)
