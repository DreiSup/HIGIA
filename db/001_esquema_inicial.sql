-- ============================================================================
--  HIGÍA — esquema de la base de datos de salud personal
--  Postgres 16 + TimescaleDB · localhost:5433
--
--  Diseño híbrido, decidido con el usuario el 2026-08-14:
--    · Series escalares  -> UNA hypertable (`mediciones`)
--    · Sueño             -> tablas propias (es un INTERVALO, no un escalar)
--    · Alimentación      -> relacional, con los TOTALES CALCULADOS por vista
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ============================================================================
--  1. SERIES ESCALARES
--  Pulsaciones, temperatura, SpO2, pasos, calorias... todas tienen la misma
--  forma: (momento, numero). Una sola tabla -> añadir una metrica nueva no
--  requiere crear nada.
-- ============================================================================

CREATE TABLE IF NOT EXISTS mediciones (
    ts       timestamptz      NOT NULL,
    metrica  text             NOT NULL,
    valor    double precision NOT NULL,
    fuente   text             NOT NULL DEFAULT 'takeout_csv',
    PRIMARY KEY (metrica, ts)
);

SELECT create_hypertable('mediciones', 'ts', if_not_exists => TRUE);

COMMENT ON TABLE mediciones IS
  'Series escalares. metrica: pulsaciones|temperatura|spo2|pasos|calorias|hrv|fc_reposo';
COMMENT ON COLUMN mediciones.fuente IS
  'D14: la fuente canonica de pulsaciones es el CSV de Google (~3 s), NO el JSON (~6 s)';

-- ============================================================================
--  2. SUEÑO — intervalos, no escalares
-- ============================================================================

CREATE TABLE IF NOT EXISTS sueno (
    log_id            bigint      PRIMARY KEY,
    noche             date        NOT NULL,
    inicio            timestamptz NOT NULL,
    fin               timestamptz NOT NULL,
    minutos_dormido   int,
    minutos_despierto int,
    minutos_en_cama   int,
    eficiencia        int,
    -- OJO: falso = siesta. Sin filtrar por esto, las siestas cuentan como
    -- noches y destrozan cualquier media.
    principal         boolean     NOT NULL,
    fuente            text        NOT NULL DEFAULT 'takeout_json'
);

CREATE INDEX IF NOT EXISTS ix_sueno_noche ON sueno (noche);
-- Indice de rango: hace rapidos los cruces "que pasaba MIENTRAS dormia".
CREATE INDEX IF NOT EXISTS ix_sueno_rango
    ON sueno USING gist (tstzrange(inicio, fin));

CREATE TABLE IF NOT EXISTS sueno_fases (
    log_id   bigint      NOT NULL REFERENCES sueno(log_id) ON DELETE CASCADE,
    inicio   timestamptz NOT NULL,
    fase     text        NOT NULL,   -- deep | light | rem | wake
    segundos int         NOT NULL,
    PRIMARY KEY (log_id, inicio)
);

-- ============================================================================
--  3. ALIMENTACIÓN
--  La base pasa a ser la fuente de verdad (A4, 2026-08-14). El vault guarda
--  el contexto y los enlaces, no los datos.
-- ============================================================================

CREATE TABLE IF NOT EXISTS alimentos (
    id                     text PRIMARY KEY,
    nombre                 text NOT NULL,
    marca                  text,
    formato                text,
    url                    text,
    -- Jerarquia de fuentes (D7): etiqueta > bedca > usda > estimado.
    fuente                 text NOT NULL,
    fecha_consulta         date,
    base                   text,          -- 100g | 100g_comestible
    kcal                   numeric,
    prot_g                 numeric,
    hc_g                   numeric,
    azucar_g               numeric,
    grasa_g                numeric,
    sat_g                  numeric,
    fibra_g                numeric,
    sal_g                  numeric,
    -- El corazon de los ensayos. 'desconocido' NO es 'no'.
    lactosa                text NOT NULL DEFAULT 'desconocido',
    gluten                 text NOT NULL DEFAULT 'desconocido',
    unidades_envase        int,           -- lo que hizo exacto el bacon
    peso_unidad_g          numeric,
    porcion_comestible_pct numeric DEFAULT 100,
    notas                  text,
    CONSTRAINT ck_fuente  CHECK (fuente  IN ('etiqueta','bedca','usda','estimado')),
    CONSTRAINT ck_lactosa CHECK (lactosa IN ('si','no','trazas','desconocido')),
    CONSTRAINT ck_gluten  CHECK (gluten  IN ('si','no','trazas','desconocido'))
);

CREATE TABLE IF NOT EXISTS tandas (
    id                  text PRIMARY KEY,
    fecha               date NOT NULL,
    nombre              text NOT NULL,
    raciones            int  NOT NULL CHECK (raciones > 0),
    unidad              text,
    peso_racion_g       numeric,
    peso_crudo_g        numeric,
    peso_cocinado_g     numeric,
    raciones_consumidas int DEFAULT 0,
    notas               text
);
COMMENT ON TABLE tandas IS
  'Se cocina una vez y se come varias. Los macros salen de la fraccion de tanda '
  'sobre ingredientes CRUDOS: el peso cocinado NO sirve para calcular.';

