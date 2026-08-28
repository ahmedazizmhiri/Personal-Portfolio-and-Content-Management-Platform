import type { EditableCmsTable } from "@/lib/security/validation";

const common = ["id", "created_at", "updated_at"] as const;

const columns: Record<EditableCmsTable, readonly string[]> = {
  profile: [
    ...common, "full_name", "initials", "headline", "secondary_line", "tagline",
    "location", "email", "linkedin_url", "linkedin_label", "github_url",
    "github_label", "avatar_url", "availability", "short_bio", "about_text",
    "about_focus", "published",
  ],
  hero: [
    ...common, "eyebrow", "title", "subtitle", "tagline", "dynamic_titles",
    "primary_cta_label", "primary_cta_href", "secondary_cta_label",
    "secondary_cta_href", "published",
  ],
  about: [...common, "title", "body", "highlights", "avatar_url", "published"],
skills: [
  ...common, "name", "category", "icon_key", "icon_color", "description",
  "sort_order", "published",
],
  projects: [
    ...common, "slug", "title", "type", "summary", "description",
    "cover_image_url", "card_image_url", "open_graph_image", "tags", "tools",
    "github_url", "linkedin_url", "demo_url", "case_study_url", "seo_title",
    "seo_description", "project_group", "organisation", "status",
    "home_featured_order", "projects_page_order", "featured", "published",
    "sort_order",
  ],
  project_sections: [
    ...common, "project_id", "section_type", "title", "body", "bullets",
    "sort_order", "is_visible", "is_archived", "layout_variant",
  ],
  experience: [
    ...common, "company", "role", "location", "start_date", "end_date",
    "date_label", "logo_url", "logo_alt", "points", "tools", "sort_order",
    "published",
  ],
  education: [
    ...common, "institution", "degree", "start_date", "end_date", "status",
    "location", "sort_order", "published",
  ],
  certifications: [
    ...common, "name", "issuer", "date", "credential_url", "credential_id",
    "image_url", "description", "tags", "sort_order", "published",
  ],
  resumes: [
    ...common, "label", "variant", "pdf_url", "docx_url", "sort_order",
    "published",
  ],
social_links: [
  ...common,
  "slug",
  "label",
  "url",
  "link_group",
  "icon_key",
  "icon_url",
  "show_in_contact",
  "show_in_footer",
  "include_in_same_as",
  "sort_order",
  "published",
],
  pages: [
    ...common, "page_key", "title", "slug", "seo_title", "seo_description",
    "open_graph_title", "open_graph_description", "open_graph_image",
    "navigation_label", "navigation_order", "show_in_navigation",
    "show_in_footer", "is_published",
  ],
  page_sections: [
    ...common, "page_id", "section_key", "section_type", "title", "subtitle",
    "description", "cta_label", "cta_href", "secondary_cta_label",
    "secondary_cta_href", "display_order", "is_visible", "is_archived",
    "layout_variant",
  ],
  page_section_items: [
    ...common, "page_section_id", "title", "subtitle", "description",
    "link_label", "link_url", "media_url", "media_alt", "display_order",
    "is_visible",
  ],
  project_section_items: [
    ...common, "project_section_id", "label", "value", "description",
    "display_order", "is_visible",
  ],
    project_media: [
    ...common, "project_id", "project_section_id", "media_url", "alt_text",
    "caption", "media_type", "display_order", "is_visible",
  ],
  volunteering: [
    ...common, "stable_key", "role", "organisation", "start_date", "end_date",
    "date_label", "domain", "summary", "description_items", "focus_areas",
    "logo_url", "logo_alt", "certification_id", "sort_order", "published",
    "archived",
  ],
};

export const cmsSelectColumns = (table: EditableCmsTable) =>
  columns[table].join(",");
