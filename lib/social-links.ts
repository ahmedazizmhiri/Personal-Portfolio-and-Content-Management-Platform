import type { AnalyticsEvent } from "@/lib/analytics/events";
import type {
  ProfileContent,
  SocialLinkContent,
  SocialLinkGroup,
} from "@/lib/cms-types";
import { assetUrlSchema } from "@/lib/security/validation";

export type SocialLinkLocation = "contact" | "footer";

const emailAddressPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const parseLink = (value: string) => {
  try {
    return new URL(value.trim());
  } catch {
    return null;
  }
};

export const isMailtoLink = (value: string) => {
  const parsed = parseLink(value);
  if (parsed?.protocol !== "mailto:") return false;

  const address = decodeURIComponent(parsed.pathname).trim();
  return !parsed.search && !parsed.hash && emailAddressPattern.test(address);
};

export const isHttpsSocialLink = (value: string) =>
  parseLink(value)?.protocol === "https:";

export const isSafeSocialLink = (value: string) =>
  isHttpsSocialLink(value) || isMailtoLink(value);

export const sortSocialLinks = (
  socialLinks: readonly SocialLinkContent[],
) => [...socialLinks].sort(
  (left, right) =>
    left.sortOrder - right.sortOrder
    || left.label.localeCompare(right.label)
    || left.slug.localeCompare(right.slug),
);

export const getSocialLinksForLocation = (
  socialLinks: readonly SocialLinkContent[],
  location: SocialLinkLocation,
) => sortSocialLinks(socialLinks).filter((link) =>
  link.published === true
  && (location === "contact" ? link.showInContact : link.showInFooter)
  && Boolean(link.slug.trim())
  && Boolean(link.label.trim())
  && isSafeSocialLink(link.url),
);

export const groupSocialLinksForLocation = (
  socialLinks: readonly SocialLinkContent[],
  location: SocialLinkLocation,
): Record<SocialLinkGroup, SocialLinkContent[]> => {
  const visibleLinks = getSocialLinksForLocation(socialLinks, location);

  return {
    primary: visibleLinks.filter((link) => link.group === "primary"),
    freelance: visibleLinks.filter((link) => link.group === "freelance"),
  };
};

export const getSocialLinkAnalyticsEvent = (
  link: SocialLinkContent,
  location: SocialLinkLocation,
): AnalyticsEvent => isMailtoLink(link.url)
  ? {
      event: "email_contact_click",
      link_location: location,
    }
  : {
      event: "social_profile_click",
      platform: link.slug,
      link_group: link.group,
      link_location: location,
    };

export const getSafeSocialIconUrl = (iconUrl?: string) => {
  const candidate = iconUrl?.trim() ?? "";
  if (!candidate) return undefined;

  const result = assetUrlSchema.safeParse(candidate);
  return result.success && result.data ? result.data : undefined;
};

export const createProfileSocialLinkFallback = (
  profile: ProfileContent,
): SocialLinkContent[] => {
  const fallbackLinks = [
    {
      slug: "email",
      label: profile.email || "Email",
      url: profile.email ? `mailto:${profile.email}` : "",
      iconKey: "email",
      group: "primary",
      showInContact: true,
      showInFooter: true,
      includeInSameAs: false,
      sortOrder: 0,
      published: true,
    },
    {
      slug: "linkedin",
      label: profile.linkedInLabel || "LinkedIn",
      url: profile.linkedIn,
      iconKey: "linkedin",
      group: "primary",
      showInContact: true,
      showInFooter: true,
      includeInSameAs: true,
      sortOrder: 10,
      published: true,
    },
    {
      slug: "github",
      label: profile.githubLabel || "GitHub",
      url: profile.github,
      iconKey: "github",
      group: "primary",
      showInContact: true,
      showInFooter: true,
      includeInSameAs: true,
      sortOrder: 20,
      published: true,
    },
  ] satisfies SocialLinkContent[];

  return sortSocialLinks(
    fallbackLinks.filter((link) => isSafeSocialLink(link.url)),
  );
};

export const getSocialSameAsLinks = (
  socialLinks: readonly SocialLinkContent[],
) => [...new Set(
  sortSocialLinks(socialLinks)
    .filter((link) =>
      link.published === true
      && link.includeInSameAs
      && isHttpsSocialLink(link.url),
    )
    .map((link) => link.url.trim()),
)];
