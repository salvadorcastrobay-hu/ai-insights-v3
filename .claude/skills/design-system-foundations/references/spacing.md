# Sizing & Spacing — Referencia completa

> Extraído del nodo 39:1722 del archivo Figma Foundations.
> https://www.figma.com/design/JZaQqFSAyJBX6RC1aBVKTp/Foundations?node-id=39-1722
> Base múltiple de 8. A menor espaciado, más relación entre elementos.
> Elementos más lejanos (mayor espaciado) = menos relación entre sí.

---

## Specials (fracciones de la unidad base)

| Token  | Value | Uso |
|--------|-------|-----|
| 0,25x  | 2px   | Elementos con gran relación |
| 0,5x   | 4px   | Elementos con gran relación |
| 1,5x   | 12px  | Elementos con gran relación |

---

## General (múltiplos de 8px)

| Token | Value | Uso |
|-------|-------|-----|
| 1x    | 8px   | Elementos con gran relación — Padding y margins |
| 2x    | 16px  | Elementos con gran relación — Padding y margins |
| 3x    | 24px  | Elementos que pueden tener relación dentro de una sección |
| 4x    | 32px  | Marcar diferencia entre secciones |
| 5x    | 40px  | Marcar diferencia entre secciones |
| 8x    | 64px  | Grandes secciones que necesitan espacio |
| 9x    | 72px  | Grandes secciones que necesitan espacio |
| 16x   | 128px | Grandes secciones que necesitan espacio |

---

## Guía de uso semántico

```
2px  / 4px  → elementos íntimamente relacionados (icon + label, etc.)
12px         → relación fuerte (items de lista, campos en un form)
8px  / 16px  → padding interno de componentes
24px         → agrupación dentro de una sección
32px / 40px  → separación clara entre secciones distintas
64px / 72px  → separación de grandes bloques
128px        → separación máxima entre secciones de página
```
