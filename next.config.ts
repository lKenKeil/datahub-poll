import type { NextConfig } from "next";

function getPollImageRemotePatterns() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!supabaseUrl) return [];

  try {
    return [new URL("/storage/v1/object/public/poll-option-images/**", supabaseUrl)];
  } catch {
    return [];
  }
}

const nextConfig: NextConfig = {
  allowedDevOrigins: ["125.185.9.211"],
  images: {
    remotePatterns: getPollImageRemotePatterns(),
  },
};

export default nextConfig;
