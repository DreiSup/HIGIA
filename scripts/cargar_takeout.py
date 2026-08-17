#!/usr/bin/env python3
"""
Carga un export de Google Takeout (Fitbit / Google Health) en la base de Higía.

Lee el ZIP directamente, sin descomprimir. Es IDEMPOTENTE: se puede relanzar sobre
el mismo export, o sobre exports que se solapen, sin duplicar nada.

Uso (desde el contenedor del backend, que ya tiene psycopg y /datos montado):
    docker compose exec backend python /scripts/cargar_takeout.py /datos/takeout/<fichero>.zip
    docker compose exec backend python /scripts/cargar_takeout.py <zip> --dry-run

────────────────────────────────────────────────────────────────────────────────
 DECISIONES QUE IMPLEMENTA ESTE FICHERO — cambiarlas aquí cambia los datos
────────────────────────────────────────────────────────────────────────────────

D14 · Una fuente canónica por métrica. El export duplica casi todo: la FC está en
      JSON (~6 s) y en CSV (~3 s); el sueño aparece en cuatro sitios. Se elige uno
      y queda escrito.

D14-bis · ⚠️ NO BASTA CON ELEGIR FICHERO: HAY QUE FILTRAR POR DISPOSITIVO.
      El mismo CSV mezcla tres fuentes — `Google Fitbit Air`, `Nothing X Health
      Connect` y `Phone Health Connect` (el móvil). En `steps` el móvil aporta 736
      registros frente a 1.188 del reloj: cargarlos todos CUENTA LOS PASOS DOS
      VECES, porque ambos miden la misma caminata. Se carga solo la pulsera.
      🔴 `resting_heart_rate` viene SOLO del móvil, así que no se usa ese fichero:
         la FC en reposo se toma de `nremhr` (FC nocturna real de la pulsera).

Zonas horarias · El Takeout MEZCLA formatos y esto produce errores silenciosos:
      · `2026-08-10T00:00:02Z`  → lleva Z, es UTC
      · `2026-08-12T22:00:30`   → sin zona, es HORA LOCAL (Europe/Madrid)
      El sueño viene en local sin zona y las pulsaciones en UTC. Sin tratarlos
      distinto, los cruces temporales salen desplazados 2 h en verano SIN AVISAR.

`noche` · Es la fecha de LA TARDE en que te acuestas, no `dateOfSleep` (que es el
      día en que te despiertas). Se calcula cortando a mediodía. Verificado el
      2026-08-15 contra la tabla de `wiki/metricas/sueno.md`: reproduce las cinco
      noches (sáb 08 → mié 12) y la media de 6,26 h exactas.

`principal` ← `mainSleep` · Sin este filtro las siestas cuentan como noches.
"""
import argparse
import csv
import io
import json
import os
import re
import sys
import zipfile
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import psycopg

# ⚠️ Zona real, NO un desfase fijo. En agosto Madrid es UTC+2 y en enero UTC+1:
#    fijar +2 "porque los datos son de agosto" mete un error de una hora en
#    cuanto llegue el primer export de invierno, y no avisaría.
MADRID = ZoneInfo("Europe/Madrid")

BASE = "Takeout/Google Health/"

# El dispositivo canónico. Todo lo que no venga de aquí se descarta cuando la
# métrica está duplicada entre reloj y móvil. Ver D14-bis arriba.
DISPOSITIVO = "Google Fitbit Air"

# ──────────────────────────────────────────────────────────────────────────────
#  VALORES CENTINELA — lecturas fallidas disfrazadas de dato
# ──────────────────────────────────────────────────────────────────────────────
# 🔴 `spo2` emite exactamente 50 cuando el sensor NO consigue leer. Comprobado
#    el 2026-08-15 sobre este export: el 50 aparece 263 veces, redondo, y no hay
#    NADA entre 50 y 76; el resto de valores aparecen una sola vez y con
#    decimales. Es un centinela, no una distribución.
#
#    Descartarlo NO es inventar un dato (regla 6): es reconocer que ahí no hubo
#    medición. Cargarlo sí sería el error — pintaría un mínimo de 50 % en la app,
#    que leído como saturación real es una urgencia médica que nunca ocurrió.
#    Un hueco tiene que verse como hueco (regla 9 del vault).
CENTINELAS = {"spo2": {50.0}}


