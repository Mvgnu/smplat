// meta: module: remediation-knowledge-base
// meta: feature: marketing-preview-diagnostics

export type RemediationCategory = "schema" | "content-gap" | "fallback" | "lexical";

export type RemediationStep = {
  title: string;
  description: string;
  payloadPath?: string;
  fixtureSource?: string;
};

export type RemediationPlaybook = {
  id: string;
  category: RemediationCategory;
  summary: string;
  steps: RemediationStep[];
};

type CategoryIndex = Record<RemediationCategory, RemediationPlaybook[]>;

const catalog: CategoryIndex = {
  schema: [
    {
      id: "schema-validate-fields",
      category: "schema",
      summary: "Resolve schema validation blockers",
      steps: [
        {
          title: "Inspect Payload fields",
          description:
            "Open the document in Payload admin and review each field referenced in the validation error.",
          payloadPath: "/admin/collections/pages/{docId}"
        },
        {
          title: "Confirm relationship data",
          description:
            "If the schema references relationships, ensure the related entries exist and expose the expected fields.",
          fixtureSource: "payload-fixtures/pages.json"
        }
      ]
    }
  ],
  "content-gap": [
    {
      id: "content-gap-fill",
      category: "content-gap",
      summary: "Fill missing marketing content",
      steps: [
        {
          title: "Audit content gaps",
          description:
            "Compare the draft markup to the published snapshot to identify missing headlines, copy, or media elements." 
        },
        {
          title: "Populate Payload content",
          description:
            "Update the Payload block with the missing values, using fallback copy from fixtures only as a short-term patch.",
          payloadPath: "/admin/collections/pages/{docId}?tab=content"
        }
      ]
    }
  ],
  fallback: [
    {
      id: "fallback-governance",
      category: "fallback",
      summary: "Tune fallback governance ordering",
      steps: [
        {
          title: "Review fixture provenance",
          description:
            "Inspect fixture data powering this block to confirm fallback content is up to date.",
          fixtureSource: "apps/web/src/server/cms/__fixtures__/marketing-fallbacks.json"
        },
        {
          title: "Adjust fallback priority",
          description:
            "Use the cockpit governance controls to reprioritize or reset fallbacks before promoting the Payload content."
        }
      ]
    }
  ],
  lexical: [
    {
      id: "lexical-normalization",
      category: "lexical",
      summary: "Recover from Lexical normalization issues",
      steps: [
        {
          title: "Replay Lexical content",
          description:
            "Copy the Lexical JSON from Payload and replay it in the preview fixture to reproduce the normalization warning.",
          fixtureSource: "apps/web/src/server/cms/__fixtures__/payload-lexical-marketing.json"
        },
        {
          title: "Sanitize unsupported nodes",
          description:
            "Remove unsupported nodes or update the normalizer to handle them, then re-trigger the live preview stream."
        }
      ]
    }
  ]
};

export const REMEDIATION_PLAYBOOKS: RemediationPlaybook[] = Object.values(catalog).flat();

export const REMEDIATION_INDEX: CategoryIndex = catalog;

export const getPlaybooksByCategory = (category: RemediationCategory): RemediationPlaybook[] => {
  return catalog[category] ?? [];
};
