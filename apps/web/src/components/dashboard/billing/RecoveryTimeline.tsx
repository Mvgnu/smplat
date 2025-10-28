"use client";

// meta: component: RecoveryTimeline
// meta: feature: billing-recovery

import { Clock, Mail, MessageCircle, RefreshCcw } from "lucide-react";
import type { ReactNode } from "react";

import type { HostedSessionRecoveryTimeline } from "@/server/billing/types";

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const channelIcons: Record<string, ReactNode> = {
  email: <Mail className="h-4 w-4" />,
  sms: <MessageCircle className="h-4 w-4" />,
};

type RecoveryTimelineProps = {
  timeline: HostedSessionRecoveryTimeline | null;
};

export function RecoveryTimeline({ timeline }: RecoveryTimelineProps) {
  if (!timeline || timeline.sessions.length === 0) {
    return null;
  }

  return (
    <section className="rounded-3xl border border-white/10 bg-black/30 p-6 text-sm text-white/80">
      <header className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <RefreshCcw className="h-5 w-5 text-emerald-300" />
          <div>
            <h3 className="text-base font-semibold text-white">Recovery timeline</h3>
            <p className="text-xs uppercase tracking-[0.3em] text-white/40">
              Automation attempts & communications
            </p>
          </div>
        </div>
        <span className="text-xs text-white/50">
          Generated {formatDisplayDate(timeline.generatedAt)}
        </span>
      </header>

      <div className="flex flex-col gap-4">
        {timeline.sessions.map((session) => (
          <article
            key={session.sessionId}
            className="rounded-2xl border border-white/10 bg-white/5 p-4 shadow-sm"
          >
            <header className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.25em] text-white/40">Session</p>
                <h4 className="text-sm font-semibold text-white">{session.sessionId}</h4>
              </div>
              <div className="flex items-center gap-2 text-xs text-white/60">
                <span className="rounded-full border border-white/20 px-3 py-1 text-[0.65rem] font-semibold uppercase">
                  {session.status}
                </span>
                {session.lastChannel && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-1">
                    {channelIcons[session.lastChannel] ?? <Mail className="h-3 w-3" />}
                    <span className="text-[0.65rem] uppercase tracking-wide">
                      {session.lastChannel}
                    </span>
                  </span>
                )}
              </div>
            </header>

            <div className="flex flex-col gap-3">
              {session.attempts.map((attempt) => (
                <div
                  key={`${session.sessionId}-${attempt.attempt}-${attempt.scheduledAt}`}
                  className="flex flex-col gap-1 rounded-xl border border-white/10 bg-black/40 p-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-[0.2em] text-white/50">
                      Attempt {attempt.attempt}
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs text-white/60">
                      <Clock className="h-3.5 w-3.5" />
                      {formatDisplayDate(attempt.scheduledAt)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-4 text-xs text-white/60">
                    <span className="rounded-full bg-white/10 px-2 py-1 text-[0.65rem] uppercase tracking-wide">
                      {attempt.status}
                    </span>
                    {attempt.nextRetryAt && (
                      <span className="inline-flex items-center gap-1">
                        <RefreshCcw className="h-3.5 w-3.5 text-emerald-200" />
                        Next retry {formatDisplayDate(attempt.nextRetryAt)}
                      </span>
                    )}
                    {attempt.notifiedAt && (
                      <span className="inline-flex items-center gap-1">
                        {(session.lastChannel && channelIcons[session.lastChannel]) ?? (
                          <Mail className="h-3 w-3" />
                        )}
                        Notified {formatDisplayDate(attempt.notifiedAt)}
                      </span>
                    )}
                  </div>
                </div>
              ))}

              <footer className="flex flex-wrap items-center gap-3 text-xs text-white/50">
                {session.nextRetryAt && (
                  <span className="inline-flex items-center gap-1">
                    <RefreshCcw className="h-3 w-3" />
                    Next retry window: {formatDisplayDate(session.nextRetryAt)}
                  </span>
                )}
                {session.lastNotifiedAt && (
                  <span className="inline-flex items-center gap-1">
                    <Mail className="h-3 w-3" />
                    Last notified: {formatDisplayDate(session.lastNotifiedAt)}
                  </span>
                )}
              </footer>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function formatDisplayDate(value?: string | null): string {
  if (!value) {
    return "Pending";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return dateTimeFormatter.format(date);
}