# ──────────────────────────────────────────────────────────────────────────────
#  Utilidades
# ──────────────────────────────────────────────────────────────────────────────

def url_base_datos() -> str:
    """Misma lógica que el backend: se arma desde piezas, nunca desde una URL ya
    montada, porque el `.env` vive en el directorio padre (fuera del repo)."""
    return (
        f"postgresql://{os.getenv('POSTGRES_USER', 'higia')}"
        f":{os.environ['POSTGRES_PASSWORD']}"
        f"@{os.getenv('POSTGRES_HOST', 'db')}"
        f":{os.getenv('POSTGRES_PORT', '5432')}"
        f"/{os.getenv('POSTGRES_DB', 'higia')}"
    )


def momento(texto: str, forzar_local: bool = False) -> datetime:
    """Convierte un timestamp del Takeout en uno CON zona horaria.

    Si trae `Z` es UTC. Si no trae zona, es hora local de Madrid — y tratarlo
    como UTC es el error silencioso que desplaza dos horas los cruces.

    🔴 `forzar_local` existe porque HAY UN FICHERO QUE MIENTE. En
    `Sleep Score/sleep_score.csv` los timestamps llevan `Z` pero NO son UTC:
    comprobado el 2026-08-15 comparando por `logId` contra el JSON de sueño —
    la misma noche 53287889033 aparece como `2026-08-13T05:29:00Z` en el CSV y
    como `2026-08-13T05:29:00` (local, sin zona) en el JSON. Dígitos idénticos,
    luego es el mismo instante y la `Z` sobra. Creérsela mete +2 h a cada
    puntuación y la coloca DESPUÉS de que la noche haya terminado.
    """
    t = texto.strip()
    if forzar_local:
        return datetime.fromisoformat(t.rstrip("Z")).replace(tzinfo=MADRID)
    if t.endswith("Z"):
        return datetime.fromisoformat(t[:-1]).replace(tzinfo=timezone.utc)
    d = datetime.fromisoformat(t)
    return d if d.tzinfo else d.replace(tzinfo=MADRID)


def noche_de(inicio: datetime):
    """La noche a la que pertenece un sueño = la fecha de la TARDE.

    Acostarse a las 22:00 del 12 → noche del 12.
    Acostarse a las 00:50 del  9 → noche del  8, no del 9.
    """
    return (inicio - timedelta(hours=12)).date()


def ficheros(z: zipfile.ZipFile, carpeta: str, patron: str):
    """Ficheros de una carpeta cuyo nombre casa con `patron`, ordenados."""
    rx = re.compile(patron)
    return sorted(
        i.filename
        for i in z.infolist()
        if not i.is_dir()
        and i.filename.startswith(BASE + carpeta)
        and rx.search(os.path.basename(i.filename))
    )


def filas_csv(z: zipfile.ZipFile, nombre: str):
    return csv.DictReader(io.StringIO(z.read(nombre).decode("utf-8", "replace")))


def columna_fuente(fila: dict):
    """El nombre de la columna de dispositivo cambia entre ficheros."""
    for c in fila:
        if c and "source" in c.lower():
            return c
    return None


# ──────────────────────────────────────────────────────────────────────────────
#  Extracción — cada función devuelve filas listas para insertar
# ──────────────────────────────────────────────────────────────────────────────

