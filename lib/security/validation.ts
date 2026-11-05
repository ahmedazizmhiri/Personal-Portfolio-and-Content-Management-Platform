import { z } from "zod";
import { parseFirebaseAsset } from "@/lib/firebase/assets";

import {
  cmsBlockTypes,
  cmsLayoutVariants,
  variantsForBlock,
} from "@/lib/cms-block-registry";
import { isSafeInternalPath } from "@/lib/security/redirects";

export const emailSchema = z.string().trim().email().max(254);

export const passwordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters.")
  .max(128, "Password is too long.")
  .regex(/[a-z]/, "Password must include a lowercase letter.")
  .regex(/[A-Z]/, "Password must include an uppercase letter.")
  .regex(/[0-9]/, "Password must include a number.");

export const captchaTokenSchema = z.string().trim().min(1).max(4096);

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(256),
  next: z.string().optional(),
  captchaToken: captchaTokenSchema,
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
  captchaToken: captchaTokenSchema,
});

export const resetPasswordSchema = z.object({
  password: passwordSchema,
  oobCode: z.string().trim().min(1).max(2048),
});

export const contactSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: emailSchema,
  message: z.string().trim().min(10).max(5000),
  company: z.string().max(200).optional().default(""),
  captchaToken: captchaTokenSchema,
  submissionId: z.string().uuid(),
}).strict();

export const mfaVerifySchema = z.object({
  factorId: z.string().uuid(),
  code: z.string().regex(/^\d{6}$/),
  rememberDevice: z.boolean().optional().default(false),
});

export const mfaRemoveSchema = z.object({
  factorId: z.string().uuid(),
  code: z.string().regex(/^\d{6}$/).optional(),
});

export const mfaPreferenceSchema = z.object({
  mfaRequired: z.boolean(),
  rememberDeviceEnabled: z.boolean().optional().default(true),
});

export const contentMutationSchema = z.object({
  table: z.string().min(1),
  values: z.record(z.string(), z.unknown()).optional(),
  rows: z.array(z.record(z.string(), z.unknown())).optional(),
  id: z.string().optional(),
  // An existing Firestore timestamp is a concurrency token. Some migrated rows
  // contain legacy non-ISO text: match it exactly rather than rejecting a save.
  expectedUpdatedAt: z.string().min(1).max(128).optional(),
}).strict();

export const builderCompoundMutationSchema = z.object({
  action: z.enum(["duplicate", "move"]),
  table: z.enum(["page_sections", "project_sections"]),
  id: z.string().uuid(),
  expectedUpdatedAt: z.string().min(1).max(128),
  idempotencyKey: z.string().uuid().optional(),
  relatedId: z.string().uuid().optional(),
  relatedExpectedUpdatedAt: z.string().min(1).max(128).optional(),
  direction: z.enum(["up", "down"]).optional(),
}).strict().superRefine((value, context) => {
  if (value.action === "duplicate") {
    if (!value.idempotencyKey) {
      context.addIssue({
        code: "custom",
        path: ["idempotencyKey"],
        message: "A duplicate request key is required.",
      });
    }
    return;
  }
  if (!value.relatedId) {
    context.addIssue({
      code: "custom",
      path: ["relatedId"],
      message: "The neighboring block is required.",
    });
  }
  if (!value.relatedExpectedUpdatedAt) {
    context.addIssue({
      code: "custom",
      path: ["relatedExpectedUpdatedAt"],
      message: "Reload the neighboring block before moving.",
    });
  }
  if (!value.direction) {
    context.addIssue({
      code: "custom",
      path: ["direction"],
      message: "The move direction is required.",
    });
  }
});

export const messageStatusSchema = z.enum(["new", "read", "archived"]);

export const messageActionSchema = z.enum([
  "mark_read",
  "mark_unread",
  "archive",
  "restore_read",
  "restore_unread",
  "resend_notification",
]);

