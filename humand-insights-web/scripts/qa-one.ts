/* eslint-disable no-console */
import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto";
const envPath = path.join(process.cwd(), ".env.qa");
for (const l of fs.readFileSync(envPath, "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(?:"([^"]*)"|(.*))$/);
  if (m) process.env[m[1]] ??= m[2] ?? m[3];
}
function mintJwt(email: string, s: string) {
  const now = Math.floor(Date.now()/1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const si = `${b64({alg:"HS256",typ:"JWT"})}.${b64({aud:"authenticated",exp:now+3600,iat:now,iss:"supabase",sub:crypto.randomUUID(),email,app_metadata:{roles:["admin"]},role:"authenticated",session_id:crypto.randomUUID()})}`;
  return `${si}.${crypto.createHmac("sha256",s).update(si).digest("base64url")}`;
}
const token = mintJwt("qa@humand.co", process.env.SUPABASE_JWT_SECRET!);
const cookie = `sb-nzjzwtjyfqflhyidbacq-auth-token=base64-${Buffer.from(JSON.stringify({access_token:token,refresh_token:"f",expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,token_type:"bearer",user:{id:crypto.randomUUID(),email:"qa@humand.co",role:"authenticated",aud:"authenticated",app_metadata:{roles:["admin"]},user_metadata:{}}})).toString("base64")}`;

async function ask(q: string, chartContext: unknown) {
  const res = await fetch("https://humand-insights-web.vercel.app/api/ask-chart", {
    method: "POST",
    headers: { "Content-Type":"application/json", "Authorization":`Bearer ${token}`, "Cookie": cookie },
    body: JSON.stringify({ question: q, pathname: "/executive-summary", filters: {}, chartContext }),
  });
  if (!res.ok) { console.error(res.status, await res.text()); return; }
  const reader = res.body!.getReader(); const dec = new TextDecoder();
  while (true) { const {done,value} = await reader.read(); if (done) break; process.stdout.write(dec.decode(value)); }
  process.stdout.write("\n");
}

const PAINS = {
  chartTitle: "Top 10 Pains", chartKind: "horizontal-bar",
  dimension: "insight_subtype_display", scopeType: "pain",
  rows: [
    { label: "Procesos manuales", value: 9531 },
    { label: "Herramientas fragmentadas", value: 5736 },
    { label: "Sin autogestion", value: 2681 },
    { label: "Baja adopcion", value: 2580 },
    { label: "Cuellos de botella", value: 1553 },
    { label: "Empleados inalcanzables", value: 1519 },
    { label: "HR saturado en operacion", value: 1407 },
    { label: "Sin estandarizacion", value: 1273 },
    { label: "Dolor de reportes", value: 874 },
    { label: "Informacion que no llega", value: 714 },
  ],
};

(async () => {
  console.log("\n========== Q1: parent drill (should KEEP taxonomy bullets) ==========");
  await ask("a que se refieren los leads con procesos manuales?", PAINS);
  console.log("\n========== Q2: sub-label drill (should switch to PROSE + quotes) ==========");
  await ask("que seria control horario?", PAINS);
})();
