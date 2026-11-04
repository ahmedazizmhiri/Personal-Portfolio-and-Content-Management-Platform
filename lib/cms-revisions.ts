import "server-only";

import { createFirebaseAdminClient } from "@/lib/firebase/admin";
import {
  type EditableCmsTable,
  validateCmsRow,
} from "@/lib/security/validation";

const forbiddenKey = /(password|secret|token|private[_-]?key|api[_-]?key)/i;

const sanitizeRevisionValues = (
  table: EditableCmsTable,
  value: Record<string, unknown> | null,
) => {
  if (!value) return null;
  const parsed = validateCmsRow(table, value);
  const safe = parsed.success ? parsed.data : {};

  return Object.fromEntries(
    Object.entries(safe).filter(([key]) => !forbiddenKey.test(key)),
  );
};

const changedFields = (
  previous: Record<string, unknown> | null,
  next: Record<string, unknown> | null,
) => {
  const keys = new Set([
    ...Object.keys(previous ?? {}),
    ...Object.keys(next ?? {}),
  ]);

  return [...keys]
    .filter((key) =>
      JSON.stringify(previous?.[key] ?? null) !== JSON.stringify(next?.[key] ?? null),
    )
    .sort();
};

export const writeCmsRevision = async (input: {
  actorUserId: string;
  table: EditableCmsTable;
  recordId: string;
  operation: "create" | "update" | "archive" | "delete";
  previous: Record<string, unknown> | null;
  next: Record<string, unknown> | null;
}) => {
  const previousValues = sanitizeRevisionValues(input.table, input.previous);
  const nextValues = sanitizeRevisionValues(input.table, input.next);
  const firebase = createFirebaseAdminClient();
  const { error } = await firebase.from("cms_content_revisions").insert({
    actor_user_id: input.actorUserId,
    table_name: input.table,
    record_id: input.recordId,
    operation: input.operation,
    changed_fields: changedFields(previousValues, nextValues),
    previous_values: previousValues,
    next_values: nextValues,
  });

  return { ok: !error, code: error?.code ?? null };
};
