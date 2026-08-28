export const revalidate = 60;

import type { Metadata, Viewport } from "next";
import type { PropsWithChildren } from "react";

import { AnalyticsConsentProvider } from "@/components/analytics/analytics-consent-provider";
import { ConsentBootstrap } from "@/components/analytics/consent-bootstrap";
import { DeferredAnalytics } from "@/components/main/deferred-analytics";
import { DeferredStarBackground } from "@/components/main/deferred-star-background";
import { Footer } from "@/components/main/footer";
import { ImageFallbackController } from "@/components/main/image-fallback-controller";
import { Navbar } from "@/components/main/navbar";
import { JsonLd } from "@/components/seo/json-ld";
import { siteConfig } from "@/config";
import { getPortfolioChromeContent } from "@/lib/cms";
import { personSchema, websiteSchema } from "@/lib/seo/schema";
import { cn } from "@/lib/utils";

import "./globals.css";

export const viewport: Viewport = { themeColor: "#030014" };
export const metadata: Metadata = siteConfig;
const analyticsEnabled = process.env.VERCEL_ENV === "production";
const clarityProjectId = process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID;
const gtmId = process.env.NEXT_PUBLIC_GTM_ID;

export default async function RootLayout({ children }: PropsWithChildren) {
  const content = await getPortfolioChromeContent();

  return (
    <html lang="en">
      <head>
        <ConsentBootstrap enabled={analyticsEnabled} />
      </head>
      <body className={cn("bg-[#030014] overflow-y-scroll overflow-x-hidden font-sans")}>
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <AnalyticsConsentProvider
          analyticsEnabled={analyticsEnabled}
          gtmId={gtmId}
          clarityProjectId={clarityProjectId}
        >
          <JsonLd
  data={[
    websiteSchema(),
    personSchema(content.profile, content.socialLinks),
  ]}
/>
          <DeferredStarBackground />
          <ImageFallbackController />
          <Navbar profile={content.profile} navLinks={content.navLinks} />
          {children}
          <Footer
  profile={content.profile}
  navLinks={content.navLinks}
  socialLinks={content.socialLinks}
/>
          <DeferredAnalytics enabled={analyticsEnabled} />
        </AnalyticsConsentProvider>
      </body>
    </html>
  );
}
