import { NextResponse } from "next/server";
import { getSupabaseServerInfo, supabaseServer } from "@/lib/supabase-server";

export async function GET() {
  const info = getSupabaseServerInfo();

  try {
    const { error } = await supabaseServer.from("polls").select("id").limit(1);
    const configurationError = info.mutationKeyConfigured
      ? null
      : "SUPABASE_SERVICE_ROLE_KEY is not configured; server mutations are disabled.";
    const ok = !error && !configurationError;

    return NextResponse.json({
      ok,
      info,
      error: error?.message ?? configurationError,
    }, { status: ok ? 200 : 503 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        ok: false,
        info,
        error: message,
      },
      { status: 500 },
    );
  }
}
