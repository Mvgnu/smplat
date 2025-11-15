"use client";

import { useState } from "react";

import type { CustomFieldDraft } from "@/app/(admin)/admin/products/types";

type FieldValidationPanelProps = {
  field: CustomFieldDraft;
  onValidationChange: (patch: Partial<CustomFieldDraft["validation"]>) => void;
  onSampleValuesChange: (value: string) => void;
  onRegexTesterChange: (patch: Partial<CustomFieldDraft["regexTester"]>) => void;
};

type RegexStatus =
  | { state: "idle"; message: null }
  | { state: "success"; message: string }
  | { state: "error"; message: string };

const initialStatus: RegexStatus = { state: "idle", message: null };

export function FieldValidationPanel({
  field,
  onValidationChange,
  onSampleValuesChange,
  onRegexTesterChange,
}: FieldValidationPanelProps) {
  const [regexStatus, setRegexStatus] = useState<RegexStatus>(initialStatus);

  const handleRegexTest = () => {
    const pattern = field.validation.pattern.trim();
    const sample = field.regexTester.sampleValue.trim();
    const flagString = field.validation.regexFlags.trim();

    if (!pattern) {
      setRegexStatus({ state: "error", message: "Add a pattern before testing." });
      return;
    }

    if (!sample) {
      setRegexStatus({ state: "error", message: "Provide a sample value to test against." });
      return;
    }

    try {
      const regex = flagString.length > 0 ? new RegExp(pattern, flagString) : new RegExp(pattern);
      const match = regex.test(sample);
      setRegexStatus({
        state: match ? "success" : "error",
        message: match ? "Sample matches the pattern." : "Sample does not match the pattern.",
      });
      onRegexTesterChange({ lastResult: match });
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "Unable to evaluate pattern. Check regex syntax.";
      setRegexStatus({ state: "error", message: detail });
      onRegexTesterChange({ lastResult: null });
    }
  };

  return (
    <div className="space-y-4 rounded-xl border border-white/10 bg-black/30 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">Validation & guidance</p>
          <p className="text-xs text-white/50">
            Configure acceptable values, numeric ranges, and sample content for operators + storefront.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-white/60">
          <input
            type="checkbox"
            checked={field.validation.disallowWhitespace}
            onChange={(event) => onValidationChange({ disallowWhitespace: event.target.checked })}
            className="h-4 w-4 border-white/20 bg-black/60 text-emerald-400 focus:ring-emerald-400"
          />
          Disallow whitespace
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs text-white/70">
          Min length
          <input
            type="number"
            min="0"
            value={field.validation.minLength}
            onChange={(event) => onValidationChange({ minLength: event.target.value })}
            placeholder="e.g. 3"
            className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-white/70">
          Max length
          <input
            type="number"
            min="0"
            value={field.validation.maxLength}
            onChange={(event) => onValidationChange({ maxLength: event.target.value })}
            placeholder="e.g. 32"
            className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-white/70">
          Allowed values (comma or newline separated)
          <textarea
            value={field.validation.allowedValues}
            onChange={(event) => onValidationChange({ allowedValues: event.target.value })}
            rows={2}
            placeholder="instagram, tiktok"
            className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
          />
        </label>
      </div>

      {field.fieldType === "number" ? (
        <div className="grid gap-3 md:grid-cols-3">
          <label className="flex flex-col gap-1 text-xs text-white/70">
            Min value
            <input
              type="number"
              value={field.validation.minValue}
              onChange={(event) => onValidationChange({ minValue: event.target.value })}
              placeholder="e.g. 0"
              className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-white/70">
            Max value
            <input
              type="number"
              value={field.validation.maxValue}
              onChange={(event) => onValidationChange({ maxValue: event.target.value })}
              placeholder="e.g. 100"
              className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-white/70">
            Numeric step
            <input
              type="number"
              min="0"
              step="0.01"
              value={field.validation.numericStep}
              onChange={(event) => onValidationChange({ numericStep: event.target.value })}
              placeholder="e.g. 5"
              className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
            />
            <span className="text-[0.65rem] text-white/40">Ensures submitted numbers align to increments.</span>
          </label>
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs text-white/70">
          Regex pattern
          <input
            value={field.validation.pattern}
            onChange={(event) => onValidationChange({ pattern: event.target.value })}
            placeholder="^https://"
            className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-white/70">
          Regex flags
          <input
            value={field.validation.regexFlags}
            onChange={(event) => onValidationChange({ regexFlags: event.target.value })}
            placeholder="i"
            className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-white/70">
          Regex description
          <input
            value={field.validation.regexDescription}
            onChange={(event) => onValidationChange({ regexDescription: event.target.value })}
            placeholder="Explain why the regex exists"
            className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
          />
        </label>
      </div>
      <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_auto]">
        <label className="flex flex-col gap-1 text-xs text-white/70">
          Regex sample value
          <input
            value={field.regexTester.sampleValue}
            onChange={(event) => onRegexTesterChange({ sampleValue: event.target.value, lastResult: null })}
            placeholder="https://brand.example"
            className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
          />
          {regexStatus.message ? (
            <span
              className={`text-[0.65rem] ${
                regexStatus.state === "success" ? "text-emerald-300" : "text-red-300"
              }`}
            >
              {regexStatus.message}
            </span>
          ) : field.regexTester.lastResult != null ? (
            <span className="text-[0.65rem] text-white/50">
              Last result: {field.regexTester.lastResult ? "Match" : "No match"}
            </span>
          ) : null}
        </label>
        <button
          type="button"
          onClick={handleRegexTest}
          className="mt-5 inline-flex items-center justify-center rounded-full border border-white/20 px-4 py-1.5 text-xs uppercase tracking-[0.3em] text-white/70 transition hover:border-white/40 hover:text-white"
        >
          Test pattern
        </button>
      </div>

      <label className="flex flex-col gap-1 text-xs text-white/70">
        Sample values (one per line)
        <textarea
          value={field.sampleValues}
          onChange={(event) => onSampleValuesChange(event.target.value)}
          rows={3}
          placeholder={"@brand.example\nhttps://link.example"}
          className="rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
        />
        <span className="text-[0.65rem] text-white/40">
          Provided to operators & the storefront as guidance. Not validated.
        </span>
      </label>
    </div>
  );
}
