"""Higía — API de salud personal.

Tres bloques, uno por pantalla de la app:
  · /dia        → Home: el dashboard del día
  · /comidas    → Food: registro y consulta, con macros CALCULADAS
  · /salud      → Salud: la pulsera, en vista SEMANAL

🔑 REGLA QUE ATRAVIESA TODA LA API: un hueco se devuelve como `null`, jamás como
   0. La app tiene que poder pintar "—" y no "0 kcal". "No tengo el dato" y "el
   dato es cero" son cosas distintas, y confundirlas es la forma más fácil de
   sacar una conclusión falsa.

🔑 LOS TOTALES NO SE GUARDAN, SE CALCULAN. Ningún endpoint acepta un total de
   macros: se derivan de los ingredientes en `v_comidas`. Por eso es imposible
   que el total de una comida diverja de su detalle (D15).
"""
from datetime import date, timedelta

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from . import bd
from .modelos import (INCERTIDUMBRE_POR_ORIGEN, ComidaEntrada, ConsumoEntrada,
                      DiaSubjetivoEntrada)

app = FastAPI(
    title="Higía",
    description="API de salud personal. Uso individual.",
    version="0.2.0",
)

# El frontend corre en otro puerto durante el desarrollo. Solo localhost: esto
# no sale a la red, igual que la base.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ══════════════════════════════════════════════════════════════════════════════
#  Salud del servicio
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/health", tags=["sistema"])
def health() -> dict:
    """Estado del backend y de su conexión con la base de datos."""
    try:
        fila = bd.consultar_uno(
            "SELECT current_setting('server_version') AS postgres,"
            " (SELECT count(*) FROM information_schema.tables"
            "  WHERE table_schema='public') AS tablas,"
            " (SELECT count(*) FROM mediciones) AS mediciones,"
            " (SELECT count(*) FROM sueno)      AS noches,"
            " (SELECT count(*) FROM comidas)    AS comidas")
        return {"estado": "ok", **fila}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(503, f"{type(e).__name__}: {e}")


# ══════════════════════════════════════════════════════════════════════════════
#  HOME — el día
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/dia/{fecha}", tags=["home"])
def dia(fecha: date) -> dict:
    """Todo lo que se sabe de un día. Los campos ausentes vienen `null`.

    ⚠️ `kcal_quemadas` sale de la pulsera y es la PEOR estimación de cualquier
    wearable (±20-30 %). Se devuelve junto a `kcal_quemadas_aviso` para que la
    app no la pinte como un número limpio al lado de las consumidas: esa resta
    es justo la que el método desaconseja.
    """
    fila = bd.consultar_uno(
        "SELECT * FROM v_dia_completo WHERE fecha = %s", (fecha,))
    if not fila:
        # 200 con todo a null, no 404: "no hay datos de ese día" es una
        # respuesta legítima que la app tiene que saber pintar como huecos.
        fila = {"fecha": fecha}
    fila["kcal_quemadas_aviso"] = (
        "Estimación del dispositivo, ±20-30 %. Sirve para comparar días entre "
        "sí, no para cuadrar un balance energético."
    )
    fila["comidas_detalle"] = bd.consultar(
        "SELECT id, momento, descripcion, kcal, prot_g, hc_g, grasa_g,"
        " lactosa, gluten, error_pct FROM v_comidas WHERE fecha = %s"
        " ORDER BY momento NULLS LAST, id", (fecha,))
    fila["consumos"] = bd.consultar(
        "SELECT id, sustancia, cantidad, unidad, momento, nota FROM consumos"
        " WHERE fecha = %s ORDER BY momento NULLS LAST, id", (fecha,))
    return fila


@app.get("/dias", tags=["home"])
def dias(desde: date | None = None, hasta: date | None = None,
         limite: int = Query(default=30, ge=1, le=400)) -> list[dict]:
    """Serie de días. Sin fechas, los últimos `limite` que tengan algo."""
    if desde and hasta:
        return bd.consultar(
            "SELECT * FROM v_dia_completo WHERE fecha BETWEEN %s AND %s"
            " ORDER BY fecha", (desde, hasta))
    return list(reversed(bd.consultar(
        "SELECT * FROM v_dia_completo ORDER BY fecha DESC LIMIT %s", (limite,))))


