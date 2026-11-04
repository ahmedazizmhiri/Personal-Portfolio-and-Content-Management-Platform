export const revalidate = 60;

import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  notFound,
  permanentRedirect,
} from "next/navigation";

import { ProjectViewTracker } from "@/components/analytics/project-view-tracker";
import { TrackedLink } from "@/components/analytics/tracked-link";
import { Breadcrumbs } from "@/components/seo/breadcrumbs";
import { JsonLd } from "@/components/seo/json-ld";
import { ProjectSocialLinks } from "@/components/sub/project-social-links";
import {
  getPortfolioContent,
  getProjectBySlug,
  getProjectSlugRedirect,
} from "@/lib/cms";
import { hasMeaningfulProjectSection } from "@/lib/content-completeness";
import type {
  ProjectMediaContent,
  ProjectSectionContent,
} from "@/lib/cms-types";
import { getProjectSectionLayout } from "@/lib/project-section-layout";
import { getRelatedProjects } from "@/lib/related-projects";
import { createPageMetadata } from "@/lib/seo/metadata";
import { projectSchema } from "@/lib/seo/schema";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const {
    slug,
  } = await params;

  let project =
    await getProjectBySlug(
      slug,
    );

  if (!project) {
    const redirectSlug =
      await getProjectSlugRedirect(
        slug,
      );

    if (
      redirectSlug
    ) {
      project =
        await getProjectBySlug(
          redirectSlug,
        );
    }
  }

  if (!project) {
    return createPageMetadata({
      title:
        "Project not found",

      description:
        "This project is not available.",

      path:
        `/projects/${slug}`,

      noindex:
        true,
    });
  }

  return createPageMetadata({
    title:
      project.seoTitle ||
      project.title,

    description:
      (
        project.seoDescription ||
        project.description
      ).slice(
        0,
        160,
      ),

    path:
      `/projects/${project.slug}`,

    image:
      project.openGraphImage ||
      project.image,
  });
}

