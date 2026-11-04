import { z } from "zod";

import {
  assetUrlSchema,
  externalUrlSchema,
} from "@/lib/security/validation";

const nullableSectionId =
  z.preprocess(
    (value) =>
      value === "" ||
      value === undefined
        ? null
        : value,

    z
      .string()
      .uuid()
      .nullable(),
  );

export const projectMediaValuesSchema =
  z
    .object({
      project_section_id:
        nullableSectionId,

      media_url:
        z
          .string()
          .trim()
          .min(
            1,
            "Media URL is required.",
          )
          .max(2048),

      alt_text:
        z
          .string()
          .trim()
          .min(
            1,
            "Accessible media text is required.",
          )
          .max(500),

      caption:
        z
          .string()
          .trim()
          .max(2000),

      media_type:
        z.enum([
          "image",
          "video",
          "document",
        ]),

      display_order:
        z
          .number()
          .int()
          .min(-10000)
          .max(10000),

      is_visible:
        z.boolean(),
    })
    .strict()
    .superRefine(
      (
        value,
        context,
      ) => {
        const result =
          value.media_type ===
          "image"
            ? assetUrlSchema
                .safeParse(
                  value.media_url,
                )
            : externalUrlSchema
                .safeParse(
                  value.media_url,
                );

        if (
          !result.success
        ) {
          context.addIssue({
            code: "custom",
            path: [
              "media_url",
            ],
            message:
              value.media_type ===
              "image"
                ? "Choose an internal image or an image uploaded to this Firebase project."
                : "Video and document media must use an HTTPS URL.",
          });
        }
      },
    );

export const projectMediaCreateSchema =
  z
    .object({
      values:
        projectMediaValuesSchema,
    })
    .strict();

export const projectMediaUpdateSchema =
  z
    .object({
      id:
        z.string().uuid(),

      expectedUpdatedAt:
        z
          .string()
          .datetime({
            offset: true,
          }),

      values:
        projectMediaValuesSchema,
    })
    .strict();

export const projectMediaDeleteSchema =
  z
    .object({
      id:
        z.string().uuid(),

      expectedUpdatedAt:
        z
          .string()
          .datetime({
            offset: true,
          }),
    })
    .strict();

export const projectMediaProjectIdSchema =
  z.string().uuid();