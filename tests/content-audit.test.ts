import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const auditScript = join(root, "scripts/content/audit.mjs");
const temporaryDirectories: string[] = [];

const createRepositoryFixture = (portfolioSource = "") => {
  const directory = mkdtempSync(join(tmpdir(), "portfolio-content-audit-"));
  temporaryDirectories.push(directory);
  mkdirSync(join(directory, "constants"), { recursive: true });
  mkdirSync(join(directory, "data"), { recursive: true });
  mkdirSync(join(directory, "public/cv"), { recursive: true });
  writeFileSync(join(directory, "constants/portfolio.ts"), portfolioSource);
  writeFileSync(join(directory, "data/fallback-portfolio.ts"), "");
  return directory;
};

const withoutFirebase = () => {
  const environment = { ...process.env };
  delete environment.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  delete environment.CONTENT_AUDIT_FIXTURE_URL;
  return environment;
};

const validSnapshots: Record<string, unknown[]> = {
  profile: [
    {
      full_name: "Ahmed Aziz Mhiri",
      availability:
        "Open to selected freelance projects and building toward international full-time opportunities from 2027.",
      published: true,
    },
  ],
  experience: [
    {
      company: "El Mouradi Hotels",
      role: "Digital Transformation Project Manager",
      start_date: "Jul 2026",
      end_date: "Present",
      date_label: "Jul 2026 - Present",
      published: true,
    },
    {
      company: "Sunshine Holiday Group / Sunshine Vacances France",
      role: "Head of IT Services | Process Automation & Business Systems",
      start_date: "Jul 2025",
      end_date: "Jul 2026",
      date_label: "Jul 2025 - Jul 2026",
      published: true,
    },
    {
      company: "El Mouradi Hotels",
      role: "Management Control Intern",
      start_date: "Jun 2023",
      end_date: "Sep 2023",
      date_label: "Jun 2023 - Sep 2023",
      published: true,
    },
  ],
  education: [
    {
      institution: "IHEC Carthage",
      degree: "Master's in Big Data Analytics & E-Commerce",
      start_date: "Oct 2025",
      end_date: "Jun 2027",
      status: "In progress — expected graduation June 2027",
      published: true,
    },
    {
      institution: "IHEC Carthage",
      degree: "Licence / Bachelor's degree in Business Intelligence",
      start_date: "Jan 2021",
      end_date: "Jun 2025",
      status:
        "Overall average: 17.11/20 · PFE grade: 19.5/20 · Mention Excellent",
      published: true,
    },
  ],
  resumes: [
    {
      label: "English CV",
      variant: "english-professional-cv",
      pdf_url: "/cv/Ahmed_Aziz_Mhiri_CV_English.pdf",
      docx_url: "/cv/Ahmed_Aziz_Mhiri_CV_English.docx",
      published: true,
    },
    {
      label: "French CV",
      variant: "french-cv",
      pdf_url: "/cv/Ahmed_Aziz_Mhiri_CV_Francais.pdf",
      docx_url: "/cv/Ahmed_Aziz_Mhiri_CV_Francais.docx",
      published: true,
    },
    {
      label: "Italian CV",
      variant: "italian-cv",
      pdf_url: "/cv/Ahmed_Aziz_Mhiri_CV_Italian.pdf",
      docx_url: "/cv/Ahmed_Aziz_Mhiri_CV_Italian.docx",
      published: true,
    },
  ],
  pages: [
    "home",
    "about",
    "expertise",
    "projects",
    "experience",
    "education",
    "certifications",
    "resume",
    "contact",
  ].map((page_key) => ({ page_key })),
};

const startSnapshotServer = async (
  snapshots: Record<string, unknown[]>,
) => {
  const server = createServer((request, response) => {
    const table = new URL(request.url || "/", "http://127.0.0.1")
      .pathname.split("/")
      .filter(Boolean)
      .at(-1) || "";
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(snapshots[table] ?? []));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Content audit fixture server did not bind a TCP port");
  }
  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
  };
};

const stopServer = (server: Server) =>
  new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

