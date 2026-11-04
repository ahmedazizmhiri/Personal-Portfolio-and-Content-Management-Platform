# Public CV asset policy

Only validated English, French, and Italian CV variants may be published by the portfolio. The Master CV is private and must never be placed in the public download flow. ATS and Canadian variants are deprecated and must not be linked or published.

## Current asset status

- English and French: current uploaded originals are unavailable. Older PDF and DOCX copies were recovered privately from Git history, reviewed, and found outdated.
- Italian: no local original was found.
- All three Firebase CMS resume records are preserved but unpublished, with inaccessible download URLs removed.
- Master: private; no public asset is expected.
- ATS and Canadian: deprecated legacy assets and CMS URLs must not be restored.

The selected migration serves public files from this repository and does not require Firebase Storage. Updated, validated CVs may be added to `public/cv` and deployed before their CMS download URLs and publication state are updated. Historical copies remain under the Git-ignored `.artifacts/firebase-migration-baseline/legacy-cvs` folder; see `docs/LEGACY_CV_REVIEW.md`. Never copy private source backups into this public folder.
