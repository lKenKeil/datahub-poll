import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

export async function GET() {
  try {
    const { data, error } = await supabaseServer
      .from("official_statistics")
      .select("*")
      .eq("is_verified", true)
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("observed_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(8);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data: data ?? [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `official statistics GET failed: ${message}` }, { status: 500 });
  }
}
