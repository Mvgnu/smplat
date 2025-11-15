import type { StorefrontRewards } from "@/data/storefront-experience";

type RewardCalloutsProps = {
  rewards: StorefrontRewards;
};

export function RewardCallouts({ rewards }: RewardCalloutsProps) {
  return (
    <section
      aria-labelledby="reward-callouts-heading"
      className="mx-auto w-full max-w-6xl rounded-[32px] border border-white/10 bg-gradient-to-r from-indigo-900/70 via-slate-900/80 to-black px-8 py-12 text-white shadow-2xl shadow-indigo-500/10"
    >
      <div className="space-y-4 text-left">
        <p className="text-sm font-semibold uppercase tracking-[0.25em] text-indigo-200/80">Rewards & Intents</p>
        <h2 id="reward-callouts-heading" className="text-3xl font-semibold">
          {rewards.heading}
        </h2>
        <p className="text-white/70">{rewards.subheading}</p>
      </div>

      <div className="mt-8 grid gap-6 md:grid-cols-3">
        {rewards.callouts.map((callout) => (
          <article
            key={callout.id}
            className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/5 px-6 py-6 shadow-lg shadow-black/30"
          >
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/60">{callout.timeline}</p>
              <h3 className="mt-2 text-xl font-semibold">{callout.title}</h3>
              <p className="text-sm text-white/70">{callout.description}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-left">
              <p className="text-sm font-semibold text-white">{callout.rewardValue}</p>
              <div className="mt-2 h-2 w-full rounded-full bg-white/10">
                <div
                  data-testid={`reward-progress-${callout.id}`}
                  className="h-2 rounded-full bg-gradient-to-r from-emerald-200 via-white to-yellow-300"
                  style={{ width: `${Math.round(callout.progress * 100)}%` }}
                />
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
