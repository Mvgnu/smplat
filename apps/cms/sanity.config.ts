import { defineConfig } from "sanity";
import { deskTool } from "sanity/desk";
import { visionTool } from "@sanity/vision";

import { schemaTypes } from "./schemas";

const projectId = process.env.SANITY_PROJECT_ID || "smplat";
const dataset = process.env.SANITY_DATASET || (process.env.NODE_ENV === "production" ? "production" : "development");

export default defineConfig({
  name: "smplat-cms",
  title: "SMPLAT CMS",
  projectId,
  dataset,
  plugins: [deskTool(), visionTool()],
  schema: {
    types: schemaTypes
  }
});
