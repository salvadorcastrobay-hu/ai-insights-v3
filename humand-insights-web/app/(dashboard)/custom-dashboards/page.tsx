import { CustomDashboardsClient } from "@/components/pages/CustomDashboardsClient";
import { loadInsights } from "@/lib/supabase/queries";

export default async function Page() {
  const rows = await loadInsights(process.env.NEXT_PUBLIC_PROMPT_VERSION ?? "v3.0");
  return <CustomDashboardsClient rows={rows} />;
}
