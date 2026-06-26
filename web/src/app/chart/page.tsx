import ChartPageClient from "./ChartPageClient";

export default async function ChartPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { codes: codesParam } = await searchParams;
  const raw = Array.isArray(codesParam) ? codesParam[0] : (codesParam ?? "");
  const codes = [...new Set(
    raw.split(",").map(c => c.trim()).filter(c => c.length > 0)
  )];

  return <ChartPageClient codes={codes} />;
}