# ══════════════════════════════════════════════════════════════════════════════
#  FOOD
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/alimentos", tags=["food"])
def alimentos(q: str | None = None,
              limite: int = Query(default=50, ge=1, le=200)) -> list[dict]:
    """Catálogo. `q` busca por nombre o marca, sin distinguir acentos ni caja."""
    if q:
        return bd.consultar(
            "SELECT * FROM alimentos"
            " WHERE unaccent(nombre) ILIKE unaccent(%s)"
            "    OR unaccent(coalesce(marca,'')) ILIKE unaccent(%s)"
            " ORDER BY nombre LIMIT %s", (f"%{q}%", f"%{q}%", limite))
    return bd.consultar("SELECT * FROM alimentos ORDER BY nombre LIMIT %s",
                        (limite,))


@app.get("/comidas", tags=["food"])
def comidas(fecha: date | None = None,
            limite: int = Query(default=50, ge=1, le=200)) -> list[dict]:
    """Comidas con sus macros CALCULADAS desde los ingredientes."""
    if fecha:
        return bd.consultar(
            "SELECT * FROM v_comidas WHERE fecha = %s"
            " ORDER BY momento NULLS LAST, id", (fecha,))
    return bd.consultar(
        "SELECT * FROM v_comidas ORDER BY fecha DESC, momento NULLS LAST, id"
        " LIMIT %s", (limite,))


@app.get("/comidas/frecuentes", tags=["food"])
def comidas_frecuentes(limite: int = Query(default=10, ge=1, le=50)) -> list[dict]:
    """Las comidas que más repites, para volver a registrarlas de un clic.

    🔑 Es el endpoint que decide si el sistema sobrevive. Registrar una comida
    desde cero es lento; repetir una que ya comiste tiene que ser inmediato, o
    el registro se abandona en una semana y no hay datos que analizar.
    """
    return bd.consultar(
        "SELECT descripcion, count(*) AS veces, max(fecha) AS ultima,"
        "       (array_agg(id ORDER BY fecha DESC))[1] AS ultimo_id,"
        "       round(avg(kcal), 0) AS kcal_tipicas"
        " FROM v_comidas GROUP BY descripcion"
        " ORDER BY count(*) DESC, max(fecha) DESC LIMIT %s", (limite,))


@app.get("/comidas/{comida_id}", tags=["food"])
def comida(comida_id: str) -> dict:
    """Una comida con su desglose. El total viene de la vista, no de la tabla."""
    cab = bd.consultar_uno("SELECT * FROM v_comidas WHERE id = %s", (comida_id,))
    if not cab:
        raise HTTPException(404, f"No existe la comida {comida_id}")
    cab["items"] = bd.consultar(
        "SELECT i.alimento_id, a.nombre, a.marca, i.cantidad_g,"
        "       i.origen_cantidad, i.incertidumbre_pct, i.nota,"
        "       round((a.kcal   * i.cantidad_g / 100)::numeric, 1) AS kcal,"
        "       round((a.prot_g * i.cantidad_g / 100)::numeric, 1) AS prot_g,"
        "       a.lactosa, a.gluten"
        " FROM comida_items i JOIN alimentos a ON a.id = i.alimento_id"
        " WHERE i.comida_id = %s ORDER BY kcal DESC NULLS LAST", (comida_id,))
    return cab


