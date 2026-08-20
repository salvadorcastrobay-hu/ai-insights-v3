#!/usr/bin/env bash
#
# Driver del AE Playbook: elige modelo por el gate de fidelidad y corre el
# recorte acotado si el costo estimado queda bajo el techo.
#
# Existe como archivo y no como bloque para pegar porque los bloques multilinea
# con if/else se desarman al pegarlos en zsh (las lineas llegan fuera de orden y
# el shell termina echando el texto en vez de ejecutarlo).
#
# Usage:
#     bash scripts/ae_next.sh
#     TECHO_USD=60 bash scripts/ae_next.sh          # subir el techo de gasto
#     SINCE=2025-06-01 LIMIT=300 bash scripts/ae_next.sh
#     MODELO=gpt-4o bash scripts/ae_next.sh         # saltear el gate y forzar modelo

set -u

SINCE="${SINCE:-2025-11-01}"
LIMIT="${LIMIT:-150}"
TECHO_USD="${TECHO_USD:-25}"
REGION="${REGION:-HISPAM}"
OUT="/tmp/ae_next_$(date +%m%d_%H%M)"

mkdir -p "$OUT" artifacts

echo "salidas en: $OUT"
echo "recorte: region=$REGION since=$SINCE limit=$LIMIT techo=USD $TECHO_USD"

echo ""
echo "=============== 1 · UNIVERSO ==============="
# Read-only y gratis. Interesa la linea de transcripts_validated: si son pocos,
# validated_lift es ruido y hay que decirlo antes de mostrarle numeros a nadie.
python3 scripts/ae_diag.py --region "$REGION" --sample-speakers 12 2>&1 \
  | tee "$OUT/1_diag.txt" | sed -n '/1) UNIVERSO/,/2) COBERTURA/p'

MODELO="${MODELO:-}"
if [ -z "$MODELO" ]; then
  echo ""
  echo "=============== 2 · GATE: gpt-4o-mini ==============="
  # Mini es ~16x mas barato. Con un gate deterministico esto se mide en vez de
  # asumirse: si aguanta la fidelidad, el run cuesta centavos en vez de cientos.
  python3 scripts/ae_extract_test.py --sample 5 --max-chunks 3 --model gpt-4o-mini 2>&1 \
    | tee "$OUT/2_gate_mini.txt" | grep -E "FIDELIDAD|atribucion ok|VEREDICTO|^ +[0-9]+ +[a-z_]+$"

  if grep -q "VEREDICTO: PASA" "$OUT/2_gate_mini.txt"; then
    MODELO="gpt-4o-mini"
  else
    MODELO="gpt-4o"
    echo "  mini no paso el gate → se usa gpt-4o"
  fi
fi
echo ""
echo ">>> modelo: $MODELO"

echo ""
echo "=============== 3 · COSTO DEL RECORTE ==============="
python3 scripts/ae_extract_run.py --region "$REGION" --model "$MODELO" \
  --since "$SINCE" --limit "$LIMIT" --dry-run 2>&1 | tee "$OUT/3_costo.txt"

COSTO=$(sed -n 's/.*COSTO ESTIMADO.*USD *\([0-9.]*\).*/\1/p' "$OUT/3_costo.txt" | head -1)

if [ -z "$COSTO" ]; then
  echo ""
  echo "!! No pude leer el costo estimado. No corro el run. Ver $OUT/3_costo.txt"
  exit 1
fi

# Comparacion en punto flotante: [ -lt ] es solo para enteros y USD 3.40 vs 25
# fallaria con un error de sintaxis en vez de comparar.
if awk -v c="$COSTO" -v t="$TECHO_USD" 'BEGIN{exit !(c<t)}'; then
  echo ""
  echo "=============== 4 · RUN REAL (USD ~$COSTO < techo $TECHO_USD) ==============="
  python3 scripts/ae_extract_run.py --region "$REGION" --model "$MODELO" \
    --since "$SINCE" --limit "$LIMIT" 2>&1 | tee "$OUT/4_run.txt" | tail -40
else
  echo ""
  echo "!! Estimacion USD $COSTO, por encima del techo de USD $TECHO_USD. NO corri el run."
  echo "   Para correrlo igual:"
  echo "     TECHO_USD=$(awk -v c="$COSTO" 'BEGIN{printf "%d", c+1}') bash scripts/ae_next.sh"
  echo "   O acotar mas:"
  echo "     LIMIT=50 bash scripts/ae_next.sh"
  exit 0
fi

echo ""
echo "=============== 5 · PACK DE FAQs (post-run) ==============="
python3 scripts/ae_faq_pack.py --region "$REGION" --min-cluster 3 2>&1 \
  | tee "$OUT/5_faq.txt" | tail -8

echo ""
echo "=============== RESUMEN ==============="
grep -E "transcripts_validated|deals_validated" "$OUT/1_diag.txt" | head -4
echo "modelo usado: $MODELO  ·  costo estimado: USD $COSTO"
grep -E "insertadas|terminos|descartadas_no_literal|tasa de descarte" "$OUT/4_run.txt" 2>/dev/null
echo ""
echo "todo en: $OUT"
echo "pegale a Claude: cat $OUT/RESUMEN.txt"

{
  echo "### universo"; sed -n '/1) UNIVERSO/,/2) COBERTURA/p' "$OUT/1_diag.txt"
  echo "### gate mini"; grep -E "FIDELIDAD|VEREDICTO" "$OUT/2_gate_mini.txt" 2>/dev/null
  echo "### modelo/costo"; echo "$MODELO / USD $COSTO"
  echo "### run"; tail -25 "$OUT/4_run.txt" 2>/dev/null
  echo "### faqs"; tail -8 "$OUT/5_faq.txt" 2>/dev/null
} > "$OUT/RESUMEN.txt"
