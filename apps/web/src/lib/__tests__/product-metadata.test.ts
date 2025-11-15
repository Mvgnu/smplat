import {
  normalizeCustomFieldMetadata,
  normalizeOptionMetadata,
  normalizeServiceOverrideRules,
  serializeAddOnMetadata,
  serializeCustomFieldMetadata,
  serializeOptionMetadata,
} from "../product-metadata";
import { getAddOnPricingInfo } from "../product-pricing";

describe("product-metadata custom field helpers", () => {
  it("normalizes validation rules, default value, passthrough, and conditional visibility", () => {
    const metadata = normalizeCustomFieldMetadata({
      validation: {
        minLength: "2",
        maxLength: "128",
        minValue: "5",
        maxValue: "10",
        pattern: "^https://",
        disallowWhitespace: "true",
      },
      defaultValue: "https://example.com",
      passthrough: {
        checkout: false,
        fulfillment: true,
      },
      conditionalVisibility: {
        mode: "any",
        conditions: [
          { kind: "option", optionKey: "opt-1", groupKey: "grp-1" },
          { kind: "addOn", addOnId: "addon-2" },
          { kind: "channel", channel: "storefront" },
        ],
      },
    });

    expect(metadata.validation).toEqual({
      minLength: 2,
      maxLength: 128,
      minValue: 5,
      maxValue: 10,
      pattern: "^https://",
      disallowWhitespace: true,
    });
    expect(metadata.defaultValue).toBe("https://example.com");
    expect(metadata.passthrough).toEqual({ checkout: false, fulfillment: true });
    expect(metadata.conditionalVisibility).toEqual({
      mode: "any",
      conditions: [
        { kind: "option", optionKey: "opt-1", groupKey: "grp-1" },
        { kind: "addOn", addOnId: "addon-2" },
        { kind: "channel", channel: "storefront" },
      ],
    });
  });

  it("serializes metadata while preserving editorKey and structured attributes", () => {
    const payload = serializeCustomFieldMetadata({
      editorKey: "field-123",
      validation: {
        minLength: 3,
        minValue: 1,
      },
      defaultValue: "7",
      passthrough: {
        checkout: true,
        fulfillment: false,
      },
      conditionalVisibility: {
        mode: "all",
        conditions: [{ kind: "channel", channel: "dashboard" }],
      },
    });

    expect(payload).toMatchObject({
      editorKey: "field-123",
      validation: {
        minLength: 3,
        minValue: 1,
      },
      defaultValue: "7",
    });
    expect(payload.passthrough).toEqual({
      checkout: true,
      fulfillment: false,
    });
    expect(payload.conditionalVisibility).toEqual({
      mode: "all",
      conditions: [{ kind: "channel", channel: "dashboard" }],
    });
  });
});

describe("product-metadata option helpers", () => {
  it("normalizes blueprint fields and legacy keys", () => {
    const metadata = normalizeOptionMetadata({
      marketing_tagline: "  100 followers in a week ",
      fulfillment_sla: "48h turnaround",
      hero_image_url: "https://cdn.example.com/hero.png",
      calculator: {
        expression: "amount / days",
        sample_amount: "200",
        sample_days: "10",
      },
    });

    expect(metadata.marketingTagline).toBe("100 followers in a week");
    expect(metadata.fulfillmentSla).toBe("48h turnaround");
    expect(metadata.heroImageUrl).toBe("https://cdn.example.com/hero.png");
    expect(metadata.calculator).toEqual({
      expression: "amount / days",
      sampleAmount: 200,
      sampleDays: 10,
    });
  });

  it("serializes blueprint metadata with calculator samples", () => {
    const payload = serializeOptionMetadata({
      editorKey: "opt-123",
      marketingTagline: "Boosted reach",
      fulfillmentSla: "72h",
      heroImageUrl: "https://cdn.example.com/hero.jpg",
      calculator: {
        expression: "amount * 1.5",
        sampleAmount: 50,
        sampleDays: 5,
      },
    });

    expect(payload).toMatchObject({
      editorKey: "opt-123",
      marketingTagline: "Boosted reach",
      fulfillmentSla: "72h",
      heroImageUrl: "https://cdn.example.com/hero.jpg",
      calculator: {
        expression: "amount * 1.5",
        sampleAmount: 50,
        sampleDays: 5,
      },
    });
  });
});

