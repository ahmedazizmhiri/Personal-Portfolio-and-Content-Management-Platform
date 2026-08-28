export const revalidate = 60;

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CmsPageSections } from "@/components/main/cms-page-sections";
import { Contact } from "@/components/main/contact";
import { Breadcrumbs } from "@/components/seo/breadcrumbs";
import { PageIntro } from "@/components/seo/page-intro";
import { getPortfolioContent } from "@/lib/cms";
import { resolveCmsPageRoute } from "@/lib/cms-page-routing";
import { createCmsPageMetadata } from "@/lib/seo/metadata";

export async function generateMetadata(): Promise<Metadata> {
  return createCmsPageMetadata(await getPortfolioContent(), "contact");
}

export default async function ContactPage() {
  const content = await getPortfolioContent();
  const route = resolveCmsPageRoute(content, "contact");

  if (route.mode === "not-found") notFound();

  if (route.mode === "cms") {
    return (
      <main
        id="main-content"
        tabIndex={-1}
        className="min-h-screen pt-24"
      >
        <div className="relative z-20 mx-auto max-w-7xl px-6">
          <Breadcrumbs
            items={[
              { name: "Home", href: "/" },
              { name: "Contact", href: "/contact" },
            ]}
          />
        </div>
        <CmsPageSections content={content} pageKey="contact" />
<Contact
  profile={content.profile}
  socialLinks={content.socialLinks}
/>      </main>
    );
  }

  const page = content.pages.find((item) => item.pageKey === "contact");

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen pt-24">
      <div className="relative z-20 mx-auto max-w-7xl px-6">
        <Breadcrumbs
          items={[
            { name: "Home", href: "/" },
            { name: "Contact", href: "/contact" },
          ]}
        />
      </div>
      <PageIntro
        eyebrow="Start a conversation"
        title={page?.title || "Contact Ahmed Aziz Mhiri"}
        description={
          page?.seoDescription ||
          "Contact Ahmed Aziz Mhiri about Marketing & Commercial Analytics, Business Intelligence, Digital Transformation, automation and selected freelance opportunities."
        }
        links={[
          { href: "/projects", label: "View selected proof" },
          { href: "/expertise", label: "Explore relevant capabilities" },
          { href: "/resume", label: "Open resume options" },
        ]}
      />
<Contact
  profile={content.profile}
  socialLinks={content.socialLinks}
/>    </main>
  );
}
