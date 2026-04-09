import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

type Context = { params: Promise<{ id: string }> };

export async function GET(_: Request, context: Context) {
  try {
    const { id } = await context.params;

    const { data, error } = await supabaseServer
      .from("official_statistics")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `official statistic GET failed: ${message}` }, { status: 500 });
  }
}
