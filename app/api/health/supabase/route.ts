import { NextResponse } from "next/server";
import { getSupabaseServerInfo, supabaseServer } from "@/lib/supabase-server";

export async function GET() {
  const info = getSupabaseServerInfo();

  try {
    const { error } = await supabaseServer.from("polls").select("id").limit(1);
    return NextResponse.json({
      ok: !error,
      info,
      error: error?.message ?? null,
    });
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