export const messageUpdateSchema = z.object({
  id: z.string().uuid(),
  action: messageActionSchema,
}).strict();

export const messageDeleteSchema = z.object({
  id: z.string().uuid(),
}).strict();

const isHttpsUrl = (value: string) => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

const isInternalPath = isSafeInternalPath;

const isVercelPublicBlobUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && /^[a-z0-9-]+\.public\.blob\.vercel-storage\.com$/.test(url.hostname)
      && url.pathname.length > 1;
  } catch { return false; }
};
const isConfiguredPublicAssetUrl = (value: string) =>
  Boolean(parseFirebaseAsset(value, process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim() ?? ""))
  || isVercelPublicBlobUrl(value);

export const assetUrlSchema = z.string().trim().max(2048).refine(
  (value) =>
    !value || isInternalPath(value) || isConfiguredPublicAssetUrl(value),
  "Enter a site path or a public Firebase/Vercel Blob asset URL.",
);

export const externalUrlSchema = z.string().trim().max(2048).refine(
  (value) => !value || isHttpsUrl(value),
  "Enter a valid HTTPS URL.",
);

export const adminProfileSettingsSchema = z.object({
  displayName: z.string().trim().max(120).optional().default(""),
  jobTitle: z.string().trim().max(160).optional().default(""),
  phone: z.string().trim().max(40).optional().default(""),
  avatarUrl: assetUrlSchema.optional().default(""),
  timezone: z.string().trim().max(100).optional().default(""),
  language: z.string().trim().max(50).optional().default(""),
}).strict();

const emptyStringForNull = (value: unknown) =>
  value === null || value === undefined ? "" : value;

const emptyListForNull = (value: unknown) =>
  value === null || value === undefined ? [] : value;

const optionalText = (max = 5000) =>
  z.preprocess(
    emptyStringForNull,
    z.string().trim().max(max),
  );
const optionalSkillIconKey = z.preprocess(
  emptyStringForNull,
  z
    .string()
    .trim()
    .max(100)
    .refine(
      (value) =>
        !value || /^(?:Fa|Si|Tb)[A-Za-z0-9]+$/.test(value),
      "Use a React Icons export key beginning with Fa, Si or Tb, such as SiPython.",
    ),
);
const optionalHexColor = z.preprocess(
  emptyStringForNull,
  z
    .string()
    .trim()
    .max(7)
    .refine(
      (value) => !value || /^#[0-9A-Fa-f]{6}$/.test(value),
      "Use a six-digit hexadecimal color such as #3776ab.",
    ),
);

const requiredText = (max = 500) =>
  z.string().trim().min(1).max(max);

const stringList = z.preprocess(
  emptyListForNull,
  z.array(z.string().trim().min(1).max(300)).max(100),
);

const sortOrder = z
  .number()
  .int()
  .min(-10000)
  .max(10000)
  .optional()
  .default(0);

const published = z.boolean().optional().default(true);

const id = z.string().uuid().optional();

const assetLink = z.preprocess(
  emptyStringForNull,
  assetUrlSchema,
);

const externalLink = z.preprocess(
  emptyStringForNull,
  externalUrlSchema,
);

const nullableExternalLink = z.preprocess(
  emptyStringForNull,
  externalLink,
);

const socialLink = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    if (isHttpsUrl(value)) return true;

    return (
      value.startsWith("mailto:") &&
      emailSchema.safeParse(value.slice(7)).success
    );
  }, "Enter a valid HTTPS URL or email link.")
  .optional()
  .default("");

const siteLink = z.preprocess(
  emptyStringForNull,
  z
    .string()
    .trim()
    .max(2048)
    .refine((value) => {
      if (!value || isInternalPath(value) || value.startsWith("#")) {
        return true;
      }

      if (value.startsWith("mailto:")) {
        return emailSchema.safeParse(value.slice(7)).success;
      }

      return isHttpsUrl(value);
    }, "Enter a valid HTTPS URL, email link, or site path."),
);

