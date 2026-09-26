import { NextResponse } from "next/server";
import { getSupabaseMutationClient } from "@/lib/supabase-server";
import { isAdminAuthorized } from "@/lib/admin-auth";
import { deletePollWithImageCleanup } from "@/lib/poll-deletion";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const auth = isAdminAuthorized(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 });
  }

  const supabaseMutation = getSupabaseMutationClient();

  const { id } = await context.params;
  const body = (await request.json()) as Record<string, unknown>;

  const patch: Record<string, unknown> = {};

  if (typeof body.title === "string" && body.title.trim()) {
    patch.title = body.title.trim();
  }
  if (typeof body.category === "string" && body.category.trim()) {
    patch.category = body.category.trim();
  }
  if (Array.isArray(body.options)) {
    const options = body.options.map((v) => String(v).trim()).filter(Boolean);
    if (options.length >= 2) {
      patch.options = options;
      // Keep vote array length aligned with options.
      patch.votes = options.map((_, idx) => {
        const prev = Array.isArray(body.votes) ? Number(body.votes[idx]) : 0;
        return Number.isFinite(prev) && prev >= 0 ? Math.round(prev) : 0;
      });
      patch.participants = (patch.votes as number[]).reduce((acc, n) => acc + n, 0);
    }
  }
  if (typeof body.official_fact === "string") {
    patch.official_fact = body.official_fact.trim();
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
  }

  const { data, error } = await supabaseMutation
    .from("polls")
    .update(patch)
    .eq("id", id)
    .select("id,title,category,options,votes,participants,official_fact,created_at")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}

export async function DELETE(request: Request, context: Context) {
  const auth = isAdminAuthorized(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 });
  }

  const supabaseMutation = getSupabaseMutationClient();

  const { id } = await context.params;

  const result = await deletePollWithImageCleanup(supabaseMutation, id);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason === "not_found" ? "Poll not found." : "Poll deletion failed." },
      { status: result.reason === "not_found" ? 404 : 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
