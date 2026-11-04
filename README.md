# Ahmed Aziz Mhiri — Portfolio & Content Management Platform

[![Live Portfolio](https://img.shields.io/badge/Live%20Portfolio-Visit-000000?style=for-the-badge&logo=vercel)](https://ahmedaziz-portfolio.vercel.app/?utm_source=github&utm_medium=referral&utm_campaign=portfolio_growth_2026&utm_content=repository_badge)
[![Next.js](https://img.shields.io/badge/Next.js-16.4.5-000000?style=for-the-badge&logo=nextdotjs)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Firebase](https://img.shields.io/badge/Firebase-CMS%20%26%20Auth-FFCA28?style=for-the-badge&logo=firebase&logoColor=black)](https://firebase.google.com/)
[![Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-000000?style=for-the-badge&logo=vercel)](https://vercel.com/)

A production-grade 3D professional portfolio and content-management platform for **Ahmed Aziz Mhiri**, focused on **Marketing & Commercial Analytics, Business Intelligence, Digital Transformation and Automation**, with **Big Data & Applied AI** as complementary technical depth.

> **Turning business data into decisions, growth and digital solutions.**

**Migration status:** The source code now uses Firebase, and 1,258 Firestore documents plus the existing admin identity have been imported and verified in `portfolio-cb36f`. Existing repository images replace unavailable source uploads without a paid Storage plan. Older CVs were reviewed and remain unpublished pending updates. The website has not been redeployed; production needs Firebase server credentials. See [the Firebase migration runbook](docs/FIREBASE_MIGRATION.md) for setup, verification, and cutover steps.

The platform combines a recruiter-oriented public portfolio with a Firebase-backed CMS, secure administration, structured project case studies, analytics, technical SEO, AI-readable discovery and a performance-conscious 3D experience.

---

## Live links

- **Portfolio:** [View the live portfolio](https://ahmedaziz-portfolio.vercel.app/?utm_source=github&utm_medium=referral&utm_campaign=portfolio_growth_2026&utm_content=repository_readme)
- **LinkedIn:** [linkedin.com/in/ahmed-aziz-mhiri](https://www.linkedin.com/in/ahmed-aziz-mhiri/)
- **GitHub:** [https://github.com/ahmedazizmhiri](https://github.com/ahmedazizmhiri)
- **Sitemap:** [sitemap.xml](https://ahmedaziz-portfolio.vercel.app/sitemap.xml)
- **AI-readable summary:** [llms.txt](https://ahmedaziz-portfolio.vercel.app/llms.txt)

---

## Professional positioning

The portfolio presents a **business-oriented analytics and digital-transformation profile**, rather than positioning its owner as a pure software engineer, data scientist or machine-learning engineer.

Core areas include:

- Marketing & Commercial Analytics
- Business Intelligence and KPI reporting
- Digital Transformation
- Revenue, sales and operational analytics
- CRM & Marketing Automation
- Process Automation and auditability
- Customer and operational insights
- Big Data Analytics
- Applied AI for business use cases
- Digital growth and customer journeys
- Hospitality and tourism business systems

Technology is presented as an enabler of business outcomes rather than as the primary professional identity.

---

## Selected case studies

The portfolio contains published, evidence-led case studies across professional, freelance and academic work.

### RPA for Invoice Control & Booking Reconciliation

UiPath-based workflow for tourism invoice control, booking reconciliation, commercial-rule validation, structured reporting, exception management and human review.

Public material is sanitised and excludes production workflow files, confidential commercial values and operational data.

### Digital Transformation for a Men's Barbershop

Client-oriented digital transformation covering website development, online booking, local digital presence, customer communication, digital marketing and customer-journey improvement.

### AI-Ready E-Learning Platform

Academic/internship contribution to a multilingual learning platform using Angular, Spring Boot, REST APIs, microservices, Ollama, local LLM integration and RAG over document-based knowledge sources.

### Library Management Application

Full-stack academic application covering application architecture, REST APIs, relational data and business workflows.

### Hotel KPI & Cost Control Analysis

Professional management-control and analytics work involving occupancy, operational costs, budget variance, revenue-related KPIs and decision-support reporting.

No confidential customer, reservation, hotel-contract, invoice or private financial data is published.

---

## Platform capabilities

### Public portfolio

- Responsive 3D interface
- Server-rendered public content
- About, Expertise, Projects, Experience, Education, Certifications, Resume and Contact pages
- Dynamic project detail pages
- Crawlable navigation and breadcrumbs
- Related-project and expertise recommendations
- CMS-governed resume variants
- Validated resume downloads
- Accessible semantic content layered over deferred visual effects
- Mobile and desktop responsive behavior

### CMS and content governance

- Firebase-backed content management
- Published/unpublished content controls
- CMS-authoritative production rendering
- Repository fallback content for documented local-development mode
- Structured project sections and metadata
- Profile and hero management
- Skills management
- Experience and education management
- Certification management
- Resume management
- Social-link management
- Media and upload workflows
- Public-safe handling of confidential business projects

### Authentication and administration

- Firebase email/password authentication
- GitHub OAuth
- Application-managed encrypted TOTP multi-factor authentication
- Remembered-device flow
- Password recovery
- hCaptcha bot protection
- Admin authorization
- Protected CMS routes
- POST-only logout
- Server authorization and Firebase client security rules
- CSRF protection for sensitive mutations
- Origin validation

### SEO, AEO and AI discovery

- Typed route-level metadata
- Canonical URL architecture
- Open Graph metadata
- Twitter card metadata
- Dynamic project metadata
- JSON-LD structured data
- `Person`
- `WebSite`
- `CreativeWork`
- `BreadcrumbList`
- Production/preview indexing controls
- `robots.txt`
- `sitemap.xml`
- `llms.txt`
- `humans.txt`
- Web application manifest
- Google and Bing verification support
- Automated SEO and content audits

`llms.txt` is provided as a supplementary machine-readable summary. It does not guarantee indexing, ranking, citation or inclusion by AI systems.

### Analytics and observability

- Google Tag Manager
- Google Analytics
- Microsoft Clarity
- Vercel Web Analytics
- Vercel Speed Insights
- Consent-aware analytics activation
- Public/private route separation
- Deferred analytics loading
- Recruiter-oriented interaction events

### Performance and quality

- Next.js App Router
- React Server Components
- Incremental CMS revalidation
- Deferred Three.js rendering
- Deferred background media
- Automated TypeScript validation
- ESLint
- Vitest
- Playwright
- Accessibility testing
- Lighthouse auditing
- Security verification
- SEO auditing
- Content-structure auditing

---

## Technology stack

### Application

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS
- Framer Motion
- React Three Fiber
- Drei
- Three.js

### Platform and data

- Cloud Firestore
- Firebase Auth
- Firebase Storage
- Firebase Admin SDK and HTTP-only session cookies
- Vercel

### Security and validation

- hCaptcha
- TOTP MFA
- Firebase security rules
- Zod
- CSRF protection
- Origin validation
- HTTP method validation
- Content Security Policy
- Security headers

### Analytics

- Google Tag Manager
- Google Analytics
- Microsoft Clarity
- Vercel Analytics
- Vercel Speed Insights

---

## Public routes

| Route | Purpose |
|---|---|
| `/` | Portfolio overview |
| `/about` | Professional profile and positioning |
| `/expertise` | Business capabilities, tools and related work |
| `/projects` | Published project portfolio |
| `/projects/[slug]` | Detailed project case study |
| `/experience` | Professional experience timeline |
| `/education` | Academic background |
| `/certifications` | Verified credentials |
| `/resume` | Approved CV variants and validated downloads |
| `/contact` | Contact form and professional links |
| `/robots.txt` | Search-crawler directives |
| `/sitemap.xml` | Canonical public URL discovery |
| `/llms.txt` | AI-readable public summary |
| `/humans.txt` | Human-readable project attribution |
| `/manifest.webmanifest` | Web application metadata |

Operational routes under `/admin`, `/auth` and `/api` are excluded from public discovery and protected through authentication, authorization, `noindex` and appropriate response controls.

---

## Local development

### Prerequisites

- Node.js compatible with Next.js 16
- npm
- Firebase project for CMS/auth/storage functionality
- hCaptcha configuration for protected authentication flows

### Installation

```bash
git clone https://github.com/ahmedazizmhiri/Personal-Portfolio-and-Content-Management-Platform.git
cd Personal-Portfolio-and-Content-Management-Platform
npm ci
cp .env.example .env.local
npm run dev
```

Open:

```text
http://localhost:3000
```

---

## Environment variables

Use `.env.example` as the source of truth.

Never commit production secrets.

```env
# Public Firebase configuration
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=

# Server-only Firebase credentials (or Application Default Credentials)
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
FIREBASE_MFA_ENCRYPTION_KEY=
FIREBASE_GITHUB_CLIENT_ID=
FIREBASE_GITHUB_CLIENT_SECRET=

# Public CAPTCHA configuration
NEXT_PUBLIC_CAPTCHA_PROVIDER=hcaptcha
NEXT_PUBLIC_CAPTCHA_SITE_KEY=

# Server-only CAPTCHA, privacy, device, limiter and notification secrets
HCAPTCHA_SECRET_KEY=
RATE_LIMIT_HMAC_SECRET=
PRIVACY_HMAC_SECRET=
ADMIN_DEVICE_HMAC_SECRET=
RESEND_API_KEY=
CONTACT_NOTIFICATION_TO=
CONTACT_NOTIFICATION_FROM=

# Canonical application URLs
NEXT_PUBLIC_SITE_URL=https://ahmedaziz-portfolio.vercel.app
APP_URL=https://ahmedaziz-portfolio.vercel.app
ALLOWED_ORIGINS=https://ahmedaziz-portfolio.vercel.app

# Admin MFA policy
REQUIRE_ADMIN_MFA=true
ADMIN_MFA_REMEMBER_DAYS=10

# Public integrations
NEXT_PUBLIC_GITHUB_USERNAME=ahmedazizmhiri
NEXT_PUBLIC_GTM_ID=
NEXT_PUBLIC_CLARITY_PROJECT_ID=
NEXT_PUBLIC_BING_SITE_VERIFICATION=
NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION=
```

### Security rules

- `FIREBASE_PRIVATE_KEY` and all application secrets are server-only and must never be exposed to browser code.
- `HCAPTCHA_SECRET_KEY` is server-only.
- HMAC secrets must be independently generated from strong random material.
- Preview deployments must remain non-indexable.
- Production canonical URLs must not be generated from an untrusted request host.
- Confidential operational data must never be stored in repository fixtures or public documentation.

Contact notifications are attempted after accepted messages are durably persisted. Failed attempts remain visible to the CMS administrator for manual retry.

---

## Available commands

```bash
npm run dev
npm run type-check
npm run lint
npm run test
npm run test:coverage
npm run test:integration
npm run build
npm run start
npm run test:e2e
npm run audit:security
npm run audit:seo
npm run audit:lighthouse
npm run content:audit
npm run analytics:verify
```

| Command | Purpose |
|---|---|
| `npm run dev` | Start the development server |
| `npm run type-check` | Run TypeScript validation |
| `npm run lint` | Run ESLint |
| `npm run test` | Run deterministic Vitest tests |
| `npm run test:coverage` | Run tests with coverage thresholds |
| `npm run test:integration` | Run isolated Firebase emulator integration tests |
| `npm run build` | Create a production build |
| `npm run start` | Start the production server locally |
| `npm run test:e2e` | Run browser and accessibility flows |
| `npm run audit:security` | Validate production security invariants |
| `npm run audit:seo` | Audit metadata, canonicals and discoverability |
| `npm run audit:lighthouse` | Run performance, accessibility, SEO and best-practice budgets |
| `npm run content:audit` | Compare CMS/public content structure |
| `npm run analytics:verify` | Validate analytics-consent behavior |

---

## Search and discovery endpoints

Production:

```text
https://ahmedaziz-portfolio.vercel.app
```

Discovery resources:

```text
/robots.txt
/sitemap.xml
/llms.txt
/humans.txt
/manifest.webmanifest
```

---

## Content publication model

The production application follows these rules:

1. When Firebase is configured, published CMS content is authoritative.
2. A valid empty CMS result remains empty.
3. Unpublished content is never restored through fallback data.
4. Discovery output fails closed when publication state cannot be trusted.
5. Repository fallback content is intended for documented local development.
6. Public case-study content must remain factual and non-confidential.
7. Unsupported metrics and outcomes must not be invented.

---

## Security principles

`robots.txt` is not treated as a security mechanism.

Security depends on:

- Authentication
- Authorization
- Firebase rules and server authorization
- MFA
- CSRF protection
- Origin checks
- Input validation
- CAPTCHA
- Strict HTTP methods
- Protected server-side operations
- Security headers
- Appropriate `401`, `403` and `405` responses

Administrative and authentication surfaces are intentionally separated from public portfolio discovery and analytics.

---

## Project structure

```text
app/                 Next.js routes, layouts, metadata and route handlers
components/          Public UI, admin UI, analytics, security and SEO components
config/              Site-wide configuration
constants/           Verified repository fallback content
lib/                 CMS, Firebase, authentication, analytics and SEO utilities
public/              Public images and static resources
scripts/security/    Production security verification
scripts/seo/         Technical SEO auditing
scripts/content/     Public CMS/content auditing
scripts/analytics/   Analytics-consent verification
docs/                SEO, branding, security and operating documentation
firebase/             Firebase rules, index/TTL configuration
supabase/             Historical source database migrations
tests/                Unit, integration and behavior tests
```

---

## Deployment

The application is deployed on Vercel.

Before a production release:

1. Configure required environment variables.
2. Configure Firebase authentication providers, action URLs and rules.
3. Configure hCaptcha.
4. Ensure preview deployments remain `noindex`.
5. Run type-check, lint, tests and production build validation.
6. Run security and SEO checks.
7. Validate authentication and MFA flows.
8. Validate CMS writes and uploads.
9. Validate analytics consent.
10. Validate structured data and social previews.

---

## Quality and launch validation

The portfolio has been evaluated across:

- Automated quality gates
- Production functional QA
- Recruiter/content positioning
- Responsive UX
- Accessibility
- Performance
- Security
- Privacy
- Authentication boundaries
- CMS behavior
- SEO
- Discoverability
- Analytics consistency
- Production launch readiness

The public project documentation avoids unsupported claims and does not treat automated audits as proof of business outcomes.

---

## Accuracy and privacy

The project intentionally avoids:

- Unsupported performance metrics
- Fake testimonials
- Fabricated business outcomes
- Confidential operational information

Public content must not expose:

- Customer identities
- Reservation references
- Hotel contracts
- Invoice values
- Confidential commercial conditions
- Private financial figures
- Credentials
- Authentication secrets
- Administrative data

---

## Author

**Ahmed Aziz Mhiri**

Marketing & Commercial Analytics · Business Intelligence · Digital Transformation · Automation  
**Big Data & Applied AI**

- [Portfolio](https://ahmedaziz-portfolio.vercel.app)
- [LinkedIn](https://www.linkedin.com/in/ahmed-aziz-mhiri/)
- [GitHub](https://github.com/ahmedazizmhiri)

---

## License

This project is licensed under the **MIT License**.
