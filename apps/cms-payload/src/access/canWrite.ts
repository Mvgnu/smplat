import type { Access } from "payload";

export const canWrite: Access = ({ req }) => {
  if (req.user) {
    return true;
  }

  const seedKey = process.env.SEED_KEY;
  if (seedKey && req.headers) {
    const header = typeof req.headers.get === "function"
      ? req.headers.get("x-seed-key")
      : ((req.headers as unknown as Record<string, string | string[] | undefined>)["x-seed-key"] ?? undefined);

    if (Array.isArray(header)) {
      return header.includes(seedKey);
    }
    if (typeof header === "string") {
      return header === seedKey;
    }
  }

  return false;
};