export default async function ProjectDetailPage({
  params,
}: PageProps) {
  const {
    slug,
  } = await params;

  const project =
    await getProjectBySlug(
      slug,
    );

  if (!project) {
    const redirectSlug =
      await getProjectSlugRedirect(
        slug,
      );

    if (
      redirectSlug
    ) {
      permanentRedirect(
        `/projects/${redirectSlug}`,
      );
    }

    notFound();
  }

  const content =
    await getPortfolioContent();
  const related = getRelatedProjects(project, content.projects);
  const sections = (project.sections ?? []).filter(
    hasMeaningfulProjectSection,
  );
  const attachedMediaIds = new Set(
    sections.flatMap((section) => section.media.map((media) => media.id)),
  );
  const unattachedMedia = project.media.filter(
    (media) => !attachedMediaIds.has(media.id),
  );
const projectRole = getProjectRole(
  project.role,
  project.slug,
  sections,
);  const tools = project.tools?.length ? project.tools : project.tags;
  const evidenceSummary =
    sections.length > 0
      ? `${sections.length} documented case-study ${
          sections.length === 1 ? "section" : "sections"
        }${project.media.length > 0 ? ` and ${project.media.length} media item${project.media.length === 1 ? "" : "s"}` : ""}`
      : "Published project summary";

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="min-h-screen px-6 py-28"
    >
      <article className="relative z-[20] mx-auto flex w-full max-w-5xl flex-col gap-8">
        <JsonLd data={projectSchema(project)} />
        <ProjectViewTracker
          projectSlug={project.slug}
          projectTitle={project.title}
        />
        <Breadcrumbs
          items={[
            { name: "Home", href: "/" },
            { name: "Projects", href: "/projects" },
            {
              name: project.title,
              href: `/projects/${project.slug}`,
            },
          ]}
        />
        <Link
          href="/projects"
          className="button-secondary inline-flex min-h-11 w-fit items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold"
        >
          <span aria-hidden="true">←</span> Back to projects
        </Link>

        <header>
          <p className="Welcome-text mb-4 text-sm">Project</p>
          <h1 className="text-4xl font-bold text-white sm:text-5xl">
            {project.title}
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-8 text-gray-300">
            {project.description}
          </p>
<ProjectSocialLinks
  githubUrl={project.githubUrl}
  linkedinUrl={project.linkedinUrl}
  projectSlug={project.slug}
  projectTitle={project.title}
  className="mt-5"
/>
          {project.demoUrl ? (
            <TrackedLink
              href={project.demoUrl}
analyticsEvent={{
  event: "project_demo_click",
  project_slug: project.slug,
  project_title: project.title,
  cta_location: "project_page",
}}
              target="_blank"
              rel="noreferrer noopener"
              className="button-secondary mt-5 inline-flex min-h-11 items-center rounded-lg px-4 py-2.5 text-sm font-semibold"
            >
              View project demo
            </TrackedLink>
          ) : null}
        </header>

        <div className="relative aspect-[16/9] overflow-hidden rounded-lg border border-[#2A0E61] bg-[#08021c]/70 shadow-lg shadow-[#2A0E61]/20">
          <Image
            src={project.image}
            alt={`Cover image for ${project.title}`}
            fill
            sizes="(min-width: 1024px) 960px, 100vw"
            className={`${project.image.startsWith("/companies/") || project.image === "/logo.png" ? "object-contain p-8" : "object-cover"} opacity-90`}
            data-image-fallback="swap"
            data-fallback-src="/projects/project-1.png"
          />
        </div>

        <section
          aria-labelledby="project-at-a-glance"
          className="rounded-lg border border-cyan-300/20 bg-cyan-300/[0.06] p-5"
        >
          <h2
            id="project-at-a-glance"
            className="text-xl font-bold text-white"
          >
            At a glance
          </h2>
          <dl className="mt-4 grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
            <ProjectFact label="Type" value={project.type || "Case study"} />
            <ProjectFact label="Role" value={projectRole} />
            <ProjectFact label="Status" value="Published case study" />
            <ProjectFact
              label="Tools"
              value={tools.length > 0 ? tools.join(", ") : "Not publicly specified"}
            />
            <ProjectFact label="Evidence" value={evidenceSummary} />
          </dl>
        </section>

        {project.tags.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="Project topics">
            {project.tags.map((tag) => (
              <li
                key={tag}
                className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs text-cyan-100"
              >
                {tag}
              </li>
            ))}
          </ul>
        )}

        {sections.length > 0 && (
          <div className="divide-y divide-white/10 border-y border-white/10">
            {sections.map((section, index) => (
              <CaseStudySection
                key={section.id ?? `${project.slug}-${section.title}`}
                section={section}
                prominent={index === 0}
              />
            ))}
          </div>
        )}

        {unattachedMedia.length > 0 && (
          <section
            data-project-section
            className="rounded-lg border border-white/10 bg-[#100b24]/90 p-6 shadow-xl shadow-[#2A0E61]/20 backdrop-blur-md"
          >
            <h2 className="text-2xl font-bold text-white">Project media</h2>
            <ProjectMediaGallery media={unattachedMedia} />
          </section>
        )}

        {related.length > 0 ? (
          <section>
            <h2 className="text-2xl font-bold text-white">Related work</h2>
            <div className="mt-4 flex flex-col gap-3">
              {related.map((item) => (
                <TrackedLink
                  key={item.slug}
                  href={`/projects/${item.slug}`}
                  analyticsEvent={{
                    event: "project_explore_click",
                    project_slug: item.slug,
                    project_title: item.title,
                    cta_location: "related_projects",
                  }}
                  className="action-link inline-flex min-h-11 w-fit items-center"
                >
                  View the {item.title} case study
                </TrackedLink>
              ))}
            </div>
          </section>
        ) : null}

        <nav
          aria-label="Project next steps"
          className="flex flex-wrap gap-3 border-t border-white/10 pt-7"
        >
          <Link
            href="/expertise"
            className="button-secondary inline-flex min-h-11 items-center rounded-lg px-4 py-2.5 text-sm font-semibold"
          >
            Explore relevant expertise
          </Link>
          <Link
            href="/experience"
            className="button-secondary inline-flex min-h-11 items-center rounded-lg px-4 py-2.5 text-sm font-semibold"
          >
            Review professional experience
          </Link>
          <TrackedLink
            href="/contact"
            analyticsEvent={{
              event: "contact_cta_click",
              cta_location: "project_page",
              cta_label: "project_contact",
            }}
            className="button-primary inline-flex min-h-11 items-center rounded-lg px-4 py-2.5 text-sm font-semibold text-white"
          >
            Discuss a related opportunity
          </TrackedLink>
        </nav>
      </article>
    </main>
  );
}

