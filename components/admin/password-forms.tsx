"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import type {
  CaptchaController,
  CaptchaSnapshot,
} from "@/components/security/captcha-widget";
import { adminFetch } from "@/components/admin/admin-api";
import { FormEvent, useCallback, useRef, useState } from "react";

const CaptchaWidget = dynamic(
  () =>
    import("@/components/security/captcha-widget").then(
      (module) => module.CaptchaWidget,
    ),
  {
    ssr: false,
    loading: () => (
      <p className="min-h-[160px] text-xs text-cyan-100 min-[400px]:min-h-[85px]" aria-live="polite">
        Loading verification...
      </p>
    ),
  },
);

const initialCaptcha: CaptchaSnapshot = {
  token: null,
  ready: false,
  error: null,
  expired: false,
};

const genericRecoveryMessage =
  "If an account exists, password-reset instructions have been sent.";

export const ForgotPasswordForm = () => {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const [captcha, setCaptcha] = useState<CaptchaSnapshot>(initialCaptcha);
  const captchaController = useRef<CaptchaController | null>(null);

  const handleCaptchaChange = useCallback((next: CaptchaSnapshot) => {
    setCaptcha(next);
  }, []);

  const handleCaptchaControllerChange = useCallback(
    (controller: CaptchaController | null) => {
      captchaController.current = controller;
    },
    [],
  );

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    if (!captcha.token) {
      setStatus(captcha.error ?? "Complete the verification first.");
      return;
    }

    const captchaToken = captcha.token;
    setPending(true);
    setStatus("");

    try {
      const response = await adminFetch("/api/auth/forgot-password", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, captchaToken }),
      });
      const data = await response.json().catch(() => ({}));
      setStatus(data.message ?? genericRecoveryMessage);
    } catch {
      setStatus(genericRecoveryMessage);
    } finally {
      captchaController.current?.reset();
      setPending(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-md rounded-lg border border-white/10 bg-[#100b24]/90 p-6 text-gray-200 shadow-xl shadow-[#2A0E61]/25 backdrop-blur-md">
      <h1 className="text-3xl font-bold text-white">Forgot password</h1>
      <form onSubmit={submit} className="mt-8 flex flex-col gap-5">
        <label className="flex flex-col gap-2 text-sm">
          Admin email
          <input
            className="rounded-lg border border-white/10 bg-[#151030] px-4 py-3 text-white outline-none focus:border-cyan-300/60"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <CaptchaWidget
          action="password-recovery"
          onChange={handleCaptchaChange}
          onControllerChange={handleCaptchaControllerChange}
        />
        <button
          type="submit"
          disabled={pending || !captcha.token}
          className="button-primary rounded-lg px-5 py-3 font-bold text-white disabled:opacity-60"
        >
          {pending ? "Sending..." : "Send recovery link"}
        </button>
      </form>
      <p className="mt-5 min-h-6 text-sm text-cyan-100" aria-live="polite">
        {status}
      </p>
      <Link
        href="/admin/login"
        className="mt-4 inline-flex text-sm text-gray-300 hover:text-cyan-100"
      >
        Back to login
      </Link>
    </div>
  );
};

export const ResetPasswordForm = ({ recoveryReady = true, oobCode = "" }: { recoveryReady?: boolean; oobCode?: string }) => {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!recoveryReady) { setStatus("Recovery session is missing or expired. Request a new recovery link."); return; }
    if (password !== confirmation) { setStatus("Passwords do not match."); return; }
    if (password.length < 12 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
      setStatus("Use at least 12 characters with uppercase, lowercase and a number.");
      return;
    }
    setPending(true);
    try {
      const response = await adminFetch("/api/auth/reset-password", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password, oobCode }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) { setStatus(data.error ?? "Password could not be updated."); return; }
      window.location.href = data.redirectTo ?? "/admin/login?reset=success";
    } catch {
      setStatus("Password could not be updated.");
    } finally {
      setPending(false);
    }
  };

  return <div className="mx-auto w-full max-w-md rounded-lg border border-white/10 bg-[#100b24]/90 p-6 text-gray-200 shadow-xl shadow-[#2A0E61]/25 backdrop-blur-md"><h1 className="text-3xl font-bold text-white">Reset password</h1><p className="mt-3 text-sm leading-6 text-gray-400">{recoveryReady ? "Use at least 12 characters with uppercase, lowercase and a number." : "This recovery session is missing or expired. Request a new recovery email."}</p><form onSubmit={submit} className="mt-8 flex flex-col gap-5"><label className="flex flex-col gap-2 text-sm">New password<input className="rounded-lg border border-white/10 bg-[#151030] px-4 py-3 text-white outline-none focus:border-cyan-300/60" type="password" minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} required disabled={!recoveryReady} /></label><label className="flex flex-col gap-2 text-sm">Confirm new password<input className="rounded-lg border border-white/10 bg-[#151030] px-4 py-3 text-white outline-none focus:border-cyan-300/60" type="password" minLength={12} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required disabled={!recoveryReady} /></label><button type="submit" disabled={pending || !recoveryReady} className="button-primary rounded-lg px-5 py-3 font-bold text-white disabled:opacity-60">{pending ? "Updating..." : "Update password"}</button></form><p className="mt-5 min-h-6 text-sm text-cyan-100" aria-live="polite">{status}</p>{!recoveryReady && <Link href="/admin/forgot-password" className="mt-4 inline-flex text-sm text-gray-300 hover:text-cyan-100">Request another recovery link</Link>}</div>;
};
