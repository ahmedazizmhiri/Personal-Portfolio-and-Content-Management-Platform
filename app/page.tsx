export const revalidate = 60;

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { About } from "@/components/main/about";
import { CertificationsSection } from "@/components/main/certifications-section";
import { CmsPageSections } from "@/components/main/cms-page-sections";
import { Contact } from "@/components/main/contact";
import { EducationSection } from "@/components/main/education-section";
import { Experience } from "@/components/main/experience";
import { Hero } from "@/components/main/hero";
import { Projects } from "@/components/main/projects";
import { ResumeSection } from "@/components/main/resume-section";
import { Skills } from "@/components/main/skills";
import { getPortfolioContent } from "@/lib/cms";
import { resolveCmsPageRoute } from "@/lib/cms-page-routing";
import { createCmsPageMetadata } from "@/lib/seo/metadata";

export async function generateMetadata(): Promise<Metadata> {
  return createCmsPageMetadata(await getPortfolioContent(), "home");
}

export default async function Home() {
  const content = await getPortfolioContent();
  const route = resolveCmsPageRoute(content, "home");

  if (route.mode === "not-found") notFound();

  return (
    <main id="main-content" tabIndex={-1} className="h-full w-full">
      {route.mode === "cms" ? (
        <CmsPageSections content={content} pageKey="home" />
      ) : (
        <>
          <Hero profile={content.profile} hero={content.hero} />
          <About profile={content.profile} about={content.about} />
          <Skills skillCategories={content.skillCategories} />
          <Projects
  projects={content.projects
    .filter((project) => project.featured)
    .sort(
      (left, right) =>
        (left.homeFeaturedOrder ?? 999) -
        (right.homeFeaturedOrder ?? 999),
    )}
  cardLocation="homepage"
/>
          <Experience experience={content.experience} />
          <EducationSection preview education={content.education} />
          <CertificationsSection
            preview
            certifications={content.certifications}
          />
          <ResumeSection preview resumes={content.resumes} />
<Contact
  profile={content.profile}
  socialLinks={content.socialLinks}
/>        </>
      )}
    </main>
  );
}