describe("product-metadata service override helpers", () => {
  it("normalizes service override rules with mixed condition payloads", () => {
    const rules = normalizeServiceOverrideRules([
      {
        id: "",
        label: " High value ",
        description: "  Large orders ",
        priority: "5",
        conditions: [
          { kind: "channel", channels: ["storefront", "admin ", ""] },
          { type: "geo", values: ["US-EAST", ""] },
          { kind: "amount", min: "100", maxAmount: "250" },
          { kind: "drip", minDrip: "1", maxPerDay: "3" },
          { kind: "option", optionKey: "opt-a" },
          { kind: "unknown" }
        ],
        overrides: {
          serviceId: " svc-1 ",
          providerId: " vendor-9 ",
          costAmount: "199.5",
          costCurrency: " usd ",
          marginTarget: "0.2",
          fulfillmentMode: "scheduled",
          dripPerDay: "2",
          payloadTemplate: { foo: "bar" }
        }
      },
      { id: "skip", conditions: [{ kind: "unknown" }] }
    ]);

    expect(rules).toHaveLength(1);
    expect(rules?.[0]).toMatchObject({
      id: "rule-1",
      label: "High value",
      description: "Large orders",
      priority: 5,
      conditions: [
        { kind: "channel", channels: ["storefront", "admin"] },
        { kind: "geo", regions: ["US-EAST"] },
        { kind: "amount", min: 100, max: 250 },
        { kind: "drip", min: 1, max: 3 },
        { kind: "option", optionKey: "opt-a", optionId: undefined }
      ],
      overrides: {
        serviceId: "svc-1",
        providerId: "vendor-9",
        costAmount: 199.5,
        costCurrency: "USD",
        marginTarget: 0.2,
        fulfillmentMode: "scheduled",
        dripPerDay: 2,
        payloadTemplate: { foo: "bar" }
      }
    });
  });

  it("serializes add-on metadata and embedded service override rules", () => {
    const payload = serializeAddOnMetadata({
      editorKey: "addon-123",
      pricing: {
        mode: "serviceOverride",
        serviceId: "svc-abc",
        rules: [
          {
            id: "rule-1",
            label: "Storefront surge",
            description: "Apply vendor override for storefront rush orders",
            priority: 2,
            conditions: [
              { kind: "channel", channels: ["storefront"] },
              { kind: "amount", min: 50, max: 200 }
            ],
            overrides: {
              providerId: "vendor-123",
              costAmount: 75
            }
          }
        ]
      }
    });

    expect(payload).toMatchObject({
      editorKey: "addon-123",
      pricing: {
        mode: "serviceOverride",
        serviceId: "svc-abc",
        rules: [
          {
            id: "rule-1",
            label: "Storefront surge",
            description: "Apply vendor override for storefront rush orders",
            priority: 2,
            conditions: [
              { kind: "channel", channels: ["storefront"] },
              { kind: "amount", min: 50, max: 200 }
            ],
            overrides: { providerId: "vendor-123", costAmount: 75 }
          }
        ]
      }
    });
  });

  it("serializes service override extras including preview quantity and payload template", () => {
    const payload = serializeAddOnMetadata({
      pricing: {
        mode: "serviceOverride",
        serviceId: "svc-extra",
        providerId: "vendor-42",
        costAmount: 48.75,
        costCurrency: "usd",
        marginTarget: 0.18,
        fulfillmentMode: "scheduled",
        payloadTemplate: { amount: "{{quantity}}", geo: "EU" },
        dripPerDay: 12,
        previewQuantity: 150,
      },
    });

    expect(payload.pricing).toMatchObject({
      mode: "serviceOverride",
      serviceId: "svc-extra",
      providerId: "vendor-42",
      costAmount: 48.75,
      costCurrency: "usd",
      marginTarget: 0.18,
      fulfillmentMode: "scheduled",
      payloadTemplate: { amount: "{{quantity}}", geo: "EU" },
      dripPerDay: 12,
      previewQuantity: 150,
    });
  });
});

describe("product-metadata pricing info", () => {
  it("prefers snapshot pricing information when available", () => {
    const info = getAddOnPricingInfo(
      {
        pricing: {
          mode: "serviceOverride",
          serviceId: "svc-meta",
          rules: []
        }
      },
      {
        mode: "serviceOverride",
        serviceId: "svc-snapshot",
        amount: 120,
        percentageMultiplier: 1.2,
        providerCostAmount: 80,
        providerCostCurrency: "usd",
        marginTarget: 0.3,
        fulfillmentMode: "refill",
        dripPerDay: 5,
        serviceProviderId: "vendor-7",
        serviceProviderName: "Vendor 7",
        serviceAction: "launch",
        serviceDescriptor: { region: "us" },
        payloadTemplate: { foo: "bar" },
        serviceRules: [
          {
            id: "rule-snapshot",
            conditions: [{ kind: "channel", channels: ["storefront"] }],
            overrides: { providerId: "vendor-override" }
          }
        ]
      }
    );

    expect(info).toEqual(
      expect.objectContaining({
        mode: "serviceOverride",
        amount: 120,
        percentageMultiplier: 1.2,
        providerCostAmount: 80,
        providerCostCurrency: "usd",
        marginTarget: 0.3,
        fulfillmentMode: "refill",
        dripPerDay: 5,
        serviceProviderId: "vendor-7",
        serviceProviderName: "Vendor 7",
        serviceAction: "launch",
        serviceDescriptor: { region: "us" },
        payloadTemplate: { foo: "bar" },
        serviceRules: [
          {
            id: "rule-snapshot",
            conditions: [{ kind: "channel", channels: ["storefront"] }],
            overrides: { providerId: "vendor-override" }
          }
        ]
      })
    );
  });

  it("derives pricing info from metadata when snapshot is absent", () => {
    const info = getAddOnPricingInfo({
      pricing: {
        mode: "serviceOverride",
        serviceId: "svc-meta-only",
        rules: [
          {
            id: "rule-1",
            conditions: [{ kind: "channel", channels: ["storefront"] }],
            overrides: { providerId: "vendor-x" }
          }
        ]
      }
    });

    expect(info).toMatchObject({
      mode: "serviceOverride",
      amount: null,
      serviceId: "svc-meta-only",
      serviceRules: [
        {
          id: "rule-1",
          conditions: [{ kind: "channel", channels: ["storefront"] }],
          overrides: { providerId: "vendor-x" }
        }
      ]
    });
  });

  it("surfaces preview quantity hints from metadata", () => {
    const info = getAddOnPricingInfo({
      pricing: {
        mode: "serviceOverride",
        serviceId: "svc-preview",
        previewQuantity: 275,
      },
    });

    expect(info.previewQuantity).toBe(275);
  });
});
