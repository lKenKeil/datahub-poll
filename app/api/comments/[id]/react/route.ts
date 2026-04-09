import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

type Context = { params: Promise<{ id: string }> };

type ReactionBody = {
  userFingerprint: string;
  reaction: "like" | "dislike" | null;
};

export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as ReactionBody;

    if (!body.userFingerprint?.trim()) {
      return NextResponse.json({ error: "userFingerprint is required" }, { status: 400 });
    }

    if (body.reaction === null) {
      const { error } = await supabaseServer
        .from("comment_reactions")
        .delete()
        .eq("comment_id", id)
        .eq("user_fingerprint", body.userFingerprint);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    } else {
      const { error } = await supabaseServer.from("comment_reactions").upsert(
        {
          comment_id: id,
          user_fingerprint: body.userFingerprint,
          reaction: body.reaction,
        },
        { onConflict: "comment_id,user_fingerprint" },
      );

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    const { data: reactions, error: countError } = await supabaseServer
      .from("comment_reactions")
      .select("reaction,user_fingerprint")
      .eq("comment_id", id);

    if (countError) {
      return NextResponse.json({ error: countError.message }, { status: 500 });
    }

    const rows = (reactions ?? []) as Array<{ reaction: "like" | "dislike"; user_fingerprint: string }>;
    const likeCount = rows.filter((row) => row.reaction === "like").length;
    const dislikeCount = rows.filter((row) => row.reaction === "dislike").length;
    const my = rows.find((row) => row.user_fingerprint === body.userFingerprint)?.reaction ?? null;

    return NextResponse.json({ likeCount, dislikeCount, userReaction: my });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `reaction API failed: ${message}` }, { status: 500 });
  }
}
