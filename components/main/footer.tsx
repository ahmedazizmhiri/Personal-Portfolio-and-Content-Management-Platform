import { MapPinIcon } from "@heroicons/react/24/solid";
import Link from "next/link";

import { CookiePreferencesButton } from "@/components/consent/cookie-preferences-button";
import { SocialProfileLink } from "@/components/sub/social-profile-link";
import { fallbackPortfolioContent } from "@/data/fallback-portfolio";
import type {
  NavLink,
  ProfileContent,
  SocialLinkContent,
} from "@/lib/cms-types";
import { getFooterNavigationLinks } from "@/lib/navigation";
import { groupSocialLinksForLocation } from "@/lib/social-links";

type FooterProps = {
  profile?: ProfileContent;
  navLinks?: NavLink[];
  socialLinks?: SocialLinkContent[];
};

export const Footer = ({
  profile = fallbackPortfolioContent.profile,
  navLinks = fallbackPortfolioContent.navLinks,
  socialLinks = fallbackPortfolioContent.socialLinks,
}: FooterProps) => {
  const footerLinks = getFooterNavigationLinks(navLinks);

  const groupedLinks = groupSocialLinksForLocation(
    socialLinks,
    "footer",
  );

  return (
    <footer className="relative z-[20] w-full bg-transparent px-6 py-10 text-gray-300">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 border-t border-white/10 pt-8 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-lg font-semibold text-white">
            {profile.name}
          </p>

          <p className="mt-2 max-w-xl text-sm leading-6 text-gray-400">
            {profile.mainTitle}
          </p>
        </div>

        <div className="flex flex-col gap-3 text-sm md:items-end">
          <span className="inline-flex items-center gap-2">
            <MapPinIcon className="h-4 w-4 text-cyan-200" />
            {profile.location}
          </span>

          {groupedLinks.primary.map((link) => (
            <SocialProfileLink
              key={link.slug}
              link={link}
              location="footer"
              className="inline-flex min-h-11 items-center gap-2 rounded-md transition hover:text-cyan-100"
            />
          ))}

          {groupedLinks.freelance.length > 0 ? (
            <div className="mt-2 flex flex-col gap-2 md:items-end">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                Freelance
              </span>

              <div className="flex flex-wrap gap-x-4 gap-y-2 md:justify-end">
                {groupedLinks.freelance.map((link) => (
                  <SocialProfileLink
                    key={link.slug}
                    link={link}
                    location="footer"
                    className="inline-flex min-h-11 items-center gap-2 rounded-md transition hover:text-cyan-100"
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <p className="mx-auto mt-8 max-w-7xl text-sm text-gray-400">
        &copy; {profile.name} {new Date().getFullYear()}. All rights reserved.
      </p>

      <nav
        aria-label="Footer navigation"
        className="mx-auto mt-6 flex max-w-7xl flex-wrap gap-x-5 gap-y-3 text-sm text-gray-400"
      >
        {footerLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="inline-flex min-h-11 items-center hover:text-cyan-100"
          >
            {link.title}
          </Link>
        ))}

        <CookiePreferencesButton />
      </nav>

      <p className="mx-auto mt-5 max-w-7xl text-xs leading-6 text-gray-400">
        With your choice, Google Tag Manager manages GA4 aggregate traffic and
        event measurement, Microsoft Clarity supports UX heatmaps and session
        behavior, and Vercel Web Analytics and Speed Insights provide aggregate
        traffic and performance measurement. These optional services remain off
        until analytics consent. Advertising personalization stays disabled,
        sensitive forms are masked, and contact-form content is never sent to
        analytics. Use Analytics preferences above to change your choice.
      </p>
    </footer>
  );
};