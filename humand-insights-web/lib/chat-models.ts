// Modelos disponibles en los chats, por capacidad/costo (coherente).
// El cost real se calcula en el servicio Python (PRICING_USD_PER_M).
export type ChatModelTier = "basico" | "intermedio" | "avanzado";

export type ChatModelOption = {
  id: string;
  tier: ChatModelTier;
  label: string;
  hint: string;
};

export const CHAT_MODELS: ChatModelOption[] = [
  { id: "gpt-4o-mini", tier: "basico", label: "Básico", hint: "Rápido y económico" },
  { id: "gpt-5.4-mini", tier: "intermedio", label: "Intermedio", hint: "Mejor razonamiento" },
  { id: "gpt-5.4", tier: "avanzado", label: "Avanzado", hint: "Máxima calidad" },
];

// Default: el más barato (básico).
export const DEFAULT_CHAT_MODEL = "gpt-4o-mini";

const VALID_IDS = new Set(CHAT_MODELS.map((m) => m.id));

/** Devuelve un model id válido del allowlist; cae al default si no aplica. */
export function resolveChatModel(id?: string | null): string {
  return id && VALID_IDS.has(id) ? id : DEFAULT_CHAT_MODEL;
}
