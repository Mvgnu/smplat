export default function TermsOfServicePage() {
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-6 py-16 text-white">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-[0.3em] text-white/40">Legal</p>
        <h1 className="text-3xl font-semibold">Terms of service</h1>
        <p className="text-sm text-white/60">
          These terms govern access to SMPLAT. By creating a workspace you agree to the responsibilities outlined
          below.
        </p>
      </header>
      <section className="space-y-4 text-sm text-white/70">
        <p>
          SMPLAT provides infrastructure for social media campaign management. You are responsible for the content,
          budget, and fulfilment data entered into the platform. Campaign outcomes depend on many factors outside our
          control; we therefore disclaim performance guarantees.
        </p>
        <p>
          Fees are invoiced monthly based on the subscription tier chosen during onboarding. Payments are non-refundable
          for the current billing period. You may cancel at any time and your workspace will remain accessible until the
          end of the paid term.
        </p>
        <p>
          For clarifications please contact{" "}
          <a className="underline" href="mailto:legal@smplat.dev">
            legal@smplat.dev
          </a>
          . We reserve the right to update these terms with reasonable notice. Continued use of the service constitutes
          acceptance of any revisions.
        </p>
      </section>
    </main>
  );
}
