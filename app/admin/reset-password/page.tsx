import { ResetPasswordForm } from "@/components/admin/password-forms";

export const dynamic = "force-dynamic";

export default async function AdminResetPasswordPage({ searchParams }: { searchParams: Promise<{ oobCode?: string; mode?: string }> }) {
  const params = await searchParams;
  const code = params.mode === "resetPassword" ? params.oobCode ?? "" : "";
  return <main id="main-content" tabIndex={-1} className="min-h-screen px-6 py-28"><ResetPasswordForm recoveryReady={Boolean(code)} oobCode={code} /></main>;
}
