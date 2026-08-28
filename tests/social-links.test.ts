import { describe, expect, it } from "vitest";

import { fallbackPortfolioContent } from "@/data/fallback-portfolio";
import {
  createProfileSocialLinkFallback,
  getSafeSocialIconUrl,
  getSocialLinkAnalyticsEvent,
  getSocialLinksForLocation,
  getSocialSameAsLinks,
  groupSocialLinksForLocation,
  isMailtoLink,
  sortSocialLinks,
} from "@/lib/social-links";
import {
  createSocialLinkFixture,
  socialLinkFixtures,
} from "@/tests/fixtures/social-links";

describe("generic social-link utilities", () => {
  it("sorts deterministically without mutating CMS input", () => {
    const { linkedIn, github, futurePlatform } = socialLinkFixtures();
    const input = [futurePlatform, github, linkedIn];

    expect(sortSocialLinks(input).map((link) => link.slug)).toEqual([
      "linkedin",
      "github",
      "future-platform",
    ]);
    expect(input.map((link) => link.slug)).toEqual([
      "future-platform",
      "github",
      "linkedin",
    ]);
  });

  it("respects publication and per-location visibility", () => {
    const visible = createSocialLinkFixture({ slug: "visible" });
    const contactHidden = createSocialLinkFixture({
      slug: "contact-hidden",
      showInContact: false,
    });
    const footerHidden = createSocialLinkFixture({
      slug: "footer-hidden",
      showInFooter: false,
    });
    const unpublished = createSocialLinkFixture({
      slug: "unpublished",
      published: false,
    });
    const unsafe = createSocialLinkFixture({
      slug: "unsafe",
      url: "javascript:alert(1)",
    });
    const links = [footerHidden, unpublished, contactHidden, unsafe, visible];

    expect(
      getSocialLinksForLocation(links, "contact").map((link) => link.slug),
    ).toEqual(["footer-hidden", "visible"]);
    expect(
      getSocialLinksForLocation(links, "footer").map((link) => link.slug),
    ).toEqual(["contact-hidden", "visible"]);
  });

  it("groups every visible link generically", () => {
    const { linkedIn, github, futurePlatform } = socialLinkFixtures();
    const grouped = groupSocialLinksForLocation(
      [futurePlatform, github, linkedIn],
      "contact",
    );

    expect(grouped.primary.map((link) => link.slug)).toEqual([
      "linkedin",
      "github",
    ]);
    expect(grouped.freelance.map((link) => link.slug)).toEqual([
      "future-platform",
    ]);
  });

  it("identifies only usable mailto links", () => {
    expect(isMailtoLink("mailto:owner@example.com")).toBe(true);
    expect(isMailtoLink(" MAILTO:owner@example.com ")).toBe(true);
    expect(isMailtoLink("mailto:not-an-email")).toBe(false);
    expect(isMailtoLink("mailto:owner@example.com?subject=private")).toBe(
      false,
    );
    expect(isMailtoLink("https://example.com/?next=mailto:owner@example.com"))
      .toBe(false);
  });

  it("creates analytics from CMS identity, including an unknown platform", () => {
    const { email, futurePlatform } = socialLinkFixtures();

    expect(getSocialLinkAnalyticsEvent(futurePlatform, "footer")).toEqual({
      event: "social_profile_click",
      platform: "future-platform",
      link_group: "freelance",
      link_location: "footer",
    });
    expect(getSocialLinkAnalyticsEvent(email, "contact")).toEqual({
      event: "email_contact_click",
      link_location: "contact",
    });
  });

  it("accepts a safe CMS icon asset and rejects an arbitrary host", () => {
    const safePath =
      "/storage/v1/object/public/public-assets/social/future-platform.webp";

    expect(getSafeSocialIconUrl(safePath)).toBe(safePath);
    expect(getSafeSocialIconUrl("https://assets.example.com/icon.webp"))
      .toBeUndefined();
    expect(getSafeSocialIconUrl("   ")).toBeUndefined();
  });

  it("builds only the resilient Email, LinkedIn, and GitHub fallback", () => {
    const links = createProfileSocialLinkFallback(
      fallbackPortfolioContent.profile,
    );

    expect(links.map((link) => link.slug)).toEqual([
      "email",
      "linkedin",
      "github",
    ]);
    expect(links.every((link) => link.group === "primary")).toBe(true);
    expect(
      links.find((link) => link.slug === "email")?.includeInSameAs,
    ).toBe(false);
    expect(
      links
        .filter((link) => link.slug !== "email")
        .every((link) => link.includeInSameAs),
    ).toBe(true);
  });

  it("keeps sameAs published, opted-in, HTTPS-only, and deduplicated", () => {
    const duplicateUrl = "https://example.com/duplicate";
    const links = [
      createSocialLinkFixture({
        slug: "first",
        url: duplicateUrl,
        sortOrder: 0,
      }),
      createSocialLinkFixture({
        slug: "duplicate",
        url: ` ${duplicateUrl} `,
        sortOrder: 1,
      }),
      createSocialLinkFixture({
        slug: "email",
        url: "mailto:owner@example.com",
        sortOrder: 2,
      }),
      createSocialLinkFixture({
        slug: "not-opted-in",
        url: "https://example.com/private",
        includeInSameAs: false,
        sortOrder: 3,
      }),
      createSocialLinkFixture({
        slug: "draft",
        url: "https://example.com/draft",
        published: false,
        sortOrder: 4,
      }),
    ];

    expect(getSocialSameAsLinks(links)).toEqual([duplicateUrl]);
  });
});
