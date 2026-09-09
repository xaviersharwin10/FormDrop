import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Silences a workspace-root warning caused by an unrelated lockfile
  // elsewhere in the home directory — this repo's root is unambiguous.
  outputFileTracingRoot: path.join(__dirname, "../.."),
};

export default nextConfig;