@app.post("/comidas", status_code=201, tags=["food"])
def crear_comida(entrada: ComidaEntrada) -> dict:
    """Registra una comida. NO acepta totales: se calculan.

    El id se genera `c-AAAA-MM-DD-NN` siguiendo la convención que ya usaba el
    registro del vault.
    """
    with bd.cursor() as cur:
        cur.execute("SELECT count(*) AS n FROM comidas WHERE fecha = %s",
                    (entrada.fecha,))
        comida_id = f"c-{entrada.fecha}-{cur.fetchone()['n'] + 1:02d}"

        # Comprobar los alimentos ANTES de insertar nada: si uno no existe, es
        # mejor un 400 claro que una violación de clave ajena a medio camino.
        ids = {i.alimento_id for i in entrada.items}
        cur.execute("SELECT id FROM alimentos WHERE id = ANY(%s)", (list(ids),))
        faltan = ids - {f["id"] for f in cur.fetchall()}
        if faltan:
            raise HTTPException(
                400, f"Alimentos que no están en el catálogo: {sorted(faltan)}")

        cur.execute(
            "INSERT INTO comidas (id, fecha, momento, descripcion, foto, metodo,"
            " tanda_id, nota) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
            (comida_id, entrada.fecha, entrada.momento, entrada.descripcion,
             entrada.foto, entrada.metodo, entrada.tanda_id, entrada.nota))
        cur.executemany(
            "INSERT INTO comida_items (comida_id, alimento_id, cantidad_g,"
            " origen_cantidad, incertidumbre_pct, nota) VALUES (%s,%s,%s,%s,%s,%s)",
            [(comida_id, i.alimento_id, i.cantidad_g, i.origen_cantidad,
              # Si no se declara, se deduce del origen. Nunca se deja en 0:
              # eso afirmaría certeza absoluta sobre una cantidad estimada.
              i.incertidumbre_pct if i.incertidumbre_pct is not None
              else INCERTIDUMBRE_POR_ORIGEN[i.origen_cantidad],
              i.nota) for i in entrada.items])
    return comida(comida_id)


@app.delete("/comidas/{comida_id}", status_code=204, tags=["food"])
def borrar_comida(comida_id: str) -> None:
    with bd.cursor() as cur:
        cur.execute("DELETE FROM comidas WHERE id = %s", (comida_id,))
        if cur.rowcount == 0:
            raise HTTPException(404, f"No existe la comida {comida_id}")


# ══════════════════════════════════════════════════════════════════════════════
#  SALUD — vista SEMANAL
#
#  Decisión del usuario (2026-08-15): lo diario ya lo ve en Google Health; lo
#  que aporta esta app es la semana. Por eso aquí no hay endpoint por día.
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/salud/semanas", tags=["salud"])
def semanas(limite: int = Query(default=12, ge=1, le=104)) -> list[dict]:
    """Una fila por semana ISO.

    ⚠️ `dias_con_dato` viaja con cada media a propósito: una media de 7 noches y
    una de 1 no valen lo mismo, y sin ese número la app no puede distinguirlas.
    Hoy, con un solo Takeout, casi todas las semanas serán parciales.
    """
    return list(reversed(bd.consultar(
        """SELECT
             (date_trunc('week', fecha))::date AS semana_inicio,
             (date_trunc('week', fecha) + interval '6 days')::date AS semana_fin,
             count(*) FILTER (WHERE minutos_dormido IS NOT NULL) AS noches_con_dato,
             round(avg(minutos_dormido), 0)   AS dormido_min_media,
             round(avg(eficiencia), 0)        AS eficiencia_media,
             round(avg(puntuacion_sueno), 0)  AS puntuacion_sueno_media,
             round(avg(fc_reposo), 0)         AS fc_reposo_media,
             round(avg(hrv), 1)               AS hrv_media,
             round(avg(pulsaciones_media), 1) AS pulsaciones_media,
             round(avg(spo2_media), 1)        AS spo2_media,
             round(avg(pasos), 0)             AS pasos_media,
             round(sum(pasos), 0)             AS pasos_total,
             round(avg(kcal_quemadas), 0)     AS kcal_quemadas_media,
             round(avg(kcal_consumidas), 0)   AS kcal_consumidas_media,
             count(*) FILTER (WHERE kcal_consumidas IS NOT NULL) AS dias_con_comida,
             count(*)                         AS dias_con_dato
           FROM v_dia_completo
           GROUP BY 1, 2 ORDER BY 1 DESC LIMIT %s""", (limite,))))


