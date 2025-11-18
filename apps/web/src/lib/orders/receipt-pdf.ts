import PDFDocument from "pdfkit";
import type PDFKit from "pdfkit";

import {
  buildDeliveryProofInsights,
  formatFollowerValue,
  formatRelativeTimestamp,
  formatSignedNumber,
} from "@/lib/delivery-proof-insights";
import type { DeliveryProofInsight } from "@/lib/delivery-proof-insights";
import type { OrderReceiptPayload } from "./receipt-exports";

const currencyFormatter = (currency: string) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

export async function renderOrderReceiptPdf(payload: OrderReceiptPayload): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", (error) => reject(error));

    const currency = payload.currency;
    const formatCurrency = currencyFormatter(currency);
    const deliveryProofInsights = buildDeliveryProofInsights(
      payload.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        productTitle: item.productTitle,
        platformContext: item.platformContext,
      })),
      {
        proof: payload.deliveryProof ?? undefined,
        aggregates: payload.deliveryProofAggregates ?? undefined,
      }
    );

    doc.fontSize(20).text("SMPLAT Receipt", { align: "left" });
    doc.moveDown(0.5);
    doc.fontSize(12);
    doc.text(`Order reference: ${payload.orderNumber ?? payload.id}`);
    doc.text(`Status: ${payload.status}`);
    doc.text(`Total: ${formatCurrency.format(payload.total)}`);
    doc.text(`Created: ${dateFormatter.format(new Date(payload.createdAt))}`);
    doc.text(`Updated: ${dateFormatter.format(new Date(payload.updatedAt))}`);
    if (typeof payload.loyaltyProjectionPoints === "number") {
      doc.text(`Projected loyalty points: ${payload.loyaltyProjectionPoints.toLocaleString("en-US")}`);
    }
    doc.moveDown();

    doc.fontSize(14).text("Items", { underline: true });
    doc.moveDown(0.25);
    payload.items.forEach((item) => {
      doc
        .fontSize(12)
        .font("Helvetica-Bold")
        .text(`${item.productTitle} · ${item.quantity} × ${formatCurrency.format(item.unitPrice)}`);
      doc
        .font("Helvetica")
        .text(`Total: ${formatCurrency.format(item.totalPrice)}`)
        .moveDown(0.2);
      if (item.platformContext?.handle || item.platformContext?.label) {
        const platformParts = [
          item.platformContext.label ?? null,
          item.platformContext.handle ? `@${item.platformContext.handle}` : null,
          item.platformContext.platformType ?? null,
        ].filter(Boolean);
        if (platformParts.length) {
          doc.text(`Platform: ${platformParts.join(" • ")}`);
        }
      }
      if (item.selectedOptions?.options?.length) {
        doc.font("Helvetica-Oblique").text("Options:", { continued: false });
        item.selectedOptions.options.forEach((option) => {
          doc
            .font("Helvetica")
            .text(
              `  • ${option.groupName ?? option.groupId ?? "Option"}: ${option.label} (${
                option.priceDelta >= 0 ? "+" : "-"
              }${formatCurrency.format(Math.abs(option.priceDelta))})`
            );
          if (option.marketingTagline) {
            doc.text(`      Tagline: ${option.marketingTagline}`);
          }
          if (option.fulfillmentSla) {
            doc.text(`      SLA: ${option.fulfillmentSla}`);
          }
          if (option.calculator?.expression) {
            doc.text(`      Calculator: ${option.calculator.expression}`);
          }
        });
      }
      if (item.selectedOptions?.subscriptionPlan) {
        const plan = item.selectedOptions.subscriptionPlan;
        doc
          .font("Helvetica-Oblique")
          .text("Subscription plan:", { continued: false })
          .font("Helvetica");
        doc.text(`  • ${plan.label ?? "Plan"} (${plan.billingCycle?.replace("_", " ") ?? "custom"})`);
        if (typeof plan.priceDelta === "number") {
          const formatted = formatCurrency.format(Math.abs(plan.priceDelta));
          doc.text(`      Delta: ${plan.priceDelta >= 0 ? "+" : "-"}${formatted}`);
        }
      }
      const experiment = extractItemPricingExperiment(item.attributes);
      if (experiment) {
        doc.font("Helvetica-Oblique").text("Pricing experiment:", { continued: false }).font("Helvetica");
        doc.text(
          `  • ${experiment.trackLabel} ${experiment.variantName} (${experiment.name ?? experiment.slug})`
        );
        if (experiment.assignmentStrategy) {
          doc.text(`      Assignment: ${experiment.assignmentStrategy}`);
        }
        if (experiment.status) {
          doc.text(`      Status: ${experiment.status}`);
        }
        if (experiment.featureFlagKey) {
          doc.text(`      Feature flag: ${experiment.featureFlagKey}`);
        }
      }
      doc.moveDown(0.4);
    });

    if (payload.pricingExperiments.length) {
      doc.moveDown().fontSize(14).text("Experiment exposure", { underline: true });
      payload.pricingExperiments.forEach((experiment) => {
        doc
          .fontSize(12)
          .font("Helvetica-Bold")
          .text(`${experiment.name ?? experiment.slug} (${experiment.slug})`);
        doc.font("Helvetica").text(
          `${experiment.isControl ? "Control" : "Challenger"} · Variant ${experiment.variantName ?? experiment.variantKey}`
        );
        if (experiment.assignmentStrategy) {
          doc.text(`Assignment strategy: ${experiment.assignmentStrategy}`);
        }
        if (experiment.status || experiment.featureFlagKey) {
          doc.text(
            `Status: ${experiment.status ?? "unknown"}${
              experiment.featureFlagKey ? ` · Flag ${experiment.featureFlagKey}` : ""
            }`
          );
        }
        doc.moveDown(0.3);
      });
    }

    if (deliveryProofInsights.length) {
      doc.moveDown().fontSize(14).text("Delivery proof", { underline: true });
      doc.fontSize(12);
      deliveryProofInsights.forEach((insight) => {
        renderDeliveryProofInsight(doc, insight);
        doc.moveDown(0.5);
      });
    }

    if (shouldRenderProviderTelemetry(payload.providerTelemetry)) {
      doc.moveDown().fontSize(14).text("Provider automation", { underline: true });
      renderProviderTelemetry(doc, payload.providerTelemetry!);
    }

    renderComplianceSection(doc, payload);

    doc.end();
  });
}

