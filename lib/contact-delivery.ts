import "server-only";

import { createFirebaseAdminClient } from "@/lib/firebase/admin";

export type ContactNotification = {
  id: string;
  name: string;
  email: string;
  message: string;
};

export type ContactDeliveryResult = {
  delivered: boolean;
  code: string;
};

export const CONTACT_DELIVERY_STALE_CLAIM_MS = 5 * 60 * 1_000;

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);

const safeHeaderValue = (value: string) =>
  !/[\r\n]/.test(value) && value.length <= 320;

const recordFailure = async (
  id: string,
  code: string,
  attempt: number,
) => {
  const firebase = createFirebaseAdminClient();
  const result = await firebase
    .from("contact_messages")
    .update({
      delivery_status: "failed",
      delivery_attempts: attempt,
      last_delivery_attempt_at: new Date().toISOString(),
      next_delivery_attempt_at: new Date(Date.now() + 15 * 60 * 1_000).toISOString(),
      delivery_error_code: code.slice(0, 120),
    })
    .eq("id", id)
    .eq("delivery_status", "sending")
    .eq("delivery_attempts", attempt)
    .select("id")
    .maybeSingle();

  return !result.error && Boolean(result.data);
};

export const deliverContactNotification = async (
  message: ContactNotification,
): Promise<ContactDeliveryResult> => {
  const apiKey = process.env.RESEND_API_KEY?.trim() ?? "";
  const to = process.env.CONTACT_NOTIFICATION_TO?.trim() ?? "";
  const from = process.env.CONTACT_NOTIFICATION_FROM?.trim() ?? "";
  const firebase = createFirebaseAdminClient();

  const existing = await firebase
    .from("contact_messages")
    .select("delivery_attempts,delivery_status,last_delivery_attempt_at")
    .eq("id", message.id)
    .maybeSingle();
  if (existing.error || !existing.data) {
    return { delivered: false, code: "delivery_state_unavailable" };
  }
  if (existing.data.delivery_status === "sent") {
    return { delivered: true, code: "already_sent" };
  }
  const lastAttemptAt =
    typeof existing.data.last_delivery_attempt_at === "string"
      ? existing.data.last_delivery_attempt_at
      : null;
  const lastAttemptTimestamp = lastAttemptAt ? Date.parse(lastAttemptAt) : NaN;
  const sendingClaimIsStale =
    existing.data.delivery_status === "sending"
    && (
      !Number.isFinite(lastAttemptTimestamp)
      || Date.now() - lastAttemptTimestamp >= CONTACT_DELIVERY_STALE_CLAIM_MS
    );
  if (
    existing.data.delivery_status === "sending"
    && !sendingClaimIsStale
  ) {
    return { delivered: false, code: "delivery_in_progress" };
  }

  const previousAttempt = Math.max(
    0,
    Number(existing.data.delivery_attempts ?? 0),
  );
  const attempt = previousAttempt + 1;
  const attemptStartedAt = new Date().toISOString();

  let claim = firebase
    .from("contact_messages")
    .update({
      delivery_status: "sending",
      delivery_attempts: attempt,
      last_delivery_attempt_at: attemptStartedAt,
      next_delivery_attempt_at: null,
      delivery_error_code: null,
    })
    .eq("id", message.id)
    .eq("delivery_attempts", previousAttempt);
  claim = existing.data.delivery_status == null
    ? claim.is("delivery_status", null)
    : claim.eq("delivery_status", existing.data.delivery_status);
  if (existing.data.delivery_status === "sending") {
    claim = lastAttemptAt == null
      ? claim.is("last_delivery_attempt_at", null)
      : claim.eq("last_delivery_attempt_at", lastAttemptAt);
  }
  const claimed = await claim.select("id").maybeSingle();
  if (claimed.error || !claimed.data) {
    return { delivered: false, code: "delivery_claim_conflict" };
  }

  if (
    !apiKey
    || !to
    || !from
    || !safeHeaderValue(to)
    || !safeHeaderValue(from)
    || !safeHeaderValue(message.email)
  ) {
    const recorded = await recordFailure(
      message.id,
      "provider_not_configured",
      attempt,
    );
    return {
      delivered: false,
      code: recorded
        ? "provider_not_configured"
        : "failure_state_unconfirmed",
    };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `portfolio-contact-${message.id}`,
      },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: message.email,
        subject: `Portfolio contact from ${message.name}`.slice(0, 200),
        text: [
          `Name: ${message.name}`,
          `Email: ${message.email}`,
          "",
          message.message,
        ].join("\n"),
        html: [
          `<p><strong>Name:</strong> ${escapeHtml(message.name)}</p>`,
          `<p><strong>Email:</strong> ${escapeHtml(message.email)}</p>`,
          `<p>${escapeHtml(message.message).replace(/\r?\n/g, "<br>")}</p>`,
        ].join(""),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });

    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      const code = `provider_${response.status}`;
      const recorded = await recordFailure(message.id, code, attempt);
      return {
        delivered: false,
        code: recorded ? code : "failure_state_unconfirmed",
      };
    }

    const recorded = await firebase
      .from("contact_messages")
      .update({
        delivery_status: "sent",
        delivery_attempts: attempt,
        last_delivery_attempt_at: new Date().toISOString(),
        next_delivery_attempt_at: null,
        delivered_at: new Date().toISOString(),
        delivery_error_code: null,
        provider_message_id:
          typeof payload.id === "string" ? payload.id.slice(0, 255) : null,
      })
      .eq("id", message.id)
      .eq("delivery_status", "sending")
      .eq("delivery_attempts", attempt)
      .select("id")
      .maybeSingle();
    if (recorded.error || !recorded.data) {
      return { delivered: false, code: "sent_state_unconfirmed" };
    }

    return { delivered: true, code: "sent" };
  } catch {
    const recorded = await recordFailure(
      message.id,
      "provider_unavailable",
      attempt,
    );
    return {
      delivered: false,
      code: recorded
        ? "provider_unavailable"
        : "failure_state_unconfirmed",
    };
  }
};
