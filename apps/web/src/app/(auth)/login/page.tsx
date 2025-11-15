"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// security-lockout: client-preflight-check
const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

const mapAuthError = (code: string | null) => {
  if (!code) {
    return null;
  }

  switch (code) {
    case "Verification":
      return "Your previous sign-in link expired. Request a new one below.";
    case "AccessDenied":
      return "Access is restricted. Confirm you are using the correct work email.";
    case "EmailSignin":
      return "We were unable to send a sign-in link. Try again in a moment.";
    case "Configuration":
      return "Sign-in is temporarily unavailable. Please try again later.";
    default:
      return "We couldn't sign you in. Double-check your email and try again.";
  }
};

type DevShortcutKey = "customer" | "admin" | "testing" | "analysis";

const devShortcutOptions: Array<{ key: DevShortcutKey; label: string }> = [
  { key: "customer", label: "Customer dashboard" },
  { key: "admin", label: "Admin control center" },
  { key: "testing", label: "Testing sandbox" },
  { key: "analysis", label: "Analysis workspace" }
];

export default function LoginPage() {
  const searchParams = useSearchParams();
  const defaultCallbackUrl = searchParams.get("callbackUrl") ?? "/dashboard";
  const cmsEnv =
    (process.env.NEXT_PUBLIC_CMS_ENV ?? process.env.NODE_ENV ?? "").toLowerCase();
  const enableDevShortcuts = cmsEnv === "development";
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [devLoginKey, setDevLoginKey] = useState<DevShortcutKey | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(() => mapAuthError(searchParams.get("error")));

  const handleDevLogin = async (userKey: DevShortcutKey) => {
    setDevLoginKey(userKey);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const result = await signIn("dev-shortcut", {
        userKey,
        callbackUrl: defaultCallbackUrl,
        redirect: false
      });

      if (result?.error) {
        setErrorMessage("Immediate login failed. Ensure dev users are seeded.");
        setDevLoginKey(null);
        return;
      }

      if (result?.url) {
        setDevLoginKey(null);
        window.location.href = result.url;
        return;
      }

      if (!result || !result.error) {
        setDevLoginKey(null);
        router.replace(defaultCallbackUrl);
        return;
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Immediate login failed.");
    }

    setDevLoginKey(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedEmail = email.trim();

    if (!trimmedEmail) {
      setErrorMessage("Enter your work email to continue.");
      setSuccessMessage(null);
      return;
    }

    if (!emailPattern.test(trimmedEmail)) {
      setErrorMessage("That doesn't look like a valid email address.");
      setSuccessMessage(null);
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const lockoutResponse = await fetch(
        `${apiBase}/api/v1/auth/lockout?identifier=${encodeURIComponent(trimmedEmail)}`
      );

      if (lockoutResponse.ok) {
        const lockoutState: { locked: boolean; retry_after_seconds: number | null } = await lockoutResponse.json();
        if (lockoutState.locked) {
          const retrySeconds = lockoutState.retry_after_seconds ?? 0;
          const retryMinutes = Math.max(1, Math.ceil(retrySeconds / 60));
          setErrorMessage(`Too many attempts. Try again in about ${retryMinutes} minute${retryMinutes > 1 ? "s" : ""}.`);
          setIsSubmitting(false);
          return;
        }
      }

      const result = await signIn("email", {
        email: trimmedEmail,
        redirect: false,
        callbackUrl: defaultCallbackUrl
      });

      if (result?.error) {
        try {
          await fetch(`${apiBase}/api/v1/auth/attempts`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ identifier: trimmedEmail, outcome: "failure" })
          });
        } catch (attemptError) {
          console.warn("Failed to record auth failure", attemptError);
        }
        setErrorMessage(mapAuthError(result.error));
        setIsSubmitting(false);
        return;
      }

      setSuccessMessage("Check your inbox for a magic link to finish signing in.");
      setEmail("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Something went wrong. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-16">
      <div className="rounded-3xl border border-white/10 bg-black/40 p-8 shadow-xl backdrop-blur">
        <h1 className="text-2xl font-semibold text-white">Sign in to SMPLAT</h1>
        <p className="mt-2 text-sm text-white/60">Continue with your agency email to access your dashboard.</p>

        {errorMessage && (
          <div className="mt-6 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-100" data-testid="validation-error">
            {errorMessage}
          </div>
        )}

        {successMessage && (
          <div className="mt-6 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100" data-testid="success-message">
            {successMessage}
          </div>
        )}

        <form className="mt-8 space-y-4" onSubmit={handleSubmit} noValidate>
          <div className="space-y-2">
            <label className="block text-sm font-medium text-white" htmlFor="email">
              Work email
            </label>
            <input
              className="w-full rounded-lg border border-white/20 bg-transparent px-4 py-3 text-sm text-white outline-none transition focus:border-white/60 focus:ring-2 focus:ring-white/20"
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@agency.com"
              autoComplete="email"
              disabled={isSubmitting}
              data-testid="email-input"
            />
          </div>
          <button
            className="w-full rounded-lg bg-white px-4 py-3 text-sm font-semibold text-black transition hover:bg-white/80 disabled:cursor-not-allowed disabled:bg-white/60"
            type="submit"
            disabled={isSubmitting}
            data-testid="login-button"
          >
            {isSubmitting ? "Sending link..." : "Continue with email"}
          </button>
        </form>

        {enableDevShortcuts && (
          <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/80">
            <p className="font-medium text-white">Immediate development logins</p>
            <p className="mt-1 text-xs text-white/60">
              Available locally when CMS_ENV=development and dev users have been seeded.
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {devShortcutOptions.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className="w-full rounded-lg border border-white/20 bg-transparent px-4 py-2 text-sm font-medium text-white transition hover:border-white/60 hover:bg-white/10 disabled:cursor-not-allowed disabled:border-white/10 disabled:opacity-70"
                  onClick={() => handleDevLogin(option.key)}
                  disabled={isSubmitting || (devLoginKey !== null && devLoginKey !== option.key)}
                  data-testid={`dev-login-${option.key}`}
                >
                  {devLoginKey === option.key ? "Signing in…" : option.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6 space-y-3 text-sm text-white/60">
          <p>Single sign-on with Google or Instagram coming soon.</p>
        </div>
      </div>
    </main>
  );
}
