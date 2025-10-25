"use client";

import { FormEvent, useState } from "react";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

export default function LoginPage() {
  const searchParams = useSearchParams();
  const defaultCallbackUrl = searchParams.get("callbackUrl") ?? "/dashboard";
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(() => mapAuthError(searchParams.get("error")));

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
      const result = await signIn("email", {
        email: trimmedEmail,
        redirect: false,
        callbackUrl: defaultCallbackUrl
      });

      if (result?.error) {
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

        <div className="mt-6 space-y-3 text-sm text-white/60">
          <p>Single sign-on with Google or Instagram coming soon.</p>
        </div>
      </div>
    </main>
  );
}
