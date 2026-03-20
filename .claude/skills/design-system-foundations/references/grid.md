# Grids — Referencia completa

> Extraído del nodo 328:522 del archivo Figma Foundations.
> https://www.figma.com/design/JZaQqFSAyJBX6RC1aBVKTp/Foundations?node-id=328-522
> Las grillas se utilizan según el tamaño del contenedor.
> Pueden existir hasta 3 grillas conviviendo en la misma interfaz, según el tipo de layout (1, 2 ó 3 paneles).

---

## Tokens de grilla

| Token    | Screen size | Margen | Gutter | Body            | Columns | Uso |
|----------|-------------|--------|--------|-----------------|---------|-----|
| S-Fluid  | 0–599px     | 16     | 16     | Fluid           | 4       | Paneles laterales, Layout mobile/responsive |
| M-Fluid  | 600–839px   | 32     | 16     | Fluid           | 8       | Paneles centrales, Layout tablets |
| L-Fluid  | 840–1199px  | 32     | 16     | Fluid           | 12      | Paneles centrales, Layout tablets |
| XL-Fluid | 1200+       | 16     | 24     | Fluid           | 12      | Header tablet & desktop |
| XL-Fixed | 1200+       | Fluid  | 16     | Min Width 1040  | 12      | Paneles únicos, Layout desktop |

---

## Notas

- Todas las unidades de margen y gutter están en píxeles
- **Body Fluid** = el contenido ocupa todo el ancho disponible menos los márgenes
- **XL-Fixed** tiene un ancho mínimo de contenido de 1040px — el margen es fluido
- En layouts con múltiples paneles, cada panel puede usar su propia grilla según su ancho

---

## CSS reference

```css
/* S-Fluid — 0 a 599px */
/* 4 columnas, margen 16px, gutter 16px */
@media (max-width: 599px) {
  .grid { padding-inline: 16px; column-gap: 16px; }
}

/* M-Fluid — 600 a 839px */
/* 8 columnas, margen 32px, gutter 16px */
@media (min-width: 600px) and (max-width: 839px) {
  .grid { padding-inline: 32px; column-gap: 16px; }
}

/* L-Fluid — 840 a 1199px */
/* 12 columnas, margen 32px, gutter 16px */
@media (min-width: 840px) and (max-width: 1199px) {
  .grid { padding-inline: 32px; column-gap: 16px; }
}

/* XL-Fluid — 1200px+ */
/* 12 columnas, margen 16px, gutter 24px */
@media (min-width: 1200px) {
  .grid { padding-inline: 16px; column-gap: 24px; }
}

/* XL-Fixed — 1200px+, contenido con min-width 1040px */
@media (min-width: 1200px) {
  .grid-fixed { min-width: 1040px; column-gap: 16px; margin-inline: auto; }
}
```
