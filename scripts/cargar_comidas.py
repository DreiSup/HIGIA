#!/usr/bin/env python3
"""
Migra el catálogo y el registro de comidas del vault a la base de datos (D15).

Origen: `~/Obsidian/Higia/raw/` — CSV que dejaron de ser la fuente el 2026-08-14
y quedan como archivo histórico congelado. Este script los mueve a la base, que
pasa a ser la fuente de verdad.

Uso:
    docker compose exec backend python /scripts/cargar_comidas.py /raw
    docker compose exec backend python /scripts/cargar_comidas.py /raw --dry-run

────────────────────────────────────────────────────────────────────────────────
 🔑 LO QUE ESTE SCRIPT NO CARGA, Y ES LO IMPORTANTE
────────────────────────────────────────────────────────────────────────────────

`comidas.csv` trae columnas `kcal`, `prot_g`, `hc_g`… con los TOTALES de cada
comida. **No se cargan.** D15 dice que el total es derivado, no fuente: lo
calcula la vista `v_comidas` desde los ingredientes.

Los totales del CSV se usan como ORÁCULO DE PRUEBA — al terminar, el script
compara lo que calcula la vista contra lo que decía el CSV. Si no cuadran, la
carga está mal. Es la misma idea del protocolo ("si los items no reproducen el
total, manda el detalle"), ahora comprobada automáticamente.

Lo mismo con `tandas.csv`: sus columnas de macros son derivadas y se ignoran.

⚠️ IDEMPOTENCIA. `comida_items` NO tiene clave primaria a propósito: una comida
puede llevar el mismo alimento dos veces (en la comida 02 el aceite aparece dos
veces, el de freír y el de aliñar). Por eso los items de una comida se BORRAN y
se reinsertan, en vez de usar ON CONFLICT.
"""
import argparse
import csv
import os
import sys

import psycopg

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cargar_takeout import url_base_datos  # noqa: E402


def limpio(v):
    """Cadena vacía → NULL. Un hueco no es un cero (regla 6 del vault)."""
    if v is None:
        return None
    v = v.strip()
    return v if v else None


