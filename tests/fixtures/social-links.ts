import type { SocialLinkContent } from "@/lib/cms-types";

export const createSocialLinkFixture = (
  overrides: Partial<SocialLinkContent> = {},
): SocialLinkContent => ({
  slug: "future-platform",
  label: "Future Platform",
  url: "https://example.com/profile",
  iconKey: "unknown-icon",
  group: "freelance",
  showInContact: true,
  showInFooter: true,
  includeInSameAs: true,
  sortOrder: 30,
  published: true,
  ...overrides,
});

export const socialLinkFixtures = () => ({
  email: createSocialLinkFixture({
    slug: "email",
    label: "Email",
    url: "mailto:owner@example.com",
    iconKey: "email",
    group: "primary",
    includeInSameAs: false,
    sortOrder: 0,
  }),
  linkedIn: createSocialLinkFixture({
    slug: "linkedin",
    label: "LinkedIn",
    url: "https://www.linkedin.com/in/example",
    iconKey: "linkedin",
    group: "primary",
    sortOrder: 10,
  }),
  github: createSocialLinkFixture({
    slug: "github",
    label: "GitHub",
    url: "https://github.com/example",
    iconKey: "github",
    group: "primary",
    sortOrder: 20,
  }),
  futurePlatform: createSocialLinkFixture(),
  futurePlatformWithIcon: createSocialLinkFixture({
    iconUrl:
      "/storage/v1/object/public/public-assets/social/future-platform.webp",
  }),
});