function CaseStudySection({
  section,
  prominent,
}: {
  section: ProjectSectionContent;
  prominent: boolean;
}) {
  const paragraphs = section.body
    .split(/\r?\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const sectionType =
    section.sectionType === "media_gallery" ? "media_gallery" : "rich_text";
  const layout = getProjectSectionLayout(
    sectionType,
    section.layoutVariant,
  );
  const hasSupportingContent =
    section.items.length > 0 || section.media.length > 0;
  const splitContent = layout.splitContent && hasSupportingContent;

  const copy = (
    <div className={layout.contentClassName}>
      {section.title && (
        <h2 className="text-2xl font-bold text-white">{section.title}</h2>
      )}
      {paragraphs.length > 0 ? (
        <div className="mt-4 space-y-4 text-sm leading-7 text-gray-300">
          {paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
      ) : null}
      {section.bullets.length > 0 && (
        <ul className="mt-5 ml-5 list-disc space-y-2 text-sm leading-7 text-gray-300">
          {section.bullets.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>
      )}
    </div>
  );

  const supportingContent = (
    <>
      {section.items.length > 0 && (
        <dl
          className={`grid gap-4 ${
            splitContent ? "" : "mt-6"
          } ${layout.itemGridClassName}`}
        >
          {section.items.map((item) => (
            <div key={item.id} className={layout.itemClassName}>
              {item.label && (
                <dt className="text-sm font-semibold text-cyan-100">
                  {item.label}
                </dt>
              )}
              {(item.value || item.description) && (
                <dd className="mt-2 text-sm leading-6 text-gray-300">
                  {item.value || item.description}
                </dd>
              )}
            </div>
          ))}
        </dl>
      )}
      {section.media.length > 0 && (
        <ProjectMediaGallery
          media={section.media}
          gridClassName={layout.mediaGridClassName}
          figureClassName={layout.mediaFigureClassName}
          flush={splitContent}
        />
      )}
    </>
  );

  return (
    <section
      data-project-section
      data-layout-variant={section.layoutVariant}
      className={`${layout.sectionClassName} ${
        prominent ? "border-l-2 border-l-cyan-300/60 pl-5 sm:pl-7" : ""
      }`}
    >
      {splitContent ? (
        <div className="grid gap-7 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-10">
          {copy}
          <div>{supportingContent}</div>
        </div>
      ) : (
        <>
          {copy}
          {supportingContent}
        </>
      )}
    </section>
  );
}

function ProjectMediaGallery({
  media,
  gridClassName = "max-w-4xl grid-cols-1",
  figureClassName = "",
  flush = false,
}: {
  media: ProjectMediaContent[];
  gridClassName?: string;
  figureClassName?: string;
  flush?: boolean;
}) {
  return (
    <div
      className={`${flush ? "" : "mt-5"} grid gap-5 ${gridClassName}`}
    >
      {media.map((item) => (
        <figure
          key={item.id}
          className={`overflow-hidden rounded-lg border border-white/10 bg-[#08021c]/70 ${figureClassName}`}
        >
          {item.mediaType === "image" ? (
            <div className="relative aspect-video">
              <Image
                src={item.mediaUrl}
                alt={item.altText || "Project evidence"}
                fill
                sizes="(min-width: 768px) 460px, 100vw"
                className={item.mediaUrl.startsWith("/companies/") || item.mediaUrl === "/logo.png" ? "object-contain p-5" : "object-cover"}
                data-image-fallback="swap"
                data-fallback-src="/projects/project-1.png"
              />
            </div>
          ) : item.mediaType === "video" ? (
            <video
              controls
              preload="metadata"
              aria-label={item.altText}
              className="aspect-video w-full"
            >
              <source src={item.mediaUrl} />
            </video>
          ) : (
            <Link
              href={item.mediaUrl}
              className="action-link m-5 inline-block"
              target="_blank"
              rel="noreferrer noopener"
            >
              {item.caption || item.altText}
            </Link>
          )}
          {item.caption && item.mediaType !== "document" && (
            <figcaption className="p-4 text-sm text-gray-300">
              {item.caption}
            </figcaption>
          )}
        </figure>
      ))}
    </div>
  );
}

function ProjectFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wider text-cyan-200">
        {label}
      </dt>
      <dd className="mt-1 text-sm leading-6 text-gray-200">{value}</dd>
    </div>
  );
}

const normalizeFactLabel = (value: string) =>
  value.trim().toLowerCase().replace(/[^a-z]+/g, " ");

function getProjectRole(
  projectRole: string | undefined,
  slug: string,
  sections: ProjectSectionContent[],
) {
  const explicitRole =
    projectRole?.trim();

  if (explicitRole) {
    return explicitRole;
  }

  const roleItem = sections
    .flatMap((section) => section.items)
    .find((item) => {
      const label = normalizeFactLabel(
        item.label,
      );

      return (
        label === "role" ||
        label === "project role" ||
        label === "contribution"
      );
    });

  if (roleItem) {
    return (
      roleItem.value ||
      roleItem.description
    );
  }

  if (
    slug ===
      "sunshine-rpa-commercial-rules-automation" ||
    slug ===
      "rpa-invoice-control-booking-reconciliation"
  ) {
    return "Sole contributor";
  }

  if (
    slug ===
      "vermeg-ai-ready-e-learning-platform" ||
    slug ===
      "ai-ready-elearning-platform"
  ) {
    return "Contributor in a two-person internship prototype";
  }

  if (
    sections.some((section) =>
      /role|scope|contribution/i.test(
        section.title,
      ),
    )
  ) {
    return "Described in Role and scope below";
  }

  return "Not stated publicly";
}
