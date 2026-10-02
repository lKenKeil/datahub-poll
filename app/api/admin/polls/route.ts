import { NextResponse } from "next/server";
import { getSupabaseMutationClient } from "@/lib/supabase-server";
import { requireAdminAuthorization } from "@/lib/admin-auth";
import { moderationErrorResponse } from "@/lib/content-report-server";

export async function GET(request: Request) {
  const denied = requireAdminAuthorization(request);
  if (denied) return denied;
  try {
    const { data, error } = await getSupabaseMutationClient()
      .from("polls")
      .select("id,title,category,options,votes,participants,official_fact,created_at,is_hidden,hidden_at")
      .order("created_at", { ascending: false });
    if (error) return moderationErrorResponse(error, "admin-polls-read");
    return NextResponse.json({ data: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return moderationErrorResponse(error, "admin-polls-read-unexpected");
  }
}
