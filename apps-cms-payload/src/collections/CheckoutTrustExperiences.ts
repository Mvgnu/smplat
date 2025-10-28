import type { CollectionConfig } from "payload";

import { canWrite } from "@/access/canWrite";
import { environmentField } from "@/fields/environment";
import { createRevalidateHooks } from "@/hooks/revalidate";

const trustRevalidateHooks = createRevalidateHooks("checkout-trust-experiences");

const metricOptions = [
  {
    label: "Fulfillment SLA on-time %",
    value: "fulfillment_sla_on_time_pct",
  },
  {
    label: "First response minutes",
    value: "first_response_minutes",
  },
  {
    label: "NPS trailing 30 days",
    value: "nps_trailing_30d",
  },
];

const metricSourceOptions = [
  { label: "Fulfillment", value: "fulfillment" },
  { label: "Operator staffing", value: "operator_staffing" },
  { label: "Support analytics", value: "support_analytics" },
];

const metricPreviewStateOptions = [
  { label: "Fresh", value: "fresh" },
  { label: "Stale", value: "stale" },
  { label: "Missing", value: "missing" },
];

const metricReferenceFields = [
  {
    name: "metricId",
    type: "select",
    label: "Metric",
    options: metricOptions,
    admin: {
      description: "Maps this module to a backend metric identifier.",
    },
  },
  {
    name: "metricSource",
    type: "select",
    label: "Metric source",
    options: metricSourceOptions,
    admin: {
      description: "Signals where the metric originates for provenance badges.",
    },
  },
  {
    name: "freshnessWindowMinutes",
    type: "number",
    label: "Freshness window (minutes)",
    admin: {
      description: "Maximum allowable staleness before the module shows a warning.",
    },
  },
  {
    name: "previewState",
    type: "select",
    label: "Preview state",
    options: metricPreviewStateOptions,
    admin: {
      description: "Operator console preview override for draft content.",
    },
  },
  {
    name: "provenanceNote",
    type: "textarea",
    label: "Provenance note",
    admin: {
      description: "Optional context describing how this metric is produced.",
    },
  },
];

export const CheckoutTrustExperiences: CollectionConfig = {
  slug: "checkout-trust-experiences",
  admin: {
    useAsTitle: "name",
    defaultColumns: ["slug", "environment", "updatedAt"],
  },
  access: {
    read: () => true,
    create: canWrite,
    update: canWrite,
    delete: canWrite,
  },
  hooks: {
    afterChange: [trustRevalidateHooks.afterChange],
    afterDelete: [trustRevalidateHooks.afterDelete],
  },
  fields: [
    {
      name: "name",
      type: "text",
      required: true,
    },
    {
      name: "slug",
      type: "text",
      required: true,
      unique: true,
    },
    {
      type: "row",
      fields: [
        {
          name: "guaranteeHeadline",
          type: "text",
          label: "Guarantee headline",
        },
        {
          name: "guaranteeDescription",
          type: "textarea",
          label: "Guarantee description",
        },
      ],
    },
    {
      name: "assurancePoints",
      type: "array",
      label: "Assurance points",
      fields: [
        {
          name: "id",
          type: "text",
          label: "Stable ID",
        },
        {
          name: "title",
          type: "text",
          required: true,
        },
        {
          name: "description",
          type: "textarea",
        },
        {
          name: "evidence",
          type: "textarea",
        },
        {
          name: "metric",
          type: "group",
          fields: metricReferenceFields,
        },
      ],
    },
    {
      name: "supportChannels",
      type: "array",
      label: "Support channels",
      fields: [
        {
          name: "id",
          type: "text",
        },
        {
          name: "channel",
          type: "text",
          required: true,
        },
        {
          name: "label",
          type: "text",
          required: true,
        },
        {
          name: "target",
          type: "text",
          required: true,
        },
        {
          name: "availability",
          type: "text",
        },
      ],
    },
    {
      name: "performanceSnapshots",
      type: "array",
      label: "Performance snapshots",
      fields: [
        {
          name: "id",
          type: "text",
        },
        {
          name: "label",
          type: "text",
          required: true,
        },
        {
          name: "caption",
          type: "textarea",
        },
        {
          name: "fallbackValue",
          type: "text",
          label: "Fallback value",
          admin: {
            description: "Value displayed when live metric data is unavailable.",
          },
        },
        {
          name: "metric",
          type: "group",
          fields: metricReferenceFields,
        },
      ],
    },
    {
      name: "testimonials",
      type: "array",
      label: "Testimonials",
      fields: [
        {
          name: "id",
          type: "text",
        },
        {
          name: "quote",
          type: "textarea",
          required: true,
        },
        {
          name: "author",
          type: "text",
        },
        {
          name: "role",
          type: "text",
        },
        {
          name: "segment",
          type: "text",
          admin: {
            description: "Optional audience segment tag used for personalization.",
          },
        },
      ],
    },
    {
      name: "bundleOffers",
      type: "array",
      label: "Bundle offers",
      fields: [
        {
          name: "id",
          type: "text",
        },
        {
          name: "slug",
          type: "text",
          required: true,
        },
        {
          name: "title",
          type: "text",
          required: true,
        },
        {
          name: "description",
          type: "textarea",
        },
        {
          name: "savings",
          type: "text",
        },
      ],
    },
    environmentField(),
  ],
};

