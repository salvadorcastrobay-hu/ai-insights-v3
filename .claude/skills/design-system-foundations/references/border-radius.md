# Corner Radius — Referencia completa

> Extraído del nodo 39:1364 del archivo Figma Foundations.
> https://www.figma.com/design/JZaQqFSAyJBX6RC1aBVKTp/Foundations?node-id=39-1364
> Base múltiple de 8.

---

## Tokens

| Token | Value | Altura del elemento | Uso |
|-------|-------|---------------------|-----|
| S     | 4px   | 1–39px height       | Elementos chicos. Excepción: badges/chips |
| M     | 8px   | 40–71px height      | Elementos medianos |
| L     | 16px  | +72px height        | Elementos grandes |

---

## Reglas de aplicación

- Elegir el token según la **altura** del elemento, no según criterio visual subjetivo
- Badges y chips son una **excepción** al token S — pueden usar `border-radius: 999px` (pill)
- La escala es múltiplo de 8 (excepto S que es 4px como valor mínimo útil)

```css
/* Token S — elementos de hasta 39px de alto */
border-radius: 4px;

/* Token M — elementos de 40px a 71px de alto */
border-radius: 8px;

/* Token L — elementos de 72px o más de alto */
border-radius: 16px;
```