const runConfiguredAudit = (
  directory: string,
  url: string,
) => new Promise<{ code: number | null; output: string }>((resolve) => {
  const child = spawn(process.execPath, [auditScript], {
    cwd: directory,
    env: {
      ...process.env,
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: "",
      CONTENT_AUDIT_FIXTURE_URL: url,
    },
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    output += String(chunk);
  });
  child.on("close", (code) => resolve({ code, output }));
});

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Wave 1 content audit", () => {
  it("checks deprecated public CV filenames without Firebase", () => {
    const directory = createRepositoryFixture();
    writeFileSync(join(directory, "public/cv/Ahmed_CV_ATS.pdf"), "fixture");
    writeFileSync(
      join(directory, "public/cv/Ahmed_CV_Canadian.docx"),
      "fixture",
    );

    const result = spawnSync(process.execPath, [auditScript], {
      cwd: directory,
      env: withoutFirebase(),
      encoding: "utf8",
    });
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain("Ahmed_CV_ATS.pdf is a deprecated public CV asset");
    expect(output).toContain(
      "Ahmed_CV_Canadian.docx is a deprecated public CV asset",
    );
    expect(output).toContain("Firebase is not configured");
  });

  it("accepts exactly one fully backed EN, FR and IT row", async () => {
    const directory = createRepositoryFixture();
    const { server, url } = await startSnapshotServer(validSnapshots);
    try {
      const result = await runConfiguredAudit(directory, url);

      expect(result.code).toBe(0);
      expect(result.output).toContain("0 failure(s), 0 warning(s)");
    } finally {
      await stopServer(server);
    }
  });

  it("requires both PDF and DOCX URLs for every approved resume", async () => {
    const directory = createRepositoryFixture();
    const missingAssetSnapshots = structuredClone(validSnapshots);
    const frenchResume = missingAssetSnapshots.resumes.find(
      (resume) => (resume as { variant?: unknown }).variant === "french-cv",
    ) as { docx_url?: unknown } | undefined;
    const italianResume = missingAssetSnapshots.resumes.find(
      (resume) => (resume as { variant?: unknown }).variant === "italian-cv",
    ) as { pdf_url?: unknown } | undefined;
    if (frenchResume) frenchResume.docx_url = null;
    if (italianResume) italianResume.pdf_url = "";
    const { server, url } = await startSnapshotServer(missingAssetSnapshots);
    try {
      const result = await runConfiguredAudit(directory, url);

      expect(result.code).toBe(1);
      expect(result.output).toContain(
        "French resume has no DOCX URL; a validated asset is required",
      );
      expect(result.output).toContain(
        "Italian resume has no PDF URL; a validated asset is required",
      );
      expect(result.output).toContain("2 failure(s), 0 warning(s)");
    } finally {
      await stopServer(server);
    }
  });

  it("requires exactly one published English, French and Italian row", async () => {
    const directory = createRepositoryFixture();
    const missingItalianSnapshots = structuredClone(validSnapshots);
    missingItalianSnapshots.resumes = missingItalianSnapshots.resumes.filter(
      (resume) =>
        (resume as { variant?: unknown }).variant !== "italian-cv",
    );
    const { server, url } = await startSnapshotServer(missingItalianSnapshots);
    try {
      const result = await runConfiguredAudit(directory, url);

      expect(result.code).toBe(1);
      expect(result.output).toContain(
        "published resume policy requires exactly one Italian variant; found 0",
      );
    } finally {
      await stopServer(server);
    }
  });

  it("fails on the known stale CMS regressions", async () => {
    const directory = createRepositoryFixture();
    const staleSnapshots = structuredClone(validSnapshots);
    staleSnapshots.profile = [
      {
        full_name: "Ahmed Aziz Mhiri",
        availability: "International full-time from October 2027",
        published: true,
      },
    ];
    staleSnapshots.experience = [
      {
        company: "Sunshine Vacances France",
        role: "Head of IT Services | Process Automation & Business Systems",
        start_date: "Jul 2025",
        end_date: "Present",
        date_label: "Jul 2025 - Present",
        published: true,
      },
      {
        company: "Wrong Employer",
        role: "Management Control Intern",
        start_date: "Jul 2023",
        end_date: "Aug 2023",
        published: true,
      },
    ];
    staleSnapshots.education = [
      {
        degree: "Master's in Big Data Analytics & E-Commerce",
        end_date: "Oct 2027",
        published: true,
      },
      {
        degree: "Bachelor's degree in Business Intelligence",
        status: "Completed",
        published: true,
      },
    ];
    staleSnapshots.projects = [
      {
        slug: "master-multi-agent-llm-project",
        title: "LLM Interface for Multi-Agent System Management",
        summary: "Obsolete project",
        description: "Obsolete project",
        seo_title: "Obsolete",
        seo_description: "Obsolete",
        cover_image_url: "/cover.png",
        open_graph_image: "/cover.png",
        status: "published",
        published: true,
      },
    ];
    staleSnapshots.resumes = [
      {
        label: "ATS CV",
        variant: "ats-cv",
        pdf_url: "/cv/ats.pdf",
        docx_url: null,
        published: true,
      },
      {
        label: "Master CV",
        variant: "master-cv",
        pdf_url: null,
        docx_url: null,
        published: true,
      },
      {
        label: "Italian CV",
        variant: "italian-cv",
        pdf_url: null,
        docx_url: null,
        published: true,
      },
      {
        label: "English CV",
        variant: "english-professional-cv",
        pdf_url: "/cv/Ahmed_Aziz_Mhiri_Master.pdf",
        docx_url: null,
        published: true,
      },
      {
        label: "English CV",
        variant: "internal-review-copy",
        pdf_url: null,
        docx_url: null,
        published: true,
      },
    ];
    const { server, url } = await startSnapshotServer(staleSnapshots);
    try {
      const result = await runConfiguredAudit(directory, url);

      expect(result.code).toBe(1);
      for (const failure of [
        "stale October/Summer 2027 availability copy",
        "Sunshine is still represented as a current role",
        "missing the current El Mouradi Digital Transformation Project Manager role",
        "missing the El Mouradi Management Control Intern role",
        "Master ending Jun 2027",
        "17.11/20 final average",
        "PFE 19.5/20",
        "Mention Excellent",
        "obsolete Master multi-agent LLM project or copy",
        "deprecated resume variant is published: ats-cv ATS CV",
        "deprecated resume variant is published: master-cv Master CV",
        "deprecated/private resume asset is published: english-professional-cv English CV",
        "unapproved resume variant is published: internal-review-copy English CV",
        "Italian resume has no PDF URL; a validated asset is required",
        "Italian resume has no DOCX URL; a validated asset is required",
      ]) {
        expect(result.output).toContain(failure);
      }
    } finally {
      await stopServer(server);
    }
  });
});
