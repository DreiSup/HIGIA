-- ============================================================================
--  HIGÍA · 002 — Diario subjetivo y consumos
--
--  Decidido con el usuario el 2026-08-15. Cubre las dos piezas que faltaban
--  para poder correlacionar: cómo te sientes y qué te has metido.
--
--  ⚠️ `/docker-entrypoint-initdb.d` SOLO se ejecuta cuando la base se crea de
--     cero. Sobre una base que ya existe hay que aplicarlo a mano:
--       docker compose exec -T db psql -U higia -d higia < db/002_diario_y_consumos.sql
-- ============================================================================

-- Buscar "cafe" tiene que encontrar "café". Sin esto, el catálogo obliga a
-- escribir los acentos exactos y la búsqueda de alimentos se vuelve inútil.
CREATE EXTENSION IF NOT EXISTS unaccent;

-- ============================================================================
--  0. MINUTOS POR FASE — los totales buenos
--
--  🔑 El JSON de Fitbit da la misma información DOS VECES y NO coinciden:
--     · `levels.data`    → los tramos de la noche. Dan la FORMA (el hipnograma)
--                          y suman exactamente el tiempo en cama.
--     · `levels.summary` → los minutos por fase. Dan los TOTALES.
--
--     Sumar los tramos da 4-6 min de más por fase, porque cada tramo incluye
--     los micro-despertares que `summary` ya descuenta. Verificado el
--     2026-08-15: `summary` reproduce EXACTAMENTE la tabla de
--     `wiki/metricas/sueno.md` (74/51, 66/32, 77/81, 53/59, 81/65) y los
--     tramos no.
--
--  🔴 Por eso se guardan LAS DOS: `sueno_fases` tiene los tramos (para pintar
--     la noche) y estas columnas tienen los totales (para dar cifras). Usar los
--     tramos para dar totales enseñaría números que NO coinciden con los que el
--     usuario ve en su propia app de Google Health.
-- ============================================================================

ALTER TABLE sueno ADD COLUMN IF NOT EXISTS min_deep  int;
ALTER TABLE sueno ADD COLUMN IF NOT EXISTS min_light int;
ALTER TABLE sueno ADD COLUMN IF NOT EXISTS min_rem   int;
ALTER TABLE sueno ADD COLUMN IF NOT EXISTS min_wake  int;

COMMENT ON COLUMN sueno.min_deep IS
  'De levels.summary, NO de sumar sueno_fases. Ver cabecera de 002.';

-- ============================================================================
--  1. DIARIO SUBJETIVO
--
--  Lo que la pulsera no puede medir y solo puedes decir tú. Es la mitad que
--  falta de casi toda correlación interesante: "dormí 6 h" es un dato, "y al
--  día siguiente estaba arrastrándome" es el que hace accionable al primero.
-- ============================================================================

-- 🔑 LA ESCALA ES 0-10 Y NO SE CAMBIA.
--    Elegida el 2026-08-15 (cierra A5). 1-5 no distingue "regular" de "regular
--    tirando a mal"; 0-100 es precisión falsa — nadie separa un 63 de un 67
--    sobre su propio ánimo.
--
--    🔴 Cambiarla más adelante ROMPE LA COMPARABILIDAD DE TODO EL HISTÓRICO:
--    un 7/10 de enero y un 70/100 de junio no son el mismo dato. El CHECK está
--    aquí para que la escala sea una restricción de la base y no algo que haya
--    que acordarse de respetar.
--
--    Sesgo conocido a tener presente al interpretar: la gente se acumula en 7.

