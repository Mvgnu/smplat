"use client";

// meta: component: admin-manual-nudge-form

import { useEffect, useMemo, useState, useTransition } from "react";

import { type ManualNudgeInput, sendManualNudge } from "./actions";

export type ManualNudgeFormTask = {
  id: string;
  title: string;
  status: string;
};

export type ManualNudgeFormProps = {
  journeyId: string;
  tasks: ManualNudgeFormTask[];
};

export function ManualNudgeForm({ journeyId, tasks }: ManualNudgeFormProps) {
  const [channel, setChannel] = useState<string>("email");
  const [taskId, setTaskId] = useState<string | null>(tasks[0]?.id ?? null);
  const [subject, setSubject] = useState<string>("Onboarding task check-in");
  const defaultMessage = useMemo(() => {
    const taskTitle = tasks.find((task) => task.id === taskId)?.title;
    return [
      "Hi there,",
      "",
      taskTitle
        ? `Quick reminder that "${taskTitle}" is still pending. Let us know if you need a hand.`
        : "We're checking in on your onboarding checklist. Let us know if anything is blocking you.",
      "",
      "– SMPLAT Concierge"
    ].join("\n");
  }, [taskId, tasks]);
  const [message, setMessage] = useState<string>(defaultMessage);
  const [operator, setOperator] = useState<string>("");
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setMessage(defaultMessage);
  }, [defaultMessage]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const payload: ManualNudgeInput = {
      journeyId,
      channel,
      subject,
      message,
      taskId,
      operator,
    };

    setStatus("idle");
    startTransition(async () => {
      try {
        await sendManualNudge(payload);
        setStatus("success");
      } catch (error) {
        console.error("Failed to dispatch manual nudge", error);
        setStatus("error");
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-white/10 bg-black/30 p-6 text-sm">
      <div className="flex flex-col gap-2">
        <label className="text-xs uppercase tracking-[0.3em] text-white/40">Channel</label>
        <select
          className="rounded-xl border border-white/10 bg-black/60 px-3 py-2 text-white"
          value={channel}
          onChange={(event) => setChannel(event.target.value)}
        >
          <option value="email">Email</option>
          <option value="slack">Slack</option>
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-xs uppercase tracking-[0.3em] text-white/40">Task</label>
        <select
          className="rounded-xl border border-white/10 bg-black/60 px-3 py-2 text-white"
          value={taskId ?? ""}
          onChange={(event) => setTaskId(event.target.value || null)}
        >
          {tasks.map((task) => (
            <option key={task.id} value={task.id}>
              {task.title} ({task.status})
            </option>
          ))}
          <option value="">Whole journey</option>
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-xs uppercase tracking-[0.3em] text-white/40">Subject</label>
        <input
          className="rounded-xl border border-white/10 bg-black/60 px-3 py-2 text-white"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          required
          maxLength={120}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-xs uppercase tracking-[0.3em] text-white/40">Message</label>
        <textarea
          className="min-h-[140px] rounded-xl border border-white/10 bg-black/60 px-3 py-2 font-mono text-xs text-white"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          required
        />
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-xs uppercase tracking-[0.3em] text-white/40">Operator signature</label>
        <input
          className="rounded-xl border border-white/10 bg-black/60 px-3 py-2 text-white"
          value={operator}
          onChange={(event) => setOperator(event.target.value)}
          placeholder="Operator initials or name"
          required
        />
      </div>

      <div className="flex items-center justify-between text-xs text-white/60">
        <p>
          {status === "success" && "Nudge queued for delivery."}
          {status === "error" && "We couldn't dispatch the nudge. Try again."}
        </p>
        <button
          type="submit"
          className="inline-flex items-center rounded-full bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-white/90"
          disabled={pending || !operator || !subject || !message}
        >
          {pending ? "Sending…" : "Send nudge"}
        </button>
      </div>
    </form>
  );
}
