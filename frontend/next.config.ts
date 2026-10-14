import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  agentRules: false,
  logging: { incomingRequests: { ignore: [/\/api\/oauth\/[^/]+\/callback/] } },
};

export default nextConfig;


