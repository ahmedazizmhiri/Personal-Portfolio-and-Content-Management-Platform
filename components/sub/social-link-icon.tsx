import { EnvelopeIcon, LinkIcon } from "@heroicons/react/24/solid";
import Image from "next/image";
import type { ComponentType, SVGProps } from "react";
import { FaGithub, FaLinkedinIn, FaUpwork } from "react-icons/fa6";
import { SiMalt } from "react-icons/si";

import type { SocialLinkContent } from "@/lib/cms-types";
import { getSafeSocialIconUrl } from "@/lib/social-links";

type SocialIconComponent = ComponentType<SVGProps<SVGSVGElement>>;

const localSocialIcons: Readonly<Record<string, SocialIconComponent>> = {
  email: EnvelopeIcon,
  github: FaGithub,
  linkedin: FaLinkedinIn,
  upwork: FaUpwork,
  malt: SiMalt,
};

type SocialLinkIconProps = Pick<SocialLinkContent, "iconKey" | "iconUrl"> & {
  className?: string;
};

export const SocialLinkIcon = ({
  iconKey,
  iconUrl,
  className = "h-4 w-4",
}: SocialLinkIconProps) => {
  const safeIconUrl = getSafeSocialIconUrl(iconUrl);
const normalizedIconKey = iconKey?.trim().toLowerCase();
const LocalIcon = normalizedIconKey
  ? localSocialIcons[normalizedIconKey]
  : undefined;  const FallbackIcon = LocalIcon ?? LinkIcon;

  if (!safeIconUrl) {
    return (
      <span
        aria-hidden="true"
        data-social-icon-source={LocalIcon ? "local" : "fallback"}
      >
        <FallbackIcon className={className} />
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={`relative inline-flex shrink-0 ${className}`}
      data-image-fallback-container
      data-social-icon-source="image"
    >
      <Image
        src={safeIconUrl}
        alt=""
        fill
        sizes="16px"
        unoptimized
        className="object-contain"
        data-image-fallback="hide"
      />
      <FallbackIcon
        className="hidden h-full w-full"
        data-image-fallback-content
      />
    </span>
  );
};