def leer(ruta: str):
    with open(ruta, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def cargar(raiz: str, dry_run: bool = False) -> int:
    alimentos = leer(os.path.join(raiz, "catalogo", "alimentos.csv"))
    tandas = leer(os.path.join(raiz, "registro", "tandas.csv"))
    comidas = leer(os.path.join(raiz, "registro", "comidas.csv"))
    items = leer(os.path.join(raiz, "registro", "comida_items.csv"))

    print(f"\n📖 {raiz}\n")
    print(f"  alimentos ........ {len(alimentos):>4}")
    print(f"  tandas ........... {len(tandas):>4}")
    print(f"  comidas .......... {len(comidas):>4}")
    print(f"  items ............ {len(items):>4}")

    # ── tanda_id: el CSV de comidas NO trae la columna. Se enlaza solo cuando el
    #    id de la tanda aparece literalmente en el texto. Donde no aparece, queda
    #    NULL y se reporta: imputarlo "porque solo hay una tanda" sería inventar
    #    un dato, y un dato imputado sin marcar contamina lo que venga después.
    ids_tanda = [t["id"] for t in tandas]
    sin_enlazar = []
    for c in comidas:
        texto = f"{c.get('descripcion', '')} {c.get('nota', '')}"
        c["_tanda_id"] = next((t for t in ids_tanda if t in texto), None)
        if not c["_tanda_id"] and "tanda" in (c.get("metodo") or ""):
            sin_enlazar.append(c["id"])
    if sin_enlazar:
        print(f"\n  ⚠️ metodo dice 'tanda' pero el CSV no nombra cuál: "
              f"{', '.join(sin_enlazar)}\n     Se quedan con tanda_id NULL "
              f"(hueco declarado, no adivinado).")

    if dry_run:
        print("\n🔍 --dry-run: no se ha escrito nada.\n")
        return 0

    with psycopg.connect(url_base_datos()) as con:
        with con.cursor() as cur:
            cur.executemany(
                """INSERT INTO alimentos (id, nombre, marca, formato, url, fuente,
                       fecha_consulta, base, kcal, prot_g, hc_g, azucar_g, grasa_g,
                       sat_g, fibra_g, sal_g, lactosa, gluten, unidades_envase,
                       peso_unidad_g, porcion_comestible_pct, notas)
                   VALUES (%(id)s,%(nombre)s,%(marca)s,%(formato)s,%(url)s,%(fuente)s,
                       %(fecha_consulta)s,%(base)s,%(kcal)s,%(prot_g)s,%(hc_g)s,
                       %(azucar_g)s,%(grasa_g)s,%(sat_g)s,%(fibra_g)s,%(sal_g)s,
                       %(lactosa)s,%(gluten)s,%(unidades_envase)s,%(peso_unidad_g)s,
                       %(porcion_comestible_pct)s,%(notas)s)
                   ON CONFLICT (id) DO UPDATE SET
                       nombre=EXCLUDED.nombre, marca=EXCLUDED.marca,
                       formato=EXCLUDED.formato, url=EXCLUDED.url,
                       fuente=EXCLUDED.fuente, fecha_consulta=EXCLUDED.fecha_consulta,
                       base=EXCLUDED.base, kcal=EXCLUDED.kcal, prot_g=EXCLUDED.prot_g,
                       hc_g=EXCLUDED.hc_g, azucar_g=EXCLUDED.azucar_g,
                       grasa_g=EXCLUDED.grasa_g, sat_g=EXCLUDED.sat_g,
                       fibra_g=EXCLUDED.fibra_g, sal_g=EXCLUDED.sal_g,
                       lactosa=EXCLUDED.lactosa, gluten=EXCLUDED.gluten,
                       unidades_envase=EXCLUDED.unidades_envase,
                       peso_unidad_g=EXCLUDED.peso_unidad_g,
                       porcion_comestible_pct=EXCLUDED.porcion_comestible_pct,
                       notas=EXCLUDED.notas""",
                [{k: limpio(a.get(k)) for k in (
                    "id", "nombre", "marca", "formato", "url", "fuente",
                    "fecha_consulta", "base", "kcal", "prot_g", "hc_g", "azucar_g",
                    "grasa_g", "sat_g", "fibra_g", "sal_g", "lactosa", "gluten",
                    "unidades_envase", "peso_unidad_g", "porcion_comestible_pct",
                    "notas")} for a in alimentos])

            # Las columnas de macros del CSV de tandas son derivadas: se ignoran.
            cur.executemany(
                """INSERT INTO tandas (id, fecha, nombre, raciones, unidad,
                       peso_racion_g, peso_crudo_g, peso_cocinado_g,
                       raciones_consumidas, notas)
                   VALUES (%(id)s,%(fecha)s,%(nombre)s,%(raciones)s,%(unidad)s,
                       %(peso_racion_g)s,%(peso_crudo_g)s,%(peso_cocinado_g)s,
                       %(raciones_consumidas)s,%(nota)s)
                   ON CONFLICT (id) DO UPDATE SET
                       fecha=EXCLUDED.fecha, nombre=EXCLUDED.nombre,
                       raciones=EXCLUDED.raciones, unidad=EXCLUDED.unidad,
                       peso_racion_g=EXCLUDED.peso_racion_g,
                       peso_crudo_g=EXCLUDED.peso_crudo_g,
                       peso_cocinado_g=EXCLUDED.peso_cocinado_g,
                       raciones_consumidas=EXCLUDED.raciones_consumidas,
                       notas=EXCLUDED.notas""",
                [{k: limpio(t.get(k)) for k in (
                    "id", "fecha", "nombre", "raciones", "unidad", "peso_racion_g",
                    "peso_crudo_g", "peso_cocinado_g", "raciones_consumidas",
                    "nota")} for t in tandas])

            # `momento` = fecha + hora. Sin hora queda NULL: "no se anotó" no es
            # "a las 00:00". Hará falta cuando entremos en digestión.
            cur.executemany(
                """INSERT INTO comidas (id, fecha, momento, descripcion, foto,
                       metodo, tanda_id, nota)
                   VALUES (%(id)s, %(fecha)s, %(momento)s,
                       %(descripcion)s, %(foto)s, %(metodo)s, %(tanda_id)s, %(nota)s)
                   ON CONFLICT (id) DO UPDATE SET
                       fecha=EXCLUDED.fecha, momento=EXCLUDED.momento,
                       descripcion=EXCLUDED.descripcion, foto=EXCLUDED.foto,
                       metodo=EXCLUDED.metodo, tanda_id=EXCLUDED.tanda_id,
                       nota=EXCLUDED.nota""",
                [{"id": c["id"], "fecha": limpio(c.get("fecha")),
                  # Sin hora → NULL. "No se anotó" no es "a las 00:00".
                  "momento": (f"{c['fecha']} {limpio(c.get('hora'))}"
                              if limpio(c.get("hora")) else None),
                  "descripcion": limpio(c.get("descripcion")),
                  "foto": limpio(c.get("foto")), "metodo": limpio(c.get("metodo")),
                  "tanda_id": c["_tanda_id"], "nota": limpio(c.get("nota"))}
                 for c in comidas])

            # ⚠️ Sin PK: se reemplazan en bloque o se duplicarían al relanzar.
            cur.execute("DELETE FROM comida_items WHERE comida_id = ANY(%s)",
                        ([c["id"] for c in comidas],))
            cur.executemany(
                """INSERT INTO comida_items (comida_id, alimento_id, cantidad_g,
                       origen_cantidad, incertidumbre_pct, nota)
                   VALUES (%(comida_id)s,%(alimento_id)s,%(cantidad_g)s,
                       %(origen_cantidad)s,%(incertidumbre_pct)s,%(nota)s)""",
                [{k: limpio(i.get(k)) for k in (
                    "comida_id", "alimento_id", "cantidad_g", "origen_cantidad",
                    "incertidumbre_pct", "nota")} for i in items])
        con.commit()

        # ── Prueba: la vista tiene que reproducir los totales del CSV ──────────
        print("\n🔬 v_comidas contra los totales que traía el CSV:\n")
        fallos = 0
        with con.cursor() as cur:
            for c in comidas:
                cur.execute(
                    "SELECT kcal, prot_g, error_pct FROM v_comidas WHERE id=%s",
                    (c["id"],))
                fila = cur.fetchone()
                if not fila:
                    print(f"  🔴 {c['id']}: la vista no devuelve nada")
                    fallos += 1
                    continue
                kcal, prot, err = fila
                esp_kcal = float(c["kcal"]) if limpio(c.get("kcal")) else None
                esp_prot = float(c["prot_g"]) if limpio(c.get("prot_g")) else None
                esp_err = float(c["error_pct"]) if limpio(c.get("error_pct")) else None
                ok = (esp_kcal is None or abs(float(kcal) - esp_kcal) <= 0.5)
                ok &= (esp_prot is None or abs(float(prot) - esp_prot) <= 0.5)
                marca = "✅" if ok else "🔴"
                fallos += 0 if ok else 1
                print(f"  {marca} {c['id']}  kcal {kcal} (CSV {esp_kcal}) · "
                      f"prot {prot} (CSV {esp_prot}) · error ±{err}% (CSV ±{esp_err}%)")

    print(f"\n{'✅ Carga verificada.' if not fallos else f'🔴 {fallos} comida(s) no cuadran.'}\n")
    return 1 if fallos else 0


def main() -> int:
    p = argparse.ArgumentParser(description="Migra el registro de comidas del vault.")
    p.add_argument("raiz", help="carpeta `raw/` del vault")
    p.add_argument("--dry-run", action="store_true")
    a = p.parse_args()
    if not os.path.isdir(a.raiz):
        print(f"No existe: {a.raiz}", file=sys.stderr)
        return 1
    return cargar(a.raiz, a.dry_run)


if __name__ == "__main__":
    sys.exit(main())
