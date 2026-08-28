import { TrackedLink } from "@/components/analytics/tracked-link";
import { SocialLinkIcon } from "@/components/sub/social-link-icon";
import type { AnalyticsEvent } from "@/lib/analytics/events";
import type { SocialLinkContent } from "@/lib/cms-types";
import {
  getSocialLinkAnalyticsEvent,
  isMailtoLink,
  type SocialLinkLocation,
} from "@/lib/social-links";

type SocialProfileLinkProps = {
  link: SocialLinkContent;
  location: SocialLinkLocation;
  className: string;
};

export const SocialProfileLink = ({
  link,
  location,
  className,
}: SocialProfileLinkProps) => {
const mailto = isMailtoLink(link.url);
const displayLabel = mailto
  ? decodeURIComponent(link.url.slice("mailto:".length))
  : link.label;

const primaryEvent = getSocialLinkAnalyticsEvent(link, location);
  const analyticsEvent: AnalyticsEvent | AnalyticsEvent[] =
    mailto && location === "footer"
      ? [
          primaryEvent,
          {
            event: "contact_cta_click",
            cta_location: "footer",
            cta_label: "footer_email_contact",
          },
        ]
      : primaryEvent;

  return (
    <TrackedLink
      href={link.url}
      analyticsEvent={analyticsEvent}
      aria-label={
  mailto
    ? `Email ${displayLabel}`
    : `${displayLabel} profile`
}
      {...(!mailto
        ? { target: "_blank", rel: "noreferrer noopener" }
        : {})}
      className={className}
      data-social-link-slug={link.slug}
      data-social-link-group={link.group}
      data-social-link-location={location}
    >
      <SocialLinkIcon iconKey={link.iconKey} iconUrl={link.iconUrl} />
      {link.label}
    </TrackedLink>
  );
};
