import { Suspense } from "react";

import { AsyncFilterBar } from "@/components/layout/AsyncFilterBar";
import { GlobalFilterBar } from "@/components/layout/GlobalFilterBar";
import { SqlChatClient } from "@/components/pages/SqlChatClient";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default function Page() {
  return (
    <SqlChatClient
      filterBar={
        <Suspense fallback={<GlobalFilterBar />}>
          <AsyncFilterBar />
        </Suspense>
      }
    />
  );
}
