import { GlobalFilterBar } from "@/components/layout/GlobalFilterBar";
import { computeFilterOptions } from "@/lib/data/filters";
import { loadInsights } from "@/lib/supabase/queries";

export async function AsyncFilterBar() {
  const rows = await loadInsights(process.env.NEXT_PUBLIC_PROMPT_VERSION ?? "v3.2");
  // Compute options server-side so the client never receives the 50 MB rows array.
  const options = computeFilterOptions(rows);
  return <GlobalFilterBar options={options} />;
}
