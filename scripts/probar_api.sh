#!/usr/bin/env bash
#
# Batería de humo de la API de Higía. 21 comprobaciones.
#
#   ./scripts/probar_api.sh
#
# Comprueba que cada endpoint responde con el código que debe, incluidos los
# errores: que un alimento inexistente dé 400 y no un 500, que una escala fuera
# de 0-10 dé 422, que una comida que no existe dé 404.
#
# ⚠️ ESCRIBE EN LA BASE y limpia lo que crea al terminar. No dejar de limpiar:
#    una comida de prueba en la base contamina cualquier análisis posterior.
set -u
A=${HIGIA_API:-http://localhost:8000}
ok=0; mal=0
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

t() { # t <nombre> <codigo_esperado> <args de curl...>
  local n="$1" esp="$2"; shift 2
  local code
  code=$(curl -s -o "$TMP" -w '%{http_code}' "$@")
  if [ "$code" = "$esp" ]; then
    echo "  ✅ $n ($code)"; ok=$((ok+1))
  else
    echo "  🔴 $n → $code, esperaba $esp"; head -c 300 "$TMP"; echo; mal=$((mal+1))
  fi
}

echo "── LECTURA ──"
t "/health"                    200 "$A/health"
t "/dia con datos"             200 "$A/dia/2026-08-12"
t "/dia sin datos (200, no 404)" 200 "$A/dia/2020-01-01"
t "/dias"                      200 "$A/dias"
t "/alimentos"                 200 "$A/alimentos"
t "/alimentos?q="              200 "$A/alimentos?q=yogur"
t "/comidas"                   200 "$A/comidas"
t "/comidas/frecuentes"        200 "$A/comidas/frecuentes"
t "/comidas/{id}"              200 "$A/comidas/c-2026-08-12-01"
t "/comidas/{id} inexistente"  404 "$A/comidas/no-existe"
t "/salud/semanas"             200 "$A/salud/semanas"
t "/salud/sueno"               200 "$A/salud/sueno"
t "/salud/metricas"            200 "$A/salud/metricas"
t "/salud/serie/{metrica}"     200 "$A/salud/serie/pulsaciones?desde=2026-08-08&hasta=2026-08-13"
t "/dia-subjetivo/pendientes"  200 "$A/dia-subjetivo/pendientes"

echo "── ESCRITURA ──"
t "PUT /dia-subjetivo" 200 -X PUT "$A/dia-subjetivo" -H 'Content-Type: application/json' \
  -d '{"fecha":"1999-01-01","como_me_siento":7,"animo":6,"energia":5,"nota":"PRUEBA-AUTOMATICA"}'
t "PUT fuera de la escala 0-10 → 422" 422 -X PUT "$A/dia-subjetivo" \
  -H 'Content-Type: application/json' -d '{"fecha":"1999-01-01","energia":11}'
t "POST /consumos (normaliza la sustancia)" 201 -X POST "$A/consumos" \
  -H 'Content-Type: application/json' \
  -d '{"fecha":"1999-01-01","sustancia":"  CAFÉ  ","cantidad":1,"unidad":"taza"}'
t "POST /comidas" 201 -X POST "$A/comidas" -H 'Content-Type: application/json' \
  -d '{"fecha":"1999-01-01","descripcion":"PRUEBA-AUTOMATICA","items":[{"alimento_id":"huevo-campero-l","cantidad_g":120,"origen_cantidad":"envase"}]}'
t "POST con alimento fuera del catálogo → 400" 400 -X POST "$A/comidas" \
  -H 'Content-Type: application/json' \
  -d '{"fecha":"1999-01-01","descripcion":"x","items":[{"alimento_id":"no-existe","cantidad_g":10,"origen_cantidad":"pesado"}]}'
t "POST sin ingredientes → 422" 422 -X POST "$A/comidas" \
  -H 'Content-Type: application/json' -d '{"fecha":"1999-01-01","descripcion":"x","items":[]}'

# ── Limpieza. Todo lo de prueba va con fecha 1999-01-01 para poder borrarlo sin
#    tocar nada real, pase lo que pase a mitad de la batería.
echo "── LIMPIEZA ──"
curl -s -X DELETE "$A/comidas/c-1999-01-01-01" -o /dev/null
for id in $(curl -s "$A/consumos?fecha=1999-01-01" | grep -o '"id": *[0-9]*' | grep -o '[0-9]*'); do
  curl -s -X DELETE "$A/consumos/$id" -o /dev/null
done
resto=$(curl -s "$A/comidas?fecha=1999-01-01")
[ "$resto" = "[]" ] && echo "  ✅ base limpia" || { echo "  🔴 quedan restos: $resto"; mal=$((mal+1)); }
echo "  ℹ️  dia_subjetivo de 1999-01-01 no tiene endpoint de borrado: se quita con"
echo "     docker compose exec -T db psql -U higia -d higia -c \"DELETE FROM dia_subjetivo WHERE fecha='1999-01-01';\""

echo
echo "correctas=$ok  fallos=$mal"
[ "$mal" -eq 0 ]
