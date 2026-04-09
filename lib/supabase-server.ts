import "server-only";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const serviceRoleKey = (
  process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
);

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing Supabase server env vars.");
}

const supabaseUrlSafe = supabaseUrl;
const serviceRoleKeySafe = serviceRoleKey;

export const supabaseServer = createClient(supabaseUrlSafe, serviceRoleKeySafe, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export function getSupabaseServerInfo() {
  const key = serviceRoleKeySafe;
  return {
    urlHost: (() => {
      try {
        return new URL(supabaseUrlSafe).host;
      } catch {
        return "invalid-url";
      }
    })(),
    keyType: key.startsWith("sb_secret_")
      ? "sb_secret"
      : key.startsWith("sb_publishable_")
        ? "sb_publishable"
        : "jwt_legacy_or_unknown",
    keyLength: key.length,
  };
}
