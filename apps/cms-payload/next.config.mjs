import { withPayload } from "@payloadcms/next/withPayload";

const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb"
    }
  }
};

export default withPayload(nextConfig, {
  configPath: "./src/payload.config.ts",
  generateOnBuild: true
});