function renderDeliveryProofInsight(doc: PDFKit.PDFDocument, insight: DeliveryProofInsight) {
  doc.font("Helvetica-Bold").text(insight.item.productTitle);
  doc.font("Helvetica");
  if (insight.proof?.account?.handle) {
    doc.text(
      `Account: @${insight.proof.account.handle} · ${insight.proof.account.platform ?? "unknown platform"}`
    );
  } else if (insight.item.platformContext?.handle) {
    doc.text(`Awaiting account linkage for @${insight.item.platformContext.handle}`);
  } else {
    doc.text("No linked account yet");
  }

  const baselineFollowers = extractFollowerSnapshot(insight.proof?.baseline ?? null);
  const latestFollowers = extractFollowerSnapshot(insight.proof?.latest ?? null);
  if (baselineFollowers != null || latestFollowers != null) {
    const baselineText =
      baselineFollowers != null ? `Baseline ${formatFollowerValue(baselineFollowers)}` : "Baseline —";
    const latestText =
      latestFollowers != null ? `Latest ${formatFollowerValue(latestFollowers)}` : "Latest —";
    const deltaText =
      baselineFollowers != null && latestFollowers != null
        ? `Δ ${formatSignedNumber(latestFollowers - baselineFollowers)}`
        : "Δ —";
    doc.text(`${baselineText} · ${latestText} · ${deltaText}`);
  }
  const capturedAt = formatRelativeTimestamp(insight.proof?.latest?.recordedAt ?? null);
  if (capturedAt) {
    doc.text(`Captured ${capturedAt}`);
  }
  if (insight.proof?.latest?.warnings?.length) {
    doc.text(`Warnings: ${insight.proof.latest.warnings.join(", ")}`);
  }
  if (insight.aggregate) {
    const metric = insight.aggregate.metrics.find((entry) => entry.metricKey === "followerCount");
    if (metric) {
      const deltaText = metric.formattedDelta ?? formatSignedNumber(metric.deltaAverage);
      const percentText = metric.formattedPercent ? ` (${metric.formattedPercent})` : "";
      const latestText = metric.formattedLatest ? ` · Latest avg ${metric.formattedLatest}` : "";
      doc.text(`Benchmark ${deltaText}${percentText}${latestText}`);
      const sampleParts: string[] = [];
      if (insight.aggregate.sampleSize) {
        sampleParts.push(`n=${insight.aggregate.sampleSize}`);
      }
      doc.text(`Sample ${sampleParts.join(" · ") || "—"}`);
    }
  }
}

type ProviderTelemetry = NonNullable<OrderReceiptPayload["providerTelemetry"]>;

