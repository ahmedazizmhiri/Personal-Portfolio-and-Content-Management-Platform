/** @type {import('next').NextConfig} */
const isDevelopment = process.env.NODE_ENV === "development";
const isNonProductionDeployment = isDevelopment || Boolean(process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production");
const firebaseStorageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim() || "";
const analyticsEnabled = Boolean(
  process.env.NEXT_PUBLIC_GTM_ID
  || process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID
);
const clarityEnabled = Boolean(process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID);
const captchaProvider = (
  process.env.NEXT_PUBLIC_CAPTCHA_PROVIDER || ""
).trim().toLowerCase();
const hcaptchaSources =
  captchaProvider === "hcaptcha"
    ? ["https://hcaptcha.com", "https://*.hcaptcha.com"]
    : [];
const claritySources = clarityEnabled
  ? ["https://*.clarity.ms", "https://c.bing.com"]
  : [];
const googleSources = analyticsEnabled
  ? [
      "https://www.googletagmanager.com",
      "https://www.google-analytics.com",
      "https://region1.google-analytics.com",
    ]
  : [];
const firebaseStorageOrigin = firebaseStorageBucket ? "https://firebasestorage.googleapis.com" : "";
const blobPublicOrigin = "https://*.public.blob.vercel-storage.com";
const firebaseImagePatterns = firebaseStorageBucket ? [{
  protocol: "https", hostname: "firebasestorage.googleapis.com", port: "",
  pathname: `/v0/b/${encodeURIComponent(firebaseStorageBucket)}/o/**`,
}] : [];

const connectSources = [
  "'self'",
  "https://vitals.vercel-insights.com",
  ...googleSources,
  ...claritySources,
  ...hcaptchaSources,
].filter(Boolean).join(" ");

const scriptSources = [
  "'self'",
  "'unsafe-inline'",
  ...(isDevelopment ? ["'unsafe-eval'"] : []),
  "https://va.vercel-scripts.com",
  ...googleSources.filter((source) => source.includes("googletagmanager")),
  ...claritySources,
  ...hcaptchaSources,
].filter(Boolean).join(" ");

const frameSources = hcaptchaSources.length > 0
  ? ["'self'", ...hcaptchaSources].join(" ")
  : "'none'";

const styleSources = [
  "'self'",
  "'unsafe-inline'",
  ...hcaptchaSources,
].join(" ");

const imageSources = [
  "'self'",
  "data:",
  "blob:",
  firebaseStorageOrigin,
  blobPublicOrigin,
  ...googleSources,
  ...claritySources,
]
  .filter(Boolean)
  .join(" ");

const mediaSources = ["'self'", "blob:", firebaseStorageOrigin, blobPublicOrigin]
  .filter(Boolean)
  .join(" ");

const csp = [
  "default-src 'self'",
  `script-src ${scriptSources}`,
  "script-src-attr 'none'",
  `style-src ${styleSources}`,
  `img-src ${imageSources}`,
  "font-src 'self' data:",
  `connect-src ${connectSources}`,
  `media-src ${mediaSources}`,
  "object-src 'none'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  `frame-src ${frameSources}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  ...(!isDevelopment ? ["upgrade-insecure-requests"] : []),
].join("; ");

// Next.js still emits inline bootstrap scripts. Keep the compatible enforced
// policy while collecting violations against the nonce/hash-ready target.
const cspReportOnly = [
  "default-src 'self'",
  `script-src ${[
    "'self'",
    "https://va.vercel-scripts.com",
    ...googleSources.filter((source) => source.includes("googletagmanager")),
    ...claritySources,
    ...hcaptchaSources,
  ].join(" ")}`,
  "script-src-attr 'none'",
  `style-src ${["'self'", ...hcaptchaSources].join(" ")}`,
  `img-src ${imageSources}`,
  "font-src 'self' data:",
  `connect-src ${connectSources}`,
  `frame-src ${frameSources}`,
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "report-uri /api/security/csp-report",
  "report-to csp-endpoint",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Content-Security-Policy-Report-Only", value: cspReportOnly },
  {
    key: "Reporting-Endpoints",
    value: 'csp-endpoint="/api/security/csp-report"',
  },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const noindexHeader = { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" };

const nextConfig = {
  poweredByHeader: false,
  images: {
    // The portfolio's fill images top out near 405px. Adding a 384px device
    // candidate prevents small cards/avatars from jumping straight to 640px.
    deviceSizes: [384, 640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    remotePatterns: [...firebaseImagePatterns, { protocol: "https", hostname: "**.public.blob.vercel-storage.com", port: "", pathname: "/**" }],
  },
  outputFileTracingIncludes: {
    "/api/admin/upload": [
      "./public/**/*.jpg",
      "./public/**/*.jpeg",
      "./public/**/*.png",
      "./public/**/*.webp",
      "./public/**/*.pdf",
      "./public/**/*.docx",
      "./public/**/*.JPG",
      "./public/**/*.JPEG",
      "./public/**/*.PNG",
      "./public/**/*.WEBP",
      "./public/**/*.PDF",
      "./public/**/*.DOCX",
    ],
  },
  async headers() {
    return [
      { source: "/(.*)", headers: isNonProductionDeployment ? [...securityHeaders, noindexHeader] : securityHeaders },
      { source: "/admin/:path*", headers: [noindexHeader] },
      { source: "/auth/:path*", headers: [noindexHeader] },
      { source: "/api/:path*", headers: [noindexHeader] },
      { source: "/cv/:path*.pdf", headers: [noindexHeader] },
      { source: "/cv/:path*.docx", headers: [noindexHeader] },
    ];
  },
};

module.exports = nextConfig;
