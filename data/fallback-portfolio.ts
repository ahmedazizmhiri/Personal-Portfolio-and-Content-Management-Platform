import {
  dynamicTitles,
  navLinks,
  profile,
} from "@/constants/portfolio";
import type { PortfolioContent } from "@/lib/cms-types";
import { createProfileSocialLinkFallback } from "@/lib/social-links";

/**
 * Repository fallback content is intentionally small. It keeps the public shell
 * useful during configuration incidents without replaying projects or other
 * records that may have been unpublished in the CMS.
 */
export const primaryNavigation = navLinks.map((link) => ({ ...link }));

const fallbackProfile: PortfolioContent["profile"] = {
  ...profile,
  aboutFocus: [...profile.aboutFocus],
};

export const fallbackPortfolioContent: PortfolioContent = {
  profile: fallbackProfile,
  hero: {
    eyebrow:
      "Marketing & Commercial Analytics · Big Data · AI · Digital Transformation",
    title: fallbackProfile.name,
    subtitle:
      "Business Intelligence · CRM & Marketing Automation · Digital Transformation",
    tagline: fallbackProfile.tagline,
    dynamicTitles: [...dynamicTitles],
    primaryCtaLabel: "Explore Case Studies",
    primaryCtaHref: "/projects",
    secondaryCtaLabel: "View Resume",
    secondaryCtaHref: "/resume",
  },
  about: {
    title:
      "I connect business questions, data and technology to create decisions and systems people can use.",
    body: fallbackProfile.about,
    highlights: [...fallbackProfile.aboutFocus],
    avatarUrl: fallbackProfile.avatarPath,
  },
  skillCategories: [],
  projects: [],
  projectSections: [],
  experience: [],
  education: [],
  certifications: [],
  resumes: [],
  socialLinks: createProfileSocialLinkFallback(fallbackProfile),
  pages: [],
  volunteering: [],
  navLinks: primaryNavigation,
  delivery: {
    source: "fallback",
    profile: "failed",
    pages: "failed",
    presentation: "failed",
    projects: "failed",
    career: "failed",
    secondary: "failed",
  },
};
