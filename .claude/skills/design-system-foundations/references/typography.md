# Typography — Referencia completa

> Extraído del nodo 40:897 del archivo Figma Foundations.
> https://www.figma.com/design/JZaQqFSAyJBX6RC1aBVKTp/Foundations?node-id=40-897

---

## Fuente

**Roboto** — única familia tipográfica del sistema.

---

## Pesos

Solo dos pesos disponibles:

| Peso | Valor | Uso |
|------|-------|-----|
| Regular  | 400 | Textos de lectura, body, descripciones |
| SemiBold | 600 | Títulos, labels importantes, resaltados |

> "Tenemos dos tipos de pesos que se combinan para marcar jerarquías: regular para textos y semibold para títulos o resaltar cosas importantes."

---

## Escala Global de tamaños

Todos los tokens comparten: `font-family: Roboto`, `letter-spacing: 0.2px`.

| Token       | font-size | line-height | font-weight |
|-------------|-----------|-------------|-------------|
| Global-XXXS | 10px      | 1.4 (140%)  | 400 Regular |
| Global-XXS  | 12px      | 1.4 (140%)  | 400 Regular |
| Global-XS   | 14px      | 1.4 (140%)  | 400 Regular |
| Global-S    | 16px      | 1.4 (140%)  | 400 Regular |
| Global-M    | 18px      | 1.4 (140%)  | 400 Regular |
| Global-L    | 24px      | 1.4 (140%)  | 400 Regular |
| Global-XL   | 32px      | 1.3 (130%)  | 400 Regular |
| Global-XXL  | 36px      | 1.4 (140%)  | 400 Regular |

> **Nota:** Global-XL es el único token con line-height 1.3 en lugar de 1.4.

---

## CSS — cómo aplicar los tokens

```css
/* Global-XXXS */
font-family: 'Roboto', sans-serif;
font-size: 10px;
font-weight: 400;
line-height: 1.4;
letter-spacing: 0.2px;

/* Global-XXS */
font-size: 12px;
line-height: 1.4;

/* Global-XS */
font-size: 14px;
line-height: 1.4;

/* Global-S */
font-size: 16px;
line-height: 1.4;

/* Global-M */
font-size: 18px;
line-height: 1.4;

/* Global-L */
font-size: 24px;
line-height: 1.4;

/* Global-XL */
font-size: 32px;
line-height: 1.3; /* excepción */

/* Global-XXL */
font-size: 36px;
line-height: 1.4;

/* SemiBold — aplicar sobre cualquier token de la escala */
font-weight: 600;
```

---

## Reglas de aplicación

- Usar `font-weight: 400` por defecto para todo el texto de lectura
- Usar `font-weight: 600` para encabezados y elementos de énfasis
- **No usar otros pesos** (300, 700, 800, etc.) — no existen en el sistema
- **No cambiar el letter-spacing** — siempre 0.2px
- El line-height de 1.3 es exclusivo de Global-XL
