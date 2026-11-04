import Image from "next/image";

type ProjectArtworkProps = {
  src: string;
  title: string;
};

const FALLBACK_SRC = "/projects/project-1.png";

export const ProjectArtwork = ({ src, title }: ProjectArtworkProps) => {
  const resolvedSrc = src || FALLBACK_SRC;

  return (
    <Image
      src={resolvedSrc}
      alt={`Project visual for ${title}`}
      fill
      sizes="(min-width: 1280px) 405px, (min-width: 768px) calc(50vw - 36px), calc(100vw - 48px)"
      className={`${resolvedSrc.startsWith("/companies/") || resolvedSrc === "/logo.png" ? "object-contain p-5" : "object-cover"} opacity-85 transition duration-500 group-hover:scale-105 group-hover:opacity-100`}
      data-image-fallback="swap"
      data-fallback-src={resolvedSrc === FALLBACK_SRC ? undefined : FALLBACK_SRC}
    />
  );
};
