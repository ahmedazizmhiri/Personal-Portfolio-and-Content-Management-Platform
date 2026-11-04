import fs from "node:fs";
import path from "node:path";

const repositoryRoot = path.resolve(".");
const failures = [];
const warnings = [];
const snapshots = new Map();

const staleAvailabilityPatterns = [
  /\b(?:October|Oct\.?)\s+2027\b/i,
  /\bSummer\s+2027\b/i,
];
const obsoleteMasterProjectPatterns = [
  /master-multi-agent-llm-project/i,
  /Master\s+Multi-Agent\s+LLM\s+Project/i,
  /LLM\s+Interface\s+for\s+Multi-Agent\s+System\s+Management/i,
  /interface\s+for\s+launching\s+and\s+managing\s+a\s+multi-agent\s+system/i,
];
const stalePositioningPatterns = [
  /Data-Driven Marketing\s*&\s*Commercial Analytics/i,
  /Turning Data into Commercial Growth/i,
];
const deprecatedPublicCvFilename =
  /(?:^|[_\-.\s])(?:ats|canada|canadian|canadien|canadienne|master|masters|mastere)(?:[_\-.\s]|$)/i;

const flattenStrings = (value) => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(flattenStrings);
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(flattenStrings);
  }
  return [];
};

const listFiles = (directory) => {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(absolutePath) : [absolutePath];
  });
};

const auditRepositoryFallbacks = () => {
  const identitySourceFiles = [
    "README.md",
    "constants/portfolio.ts",
    "data/fallback-portfolio.ts",
    "app/contact/page.tsx",
    "app/humans.txt/route.ts",
    "app/opengraph-image.tsx",
    "app/resume/page.tsx",
    "config/index.ts",
    "lib/seo/config.ts",
    "lib/seo/metadata.ts",
    "package.json",
    "docs/DESIGN_MIX_IMPLEMENTATION.md",
    "docs/personal-brand-strategy.md",
    "docs/profile-bios-and-descriptions.md",
    "docs/seo-topic-and-entity-map.md",
    "supabase/00_CLEAN_RESET_AND_SEED.sql",
    "supabase/seed_ahmed_portfolio.sql",
  ];
  for (const relativePath of identitySourceFiles) {
    const absolutePath = path.join(repositoryRoot, relativePath);
    if (!fs.existsSync(absolutePath)) continue;
    const source = fs.readFileSync(absolutePath, "utf8");
    for (const pattern of staleAvailabilityPatterns) {
      if (pattern.test(source)) {
        failures.push(`${relativePath} contains stale 2027 availability copy`);
        break;
      }
    }
    if (/Sunshine[\s\S]{0,240}\bPresent\b/i.test(source)) {
      failures.push(`${relativePath} still represents Sunshine as current`);
    }
    for (const pattern of obsoleteMasterProjectPatterns) {
      if (pattern.test(source)) {
        failures.push(`${relativePath} contains the obsolete Master multi-agent LLM project`);
        break;
      }
    }
    for (const pattern of stalePositioningPatterns) {
      if (pattern.test(source)) {
        failures.push(`${relativePath} contains stale profile positioning`);
        break;
      }
    }
  }

  for (const absolutePath of listFiles(path.join(repositoryRoot, "public/cv"))) {
    if (!deprecatedPublicCvFilename.test(path.basename(absolutePath))) continue;
    failures.push(
      `${path.relative(repositoryRoot, absolutePath)} is a deprecated public CV asset`,
    );
  }
};

const report = () => {
  warnings.forEach((warning) => console.warn(`WARN ${warning}`));
  failures.forEach((failure) => console.error(`FAIL ${failure}`));
  console.log(
    `Content audit summary: ${failures.length} failure(s), ${warnings.length} warning(s).`,
  );
};

