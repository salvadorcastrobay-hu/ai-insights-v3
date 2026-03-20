---
name: design-system-foundations
description: >
  Referencia de foundations del design system: colores y tipografía. Usar esta skill SIEMPRE que
  se escriba código UI, componentes, estilos CSS, o cualquier elemento visual. Activar cuando el
  usuario mencione colores, tipografía, texto, fuentes, tamaños, o pida construir cualquier
  componente o pantalla. No inferir valores — siempre consultar esta skill primero.
---

# Design System Foundations

Fuente de verdad para colores y tipografía. Consultar antes de escribir cualquier valor visual.
Figma: https://www.figma.com/design/JZaQqFSAyJBX6RC1aBVKTp/Foundations

## Categorías

| Categoría     | Archivo de referencia            |
|---------------|----------------------------------|
| Colores       | `references/colors.md`           |
| Tipografía    | `references/typography.md`       |
| Espaciado     | `references/spacing.md`          |
| Border Radius | `references/border-radius.md`    |
| Grilla        | `references/grid.md`             |
| Elevation     | `references/elevation.md`        |

---

## Tipografía

**Fuente única:** Roboto  
**Pesos disponibles:** 400 (Regular) y 600 (SemiBold) únicamente.

- Regular → textos de lectura, body
- SemiBold → títulos, cosas importantes

### Escala de tamaños (Global tokens)

| Token       | Size | Line height | Weight | Tracking |
|-------------|------|-------------|--------|----------|
| Global-XXXS | 10px | 1.4 (140%)  | 400    | 0.2px    |
| Global-XXS  | 12px | 1.4 (140%)  | 400    | 0.2px    |
| Global-XS   | 14px | 1.4 (140%)  | 400    | 0.2px    |
| Global-S    | 16px | 1.4 (140%)  | 400    | 0.2px    |
| Global-M    | 18px | 1.4 (140%)  | 400    | 0.2px    |
| Global-L    | 24px | 1.4 (140%)  | 400    | 0.2px    |
| Global-XL   | 32px | 1.3 (130%)  | 400    | 0.2px    |
| Global-XXL  | 36px | 1.4 (140%)  | 400    | 0.2px    |

> SemiBold se aplica sobre cualquier token de la escala cuando se necesita jerarquía.

---

## Colores — Resumen rápido

Ver `references/colors.md` para la paleta completa.

### Paletas disponibles

- **Humand** → color de marca principal (azul)
- **Neutral (grey)** → grises de UI
- **Black ink** → escala acromática
- **Green - Success** → estados de éxito
- **Red (error)** → estados de error
- **Yellow (warning)** → alertas y advertencias
- **Info (Sky Blue)** → información
- **Purple, Teal, Lime, Flamingo, Tan, Salmon, Pink, Mulberry, Sunshine** → paletas extendidas

### Tokens semánticos clave (del Figma)

```css
--text/neutral/default:  #303036   /* texto principal */
--text/neutral/lighter:  #636271   /* texto secundario */
--brand/400:             #6f93eb   /* brand highlight */
--blueprimary/100:       #eff2ff   /* fondo de headers de tabla */
--blueprimary/800:       #213478   /* texto sobre fondo primary/100 */
--background/layout/default: #f5f6f8 /* fondo de página */
```

---

## Espaciado

Base múltiplo de 8px. A menor espaciado, más relación entre elementos.

| Token | Value | Uso típico |
|-------|-------|------------|
| 0,25x | 2px   | Elementos íntimamente relacionados |
| 0,5x  | 4px   | Elementos íntimamente relacionados |
| 1,5x  | 12px  | Relación fuerte (items de lista) |
| 1x    | 8px   | Padding y margins internos |
| 2x    | 16px  | Padding y margins internos |
| 3x    | 24px  | Agrupación dentro de una sección |
| 4x    | 32px  | Separación entre secciones |
| 5x    | 40px  | Separación entre secciones |
| 8x    | 64px  | Grandes bloques |
| 9x    | 72px  | Grandes bloques |
| 16x   | 128px | Separación máxima de página |

> Ver `references/spacing.md` para guía semántica completa.

---

## Border Radius

Base múltiplo de 8. El token se elige según la **altura** del elemento.

| Token | Value | Altura del elemento |
|-------|-------|---------------------|
| S     | 4px   | 1–39px              |
| M     | 8px   | 40–71px             |
| L     | 16px  | +72px               |

> Excepción: badges/chips pueden usar `border-radius: 999px`.

---

## Grilla

Pueden convivir hasta 3 grillas en la misma interfaz según el tipo de layout.

| Token    | Screen size | Margen | Gutter | Columns |
|----------|-------------|--------|--------|---------|
| S-Fluid  | 0–599px     | 16px   | 16px   | 4       |
| M-Fluid  | 600–839px   | 32px   | 16px   | 8       |
| L-Fluid  | 840–1199px  | 32px   | 16px   | 12      |
| XL-Fluid | 1200+       | 16px   | 24px   | 12      |
| XL-Fixed | 1200+       | Fluid  | 16px   | 12 (min-width 1040px) |

> Ver `references/grid.md` para CSS completo.

---

## Elevation (Shadows)

Solo 3 sombras disponibles. No usar box-shadow fuera de estos tokens.

| Token    | CSS value                                    | Uso |
|----------|----------------------------------------------|-----|
| 4dp      | `-1px 4px 8px 0px rgba(233,233,244,1)`       | Cards accionables |
| 8dp      | `-1px 8px 16px 0px rgba(170,170,186,0.45)`   | Dropdowns, hover de cards |
| Inverted | `0px -2px 24px 0px rgba(103,103,121,0.50)`   | Bottom sheets mobile |

> Ver `references/elevation.md` para reglas de uso completas.

---

## Reglas de uso

1. Nunca hardcodear colores hex ni tamaños en px si existe un token
2. Solo usar Roboto en peso 400 o 600
3. Siempre usar line-height 1.4, excepto Global-XL que es 1.3
4. Letter-spacing siempre 0.2px en todos los tokens
5. Elegir border-radius según la altura del elemento (S/M/L)
6. Usar solo las 3 sombras del sistema (4dp, 8dp, Inverted)
7. Ante cualquier duda de color, cargar `references/colors.md`
