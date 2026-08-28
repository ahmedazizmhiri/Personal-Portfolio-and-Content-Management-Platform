import { ArrowDownTrayIcon } from "@heroicons/react/24/solid";

import { TrackedLink } from "@/components/analytics/tracked-link";
import { DeferredContactForm } from "@/components/main/deferred-contact-form";
import { DeferredEarthCanvas } from "@/components/main/deferred-earth-canvas";
import { SocialProfileLink } from "@/components/sub/social-profile-link";
import { fallbackPortfolioContent } from "@/data/fallback-portfolio";
import type {
  ProfileContent,
  SocialLinkContent,
} from "@/lib/cms-types";
import { groupSocialLinksForLocation } from "@/lib/social-links";

type ContactProps = {
  profile?: ProfileContent;
  socialLinks?: SocialLinkContent[];
};

export const Contact = ({
  profile = fallbackPortfolioContent.profile,
  socialLinks = fallbackPortfolioContent.socialLinks,
}: ContactProps) => {
  const groupedLinks = groupSocialLinksForLocation(
    socialLinks,
    "contact",
  );

  return (
    <section
      id="contact"
      className="render-deferred relative z-[20] mx-auto flex w-full max-w-7xl flex-col-reverse gap-10 overflow-hidden px-6 py-24 xl:flex-row"
    >
      <div className="flex-[0.85] rounded-lg border border-white/10 bg-[#100b24]/90 p-6 shadow-xl shadow-[#2A0E61]/25 backdrop-blur-md sm:p-8">
        <p className="Welcome-text text-sm uppercase">
          Contact
        </p>

        <h2 className="mt-3 text-4xl font-bold text-white sm:text-5xl">
          Let&apos;s connect
        </h2>

        <p className="mt-4 text-base leading-7 text-gray-300">
          {profile.availability}.
        </p>

        <p className="mt-3 text-sm leading-7 text-gray-400">
          For marketing analytics, commercial analytics, business
          intelligence, automation or data operations conversations,
          reach out through the form or one of the professional links
          below.
        </p>

        <DeferredContactForm recipient={profile.email} />

        <div className="mt-6 flex flex-wrap gap-3 text-sm">
          {groupedLinks.primary.map((link) => (
            <SocialProfileLink
              key={link.slug}
              link={link}
              location="contact"
              className="button-secondary inline-flex items-center gap-2 rounded-full px-4 py-2.5 font-semibold"
            />
          ))}

          <TrackedLink
            href="/resume"
            aria-label="View CV"
            analyticsEvent={{
              event: "resume_view_click",
              cta_location: "contact_section",
            }}
            className="button-secondary inline-flex items-center gap-2 rounded-full px-4 py-2.5 font-semibold"
          >
            <ArrowDownTrayIcon className="h-4 w-4" />
            View CV
          </TrackedLink>
        </div>

        {groupedLinks.freelance.length > 0 ? (
          <div className="mt-6 border-t border-white/10 pt-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">
              Freelance profiles
            </p>

            <div className="mt-3 flex flex-wrap gap-3 text-sm">
              {groupedLinks.freelance.map((link) => (
                <SocialProfileLink
                  key={link.slug}
                  link={link}
                  location="contact"
                  className="button-secondary inline-flex items-center gap-2 rounded-full px-4 py-2.5 font-semibold"
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div
        className="h-[360px] md:h-[560px] xl:h-auto xl:flex-1"
        aria-hidden="true"
      >
        <DeferredEarthCanvas />
      </div>
    </section>
  );
};