function renderProviderTelemetry(doc: PDFKit.PDFDocument, telemetry: ProviderTelemetry) {
  doc.fontSize(12).font("Helvetica");
  doc.text(`Orders routed to providers: ${telemetry.totalOrders}`);
  const { replays, guardrails } = telemetry;
  doc.text(
    `Replays · Executed ${replays.executed}/${replays.total} · Failed ${replays.failed} · Scheduled ${replays.scheduled}`
  );
  if (guardrails.evaluated > 0) {
    doc.text(
      `Guardrail checks ${guardrails.evaluated} · Pass ${guardrails.pass} · Warn ${guardrails.warn} · Fail ${guardrails.fail}`
    );
  } else {
    doc.text("Guardrail checks pending for this order batch.");
  }

  const overrideSummaries = Object.entries(telemetry.ruleOverridesByService)
    .filter(([, value]) => value.totalOverrides > 0)
    .map(([serviceId, value]) => `${serviceId}: ${value.totalOverrides}`)
    .slice(0, 3);
  if (overrideSummaries.length) {
    doc.text(`Rule overrides triggered · ${overrideSummaries.join(" · ")}`);
  }

  const guardrailHotspots = Object.entries(telemetry.guardrailHitsByService)
    .filter(([, value]) => value.fail > 0 || value.warn > 0)
    .map(([serviceId, value]) => `${serviceId}: warn ${value.warn} · fail ${value.fail}`)
    .slice(0, 3);
  if (guardrailHotspots.length) {
    doc.text(`Services under watch · ${guardrailHotspots.join(" · ")}`);
  }
}

function shouldRenderProviderTelemetry(
  telemetry: OrderReceiptPayload["providerTelemetry"],
): telemetry is ProviderTelemetry {
  if (!telemetry) {
    return false;
  }
  const hasOverrides = Object.values(telemetry.ruleOverridesByService).some(
    (entry) => entry.totalOverrides > 0,
  );
  const hasGuardrailHits = Object.values(telemetry.guardrailHitsByService).some(
    (entry) => entry.fail > 0 || entry.warn > 0,
  );
  return (
    telemetry.totalOrders > 0 ||
    telemetry.replays.total > 0 ||
    telemetry.replays.scheduled > 0 ||
    telemetry.guardrails.evaluated > 0 ||
    hasOverrides ||
    hasGuardrailHits
  );
}

function renderComplianceSection(doc: PDFKit.PDFDocument, payload: OrderReceiptPayload) {
  doc.moveDown().fontSize(14).text("Compliance & acknowledgements", { underline: true });
  doc.fontSize(12).font("Helvetica");
  const archiveReference = payload.receiptStorageKey ?? "Pending archival";
  doc.text(`Archive reference: ${archiveReference}`);
  if (payload.receiptStorageUploadedAt) {
    doc.text(`Archived at: ${dateFormatter.format(new Date(payload.receiptStorageUploadedAt))}`);
  } else {
    doc.text("Archive upload scheduled per compliance retention policy.");
  }
  doc.text("SMPLAT retains verified receipts + proof for at least 10 years per GoBD controls.");
  doc.moveDown(0.4);
  doc.text("Authorized SMPLAT representative: ______________________________");
  doc.text("Client acknowledgement: ______________________________________");
  doc.text(`Signed on: ${dateFormatter.format(new Date(payload.updatedAt))}`);
}

type ItemExperiment = {
  slug: string;
  name: string | null;
  variantName: string;
  trackLabel: "Control" | "Challenger";
  assignmentStrategy: string | null;
  status: string | null;
  featureFlagKey: string | null;
};

function extractItemPricingExperiment(
  attributes: Record<string, unknown> | null | undefined,
): ItemExperiment | null {
  if (!isRecord(attributes)) {
    return null;
  }
  const payload =
    (attributes as Record<string, unknown>).pricingExperiment ??
    (attributes as Record<string, unknown>).pricing_experiment;
  if (!isRecord(payload)) {
    return null;
  }
  const slug = typeof payload.slug === "string" ? payload.slug : null;
  const variantKey = typeof payload.variantKey === "string" ? payload.variantKey : null;
  if (!slug || !variantKey) {
    return null;
  }
  const variantName =
    typeof payload.variantName === "string"
      ? payload.variantName
      : typeof payload.variant_key === "string"
        ? payload.variant_key
        : variantKey;
  const assignmentStrategy =
    typeof payload.assignmentStrategy === "string"
      ? payload.assignmentStrategy
      : typeof payload.assignment_strategy === "string"
        ? payload.assignment_strategy
        : null;
  const isControl =
    typeof payload.isControl === "boolean"
      ? payload.isControl
      : typeof payload.is_control === "boolean"
        ? payload.is_control
        : false;
  const status = typeof payload.status === "string" ? payload.status : null;
  const featureFlagKey =
    typeof payload.featureFlagKey === "string"
      ? payload.featureFlagKey
      : typeof payload.feature_flag_key === "string"
        ? payload.feature_flag_key
        : null;
  const name = typeof payload.name === "string" ? payload.name : null;
  return {
    slug,
    name,
    variantName,
    trackLabel: isControl ? "Control" : "Challenger",
    assignmentStrategy,
    status,
    featureFlagKey,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type DeliveryProofSnapshotPayload = NonNullable<DeliveryProofInsight["proof"]>["baseline"];

function extractFollowerSnapshot(snapshot: DeliveryProofSnapshotPayload | null | undefined): number | null {
  if (!snapshot) {
    return null;
  }
  const value = snapshot.metrics?.followerCount;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
