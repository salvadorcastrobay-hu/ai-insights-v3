import { ChatBox } from "@/components/ChatBox";
import { APP_NAME } from "@/lib/content/brand";
import { loadHighlights, sampleQuestions } from "@/lib/content/highlights";

export const dynamic = "force-dynamic";

/**
 * Chat: preguntas sobre qué publicar, respondidas con los datos de la
 * herramienta (ver lib/content/chat.ts para cómo se evita que invente).
 *
 * Sin PageHeader: el chat ocupa la pantalla entera, con su propio encabezado,
 * para que la caja de escribir quede siempre abajo.
 */
export default async function ChatPage() {
  const { syntheses } = await loadHighlights();
  const questions = [
    ...sampleQuestions(syntheses).slice(0, 2),
    "¿Qué post nuestro rindió mejor en Brasil y por qué?",
    "¿Qué pieza de ads nos trae leads más baratos?",
  ];

  return <ChatBox title={`Preguntale a ${APP_NAME}`} questions={questions} />;
}