def extraer_sueno(z: zipfile.ZipFile):
    """Sueño y fases desde el JSON clásico de Fitbit (fases ya segmentadas)."""
    noches, fases = [], []
    for nombre in ficheros(z, "Global Export Data", r"^sleep-.*\.json$"):
        for r in json.loads(z.read(nombre)):
            # `type` puede ser "stages" (con hipnograma) o "classic" (sin él).
            # Los dos se cargan: la noche vale igual, solo faltarían las fases.
            inicio, fin = momento(r["startTime"]), momento(r["endTime"])
            niveles = r.get("levels") or {}
            # Los minutos por fase salen de `summary`, NO de sumar los tramos:
            # los tramos incluyen micro-despertares que `summary` ya descuenta,
            # y son los de `summary` los que coinciden con la app de Google.
            res = niveles.get("summary") or {}
            def mins(fase):
                return (res.get(fase) or {}).get("minutes")
            noches.append((
                r["logId"], noche_de(inicio), inicio, fin,
                r.get("minutesAsleep"), r.get("minutesAwake"), r.get("timeInBed"),
                r.get("efficiency"), bool(r.get("mainSleep")), "takeout_json",
                mins("deep"), mins("light"), mins("rem"), mins("wake"),
            ))
            # 🔴 SOLO `data`. `shortData` NO son despertares adicionales: son un
            #    refinamiento CONTENIDO DENTRO de los tramos de `data`, así que
            #    cargar ambos duplica tiempo.
            #
            #    Comprobado el 2026-08-15 sobre las 5 noches de este export:
            #      solo `data`       → suma EXACTAMENTE `timeInBed` (dif. 0)
            #      `data`+`shortData`→ se pasa entre 11 y 26 min por noche
            #    El invariante de abajo vuelve a comprobarlo en cada carga.
            for f in niveles.get("data") or []:
                fases.append((
                    r["logId"], momento(f["dateTime"]),
                    f["level"], f["seconds"],
                ))

    # ── Invariante: las fases de una noche tienen que sumar su tiempo en cama.
    #    Si no cuadra, el hipnograma está mal y cualquier gráfica que lo pinte
    #    mentiría sin dar ningún error.
    por_log = defaultdict(int)
    for log_id, _, _, seg in fases:
        por_log[log_id] += seg
    for fila in noches:
        log_id, en_cama = fila[0], fila[6]
        if en_cama is None:
            continue
        dif = round(por_log.get(log_id, 0) / 60) - en_cama
        if abs(dif) > 2:
            raise SystemExit(
                f"\n🔴 Noche {log_id}: las fases suman {dif:+d} min respecto al "
                f"tiempo en cama ({en_cama} min). El hipnograma no cuadra.\n")
    return noches, fases


