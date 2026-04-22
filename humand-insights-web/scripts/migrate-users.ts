/**
 * One-time migration of streamlit-authenticator users (config.yaml) into
 * Supabase Auth. Each created user gets a recovery link emailed so they can
 * pick a new password.
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=... \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   npx tsx scripts/migrate-users.ts
 *
 * Re-running is safe: existing users are skipped (or have their roles updated).
 * Pass --dry-run to print the plan without touching Supabase.
 */

import { createClient } from "@supabase/supabase-js";

type AppRole = "admin" | "campaign_advisor" | "viewer";

type SeedUser = {
  email: string;
  roles: AppRole[];
  first_name?: string;
  last_name?: string;
};

const USERS: SeedUser[] = [
  { email: "juanba.scelzi@humand.co", roles: ["admin"], first_name: "Juanba", last_name: "Scelzi" },
  { email: "salvador.castrobay@humand.co", roles: ["admin"], first_name: "Salvador", last_name: "Castro Bay" },
  { email: "daniela.lopez@humand.co", roles: ["campaign_advisor", "viewer"], first_name: "Daniela", last_name: "Lopez" },
  { email: "melissa.gonzalez@humand.co", roles: ["campaign_advisor", "viewer"], first_name: "Melissa", last_name: "Gonzalez" },
  { email: "mile@humand.co", roles: ["campaign_advisor", "viewer"], first_name: "Milena", last_name: "Yuri" },
  { email: "pedro@humand.co", roles: ["campaign_advisor", "viewer"], first_name: "Pedro" },
  { email: "raphael.montressor@humand.co", roles: ["campaign_advisor", "viewer"], first_name: "Raphael", last_name: "Montressor" },
  { email: "agustina.ini@humand.co", roles: ["viewer"], first_name: "Agus", last_name: "Ini" },
  { email: "aimee@humand.co", roles: ["viewer"], first_name: "Aimee" },
  { email: "augusto.ferrer@humand.co", roles: ["viewer"], first_name: "Augusto", last_name: "Ferrer" },
  { email: "daniel.moreno@humand.co", roles: ["viewer"], first_name: "Daniel", last_name: "Moreno" },
  { email: "caro@humand.co", roles: ["viewer"], first_name: "Carolina", last_name: "Mendiondo" },
  { email: "juan.diego.alcocer@humand.co", roles: ["viewer"], first_name: "Juandi", last_name: "Alcocer" },
  { email: "luciano.paradiso@humand.co", roles: ["viewer"], first_name: "Lucho", last_name: "Paradiso" },
  { email: "manuela.cavallo@humand.co", roles: ["viewer"], first_name: "Manuela", last_name: "Cavallo" },
  { email: "marcos.palacio@humand.co", roles: ["viewer"], first_name: "Marcos", last_name: "Palacio" },
  { email: "nico.cordes@humand.co", roles: ["viewer"], first_name: "Nico", last_name: "Cordes" },
  { email: "sofia.esposito@humand.co", roles: ["viewer"], first_name: "Sofía", last_name: "Esposito" },
  { email: "soledad.barca@humand.co", roles: ["viewer"], first_name: "Sole", last_name: "Barca" },
  { email: "vanina.moreira@humand.co", roles: ["viewer"], first_name: "Vanina", last_name: "Moreira" },
  { email: "vivi@humand.co", roles: ["viewer"], first_name: "Vivi" },
];

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) {
    throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running.");
  }

  const dryRun = process.argv.includes("--dry-run");
  const skipReset = process.argv.includes("--skip-recovery");
  const supabase = createClient(url, serviceRole, { auth: { persistSession: false } });

  console.log(`Migrating ${USERS.length} users (dry-run=${dryRun}, skip-recovery=${skipReset})`);

  // Page through the existing users so we only do one round-trip.
  const existing = new Map<string, string>(); // email → user id
  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    for (const user of data.users) {
      if (user.email) existing.set(user.email.toLowerCase(), user.id);
    }
    if (data.users.length < 200) break;
    page += 1;
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const user of USERS) {
    const email = user.email.toLowerCase();
    const userMeta = {
      first_name: user.first_name ?? null,
      last_name: user.last_name ?? null,
    };
    const appMeta = { roles: user.roles };

    const existingId = existing.get(email);
    if (existingId) {
      console.log(`= ${email} already exists (${existingId}); syncing app_metadata.roles`);
      if (!dryRun) {
        const { error } = await supabase.auth.admin.updateUserById(existingId, {
          app_metadata: appMeta,
          user_metadata: userMeta,
        });
        if (error) {
          console.error(`  ! failed to update ${email}: ${error.message}`);
          continue;
        }
      }
      updated += 1;
      continue;
    }

    console.log(`+ creating ${email} with roles=[${user.roles.join(", ")}]`);
    if (dryRun) {
      created += 1;
      continue;
    }
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
      app_metadata: appMeta,
      user_metadata: userMeta,
    });
    if (error || !data.user) {
      console.error(`  ! failed to create ${email}: ${error?.message ?? "unknown error"}`);
      skipped += 1;
      continue;
    }
    created += 1;

    if (!skipReset) {
      const { error: linkError } = await supabase.auth.admin.generateLink({
        type: "recovery",
        email,
      });
      if (linkError) {
        console.error(`  ! failed to send recovery link to ${email}: ${linkError.message}`);
      }
    }
  }

  console.log(`\nDone. created=${created} updated=${updated} skipped=${skipped}`);
  if (dryRun) {
    console.log("(dry-run: no changes were applied)");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
