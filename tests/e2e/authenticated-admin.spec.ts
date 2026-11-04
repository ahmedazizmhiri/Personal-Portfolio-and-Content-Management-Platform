import AxeBuilder from "@axe-core/playwright";
import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { expect, test } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";

const productionProjectRef = process.env.PRODUCTION_FIREBASE_PROJECT_ID ?? "portfolio-cb36f";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "";
const storageState = process.env.E2E_ADMIN_STORAGE_STATE ?? "";
const firebaseProjectId = process.env.E2E_FIREBASE_PROJECT_ID ?? "";
const isolated = Boolean(baseURL && storageState && firebaseProjectId)
  && firebaseProjectId !== productionProjectRef
  && process.env.ALLOW_E2E_DATABASE_MUTATIONS === "true";

test.describe("authenticated CMS lifecycle in an isolated project", () => {
  test.skip(
    !isolated,
    "Requires an AAL2 admin storage state and an explicitly mutation-enabled non-production Firebase project.",
  );
  test.use({
    storageState: storageState || { cookies: [], origins: [] },
  });

  const mutationHeaders = async (
    request: APIRequestContext,
  ) => {
    const response = await request.get("/api/auth/csrf", {
      headers: { Origin: baseURL },
    });
    expect(response.status()).toBe(200);
    const payload = await response.json();
    expect(payload.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    return {
      Origin: baseURL,
      "Content-Type": "application/json",
      "x-csrf-token": payload.token as string,
    };
  };

  test("dashboard is reachable and has no serious axe violations", async ({
    page,
  }) => {
    const response = await page.goto("/admin", { waitUntil: "networkidle" });
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/admin$/);
    await expect(
      page.getByRole("heading", { name: /content management|dashboard/i }).first(),
    ).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();
    expect(
      results.violations.filter((violation) =>
        ["critical", "serious"].includes(violation.impact ?? ""),
      ),
    ).toEqual([]);
  });

  test("create, update, conflict, archive, restore, delete, and revision history", async ({
    request,
  }) => {
    const headers = await mutationHeaders(request);
    const suffix = crypto.randomUUID().slice(0, 12);
    const slug = `e2e-draft-${suffix}`;

    const createdResponse = await request.post("/api/admin/content", {
      headers,
      data: {
        table: "projects",
        values: {
          slug,
          title: `E2E draft ${suffix}`,
          summary: "Isolated CMS lifecycle fixture.",
          description: "Never published and never created in production.",
          status: "draft",
          published: false,
          featured: false,
          projects_page_order: 9_000,
          sort_order: 9_000,
        },
      },
    });
    expect(createdResponse.status()).toBe(200);
    const createdPayload = await createdResponse.json();
    const project = createdPayload.row as {
      id: string;
      updated_at: string;
    };
    expect(project.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    const updatedResponse = await request.post("/api/admin/content", {
      headers,
      data: {
        table: "projects",
        expectedUpdatedAt: project.updated_at,
        values: {
          id: project.id,
          slug,
          title: `Updated E2E draft ${suffix}`,
          summary: "Updated isolated CMS lifecycle fixture.",
          description: "Still never published or created in production.",
          status: "draft",
          published: false,
          featured: false,
          projects_page_order: 9_000,
          sort_order: 9_000,
        },
      },
    });
    expect(updatedResponse.status()).toBe(200);
    const updated = (await updatedResponse.json()).row as {
      id: string;
      updated_at: string;
    };

    const staleResponse = await request.post("/api/admin/content", {
      headers,
      data: {
        table: "projects",
        expectedUpdatedAt: project.updated_at,
        values: {
          id: project.id,
          slug,
          title: "This stale edit must not win",
          status: "draft",
          published: false,
        },
      },
    });
    expect(staleResponse.status()).toBe(409);
    expect((await staleResponse.json()).code).toBe("edit_conflict");

    const archivedResponse = await request.delete("/api/admin/content", {
      headers,
      data: {
        table: "projects",
        id: project.id,
        expectedUpdatedAt: updated.updated_at,
      },
    });
    expect(archivedResponse.status()).toBe(200);
    const archived = (await archivedResponse.json()).row as {
      id: string;
      updated_at: string;
    };

    const restoredResponse = await request.post("/api/admin/content", {
      headers,
      data: {
        table: "projects",
        expectedUpdatedAt: archived.updated_at,
        values: {
          id: project.id,
          slug,
          title: `Restored E2E draft ${suffix}`,
          summary: "Restored isolated CMS lifecycle fixture.",
          description: "Still a draft.",
          status: "draft",
          published: false,
          featured: false,
          projects_page_order: 9_000,
          sort_order: 9_000,
        },
      },
    });
    expect(restoredResponse.status()).toBe(200);
    const restored = (await restoredResponse.json()).row as {
      updated_at: string;
    };

    const sectionResponse = await request.post("/api/admin/content", {
      headers,
      data: {
        table: "project_sections",
        values: {
          project_id: project.id,
          section_type: "rich_text",
          title: "Disposable E2E section",
          body: "Draft-only test evidence.",
          bullets: [],
          sort_order: 0,
          is_visible: true,
          is_archived: false,
        },
      },
    });
    expect(sectionResponse.status()).toBe(200);
    const section = (await sectionResponse.json()).row as { id: string };

    const itemResponse = await request.post("/api/admin/content", {
      headers,
      data: {
        table: "project_section_items",
        values: {
          project_section_id: section.id,
          label: "Disposable",
          value: "Delete me",
          description: "Permanent-delete path fixture.",
          display_order: 0,
          is_visible: true,
        },
      },
    });
    expect(itemResponse.status()).toBe(200);
    const item = (await itemResponse.json()).row as {
      id: string;
      updated_at: string;
    };

    const deletedItemResponse = await request.delete("/api/admin/content", {
      headers,
      data: {
        table: "project_section_items",
        id: item.id,
        expectedUpdatedAt: item.updated_at,
      },
    });
    expect(deletedItemResponse.status()).toBe(200);
    expect((await deletedItemResponse.json()).row).toBeNull();

    const revisionsResponse = await request.get(
      `/api/admin/revisions?table=projects&id=${project.id}`,
      { headers: { Origin: baseURL } },
    );
    expect(revisionsResponse.status()).toBe(200);
    const revisions = (await revisionsResponse.json()).revisions as Array<{
      operation: string;
    }>;
    expect(revisions.map((revision) => revision.operation)).toEqual(
      expect.arrayContaining(["create", "update", "archive"]),
    );

    const finalArchive = await request.delete("/api/admin/content", {
      headers,
      data: {
        table: "projects",
        id: project.id,
        expectedUpdatedAt: restored.updated_at,
      },
    });
    expect(finalArchive.status()).toBe(200);
  });

  test("upload moves through pending grace and reconciled deletion", async ({
    request,
  }) => {
    const headers = await mutationHeaders(request);
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    const uploadedResponse = await request.post("/api/admin/upload", {
      headers: {
        Origin: baseURL,
        "x-csrf-token": headers["x-csrf-token"],
      },
      multipart: {
        bucket: "project-images",
        file: {
          name: `e2e-${crypto.randomUUID()}.png`,
          mimeType: "image/png",
          buffer: png,
        },
      },
    });
    expect(uploadedResponse.status()).toBe(200);
    const upload = (await uploadedResponse.json()).upload as {
      id: string;
      bucket: string;
      path: string;
    };

    const pendingResponse = await request.delete("/api/admin/upload", {
      headers,
      data: { id: upload.id },
    });
    expect(pendingResponse.status()).toBe(202);
    expect((await pendingResponse.json()).upload.deletion_status).toBe(
      "pending",
    );

    const app = getApps().find((app) => app.name === "e2e") ?? initializeApp({ projectId: firebaseProjectId, credential: applicationDefault() }, "e2e");
    await getFirestore(app).collection("uploads").doc(upload.id).update({
      deletion_requested_at: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
    });

    const deletedResponse = await request.delete("/api/admin/upload", {
      headers,
      data: { id: upload.id },
    });
    expect(deletedResponse.status()).toBe(200);
    expect((await deletedResponse.json()).id).toBe(upload.id);
  });
});