const base = { id };

export const editableCmsTables = [
  "profile", "hero", "about", "skills", "projects", "project_sections", "experience",
  "education", "certifications", "resumes", "social_links", "pages", "page_sections",
  "page_section_items", "project_section_items", "project_media", "volunteering",
] as const;

export type EditableCmsTable = (typeof editableCmsTables)[number];

export const isEditableCmsTable = (value: string): value is EditableCmsTable =>
  editableCmsTables.includes(value as EditableCmsTable);

const cmsRowSchemas: Record<EditableCmsTable, z.ZodType<Record<string, unknown>>> = {
  profile: z.object({ ...base, full_name: requiredText(), initials: optionalText(20), headline: optionalText(), secondary_line: optionalText(), tagline: optionalText(), location: optionalText(), email: z.union([emailSchema, z.literal("")]).optional().default(""), linkedin_url: externalLink, linkedin_label: optionalText(), github_url: externalLink, github_label: optionalText(), avatar_url: assetLink, availability: optionalText(), short_bio: optionalText(), about_text: optionalText(10000), about_focus: stringList, published }),
  hero: z.object({ ...base, eyebrow: optionalText(), title: optionalText(), subtitle: optionalText(), tagline: optionalText(), dynamic_titles: stringList, primary_cta_label: optionalText(), primary_cta_href: siteLink, secondary_cta_label: optionalText(), secondary_cta_href: siteLink, published }),
  about: z.object({ ...base, title: optionalText(), body: optionalText(10000), highlights: stringList, avatar_url: assetLink, published }),
  skills: z.object({ ...base, name: requiredText(), category: requiredText(), icon_key: optionalSkillIconKey, icon_color: optionalHexColor, description: optionalText(2000), sort_order: sortOrder, published }),
  projects: z.object({ ...base, slug: requiredText(200).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use a lowercase URL slug."), title: requiredText(), type: optionalText(), summary: optionalText(5000), description: optionalText(20000), cover_image_url: assetLink, card_image_url: assetLink, open_graph_image: assetLink, tags: stringList, tools: stringList, github_url: nullableExternalLink, linkedin_url: nullableExternalLink, demo_url: nullableExternalLink, case_study_url: nullableExternalLink, seo_title: optionalText(), seo_description: optionalText(5000), project_group: optionalText(), organisation: optionalText(), status: z.enum(["draft","preparation","published","archived"]).default("draft"), home_featured_order: z.number().int().nullable().optional(), projects_page_order: sortOrder, featured: z.boolean().optional().default(false), published, sort_order: sortOrder }),
  project_sections: z.object({ ...base, project_id: z.string().uuid(), section_type: z.enum(["rich_text", "media_gallery"]), layout_variant: z.enum(cmsLayoutVariants).optional().default("default"), title: requiredText(), body: optionalText(20000), bullets: stringList, sort_order: sortOrder, is_visible: z.boolean().optional().default(true), is_archived: z.boolean().optional().default(false) }).superRefine((value, context) => {
    if (!variantsForBlock(value.section_type).includes(value.layout_variant)) {
      context.addIssue({
        code: "custom",
        path: ["layout_variant"],
        message: "Choose a layout supported by this section type.",
      });
    }
  }),
  experience: z.object({ ...base, company: requiredText(), role: requiredText(), location: optionalText(), start_date: optionalText(), end_date: optionalText(), date_label: optionalText(), logo_url: assetLink, logo_alt: optionalText(), points: stringList, tools: stringList, sort_order: sortOrder, published }),
  education: z.object({ ...base, institution: requiredText(), degree: requiredText(), start_date: optionalText(), end_date: optionalText(), status: optionalText(), location: optionalText(), sort_order: sortOrder, published }),
  certifications: z.object({ ...base, name: requiredText(), issuer: optionalText(), date: optionalText(), credential_url: externalLink, credential_id: optionalText(), image_url: assetLink, description: optionalText(5000), tags: stringList, sort_order: sortOrder, published }),
  resumes: z.object({ ...base, label: requiredText(), variant: requiredText(), pdf_url: assetLink, docx_url: assetLink, sort_order: sortOrder, published }),
social_links: z.object({
  ...base,
  slug: requiredText(100).regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Use a lowercase URL-safe slug such as linkedin, upwork or tableau-public.",
  ),
  label: requiredText(),
  url: socialLink.refine(
    (value) => Boolean(value),
    "URL is required.",
  ),
  link_group: z
    .enum(["primary", "freelance"])
    .optional()
    .default("primary"),
  icon_key: optionalText(100),
  icon_url: assetLink,
  show_in_contact: z.boolean().optional().default(true),
  show_in_footer: z.boolean().optional().default(true),
  include_in_same_as: z.boolean().optional().default(false),
  sort_order: sortOrder,
  published,
}),  pages: z.object({ ...base, page_key: requiredText(100).regex(/^[a-z0-9-]+$/), title: requiredText(), slug: requiredText(300), seo_title: optionalText(), seo_description: optionalText(5000), open_graph_title: optionalText(), open_graph_description: optionalText(5000), open_graph_image: assetLink, navigation_label: optionalText(100), navigation_order: sortOrder, show_in_navigation: z.boolean().optional().default(false), show_in_footer: z.boolean().optional().default(false), is_published: z.boolean().optional().default(true) }),
  page_sections: z.object({ ...base, page_id: z.string().uuid(), section_key: requiredText(100).regex(/^[a-z0-9-]+$/), section_type: z.enum(cmsBlockTypes), title: optionalText(), subtitle: optionalText(), description: optionalText(20000), cta_label: optionalText(), cta_href: siteLink, secondary_cta_label: optionalText(), secondary_cta_href: siteLink, display_order: sortOrder, is_visible: z.boolean().optional().default(true), is_archived: z.boolean().optional().default(false), layout_variant: z.enum(cmsLayoutVariants).optional().default("default") }).superRefine((value, context) => {
    if (!variantsForBlock(value.section_type).includes(value.layout_variant)) {
      context.addIssue({
        code: "custom",
        path: ["layout_variant"],
        message: "Choose a layout supported by this block type.",
      });
    }
  }),
  page_section_items: z.object({ ...base, page_section_id: z.string().uuid(), title: optionalText(), subtitle: optionalText(), description: optionalText(10000), link_label: optionalText(), link_url: siteLink, media_url: assetLink, media_alt: optionalText(), display_order: sortOrder, is_visible: z.boolean().optional().default(true) }),
  project_section_items: z.object({ ...base, project_section_id: z.string().uuid(), label: optionalText(), value: optionalText(), description: optionalText(10000), display_order: sortOrder, is_visible: z.boolean().optional().default(true) }),
  project_media: z.object({ ...base, project_id: z.string().uuid(), media_url: assetLink.refine(Boolean, "Media is required."), alt_text: requiredText(), caption: optionalText(2000), media_type: z.enum(["image","video","document"]).default("image"), display_order: sortOrder, is_visible: z.boolean().optional().default(true) }),
  volunteering: z.object({ ...base, stable_key: requiredText(100).regex(/^[a-z0-9-]+$/), role: requiredText(), organisation: requiredText(), start_date: optionalText(), end_date: optionalText(), date_label: optionalText(), domain: optionalText(), summary: optionalText(5000), description_items: stringList, focus_areas: stringList, logo_url: assetLink, logo_alt: optionalText(), certification_id: z.preprocess((value) => value === "" ? null : value, z.string().uuid().nullable().optional()), sort_order: sortOrder, published, archived: z.boolean().optional().default(false) }),
};

export const validateCmsRow = (table: EditableCmsTable, value: unknown) => cmsRowSchemas[table].safeParse(value);
