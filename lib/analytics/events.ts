import {
  isAnalyticsConsentGranted,
  isProductionAnalyticsLocation,
  isPublicAnalyticsPath,
} from "@/lib/analytics/consent";
import type { SocialLinkGroup } from "@/lib/cms-types";
import type { PublicResumeVariant } from "@/lib/resume-policy";

export type VirtualPageViewEvent = {
  event: "virtual_page_view";
  page_path: string;
  page_location: string;
  page_title: string;
};

export type AnalyticsConsentUpdatedEvent = {
  event: "analytics_consent_updated";
  analytics_consent: "granted" | "denied";
};

export type GoogleTagManagerStartEvent = {
  event: "gtm.js";
  "gtm.start": number;
};

export type AnalyticsEvent =
  | {
      event: "project_view";
      project_slug: string;
      project_title: string;
    }
  | {
      event: "project_explore_click";
      project_slug?: string;
      project_title?: string;
      cta_location:
        | "hero"
        | "homepage"
        | "projects_page"
        | "related_projects";
    }
| {
    event: "resume_view_click";
    cta_location:
      | "hero"
      | "homepage"
      | "contact_section"
      | "navbar"
      | "mobile_navigation";
  }
  | {
      event: "resume_download";
      cv_variant: PublicResumeVariant;
      file_format: "pdf" | "docx";
      cta_location: "resume_page" | "homepage" | "contact_section";
    }
  | {
      event: "contact_submit_success";
      form_name: "portfolio_contact";
      contact_method: "api";
      cta_location: "contact_page";
    }
  | {
      event: "contact_fallback_mailto";
      form_name: "portfolio_contact";
      contact_method: "mailto_fallback";
      cta_location: "contact_page";
    }
  | {
      event: "contact_submit_error";
      form_name: "portfolio_contact";
      error_type: "api_error" | "network_error";
    }
  | {
      event: "profile_link_click";
      platform: string;
      link_location: "navbar" | "footer" | "contact" | "about" | "hero";
    }
  | {
      event: "social_profile_click";
      platform: string;
      link_group: SocialLinkGroup;
      link_location: "contact" | "footer";
    }
  | {
      event: "email_contact_click";
      link_location: "contact" | "footer";
    }
  | {
      event: "contact_cta_click";
      cta_location: "hero" | "project_page" | "resume_page" | "footer";
      cta_label: string;
    }
| {
    event:
      | "project_cta_click"
      | "project_demo_click"
      | "project_repository_click";
    project_slug: string;
    project_title: string;
    cta_location: "project_card" | "project_page";
  }
  | {
      event: "outbound_linkedin_click" | "outbound_github_click";
      link_location: "project_card" | "project_page" | "navbar" | "footer" | "contact" | "about";
    };

export type AnalyticsDataLayerEvent =
  | AnalyticsEvent
  | AnalyticsConsentUpdatedEvent
  | GoogleTagManagerStartEvent
  | VirtualPageViewEvent;

export type AnalyticsDataLayerItem = AnalyticsDataLayerEvent | IArguments;

export const pushDataLayerEvent = (event: AnalyticsDataLayerEvent) => {
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(event);
};

export const pushAnalyticsEvent = (event: AnalyticsEvent) => {
  if (
    typeof window === "undefined" ||
    !isProductionAnalyticsLocation() ||
    !isPublicAnalyticsPath(window.location.pathname) ||
    !isAnalyticsConsentGranted()
  ) {
    return false;
  }
  pushDataLayerEvent(event);
  return true;
};
