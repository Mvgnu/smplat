export default function PrivacyPolicyPage() {
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-6 py-16 text-white">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-[0.3em] text-white/40">Legal</p>
        <h1 className="text-3xl font-semibold">Privacy policy</h1>
        <p className="text-sm text-white/60">
          We are committed to protecting customer data and using it solely to deliver agreed promotion services.
        </p>
      </header>
      <section className="space-y-4 text-sm text-white/70">
        <p>
          SMPLAT collects only the information required to operate the storefront, automate fulfillment, and provide
          analytics to our customers. This includes contact details you submit through lead forms, account information
          when you create a workspace, and campaign metadata required to deliver social media services.
        </p>
        <p>
          We never sell personal information. Data is stored in EU data centres and access is restricted to personnel
          operating under confidentiality agreements. You can request deletion of your data at any time by emailing{" "}
          <a className="underline" href="mailto:privacy@smplat.dev">
            privacy@smplat.dev
          </a>
          .
        </p>
        <p>
          This document is a living policy. Updates will be posted here with revision timestamps. Continued use of the
          platform after changes constitutes acceptance of the updated policy.
        </p>
      </section>
    </main>
  );
}
