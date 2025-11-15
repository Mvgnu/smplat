import type { SelectField } from "payload";

export const environmentField = (): SelectField => ({
  name: "environment",
  type: "select",
  label: "Environment",
  defaultValue: "development",
  admin: {
    position: "sidebar"
  },
  options: [
    { label: "Development", value: "development" },
    { label: "Test", value: "test" },
    { label: "Production", value: "production" }
  ],
  required: true
});