@app.get("/salud/sueno", tags=["salud"])
def sueno(limite: int = Query(default=60, ge=1, le=400)) -> list[dict]:
    """Las noches, una por fila, con su hipnograma resumido.

    🔑 Se devuelven las noches SUELTAS y no medias: el primer hallazgo real de
    este sistema salió de ver cinco noches una debajo de otra, no de un
    promedio. Con pocas noches, la media esconde justo lo que hay que ver.

    ⚠️ `fases_min` (totales) y `tramos` (forma) NO son la misma cifra y no deben
    mezclarse. Los totales vienen de `levels.summary` y son los que coinciden
    con la app de Google; los tramos incluyen los micro-despertares y suman 4-6
    min más por fase. Para dar un número, `fases_min`. Para pintar la noche,
    `tramos`.
    """
    return list(reversed(bd.consultar(
        """SELECT s.noche, s.inicio, s.fin, s.minutos_dormido, s.minutos_despierto,
                  s.minutos_en_cama, s.eficiencia,
                  to_char(s.inicio, 'HH24:MI') AS hora_acostarse,
                  to_char(s.fin,    'HH24:MI') AS hora_levantarse,
                  to_char(s.noche,  'Dy')      AS dia_semana,
                  extract(isodow FROM s.noche) >= 5 AS es_finde,
                  json_build_object('deep', s.min_deep, 'light', s.min_light,
                                    'rem',  s.min_rem,  'wake',  s.min_wake)
                      AS fases_min,
                  (SELECT json_agg(json_build_object(
                              'inicio', f.inicio, 'fase', f.fase,
                              'minutos', round(f.segundos / 60.0, 1))
                          ORDER BY f.inicio)
                     FROM sueno_fases f WHERE f.log_id = s.log_id) AS tramos
           FROM sueno s WHERE s.principal
           ORDER BY s.noche DESC LIMIT %s""", (limite,))))


@app.get("/salud/serie/{metrica}", tags=["salud"])
def serie(metrica: str, desde: date | None = None, hasta: date | None = None,
          resolucion: str = Query(default="dia", pattern="^(dia|minuto)$")) -> dict:
    """Una métrica cruda, agregada por día o por minuto.

    ⚠️ `pasos` y `calorias` se SUMAN; el resto se promedian. Son incrementos por
    intervalo, no niveles: promediar pasos da un número sin significado.
    """
    ACUMULATIVAS = {"pasos", "calorias"}
    agg = "sum" if metrica in ACUMULATIVAS else "avg"
    bucket = "1 day" if resolucion == "dia" else "1 minute"
    hasta = hasta or date.today()
    desde = desde or (hasta - timedelta(days=30))
    puntos = bd.consultar(
        f"""SELECT time_bucket(%s, ts, 'Europe/Madrid') AS momento,
                   round({agg}(valor)::numeric, 2) AS valor,
                   count(*) AS n
            FROM mediciones
            WHERE metrica = %s AND ts >= %s AND ts < (%s::date + 1)
            GROUP BY 1 ORDER BY 1""",
        (bucket, metrica, desde, hasta))
    return {"metrica": metrica, "resolucion": resolucion,
            "agregacion": agg, "puntos": puntos}


@app.get("/salud/metricas", tags=["salud"])
def metricas() -> list[dict]:
    """Qué métricas hay cargadas y con cuánta cobertura."""
    return bd.consultar(
        """SELECT metrica, count(*) AS registros,
                  min(ts) AS desde, max(ts) AS hasta,
                  count(DISTINCT time_bucket('1 day', ts, 'Europe/Madrid')) AS dias
           FROM mediciones GROUP BY metrica ORDER BY metrica""")


# ══════════════════════════════════════════════════════════════════════════════
#  DIARIO SUBJETIVO Y CONSUMOS
#
#  Pensados para que Claude los rellene cada día preguntándote, que es como el
#  usuario los quiere alimentar.
# ══════════════════════════════════════════════════════════════════════════════

