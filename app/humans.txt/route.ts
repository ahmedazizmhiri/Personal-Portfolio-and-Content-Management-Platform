import { getPortfolioChromeContent } from "@/lib/cms";

export const revalidate = 60;

export async function GET() {
  const { profile } = await getPortfolioChromeContent();
  const lines = [
    `Owner: ${profile.name || "Ahmed Aziz Mhiri"}`,
    "Purpose: Marketing & Commercial Analytics, Big Data, AI and Digital Transformation portfolio",
    `Availability: ${profile.availability}`,
    "Technology: Next.js, TypeScript, Firebase, Vercel",
    ...(profile.linkedIn ? [`LinkedIn: ${profile.linkedIn}`] : []),
    ...(profile.github ? [`GitHub: ${profile.github}`] : []),
    "",
  ];

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
    },
  });
}
