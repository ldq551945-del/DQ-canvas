import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  output: "standalone",
  reactStrictMode: true,
  async rewrites() {
    return {
      beforeFiles: [{ source: "/favicon.ico", destination: "/api/site-icon" }],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default withMDX(config);