def extraer_series(z: zipfile.ZipFile):
    """Series escalares → (ts, metrica, valor, fuente).

    Cada entrada declara: carpeta, patrón, columna del valor, nombre de métrica,
    y si hay que filtrar por dispositivo.
    """
    # (carpeta, patron, col_ts, col_valor, metrica, filtrar_dispositivo)
    #
    # ⚠️ Los patrones van ANCLADOS A LA FECHA (`_\d{4}-\d{2}-\d{2}\.csv`) a
    #    propósito. Con `^heart_rate_.*` se colaba `heart_rate_variability_*`,
    #    que tiene otras columnas: la métrica se habría cargado mal.
    FECHA = r"_\d{4}-\d{2}-\d{2}\.csv$"
    FUENTES = [
        # ── Intradía, de la pulsera. D14: el CSV de Google, no el JSON. ────────
        ("Physical Activity_GoogleData", r"^heart_rate" + FECHA,
         "timestamp", "beats per minute", "pulsaciones", True),
        ("Physical Activity_GoogleData", r"^oxygen_saturation" + FECHA,
         "timestamp", "oxygen saturation percentage", "spo2", True),
        ("Physical Activity_GoogleData", r"^body_temperature" + FECHA,
         "timestamp", "temperature celsius", "temperatura", True),
        # ⚠️ Solo la pulsera: el móvil cuenta los mismos pasos otra vez.
        ("Physical Activity_GoogleData", r"^steps" + FECHA,
         "timestamp", "steps", "pasos", True),
        # Calorías las emite "Fitbit App", no el reloj: no se filtra.
        # 🔴 Fiabilidad mala (±20-30 %). Se guardan, pero ver el aviso del vault.
        ("Physical Activity_GoogleData", r"^calories" + FECHA,
         "timestamp", "calories", "calorias", False),

        # ── Resúmenes diarios (una fila por día, sin zona → hora local) ────────
        ("Heart Rate Variability", r"^Daily Heart Rate Variability Summary.*\.csv$",
         "timestamp", "rmssd", "hrv", False),
        # ⚠️ `nremhr` es la FC media durante sueño NO-REM, que NO es lo mismo que
        #    la "FC en reposo" que publica Fitbit: salen ~5 lpm por debajo (46-58
        #    frente a 53-59). Se guarda con su nombre real para no confundirlas.
        #    La FC en reposo de verdad se carga aparte, desde `sleep_score.csv`.
        ("Heart Rate Variability", r"^Daily Heart Rate Variability Summary.*\.csv$",
         "timestamp", "nremhr", "fc_no_rem", False),
        ("Heart Rate Variability", r"^Daily Respiratory Rate Summary.*\.csv$",
         "timestamp", "daily_respiratory_rate", "frecuencia_respiratoria", False),
    ]

    total = defaultdict(int)
    descartadas = defaultdict(int)
    for carpeta, patron, col_ts, col_val, metrica, filtrar in FUENTES:
        for nombre in ficheros(z, carpeta, patron):
            lector = filas_csv(z, nombre)
            # 🔴 Si la columna no existe, `fila.get()` devolvería None y la
            #    métrica se cargaría con CERO filas sin una sola queja. Pasó de
            #    verdad con `temperatura` (la columna es "temperature celsius",
            #    no "temperature"). Un hueco silencioso es peor que un fallo.
            if lector.fieldnames and col_val not in lector.fieldnames:
                raise SystemExit(
                    f"\n🔴 {os.path.basename(nombre)}: no existe la columna "
                    f"'{col_val}' (métrica '{metrica}').\n"
                    f"   Columnas reales: {lector.fieldnames}\n")
            for fila in lector:
                if filtrar:
                    col = columna_fuente(fila)
                    if col and fila[col] != DISPOSITIVO:
                        descartadas[metrica] += 1
                        continue
                bruto = (fila.get(col_val) or "").strip()
                if not bruto or bruto.lower() in ("nan", "null"):
                    continue  # hueco, no cero (regla 6 del vault)
                try:
                    valor = float(bruto)
                except ValueError:
                    continue
                if valor in CENTINELAS.get(metrica, ()):
                    descartadas[metrica + " (centinela)"] += 1
                    continue
                total[metrica] += 1
                yield (momento(fila[col_ts]), metrica, valor,
                       "takeout_csv" if filtrar else "takeout_csv_app")
    extraer_series.resumen = (dict(total), dict(descartadas))


def extraer_sleep_score(z: zipfile.ZipFile):
    """`sleep_score.csv` — una fila por noche, sellada al despertar.

    Da dos métricas: la puntuación del dispositivo y la FC en reposo REAL de
    Fitbit (la que enseña la app), que no es `nremhr`.

    ⚠️ `forzar_local=True`: este fichero pone `Z` sin ser UTC. Ver `momento()`.
    """
    COLUMNAS = [("overall_score", "puntuacion_sueno"),
                ("resting_heart_rate", "fc_reposo")]
    for nombre in ficheros(z, "Sleep Score", r"^sleep_score\.csv$"):
        for fila in filas_csv(z, nombre):
            ts = momento(fila["timestamp"], forzar_local=True)
            for col, metrica in COLUMNAS:
                bruto = (fila.get(col) or "").strip()
                if not bruto:
                    continue  # hueco, no cero
                yield (ts, metrica, float(bruto), "takeout_csv")


# ──────────────────────────────────────────────────────────────────────────────
#  Carga
# ──────────────────────────────────────────────────────────────────────────────

