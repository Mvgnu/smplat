import type { ServiceOverrideRule } from "@smplat/types";

export type ProviderRule = ServiceOverrideRule;

export const describeRuleConditions = (rule: ProviderRule): string => {
  const conditions: Array<Record<string, unknown>> = Array.isArray(rule.conditions)
    ? (rule.conditions as Array<Record<string, unknown>>)
    : [];
  if (conditions.length === 0) {
    return "Always applies";
  }
  const parts = conditions.map((condition) => {
    const typed = condition as Record<string, unknown>;
    const kind = typeof typed.kind === "string" ? typed.kind : "custom";
    switch (kind) {
      case "channel":
        return `Channel: ${Array.isArray(typed.channels) ? typed.channels.join(", ") : "any"}`;
      case "geo":
        return `Region: ${Array.isArray(typed.regions) ? typed.regions.join(", ") : "any"}`;
      case "option":
        return `Option: ${typed.optionId ?? typed.optionKey ?? "any"}`;
      case "amount":
        return `Amount ${typed.min ?? "0"}–${typed.max ?? "∞"}`;
      case "drip":
        return `Drip ${typed.min ?? "0"}/${typed.max ?? "∞"}`;
      default:
        return kind;
    }
  });
  return parts.join(" · ");
};

export const describeRuleOverrides = (rule: ProviderRule): string => {
  const overrides = rule.overrides;
  if (!overrides) {
    return "Inherit provider defaults";
  }
  const parts: string[] = [];
  if (overrides.providerId) {
    parts.push(`Provider → ${overrides.providerId}`);
  }
  if (overrides.serviceId) {
    parts.push(`Service → ${overrides.serviceId}`);
  }
  if (overrides.marginTarget != null) {
    parts.push(`Margin ${overrides.marginTarget}%`);
  }
  if (overrides.dripPerDay != null) {
    parts.push(`${overrides.dripPerDay}/day`);
  }
  if (overrides.payloadTemplate) {
    parts.push("Payload template override");
  }
  if (overrides.previewQuantity != null) {
    parts.push(`Preview ×${overrides.previewQuantity}`);
  }
  return parts.length ? parts.join(" · ") : "Inherit provider defaults";
};
