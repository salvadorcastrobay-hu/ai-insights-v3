# Elevation (Shadows) — Referencia completa

> Extraído del nodo 105:3131 del archivo Figma Foundations.
> https://www.figma.com/design/JZaQqFSAyJBX6RC1aBVKTp/Foundations?node-id=105-3131
> Existen 3 tipos de sombras. 4dp es un elemento destacado pero cercano a la superficie.
> 8dp es un elemento totalmente destacado.

---

## Tokens

| Token    | CSS box-shadow value                          | Uso |
|----------|-----------------------------------------------|-----|
| 4dp      | `-1px 4px 8px 0px rgba(233, 233, 244, 100%)`  | Cards accionables (que tienen un button) |
| 8dp      | `-1px 8px 16px 0px rgba(170, 170, 186, 45%)`  | Elementos sobre otros (dropdown, menú). Estado hover de Card Container accionable |
| Inverted | `0px -2px 24px 0px rgba(103, 103, 121, 50%)`  | Backdrops que surgen desde abajo en mobile (bottom sheets) |

---

## CSS

```css
/* 4dp — cards accionables */
box-shadow: -1px 4px 8px 0px rgba(233, 233, 244, 1);

/* 8dp — dropdowns, hover de cards */
box-shadow: -1px 8px 16px 0px rgba(170, 170, 186, 0.45);

/* Inverted — bottom sheets mobile */
box-shadow: 0px -2px 24px 0px rgba(103, 103, 121, 0.50);
```

---

## Reglas de uso

- **4dp** → siempre en cards que contienen una acción (botón)
- **8dp** → elementos flotantes sobre el contenido (dropdowns, menús desplegables) + estado hover de cards accionables
- **Inverted** → exclusivo para elementos que emergen desde abajo (mobile bottom sheets, drawers)
- No inventar sombras fuera de estos 3 tokens