CREATE TABLE IF NOT EXISTS comidas (
    id          text PRIMARY KEY,
    fecha       date NOT NULL,
    momento     timestamptz,      -- NULL = hora no anotada
    descripcion text NOT NULL,
    foto        text,
    metodo      text,             -- catalogo | tanda+catalogo | foto
    tanda_id    text REFERENCES tandas(id),
    nota        text
);
CREATE INDEX IF NOT EXISTS ix_comidas_fecha ON comidas (fecha);

CREATE TABLE IF NOT EXISTS comida_items (
    comida_id         text    NOT NULL REFERENCES comidas(id) ON DELETE CASCADE,
    alimento_id       text    NOT NULL REFERENCES alimentos(id),
    cantidad_g        numeric NOT NULL CHECK (cantidad_g >= 0),
    -- Lo que permite CALCULAR la banda de error en vez de suponerla.
    origen_cantidad   text    NOT NULL,
    incertidumbre_pct numeric NOT NULL DEFAULT 25,
    nota              text,
    CONSTRAINT ck_origen CHECK (origen_cantidad IN ('envase','pesado','estimado'))
);
CREATE INDEX IF NOT EXISTS ix_items_comida ON comida_items (comida_id);

-- ============================================================================
--  4. VISTAS — los totales se CALCULAN, no se guardan
--  Protocolo de comidas: "el total es derivado, no fuente. Si los items no
--  reproducen el total, manda el detalle."  Aqui eso deja de ser una norma
--  que hay que recordar y pasa a ser imposible de incumplir.
-- ============================================================================

CREATE OR REPLACE VIEW v_comidas AS
SELECT
    c.id, c.fecha, c.momento, c.descripcion, c.metodo, c.tanda_id, c.foto, c.nota,
    round(sum(a.kcal   * i.cantidad_g / 100)::numeric, 1) AS kcal,
    round(sum(a.prot_g * i.cantidad_g / 100)::numeric, 1) AS prot_g,
    round(sum(a.hc_g   * i.cantidad_g / 100)::numeric, 1) AS hc_g,
    round(sum(a.azucar_g * i.cantidad_g / 100)::numeric, 1) AS azucar_g,
    round(sum(a.grasa_g  * i.cantidad_g / 100)::numeric, 1) AS grasa_g,
    round(sum(a.sat_g    * i.cantidad_g / 100)::numeric, 1) AS sat_g,
    round(sum(a.fibra_g  * i.cantidad_g / 100)::numeric, 1) AS fibra_g,
    round(sum(a.sal_g    * i.cantidad_g / 100)::numeric, 2) AS sal_g,
    -- Exposiciones heredadas del producto: nunca se deciden de memoria.
    bool_or(a.lactosa = 'si') AS lactosa,
    bool_or(a.gluten  = 'si') AS gluten,
    -- Banda de error: incertidumbres compuestas en cuadratura.
    round((100 * sqrt(sum(pow(a.kcal * i.cantidad_g / 100 * i.incertidumbre_pct / 100, 2)))
                / nullif(sum(a.kcal * i.cantidad_g / 100), 0))::numeric, 1) AS error_pct
FROM comidas c
JOIN comida_items i ON i.comida_id = c.id
JOIN alimentos    a ON a.id = i.alimento_id
GROUP BY c.id, c.fecha, c.momento, c.descripcion, c.metodo, c.tanda_id, c.foto, c.nota;

COMMENT ON VIEW v_comidas IS
  'Totales calculados desde los ingredientes. Imposible que diverjan del detalle.';

CREATE OR REPLACE VIEW v_dias AS
SELECT fecha,
       count(*) AS comidas,
       sum(kcal) AS kcal, sum(prot_g) AS prot_g, sum(hc_g) AS hc_g,
       sum(grasa_g) AS grasa_g, sum(sat_g) AS sat_g,
       sum(fibra_g) AS fibra_g, sum(sal_g) AS sal_g,
       bool_or(lactosa) AS algo_con_lactosa,
       bool_or(gluten)  AS algo_con_gluten
FROM v_comidas GROUP BY fecha;

-- ============================================================================
--  5. RESÚMENES AUTOMÁTICOS de las series
--  TimescaleDB los mantiene al dia solo. Aqui viven las medias moviles que
--  pide la regla 4 del vault ("el peso diario es ruido").
-- ============================================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS mediciones_minuto
WITH (timescaledb.continuous) AS
SELECT metrica,
       time_bucket('1 minute', ts) AS minuto,
       avg(valor) AS media, min(valor) AS minimo, max(valor) AS maximo,
       count(*)   AS n
FROM mediciones
GROUP BY metrica, 2
WITH NO DATA;

CREATE MATERIALIZED VIEW IF NOT EXISTS mediciones_dia
WITH (timescaledb.continuous) AS
SELECT metrica,
       time_bucket('1 day', ts) AS dia,
       avg(valor) AS media, min(valor) AS minimo, max(valor) AS maximo,
       count(*)   AS n
FROM mediciones
GROUP BY metrica, 2
WITH NO DATA;
