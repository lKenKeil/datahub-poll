import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase-server";
import { OfficialStatistic } from "@/lib/types";

type Params = { id: string };

function readMetadataNumber(item: OfficialStatistic, key: string) {
  const value = (item.metadata as Record<string, unknown> | null | undefined)?.[key];
  return typeof value === "number" ? value : null;
}

function readMetadataString(item: OfficialStatistic, key: string) {
  const value = (item.metadata as Record<string, unknown> | null | undefined)?.[key];
  return typeof value === "string" ? value : null;
}

function formatValue(item: OfficialStatistic, value: number) {
  const indicator = readMetadataString(item, "indicator_id");
  if (indicator === "SP.POP.TOTL") return `${Math.round(value).toLocaleString()} 명`;
  if (indicator === "IT.NET.USER.ZS" || indicator === "SL.UEM.1524.ZS") return `${value.toFixed(2)}%`;
  if (indicator === "IT.CEL.SETS.P2" || indicator === "IT.NET.BBND.P2") return `${value.toFixed(2)} / 100명`;
  return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2);
}

export default async function OfficialStatisticPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;

  const { data, error } = await supabaseServer
    .from("official_statistics")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    notFound();
  }

  const item = data as OfficialStatistic;
  const latestValue = readMetadataNumber(item, "latest_value");
  const latestYear = readMetadataString(item, "latest_year");

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 dark:bg-[#020617] dark:text-slate-200 pb-20">
      <div className="max-w-4xl mx-auto px-6 pt-10 space-y-8">
        <Link
          href="/"
          className="inline-flex items-center rounded-full border border-slate-300 dark:border-white/15 px-4 py-2 text-sm font-bold hover:border-blue-500/50"
        >
          ← 돌아가기
        </Link>

        <section className="rounded-3xl border border-cyan-500/25 bg-white dark:bg-white/[0.03] p-8 space-y-5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] px-2 py-1 rounded-full bg-cyan-500/15 text-cyan-400 font-black uppercase">
              {item.category}
            </span>
            <span className="text-xs text-slate-500">
              {item.published_at ?? item.observed_at ?? "date n/a"}
            </span>
          </div>

          <h1 className="text-3xl md:text-4xl font-black leading-tight">{item.title}</h1>

          {item.summary ? (
            <p className="text-base leading-relaxed text-slate-700 dark:text-slate-300">{item.summary}</p>
          ) : null}

          {latestValue !== null ? (
            <div className="rounded-2xl border border-cyan-500/25 bg-cyan-500/10 px-5 py-4 inline-flex items-end gap-3">
              <span className="text-3xl font-black text-cyan-600 dark:text-cyan-300">
                {formatValue(item, latestValue)}
              </span>
              <span className="text-sm text-cyan-700/80 dark:text-cyan-100/80">
                {latestYear ? `${latestYear} 기준` : ""}
              </span>
            </div>
          ) : null}
        </section>

        <section className="rounded-3xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-8 space-y-4">
          <h2 className="text-lg font-black">통계 설명</h2>
          {item.methodology ? <p className="text-sm text-slate-700 dark:text-slate-300"><span className="font-black">방법론:</span> {item.methodology}</p> : null}
          {item.sample_size ? <p className="text-sm text-slate-700 dark:text-slate-300"><span className="font-black">표본수:</span> {item.sample_size.toLocaleString()}</p> : null}
          {item.confidence_note ? <p className="text-sm text-slate-700 dark:text-slate-300"><span className="font-black">신뢰 참고:</span> {item.confidence_note}</p> : null}
          <a
            href={item.source_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex rounded-full bg-cyan-600 text-white px-4 py-2 text-sm font-black hover:bg-cyan-500"
          >
            원문 출처 이동
          </a>
          {(item.tags ?? []).length > 0 ? (
            <div className="flex flex-wrap gap-2 pt-2">
              {(item.tags ?? []).map((tag) => (
                <span key={`${item.id}_${tag}`} className="text-xs px-2 py-1 rounded-full bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300">
                  #{tag}
                </span>
              ))}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
