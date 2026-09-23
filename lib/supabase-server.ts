import "server-only";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

if (!supabaseUrl || !anonKey) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.");
}

const supabaseUrlSafe = supabaseUrl;
const anonKeySafe = anonKey;
const clientOptions = {
  auth: { persistSession: false, autoRefreshToken: false },
};

// Public reads use the same least-privileged anon role as the browser.
export const supabaseServer = createClient(supabaseUrlSafe, anonKeySafe, clientOptions);

let mutationClient: typeof supabaseServer | null = null;

export function getSupabaseMutationClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey || serviceRoleKey === anonKeySafe) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY; server mutations are disabled.");
  }

  mutationClient ??= createClient(supabaseUrlSafe, serviceRoleKey, clientOptions);
  return mutationClient;
}

export function getSupabaseServerInfo() {
  const key = anonKeySafe;
  return {
    urlHost: (() => {
      try {
        return new URL(supabaseUrlSafe).host;
      } catch {
        return "invalid-url";
      }
    })(),
    keyType: key.startsWith("sb_publishable_")
        ? "sb_publishable"
        : "jwt_legacy_or_unknown",
    keyLength: key.length,
    mutationKeyConfigured: (() => {
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
      return Boolean(serviceRoleKey && serviceRoleKey !== anonKeySafe);
    })(),
  };
}
