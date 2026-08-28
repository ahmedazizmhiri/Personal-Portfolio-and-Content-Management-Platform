import type {
  Experience as StaticExperience,
  Project as StaticProject,
  ResumeAsset as StaticResumeAsset,
  SkillCategory,
} from "@/constants/portfolio";
import type {
  CmsBlockType,
  CmsLayoutVariant,
} from "@/lib/cms-block-registry";

export type { SkillCategory };

export type NavLink = {
  title: string;
  href: string;
  navigationOrder: number;
  showInNavigation: boolean;
  showInFooter: boolean;
  kind?: "link" | "resume";
};

export type ProfileContent = {
  name: string;
  initials: string;
  avatarPath: string;
  location: string;
  email: string;
  linkedIn: string;
  linkedInLabel: string;
  github: string;
  githubLabel: string;
  availability: string;
  mainTitle: string;
  secondaryLine: string;
  tagline: string;
  shortProfile: string;
  about: string;
  aboutFocus: string[];
};

export type HeroContentData = {
  eyebrow: string;
  title: string;
  subtitle: string;
  tagline: string;
  dynamicTitles: string[];
  primaryCtaLabel: string;
  primaryCtaHref: string;
  secondaryCtaLabel: string;
  secondaryCtaHref: string;
};

export type AboutContentData = {
  title: string;
  body: string;
  highlights: string[];
  avatarUrl: string;
};

export type ProjectSectionContent = {
  id?: string;
  projectSlug: string;
  title: string;
  body: string;
  bullets: string[];
  items: ProjectSectionItemContent[];
  media: ProjectMediaContent[];
  sortOrder: number;
  sectionType?: "rich_text" | "media_gallery";
  layoutVariant?: CmsLayoutVariant;
  isVisible?: boolean;
};

export type ProjectSectionItemContent = {
  id: string;
  projectSectionId: string;
  label: string;
  value: string;
  description: string;
  displayOrder: number;
};

export type ProjectMediaContent = {
  id: string;

  projectId: string;

  projectSectionId:
    string | null;

  mediaUrl: string;

  altText: string;

  caption: string;

  mediaType:
    | "image"
    | "video"
    | "document";

  displayOrder: number;

  updatedAt: string;
};

export type ProjectContent = StaticProject & {
  id: string;
  slug: string;
  type?: string;
  role?: string;
  tools?: string[];
  githubUrl?: string;
  linkedinUrl?: string;
  featured?: boolean;
  status?: "draft" | "preparation" | "published" | "archived";
  group?: string;
  homeFeaturedOrder?: number;
  projectsPageOrder?: number;
  demoUrl?: string;
  repositoryUrl?: string;
  seoTitle?: string;
  seoDescription?: string;
  openGraphImage?: string;
  sortOrder?: number;
  sections?: ProjectSectionContent[];
  media: ProjectMediaContent[];
  createdAt: string;
  updatedAt: string;
};

export type PageSectionItemContent = {
  id: string;
  pageSectionId: string;
  title: string;
  subtitle: string;
  description: string;
  linkLabel: string;
  linkUrl: string;
  mediaUrl: string;
  mediaAlt: string;
  displayOrder: number;
};

export type PageSectionContent = {
  id: string;
  pageKey: string;
  sectionType: CmsBlockType;
  title: string;
  subtitle: string;
  description: string;
  ctaLabel: string;
  ctaHref: string;
  secondaryCtaLabel: string;
  secondaryCtaHref: string;
  displayOrder: number;
  layoutVariant: CmsLayoutVariant;
  items: PageSectionItemContent[];
  updatedAt: string;
};

export type PageContent = {
  id: string;
  pageKey: string;
  title: string;
  slug: string;
  seoTitle: string;
  seoDescription: string;
  openGraphTitle: string;
  openGraphDescription: string;
  openGraphImage: string;
  navigationLabel: string;
  navigationOrder: number;
  showInNavigation: boolean;
  showInFooter: boolean;
  isPublished: boolean;
  updatedAt: string;
  sections: PageSectionContent[];
};

