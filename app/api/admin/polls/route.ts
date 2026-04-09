import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { isAdminAuthorized } from "@/lib/admin-auth";

export async function GET(request: Request) {
  const auth = isAdminAuthorized(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 });
  }

  const { data, error } = await supabaseServer
    .from("polls")
    .select("id,title,category,options,votes,participants,official_fact,created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: data ?? [] });
}
