/**
 * Corre una ingesta de discovery desde la máquina local, con el mismo código
 * del motor. Sirve para cargas a mano (la historia de una cuenta nueva) y para
 * probar el tope sin tocar el motor desplegado.
 *
 *   npx tsx scripts/run-discovery-local.ts --sources=<id,id> --backfill --per-source=100 --max-total=200 [--own-ads]
 *
 * Necesita NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY y APIFY_API_KEY
 * (y META_ACCESS_TOKEN para las cuentas propias y los ads).
 * Escribe en la base compartida.
 */
import { startDiscoveryJob } from "@/lib/content/discovery-job";
import { getJob } from "@/lib/content/store";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}`))?.split("=")[1];

async function main() {
  const sourceIds = arg("sources")?.split(",").filter(Boolean);
  const perSource = arg("per-source");
  const maxTotal = arg("max-total");
  const { job, created } = await startDiscoveryJob({
    requestedBy: "local-script",
    sourceIds,
    options: {
      backfill: process.argv.includes("--backfill"),
      ...(process.argv.includes("--own-ads") ? { ownAds: true } : {}),
      ...(perSource ? { maxItemsPerSource: Number(perSource) } : {}),
      ...(maxTotal ? { maxTotalItems: Number(maxTotal) } : {}),
    },
  });
  if (!created) {
    console.error(`Ya hay una corrida en curso (${job.id}). No se lanza otra.`);
    process.exit(1);
  }
  console.log(`job ${job.id}`);
  for (;;) {
    await new Promise((r) => setTimeout(r, 5000));
    const current = await getJob(job.id);
    if (!current) continue;
    console.log(current.state, current.current_label ?? "", JSON.stringify(current.progress));
    if (["completed", "failed", "cancelled"].includes(current.state)) {
      console.log(JSON.stringify(current.results, null, 1));
      if (current.error) console.log("error:", current.error);
      process.exit(current.state === "completed" ? 0 : 1);
    }
  }
}

void main();