export type VolunteeringContent = {
  role: string;
  organisation: string;
  logoUrl: string;
  logoAlt: string;
  date: string;
  domain: string;
  summary: string;
  descriptionItems: string[];
  focusAreas: string[];
  certification?: CertificationContent;
  sortOrder: number;
};

export type ExperienceContent = StaticExperience & {
  tools?: string[];
  sortOrder?: number;
};

export type EducationContent = {
  institution: string;
  degree: string;
  startDate: string;
  endDate: string;
  status: string;
  location: string;
  sortOrder: number;
};

export type CertificationContent = {
  name: string;
  issuer: string;
  date: string;
  credentialUrl?: string;
  credentialId?: string;
  imageUrl?: string;
  description?: string;
  tags: string[];
  sortOrder: number;
};

export type ResumeContent = StaticResumeAsset & {
  variant: string;
  sortOrder: number;
};

export type SocialLinkGroup = "primary" | "freelance";

export type SocialLinkContent = {
  slug: string;
  label: string;
  url: string;
  iconKey?: string;
  iconUrl?: string;
  group: SocialLinkGroup;
  showInContact: boolean;
  showInFooter: boolean;
  includeInSameAs: boolean;
  sortOrder: number;
  published: boolean;
};

export type PortfolioContent = {
  profile: ProfileContent;
  hero: HeroContentData;
  about: AboutContentData;
  skillCategories: SkillCategory[];
  projects: ProjectContent[];
  projectSections: ProjectSectionContent[];
  experience: ExperienceContent[];
  education: EducationContent[];
  certifications: CertificationContent[];
  resumes: ResumeContent[];
  socialLinks: SocialLinkContent[];
  pages: PageContent[];
  volunteering: VolunteeringContent[];
  navLinks: NavLink[];
  delivery: {
    source: "cms" | "fallback";
    profile: "ok" | "failed";
    pages: "ok" | "failed";
    presentation: "ok" | "partial" | "failed";
    projects: "ok" | "partial" | "failed";
    career: "ok" | "partial" | "failed";
    secondary: "ok" | "partial" | "failed";
  };
};

export type PortfolioChromeContent = Pick<
  PortfolioContent,
  "profile" | "navLinks" | "socialLinks"
>;

export type CmsTableName =
  | "profile"
  | "hero"
  | "about"
  | "skills"
  | "projects"
  | "project_sections"
  | "experience"
  | "education"
  | "certifications"
  | "resumes"
  | "social_links"
  | "site_settings"
  | "contact_messages"
  | "uploads"
  | "pages"
  | "page_sections"
  | "page_section_items"
  | "project_section_items"
  | "project_media"
  | "volunteering";

export type AdminContentSnapshot = Partial<Record<CmsTableName, unknown[]>>;

export type MessageStatus = "new" | "read" | "archived";

export type MessageAction =
  | "mark_read"
  | "mark_unread"
  | "archive"
  | "restore_read"
  | "restore_unread"
  | "resend_notification";

export type ContactMessage = {
  id: string;
  name: string;
  email: string;
  message: string;
  source: string | null;
  status: MessageStatus;
  delivery_status:
    | "not_requested"
    | "pending"
    | "sending"
    | "sent"
    | "failed";
  delivery_attempts: number;
  last_delivery_attempt_at: string | null;
  next_delivery_attempt_at: string | null;
  delivered_at: string | null;
  delivery_error_code: string | null;
  provider_message_id: string | null;
  created_at: string;
  updated_at: string;
  read_at: string | null;
  archived_at: string | null;
};

export type UploadBucket =
  | "public-assets"
  | "project-images"
  | "resumes"
  | "uploads";

export type UploadRecord = {
  id: string;
  source: "storage" | "local";
  bucket: UploadBucket;
  path: string;
  public_url: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  original_name: string | null;
  uploaded_by: string | null;
  created_at: string;
  sha256?: string | null;
  deletion_status?: "active" | "pending" | "failed";
  deletion_requested_at?: string | null;
  deletion_error_code?: string | null;
};

export type AdminProfileSettings = {
  displayName: string;
  jobTitle: string;
  phone: string;
  avatarUrl: string;
  timezone: string;
  language: string;
};