const parseEnv = (file) => {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter(
        (line) =>
          line &&
          !line.trimStart().startsWith("#") &&
          line.includes("="),
      )
      .map((line) => {
        const index = line.indexOf("=");
        return [
          line.slice(0, index).trim(),
          line
            .slice(index + 1)
            .trim()
            .replace(/^['"]|['"]$/g, ""),
        ];
      }),
  );
};

auditRepositoryFallbacks();

const localEnv = parseEnv(path.join(repositoryRoot, ".env.local"));
const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || localEnv.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const fixtureUrl = process.env.NODE_ENV === "test" ? process.env.CONTENT_AUDIT_FIXTURE_URL : "";
for (const [key, value] of Object.entries(localEnv)) { if (!process.env[key]) process.env[key] = value; }
const publicQueries = [
  [
    "profile",
    "full_name,headline,secondary_line,tagline,availability,short_bio,about_text,about_focus,published",
    "published=eq.true",
  ],
  [
    "hero",
    "eyebrow,title,subtitle,tagline,dynamic_titles,primary_cta_label,secondary_cta_label,published",
    "published=eq.true",
  ],
  ["about", "title,body,highlights,published", "published=eq.true"],
  ["skills", "name,category,sort_order,published", "published=eq.true"],
  [
    "projects",
    "id,slug,title,summary,description,status,published,seo_title,seo_description,cover_image_url,open_graph_image",
    "published=eq.true&status=eq.published",
  ],
  [
    "project_sections",
    "id,project_id,title,body,bullets,section_type,is_visible,is_archived",
    "is_visible=eq.true&is_archived=eq.false",
  ],
  [
    "project_section_items",
    "id,project_section_id,label,value,description,is_visible",
    "is_visible=eq.true",
  ],
  [
    "project_media",
    "id,project_id,media_url,alt_text,media_type,is_visible",
    "is_visible=eq.true",
  ],
  [
    "experience",
    "company,role,start_date,end_date,date_label,points,published",
    "published=eq.true",
  ],
  [
    "education",
    "institution,degree,start_date,end_date,status,location,published",
    "published=eq.true",
  ],
  [
    "certifications",
    "name,issuer,credential_url,published",
    "published=eq.true",
  ],
  ["resumes", "label,variant,pdf_url,docx_url,published", "published=eq.true"],
  ["social_links", "label,url,published", "published=eq.true"],
  ["site_settings", "key,value", ""],
  ["pages", "id,page_key,title,is_published", "is_published=eq.true"],
  [
    "page_sections",
    "id,page_id,section_type,title,description,is_visible,is_archived",
    "is_visible=eq.true&is_archived=eq.false",
  ],
  [
    "page_section_items",
    "id,page_section_id,title,description,media_url,is_visible",
    "is_visible=eq.true",
  ],
  [
    "volunteering",
    "role,organisation,summary,published,archived",
    "published=eq.true&archived=eq.false",
  ],
];

if (!projectId && !fixtureUrl) {
  console.log(
    "Content audit: Firebase is not configured; repository fallback and public assets were inspected.",
  );
  report();
  process.exit(failures.length ? 1 : 0);
}

console.log(
  "Content audit: inspecting CMS content with the server Firebase Admin SDK.",
);
for (const [table, select, filter] of publicQueries) {
  let rows;
  if (fixtureUrl) {
    const response = await fetch(`${fixtureUrl}/rest/v1/${table}?select=${encodeURIComponent(select)}&limit=500&${filter}`);
    if (!response.ok) { failures.push(`${table}: published read failed with HTTP ${response.status}`); continue; }
    rows = await response.json();
  } else {
    try {
      const { getAdmin } = await import("../firebase/shared.mjs");
      const snapshot = await getAdmin(projectId).db.collection(table).limit(500).get();
      rows = snapshot.docs.map((doc) => doc.data());
      const predicates = filter.split("&").filter(Boolean).map((condition) => condition.split("=eq."));
      rows = rows.filter((row) => predicates.every(([field, value]) => String(row[field]) === value));
    } catch (error) { failures.push(`${table}: Firestore read failed (${error.code ?? "unavailable"})`); continue; }
  }
  if (!Array.isArray(rows)) {
    failures.push(`${table}: response was not an array`);
    continue;
  }
  snapshots.set(table, rows);
  console.log(`${table}: ${rows.length} published/public row(s).`);
}

const projects = snapshots.get("projects") ?? [];
const sections = snapshots.get("project_sections") ?? [];
const sectionItems = snapshots.get("project_section_items") ?? [];
const media = snapshots.get("project_media") ?? [];

for (const project of projects) {
  if (!String(project.summary || project.description || "").trim()) {
    failures.push(
      `project ${String(project.slug || project.id)} has no public summary`,
    );
  }
  if (!String(project.seo_title || "").trim()) {
    warnings.push(
      `project ${String(project.slug || project.id)} has no SEO title`,
    );
  }
  if (!String(project.seo_description || "").trim()) {
    warnings.push(
      `project ${String(project.slug || project.id)} has no SEO description`,
    );
  }
  if (!String(project.cover_image_url || "").trim()) {
    warnings.push(
      `project ${String(project.slug || project.id)} has no cover image`,
    );
  }
  if (!String(project.open_graph_image || "").trim()) {
    warnings.push(
      `project ${String(project.slug || project.id)} has no social image`,
    );
  }

  if (
    ["vermeg-ai-ready-e-learning-platform", "ai-ready-elearning-platform"]
      .includes(String(project.slug || ""))
  ) {
    const boundaryCopy = [
      project.title,
      project.summary,
      project.description,
    ].join(" ");
    if (
      !/prototype/i.test(boundaryCopy)
      || !/(two-person|two person|team)/i.test(boundaryCopy)
      || !/chatbot/i.test(boundaryCopy)
      || !/selected (application )?services/i.test(boundaryCopy)
      || !/(not presented as a production deployment|not a production deployment)/i.test(boundaryCopy)
      || !/(not sole-authored|not solely authored|not presented .*sole-authored system|rather than (?:the )?(?:complete|whole) (?:platform|system) independently)/i.test(boundaryCopy)
    ) {
      failures.push(
        `project ${String(project.slug)} does not state the approved VERMEG team-prototype, bounded-contribution, production-presentation and authorship limits`,
      );
    }
  }
}

for (const section of sections) {
  const bullets = Array.isArray(section.bullets)
    ? section.bullets.some((item) => String(item || "").trim())
    : false;
  const hasItems = sectionItems.some(
    (item) =>
      item.project_section_id === section.id &&
      item.is_visible !== false &&
      String(item.value || item.description || "").trim(),
  );
  const acceptsProjectMedia = ["media", "media_gallery"].includes(
    String(section.section_type || ""),
  );
  const hasMedia =
    acceptsProjectMedia &&
    media.some(
      (item) =>
        item.project_id === section.project_id &&
        String(item.media_url || "").trim() &&
        String(item.alt_text || "").trim(),
    );
  if (
    !String(section.body || "").trim() &&
    !bullets &&
    !hasItems &&
    !hasMedia
  ) {
    failures.push(
      `project section ${String(section.id)} is visible but title-only`,
    );
  }
}

const profile = (snapshots.get("profile") ?? [])[0];
if (profile && profile.full_name !== "Ahmed Aziz Mhiri") {
  warnings.push(
    `profile.full_name is "${String(profile.full_name || "empty")}"; the CMS identity is rendered verbatim and should be reviewed`,
  );
}

const publishedCmsStrings = Array.from(snapshots.entries()).flatMap(
  ([table, rows]) =>
    rows.flatMap((row) =>
      flattenStrings(row).map((value) => ({ table, value })),
    ),
);
for (const pattern of staleAvailabilityPatterns) {
  const match = publishedCmsStrings.find(({ value }) => pattern.test(value));
  if (match) {
    failures.push(
      `${match.table} contains stale October/Summer 2027 availability copy`,
    );
  }
}
for (const pattern of obsoleteMasterProjectPatterns) {
  const match = publishedCmsStrings.find(({ value }) => pattern.test(value));
  if (match) {
    failures.push(
      `${match.table} contains the obsolete Master multi-agent LLM project or copy`,
    );
    break;
  }
}

const experienceRows = snapshots.get("experience") ?? [];
const rowDates = (row) =>
  [row.start_date, row.end_date, row.date_label].map(String).join(" ");
const sunshineRows = experienceRows.filter((row) =>
  /Sunshine/i.test(String(row.company || "")),
);
if (sunshineRows.some((row) => /\bPresent\b/i.test(rowDates(row)))) {
  failures.push("Sunshine is still represented as a current role");
}

const hasCurrentElMouradiRole = experienceRows.some(
  (row) =>
    /El\s+Mouradi/i.test(String(row.company || ""))
    && /Digital\s+Transformation\s+Project\s+Manager/i.test(
      String(row.role || ""),
    )
    && /\bJul(?:y)?\s+2026\b/i.test(String(row.start_date || row.date_label || ""))
    && /\bPresent\b/i.test(String(row.end_date || row.date_label || "")),
);
if (!hasCurrentElMouradiRole) {
  failures.push(
    "published experience is missing the current El Mouradi Digital Transformation Project Manager role (Jul 2026 - Present)",
  );
}

const hasCorrect2023Internship = experienceRows.some(
  (row) =>
    /El\s+Mouradi/i.test(String(row.company || ""))
    && /Management\s+Control\s+Intern/i.test(String(row.role || ""))
    && /\bJun(?:e)?\s+2023\b/i.test(String(row.start_date || row.date_label || ""))
    && /\bSep(?:t(?:ember)?)?\s+2023\b/i.test(
      String(row.end_date || row.date_label || ""),
    ),
);
if (!hasCorrect2023Internship) {
  failures.push(
    "published experience is missing the El Mouradi Management Control Intern role (June 2023 - September 2023)",
  );
}

const educationRows = snapshots.get("education") ?? [];
const masterEducation = educationRows.find((row) =>
  /Big\s+Data\s+Analytics[\s\S]*E-Commerce/i.test(String(row.degree || "")),
);
if (
  !masterEducation
  || !/\bJun(?:e)?\s+2027\b/i.test(
    String(masterEducation.end_date || masterEducation.status || ""),
  )
) {
  failures.push(
    "published education is missing the Big Data Analytics & E-Commerce Master ending Jun 2027",
  );
}

const licenceEducation = educationRows.find((row) =>
  /Business\s+Intelligence/i.test(String(row.degree || "")),
);
const licenceCopy = flattenStrings(licenceEducation || {}).join(" ");
for (const [pattern, fact] of [
  [/\b17[.,]11(?:\s*\/\s*20)?\b/i, "17.11/20 final average"],
  [
    /\bPFE(?:\s+grade)?\s*:?\s*19[.,]5(?:0)?(?:\s*\/\s*20)?\b/i,
    "PFE 19.5/20",
  ],
  [/Mention\s+Excellent/i, "Mention Excellent"],
]) {
  if (!pattern.test(licenceCopy)) {
    failures.push(`published Business Intelligence education is missing ${fact}`);
  }
}

const approvedResumeVariant = (row) => {
  const normalizeIdentifier = (value) => String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .join("-");
  const variant = normalizeIdentifier(row.variant);
  const aliases = {
    English: new Set(["english", "english-cv", "english-professional-cv"]),
    French: new Set([
      "french",
      "french-cv",
      "french-professional-cv",
      "francais",
      "francais-cv",
      "francais-professional-cv",
    ]),
    Italian: new Set([
      "italian",
      "italian-cv",
      "italian-professional-cv",
      "italiano",
      "italiano-cv",
      "italien",
      "italien-cv",
    ]),
  };
  if (variant) {
    return Object.entries(aliases).find(([, values]) =>
      values.has(variant),
    )?.[0] ?? "";
  }
  const value = normalizeIdentifier(row.label).replaceAll("-", " ");
  if (/\b(?:english|anglais|en)\b/.test(value)) return "English";
  if (/\b(?:french|francais|fr|francaise)\b/.test(value)) return "French";
  if (/\b(?:italian|italien|italiano|it)\b/.test(value)) return "Italian";
  return "";
};

const publicResumeCounts = new Map([
  ["English", 0],
  ["French", 0],
  ["Italian", 0],
]);

for (const resume of snapshots.get("resumes") ?? []) {
  const identity = `${String(resume.variant || "")} ${String(resume.label || "")}`;
  if (deprecatedPublicCvFilename.test(identity)) {
    failures.push(`deprecated resume variant is published: ${identity.trim()}`);
    continue;
  }
  const assetIdentity = `${String(resume.pdf_url || "")} ${String(resume.docx_url || "")}`;
  if (deprecatedPublicCvFilename.test(assetIdentity)) {
    failures.push(
      `deprecated/private resume asset is published: ${identity.trim()}`,
    );
    continue;
  }
  const approvedVariant = approvedResumeVariant(resume);
  if (!approvedVariant) {
    failures.push(`unapproved resume variant is published: ${identity.trim()}`);
    continue;
  }
  publicResumeCounts.set(
    approvedVariant,
    (publicResumeCounts.get(approvedVariant) ?? 0) + 1,
  );
  for (const [field, label] of [
    ["pdf_url", "PDF"],
    ["docx_url", "DOCX"],
  ]) {
    if (!String(resume[field] || "").trim()) {
      failures.push(
        `${approvedVariant} resume has no ${label} URL; a validated asset is required`,
      );
    }
  }
}

for (const requiredVariant of ["English", "French", "Italian"]) {
  const count = publicResumeCounts.get(requiredVariant) ?? 0;
  if (count !== 1) {
    failures.push(
      `published resume policy requires exactly one ${requiredVariant} variant; found ${count}`,
    );
  }
}

for (const experience of experienceRows) {
  if (!/^VERMEG/i.test(String(experience.company || ""))) continue;
  const boundaryCopy = [
    experience.role,
    ...(Array.isArray(experience.points) ? experience.points : []),
  ].join(" ");
  if (
    !/prototype/i.test(boundaryCopy)
    || !/(two-person|two person|team)/i.test(boundaryCopy)
    || !/chatbot/i.test(boundaryCopy)
    || !/selected (application )?services/i.test(boundaryCopy)
    || !/(not presented as a production deployment|not a production deployment)/i.test(boundaryCopy)
    || !/(not sole-authored|not solely authored|not presented .*sole-authored system|rather than (?:the )?(?:complete|whole) (?:platform|system) independently)/i.test(boundaryCopy)
  ) {
    failures.push(
      "VERMEG experience does not state the approved team-prototype, bounded-contribution, production-presentation and authorship limits",
    );
  }
}

const pageKeys = new Set(
  (snapshots.get("pages") ?? []).map((page) => page.page_key),
);
for (const pageKey of [
  "home",
  "about",
  "expertise",
  "projects",
  "experience",
  "education",
  "certifications",
  "resume",
  "contact",
]) {
  if (!pageKeys.has(pageKey)) {
    warnings.push(
      `published page registry is missing ${pageKey}; that route will be noindex and omitted from the sitemap`,
    );
  }
}

report();
process.exitCode = failures.length ? 1 : 0;