def cargar(ruta_zip: str, dry_run: bool = False) -> int:
    z = zipfile.ZipFile(ruta_zip)
    print(f"\n📦 {os.path.basename(ruta_zip)}\n")

    noches, fases = extraer_sueno(z)
    print(f"  sueño ............ {len(noches):>7} noches · {len(fases):>7} fases")

    series = list(extraer_series(z)) + list(extraer_sleep_score(z))
    por_metrica, descartadas = getattr(extraer_series, "resumen", ({}, {}))
    for m in ("puntuacion_sueno", "fc_reposo"):
        por_metrica[m] = sum(1 for s in series if s[1] == m)
    for m in sorted(por_metrica):
        aviso = ""
        if descartadas.get(m):
            aviso = f"   (⚠️ {descartadas[m]} descartadas: no son de la pulsera)"
        print(f"  {m:.<18} {por_metrica[m]:>7} registros{aviso}")

    if dry_run:
        print("\n🔍 --dry-run: no se ha escrito nada.\n")
        return 0

    with psycopg.connect(url_base_datos()) as con:
        with con.cursor() as cur:
            # ── Sueño. Se actualiza: un export posterior puede corregir una noche.
            cur.executemany(
                """INSERT INTO sueno (log_id, noche, inicio, fin, minutos_dormido,
                       minutos_despierto, minutos_en_cama, eficiencia, principal,
                       fuente, min_deep, min_light, min_rem, min_wake)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (log_id) DO UPDATE SET
                       noche=EXCLUDED.noche, inicio=EXCLUDED.inicio, fin=EXCLUDED.fin,
                       minutos_dormido=EXCLUDED.minutos_dormido,
                       minutos_despierto=EXCLUDED.minutos_despierto,
                       minutos_en_cama=EXCLUDED.minutos_en_cama,
                       eficiencia=EXCLUDED.eficiencia, principal=EXCLUDED.principal,
                       min_deep=EXCLUDED.min_deep, min_light=EXCLUDED.min_light,
                       min_rem=EXCLUDED.min_rem, min_wake=EXCLUDED.min_wake""",
                noches)
            cur.executemany(
                """INSERT INTO sueno_fases (log_id, inicio, fase, segundos)
                   VALUES (%s,%s,%s,%s) ON CONFLICT (log_id, inicio) DO NOTHING""",
                fases)

            # ── Series. Volumen alto → tabla temporal + INSERT ... SELECT, que
            #    permite ON CONFLICT sin hacer 180.000 round-trips.
            cur.execute("""CREATE TEMP TABLE _carga (
                               ts timestamptz, metrica text,
                               valor double precision, fuente text)
                           ON COMMIT DROP""")
            with cur.copy("COPY _carga (ts, metrica, valor, fuente) FROM STDIN") as cp:
                for fila in series:
                    cp.write_row(fila)
            cur.execute(
                """INSERT INTO mediciones (ts, metrica, valor, fuente)
                   SELECT DISTINCT ON (metrica, ts) ts, metrica, valor, fuente
                   FROM _carga ORDER BY metrica, ts
                   ON CONFLICT (metrica, ts) DO NOTHING""")
            insertadas = cur.rowcount
        con.commit()

        # ── Los agregados continuos se crearon WITH NO DATA: si no se refrescan,
        #    la app leería vistas VACÍAS sobre una base llena. Error silencioso.
        con.autocommit = True
        with con.cursor() as cur:
            for vista in ("mediciones_minuto", "mediciones_dia"):
                cur.execute(
                    f"CALL refresh_continuous_aggregate('{vista}', NULL, NULL)")
                print(f"  ↻ {vista} refrescada")

    print(f"\n✅ {len(noches)} noches · {len(fases)} fases · "
          f"{insertadas} mediciones nuevas (de {len(series)} leídas)\n")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description="Carga un Takeout en la base de Higía.")
    p.add_argument("zip", help="ruta al ZIP del Takeout")
    p.add_argument("--dry-run", action="store_true",
                   help="cuenta lo que cargaría, sin escribir")
    a = p.parse_args()
    if not os.path.exists(a.zip):
        print(f"No existe: {a.zip}", file=sys.stderr)
        return 1
    return cargar(a.zip, a.dry_run)


if __name__ == "__main__":
    sys.exit(main())
