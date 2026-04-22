import { Suspense } from "react";

import { AsyncFilterBar } from "@/components/layout/AsyncFilterBar";
import { GlobalFilterBar } from "@/components/layout/GlobalFilterBar";
import { CampaignAdvisorClient } from "@/components/pages/CampaignAdvisorClient";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default function Page() {
  return (
    <CampaignAdvisorClient
      filterBar={
        <Suspense fallback={<GlobalFilterBar />}>
          <AsyncFilterBar />
        </Suspense>
      }
    />
  );
}
