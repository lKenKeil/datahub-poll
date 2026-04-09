import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { PollCategory } from "@/lib/types";

const validCategories = new Set<PollCategory>(["학술/통계", "IT/테크", "사회/경제", "라이프스타일", "커뮤니티"]);

export async function GET() {
  try {
    const { data, error } = await supabaseServer
      .from("polls")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data: data ?? [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `polls GET failed: ${message}` }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const raw = (await request.json()) as Record<string, unknown>;

    const rawTitle = String(raw.title ?? "").trim();
    const rawCategory = String(raw.category ?? "").trim() as PollCategory;
    const rawOptions = Array.isArray(raw.options) ? raw.options.map((value) => String(value).trim()) : [];

    if (!rawTitle || rawTitle.length < 3) {
      return NextResponse.json({ error: "title is required (min 3 chars)." }, { status: 400 });
    }

    if (!validCategories.has(rawCategory)) {
      return NextResponse.json({ error: "invalid category." }, { status: 400 });
    }

    if (rawOptions.length < 2 || rawOptions.length > 6 || rawOptions.some((opt) => !opt)) {
      return NextResponse.json({ error: "options must be 2-6 non-empty values." }, { status: 400 });
    }

    const uniqueOptions = new Set(rawOptions.map((option) => option.toLowerCase()));
    if (uniqueOptions.size !== rawOptions.length) {
      return NextResponse.json({ error: "options must be unique." }, { status: 400 });
    }

    const votes =
      Array.isArray(raw.votes) &&
      raw.votes.length === rawOptions.length &&
      raw.votes.every((value) => Number.isInteger(value) && Number(value) >= 0)
        ? (raw.votes as number[])
        : Array(rawOptions.length).fill(0);

    const participants = Number.isInteger(raw.participants) && Number(raw.participants) >= 0 ? Number(raw.participants) : 0;
    const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : `custom_${Date.now()}`;

    const insertPayload: Record<string, unknown> = {
      id,
      title: rawTitle,
      category: rawCategory,
      options: rawOptions,
      votes,
      participants,
    };

    if (typeof raw.official_fact === "string" && raw.official_fact.trim()) {
      insertPayload.official_fact = raw.official_fact.trim();
    }

    let { error } = await supabaseServer.from("polls").insert(insertPayload);

    // Backward-compatible path for DBs where `official_fact` column has not been migrated yet.
    if (error?.message?.includes("official_fact")) {
      delete insertPayload.official_fact;
      const retry = await supabaseServer.from("polls").insert(insertPayload);
      error = retry.error;
    }

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, data: { id } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `polls POST failed: ${message}` }, { status: 500 });
  }
}
