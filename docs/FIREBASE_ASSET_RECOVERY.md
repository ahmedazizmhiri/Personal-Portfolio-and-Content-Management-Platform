# Local asset recovery check

Checked on 4 November 2026 after Supabase refused file downloads with `exceed_egress_quota`.

The search covered the current project files, hidden/generated project artifacts (including the local browser-download directory), all reachable Git history, and all locally stored Git blobs, including unreachable blobs. Dependency, build, and emulator caches were excluded from the filesystem scan. No Git LFS cache is present. Source file sizes, available SHA-256 values, and Storage MD5 ETags were used to look for exact matches.

**Result: no exact source upload was recovered locally.** Of 24 Storage objects, **16 are referenced by the current CMS**. The other eight are older/unreferenced uploads. The current `public/cv/` contains only its policy README.

## Files needed by the current CMS

| Category | Original filename |
| --- | --- |
| Project image | `RPA.png` |
| Project image | `E-Learning.png` |
| Project image | `Library.png` |
| Project image | `Barber.png` |
| Project image | `Tuniculture_Tourisme.png` |
| Project image | `Commercial_Marketing_Analyst_Portfolio.png` |
| Project image | `Projet_Chatbot.png` |
| Logo/icon | `Blue-Logo.png` |
| Logo/icon | `images.png` |
| Logo/icon | `upwork-icon.webp` |
| French CV | `Ahmed_Aziz_Mhiri_CV_FR.pdf` |
| French CV | `Ahmed_Aziz_Mhiri_CV_FR.docx` |
| English CV | `Ahmed_Aziz_Mhiri_CV_International_EN.pdf` |
| English CV | `Ahmed_Aziz_Mhiri_CV_International_EN.docx` |
| Italian CV | `Ahmed_Aziz_Mhiri_CV_IT.pdf` |
| Italian CV | `Ahmed_Aziz_Mhiri_CV_IT.docx` |

The current project has generic project/placeholder graphics, a profile avatar, company images, and a logo. Those are usable local assets, but they do not match these uploaded images. Earlier English/French CV binaries exist in Git history; they do not match the current validated CV uploads. No current Italian CV binary was found. No older CV, deprecated ATS/Canadian variant, or generic replacement has been published by this check.

The private machine-readable report, source upload hashes/ETags, and database snapshot remain in the Git-ignored `.artifacts/firebase-migration-baseline/` directory.

## Route without paid file storage

The owner selected existing repository images and a review of older CVs. That path has now been applied and verified in Firebase. `firebase/repository-assets.json` maps project covers to existing company/site graphics; generic template project screenshots were avoided. Malt and Upwork use bundled icons, and AIESEC uses its organization-name fallback. Current uploads and project-upload relationships are preserved in private source archive collections. The recovered English/French CVs are outdated and remain unpublished; see [the review](LEGACY_CV_REVIEW.md). Runtime uploads are disabled while no Storage bucket is configured.

If the originals can be supplied from another local folder, they can be copied into `public/projects/`, `public/brand/`, and `public/cv/`, with CMS URLs changed to internal site paths. Firebase Auth and Firestore can then handle identity and data while the existing site host serves those public files. This avoids Firebase Storage and its Blaze requirement for these static public assets.

Publishing static files through the repository means new file changes require a site deployment. Runtime CMS uploads to Firebase Storage still need a provisioned bucket; a free static-assets approach must disable that upload path or replace it with a separately approved storage provider. This is a deployment choice, not a way to retrieve the missing originals.