CREATE TABLE IF NOT EXISTS dia_subjetivo (
    fecha        date PRIMARY KEY,
    -- Las tres que pidió el usuario, en este orden.
    como_me_siento int CHECK (como_me_siento BETWEEN 0 AND 10),
    animo          int CHECK (animo          BETWEEN 0 AND 10),
    energia        int CHECK (energia        BETWEEN 0 AND 10),
    nota         text,
    -- Cuándo se registró, que no es lo mismo que el día al que se refiere.
    -- Un día puntuado tres días después vale menos: el recuerdo se deforma.
    registrado_en timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE dia_subjetivo IS
  'Un registro por día. Escala 0-10 en las tres, fijada por el CHECK. '
  'NULL = no se preguntó ese día (hueco). Nunca rellenar con un valor supuesto.';
COMMENT ON COLUMN dia_subjetivo.registrado_en IS
  'Si registrado_en - fecha es grande, el dato es un recuerdo, no una lectura.';

-- ============================================================================
--  2. CONSUMOS
--
--  Café, L-teanina, nicotina y lo que aparezca. No son alimentos: no aportan
--  macros y no entran en `comida_items`, pero SÍ son variables candidatas de
--  cualquier correlación con sueño, energía y ánimo.
--
--  Por qué tabla propia y no `alimentos`: D11 explica que no se abrió un
--  esquema de suplementos porque la creatina ya estaba en la línea base del
--  usuario. Estos son distintos — cambian de un día a otro, y esa variación es
--  justamente la señal.
-- ============================================================================

CREATE TABLE IF NOT EXISTS consumos (
    id        bigserial PRIMARY KEY,
    fecha     date        NOT NULL,
    -- ⚠️ Texto libre a propósito: el usuario no quiso un catálogo cerrado.
    --    El riesgo es la fragmentación ('cafe' / 'café' / 'Café' contarían como
    --    tres sustancias distintas y romperían cualquier agrupación). Por eso
    --    se guarda NORMALIZADO en minúsculas y sin espacios sobrantes, vía el
    --    trigger de abajo. Si algún día molesta, se cierra con un catálogo.
    sustancia text        NOT NULL,
    cantidad  numeric     CHECK (cantidad >= 0),
    unidad    text,                  -- mg | ml | taza | cigarrillo | unidad...
    -- NULL = se sabe que fue ese día, pero no a qué hora. La hora importa
    -- muchísimo aquí: un café a las 09:00 y otro a las 18:00 no son el mismo
    -- dato para el sueño de esa noche.
    momento   timestamptz,
    nota      text
);

CREATE INDEX IF NOT EXISTS ix_consumos_fecha     ON consumos (fecha);
CREATE INDEX IF NOT EXISTS ix_consumos_sustancia ON consumos (sustancia, fecha);

COMMENT ON TABLE consumos IS
  'Cafeína, nicotina, suplementos y demás. Una fila por toma, no por día: '
  'tres cafés son tres filas, porque la hora de cada uno es parte del dato.';

CREATE OR REPLACE FUNCTION normalizar_sustancia() RETURNS trigger AS $$
BEGIN
    NEW.sustancia := lower(btrim(NEW.sustancia));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_normalizar_sustancia ON consumos;
CREATE TRIGGER tg_normalizar_sustancia
    BEFORE INSERT OR UPDATE ON consumos
    FOR EACH ROW EXECUTE FUNCTION normalizar_sustancia();

-- ============================================================================
--  3. VISTA DEL DÍA — una fila por día con todo lo que se sabe de él
--
--  🔑 Es la pieza que hace posibles las correlaciones que quiere el usuario:
--     "siempre que como X, al día siguiente duermo peor". Sin esto, cada
--     pregunta exige rehacer los cruces a mano.
--
--  ⚠️ FULL JOIN, no INNER: un día con sueño pero sin comidas TIENE que salir.
--     Con INNER JOIN desaparecería, y un día ausente se lee como "no pasó nada"
--     cuando lo que pasa es que falta el dato. Hueco ≠ resultado nulo.
--
--  ⚠️ `pasos` y `calorias` van con SUM, no con AVG: son incrementos por
--     intervalo, no niveles. Promediarlos da un número sin significado.
--     Las demás (pulsaciones, spo2, temperatura) sí son niveles → AVG.
--
--  🔴 DOS TRAMPAS DE FECHA, las dos silenciosas. Detectadas el 2026-08-15:
--
--  1. `time_bucket('1 day', ts)` sobre un `timestamptz` agrupa por medianoche
--     **UTC**, no de Madrid. Un dato de las 00:30 hora local caía en el día
--     ANTERIOR. Se arregla pasándole la zona: `time_bucket(..., 'Europe/Madrid')`.
--
--  2. Las métricas de NOCHE (puntuación de sueño, FC en reposo, HRV, FC no-REM,
--     frecuencia respiratoria) vienen selladas al DESPERTAR o a las 00:00 del
--     día siguiente. Agruparlas por día natural las atribuye a la noche
--     equivocada: la puntuación de la noche del 08 aparecía en el 09.
--     Se les aplica el MISMO corte a mediodía que a `sueno.noche`.
-- ============================================================================

CREATE OR REPLACE VIEW v_dia_completo AS
WITH dias AS (
    SELECT noche AS fecha FROM sueno
    UNION SELECT fecha FROM comidas
    UNION SELECT fecha FROM dia_subjetivo
    UNION SELECT fecha FROM consumos
    UNION SELECT time_bucket('1 day', ts, 'Europe/Madrid')::date FROM mediciones
),
-- Métricas de CALENDARIO: pertenecen al día en que se midieron.
series_dia AS (
    SELECT time_bucket('1 day', ts, 'Europe/Madrid')::date AS fecha,
           round(avg(valor) FILTER (WHERE metrica = 'pulsaciones')::numeric, 1) AS pulsaciones_media,
           round(min(valor) FILTER (WHERE metrica = 'pulsaciones')::numeric, 0) AS pulsaciones_min,
           round(max(valor) FILTER (WHERE metrica = 'pulsaciones')::numeric, 0) AS pulsaciones_max,
           round(sum(valor) FILTER (WHERE metrica = 'pasos')::numeric, 0)       AS pasos,
           round(sum(valor) FILTER (WHERE metrica = 'calorias')::numeric, 0)    AS kcal_quemadas,
           round(avg(valor) FILTER (WHERE metrica = 'spo2')::numeric, 1)        AS spo2_media,
           round(avg(valor) FILTER (WHERE metrica = 'temperatura')::numeric, 2) AS temperatura_media
    FROM mediciones
    WHERE metrica IN ('pulsaciones','pasos','calorias','spo2','temperatura')
    GROUP BY 1
),
-- Métricas de NOCHE: se atribuyen a la noche, con el mismo corte que `sueno`.
series_noche AS (
    SELECT (((ts AT TIME ZONE 'Europe/Madrid') - interval '12 hours'))::date AS fecha,
           round(max(valor) FILTER (WHERE metrica = 'hrv')::numeric, 1)       AS hrv,
           round(max(valor) FILTER (WHERE metrica = 'fc_reposo')::numeric, 0) AS fc_reposo,
           round(max(valor) FILTER (WHERE metrica = 'fc_no_rem')::numeric, 1) AS fc_no_rem,
           round(max(valor) FILTER (WHERE metrica = 'frecuencia_respiratoria')::numeric, 1) AS frecuencia_respiratoria,
           round(max(valor) FILTER (WHERE metrica = 'puntuacion_sueno')::numeric, 0) AS puntuacion_sueno
    FROM mediciones
    WHERE metrica IN ('hrv','fc_reposo','fc_no_rem','frecuencia_respiratoria','puntuacion_sueno')
    GROUP BY 1
)
SELECT d.fecha,
       -- Sueño: solo el principal. Sin este filtro las siestas cuentan como noches.
       s.minutos_dormido, s.minutos_en_cama, s.eficiencia,
       s.inicio AS sueno_inicio, s.fin AS sueno_fin,
       sn.puntuacion_sueno, sn.fc_reposo, sn.hrv, sn.fc_no_rem,
       sn.frecuencia_respiratoria,
       se.pulsaciones_media, se.pulsaciones_min, se.pulsaciones_max,
       se.pasos, se.kcal_quemadas, se.spo2_media, se.temperatura_media,
       -- Comida: viene de v_dias, que a su vez sale de los ingredientes.
       c.comidas, c.kcal AS kcal_consumidas, c.prot_g, c.hc_g, c.grasa_g,
       c.sat_g, c.fibra_g, c.sal_g, c.algo_con_lactosa, c.algo_con_gluten,
       -- Subjetivo.
       ds.como_me_siento, ds.animo, ds.energia, ds.nota AS nota_dia
FROM dias d
LEFT JOIN sueno s          ON s.noche  = d.fecha AND s.principal
LEFT JOIN series_dia se    ON se.fecha = d.fecha
LEFT JOIN series_noche sn  ON sn.fecha = d.fecha
LEFT JOIN v_dias c         ON c.fecha  = d.fecha
LEFT JOIN dia_subjetivo ds ON ds.fecha = d.fecha;

COMMENT ON VIEW v_dia_completo IS
  'Una fila por día con sueño, series, comida y subjetivo. NULL = hueco real, '
  'no cero. Es la base de cualquier correlación.';