@app.put("/dia-subjetivo", tags=["diario"])
def guardar_dia_subjetivo(entrada: DiaSubjetivoEntrada) -> dict:
    """Escala 0-10. Un PUT por día: registrarlo dos veces corrige, no duplica.

    Los campos que no se envían quedan como estaban; enviar `null` explícito no
    borra. Es deliberado: preguntar solo por la energía no debe borrar el ánimo.
    """
    with bd.cursor() as cur:
        cur.execute(
            """INSERT INTO dia_subjetivo (fecha, como_me_siento, animo, energia, nota)
               VALUES (%s,%s,%s,%s,%s)
               ON CONFLICT (fecha) DO UPDATE SET
                   como_me_siento = coalesce(EXCLUDED.como_me_siento,
                                             dia_subjetivo.como_me_siento),
                   animo    = coalesce(EXCLUDED.animo,    dia_subjetivo.animo),
                   energia  = coalesce(EXCLUDED.energia,  dia_subjetivo.energia),
                   nota     = coalesce(EXCLUDED.nota,     dia_subjetivo.nota),
                   registrado_en = now()
               RETURNING *""",
            (entrada.fecha, entrada.como_me_siento, entrada.animo,
             entrada.energia, entrada.nota))
        return bd._numeros(cur.fetchone())


@app.get("/dia-subjetivo", tags=["diario"])
def listar_dia_subjetivo(limite: int = Query(default=60, ge=1, le=400)) -> list[dict]:
    return list(reversed(bd.consultar(
        "SELECT * FROM dia_subjetivo ORDER BY fecha DESC LIMIT %s", (limite,))))


@app.get("/dia-subjetivo/pendientes", tags=["diario"])
def dias_sin_registrar(limite: int = Query(default=14, ge=1, le=60)) -> list[date]:
    """Días con datos de la pulsera pero sin registro subjetivo.

    Es lo que permite que Claude sepa por qué días preguntar sin tener que
    adivinarlo. No incluye hoy: el día aún no ha terminado.
    """
    filas = bd.consultar(
        """SELECT d.fecha FROM v_dia_completo d
           LEFT JOIN dia_subjetivo s ON s.fecha = d.fecha
           WHERE s.fecha IS NULL AND d.fecha < current_date
           ORDER BY d.fecha DESC LIMIT %s""", (limite,))
    return [f["fecha"] for f in filas]


@app.post("/consumos", status_code=201, tags=["diario"])
def crear_consumo(entrada: ConsumoEntrada) -> dict:
    """Una fila por TOMA. Tres cafés son tres filas: la hora de cada uno cuenta."""
    with bd.cursor() as cur:
        cur.execute(
            """INSERT INTO consumos (fecha, sustancia, cantidad, unidad, momento, nota)
               VALUES (%s,%s,%s,%s,%s,%s) RETURNING *""",
            (entrada.fecha, entrada.sustancia, entrada.cantidad,
             entrada.unidad, entrada.momento, entrada.nota))
        return bd._numeros(cur.fetchone())


@app.get("/consumos", tags=["diario"])
def listar_consumos(fecha: date | None = None,
                    limite: int = Query(default=100, ge=1, le=500)) -> list[dict]:
    if fecha:
        return bd.consultar(
            "SELECT * FROM consumos WHERE fecha = %s"
            " ORDER BY momento NULLS LAST, id", (fecha,))
    return bd.consultar(
        "SELECT * FROM consumos ORDER BY fecha DESC, momento NULLS LAST, id"
        " LIMIT %s", (limite,))


@app.delete("/consumos/{consumo_id}", status_code=204, tags=["diario"])
def borrar_consumo(consumo_id: int) -> None:
    with bd.cursor() as cur:
        cur.execute("DELETE FROM consumos WHERE id = %s", (consumo_id,))
        if cur.rowcount == 0:
            raise HTTPException(404, f"No existe el consumo {consumo_id}")
