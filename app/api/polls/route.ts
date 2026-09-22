import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
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
    let raw: Record<string, unknown>;
    try {
      raw = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "invalid JSON body." }, { status: 400 });
    }

    const rawTitle = typeof raw?.title === "string" ? raw.title.trim() : "";
    const rawCategory = (typeof raw?.category === "string" ? raw.category.trim() : "") as PollCategory;
    const rawOptions = Array.isArray(raw?.options) && raw.options.every((value) => typeof value === "string")
      ? raw.options.map((value) => value.trim())
      : [];

    if (rawTitle.length < 3 || rawTitle.length > 120) {
      return NextResponse.json({ error: "title must be 3-120 chars." }, { status: 400 });
    }

    if (!validCategories.has(rawCategory)) {
      return NextResponse.json({ error: "invalid category." }, { status: 400 });
    }

    if (rawOptions.length < 2 || rawOptions.length > 6 || rawOptions.some((opt) => !opt || opt.length > 50)) {
      return NextResponse.json({ error: "options must be 2-6 values of 1-50 chars." }, { status: 400 });
    }

    const uniqueOptions = new Set(rawOptions.map((option) => option.toLowerCase()));
    if (uniqueOptions.size !== rawOptions.length) {
      return NextResponse.json({ error: "options must be unique." }, { status: 400 });
    }

    if (raw.official_fact !== undefined && typeof raw.official_fact !== "string") {
      return NextResponse.json({ error: "official_fact must be a string." }, { status: 400 });
    }

    const officialFact = typeof raw.official_fact === "string" ? raw.official_fact.trim() : "";
    if (officialFact.length > 300) {
      return NextResponse.json({ error: "official_fact must be at most 300 chars." }, { status: 400 });
    }

    const id = `custom_${randomUUID()}`;

    const insertPayload: Record<string, unknown> = {
      id,
      title: rawTitle,
      category: rawCategory,
      options: rawOptions,
      votes: Array(rawOptions.length).fill(0),
      participants: 0,
    };

    if (officialFact) {
      insertPayload.official_fact = officialFact;
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
