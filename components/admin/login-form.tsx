"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import type {
  CaptchaController,
  CaptchaSnapshot,
} from "@/components/security/captcha-widget";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { SiGithub } from "react-icons/si";

import { adminFetch } from "@/components/admin/admin-api";

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

type LoginFormProps = {
  nextPath: string;
  initialMfaRequired?: boolean;
  initialError?: string;
  resetSuccess?: boolean;
};

type MfaFactor = {
  id: string;
  friendly_name?: string;
};

const initialCaptcha: CaptchaSnapshot = {
  token: null,
  ready: false,
  error: null,
  expired: false,
};

const loginErrorMessage = (error?: string) => ({
  unauthorized: "This account is not authorized for portfolio administration.",
  callback: "The authentication callback could not be completed.",
  github: "GitHub login could not be started. Check the Firebase GitHub provider settings.",
  github_oauth_failed: "GitHub OAuth was cancelled or failed. Please try again.",
  github_disabled: "GitHub is disabled in Firebase. Enable the provider and add its Client ID and Client Secret.",
  firebase_config: "Firebase is not configured. Check the Firebase project settings.",
  server: "Admin access could not be verified. Check the server-side Firebase configuration.",
  session: "The login session is missing or expired.",
  recovery: "The recovery link is invalid or expired. Request a new password reset email.",
}[error ?? ""] ?? (error ? "Login could not be completed." : ""));

export const LoginForm = ({ nextPath, initialMfaRequired = false, initialError, resetSuccess }: LoginFormProps) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [rememberDevice, setRememberDevice] = useState(false);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [mfaStep, setMfaStep] = useState(initialMfaRequired);
  const [status, setStatus] = useState(initialError ? loginErrorMessage(initialError) : resetSuccess ? "Password updated. Please log in again." : "");
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

  useEffect(() => {
    if (!initialMfaRequired) return;

    const loadMfa = async () => {
      try {
        const response = await adminFetch("/api/auth/mfa/status");
        if (!response.ok) return;
        const data = await response.json();
        const factor = data.factors?.totp?.[0] as MfaFactor | undefined;
        if (factor?.id) setFactorId(factor.id);
      } catch {
        // The verification form retains its existing missing-factor message.
      }
    };

    void loadMfa();
  }, [initialMfaRequired]);

  const submitLogin = async (event: FormEvent<HTMLFormElement>) => {
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
      const response = await adminFetch("/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, next: nextPath, captchaToken }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.ok) {
        setStatus(data.error ?? "Invalid email or password.");
        return;
      }

      if (data.mfaRequired) {
        if (data.redirectTo) {
          window.location.replace(data.redirectTo);
          return;
        }
        setFactorId(data.factorId);
        setMfaStep(true);
        setStatus("Enter your Google Authenticator code.");
        return;
      }

      window.location.replace(data.redirectTo ?? "/admin");
    } catch {
      setStatus("Login could not be completed. Please try again.");
    } finally {
      captchaController.current?.reset();
      setPending(false);
    }
  };

  const submitGitHub = async () => {
    setPending(true);
    setStatus("");

    try {
      const response = await adminFetch("/api/auth/oauth/github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ next: nextPath || "/admin" }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.ok || typeof data.redirectTo !== "string") {
        throw new Error("GitHub OAuth could not be started.");
      }

      window.location.assign(data.redirectTo);
    } catch {
      setStatus("Unable to continue with GitHub.");
    } finally {
      setPending(false);
    }
  };

  const submitMfa = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!factorId) {
      setStatus("No authenticator factor found. Open Security to enroll MFA.");
      return;
    }

    setPending(true);
    setStatus("");
    try {
      const response = await adminFetch("/api/auth/mfa/verify", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ factorId, code, rememberDevice }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.ok) {
        setStatus(data.error ?? "Invalid authenticator code.");
        return;
      }

      window.location.replace(nextPath || data.redirectTo || "/admin");
    } catch {
      setStatus("Invalid authenticator code.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-md rounded-lg border border-white/10 bg-[#100b24]/90 p-6 text-gray-200 shadow-xl shadow-[#2A0E61]/25 backdrop-blur-md">
      <p className="Welcome-text text-sm uppercase">Admin</p>
      <h1 className="mt-3 text-3xl font-bold text-white">Secure login</h1>
      <p className="mt-3 text-sm leading-6 text-gray-400">Use Ahmed&apos;s approved admin account. GitHub users still need explicit admin access.</p>

      {!mfaStep ? (
        <form onSubmit={submitLogin} className="mt-8 flex flex-col gap-5">
          <label className="flex flex-col gap-2 text-sm">
            Email
            <input className="rounded-lg border border-white/10 bg-[#151030] px-4 py-3 text-white outline-none focus:border-cyan-300/60" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>
          <label className="flex flex-col gap-2 text-sm">
            Password
            <input className="rounded-lg border border-white/10 bg-[#151030] px-4 py-3 text-white outline-none focus:border-cyan-300/60" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          </label>
          <CaptchaWidget
            action="admin-login"
            onChange={handleCaptchaChange}
            onControllerChange={handleCaptchaControllerChange}
          />
          <button type="submit" disabled={pending || !captcha.token} className="button-primary rounded-lg px-5 py-3 font-bold text-white disabled:opacity-60">{pending ? "Checking..." : "Log in"}</button>
        </form>
      ) : (
        <form onSubmit={submitMfa} className="mt-8 flex flex-col gap-5">
          <label className="flex flex-col gap-2 text-sm">
            6-digit authenticator code
            <input className="rounded-lg border border-white/10 bg-[#151030] px-4 py-3 text-white outline-none focus:border-cyan-300/60" inputMode="numeric" pattern="[0-9]{6}" value={code} onChange={(event) => setCode(event.target.value)} required />
          </label>
          <label className="flex items-center gap-3 text-sm text-gray-300">
            <input type="checkbox" checked={rememberDevice} onChange={(event) => setRememberDevice(event.target.checked)} />
            Remember this device for 10 days
          </label>
          <button type="submit" disabled={pending || !factorId} className="button-primary rounded-lg px-5 py-3 font-bold text-white disabled:opacity-60">{pending ? "Verifying..." : "Verify code"}</button>
        </form>
      )}

      <div className="mt-5 flex flex-wrap gap-3 text-sm">
        <button type="button" onClick={() => void submitGitHub()} disabled={pending} className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 transition hover:bg-white/10 disabled:opacity-60">
          <SiGithub aria-hidden="true" className="h-4 w-4 shrink-0" />
          <span>Continue with GitHub</span>
        </button>
        <Link href="/admin/forgot-password" className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 transition hover:bg-white/10">Forgot password</Link>
        {mfaStep && <Link href="/admin/security?setup=mfa" className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 transition hover:bg-white/10">MFA setup</Link>}
      </div>

      <p className="mt-5 min-h-6 text-sm text-cyan-100" aria-live="polite">{status}</p>
    </div>
  );
};
