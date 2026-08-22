/**
 * Cliente de la API de Higía.
 *
 * ⚠️ La URL está fija a 127.0.0.1:8000 a propósito. Este `fetch` lo hace el
 *    NAVEGADOR, que corre en el host: `http://backend:8000` solo resuelve
 *    DENTRO de la red de compose, así que aquí no serviría. Y no se pasa por
 *    variable de entorno porque `NEXT_PUBLIC_*` se hornea en tiempo de build:
 *    una variable mal puesta no da error, simplemente deja la app muda.
 */
export const API = "http://127.0.0.1:8000";

/** GET con el error legible incluido.
 *
 * 🔑 Si la API no contesta, esto LANZA. Nunca devuelve una lista vacía: una
 *    lista vacía la pintaría la app como "no hay nada registrado", que es una
 *    afirmación sobre los datos. "No se pudo leer" no es "no hay". */
async function traer<T>(ruta: string): Promise<T> {
  const r = await fetch(`${API}${ruta}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`La API respondió ${r.status} en ${ruta}`);
  return r.json();
}

async function enviar<T>(metodo: string, ruta: string, cuerpo?: unknown): Promise<T> {
  const r = await fetch(`${API}${ruta}`, {
    method: metodo,
    headers: cuerpo === undefined ? undefined : { "Content-Type": "application/json" },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  if (!r.ok) {
    // El detalle de FastAPI dice QUÉ campo falló. Perderlo deja al usuario con
    // un "422" a secas, que no le dice nada.
    let detalle = `${r.status}`;
    try {
      const cuerpoError = await r.json();
      if (cuerpoError?.detail) detalle += ` · ${JSON.stringify(cuerpoError.detail)}`;
    } catch { /* sin cuerpo JSON: nos quedamos con el código */ }
    throw new Error(`${metodo} ${ruta} falló: ${detalle}`);
  }
  return r.status === 204 ? (undefined as T) : r.json();
}

// ──────────────────────────────────────────────────────────────────────────────
//  Tipos
//
//  🔑 Todo lo medible es `number | null`. El `null` viaja hasta la pantalla y se
//     pinta como hueco. Ningún tipo de aquí admite un 0 por defecto.
// ──────────────────────────────────────────────────────────────────────────────

/** Un día de la rejilla del calendario. */
export type Dia = {
  fecha: string;
  // Banderas para pintar la celda de un vistazo. Nunca para calcular.
  tiene_subjetivo: boolean;
  tiene_comidas: boolean;
  tiene_consumos: boolean;
  tiene_pulsera: boolean;
  // 🔑 `null` = hueco real, y se pinta como hueco. Jamás como 0.
  minutos_dormido?: number | null;
  eficiencia?: number | null;
  puntuacion_sueno?: number | null;
  pasos?: number | null;
  kcal_quemadas?: number | null;
  pulsaciones_media?: number | null;
  comidas?: number | null;
  kcal_consumidas?: number | null;
  como_me_siento?: number | null;
  animo?: number | null;
  energia?: number | null;
  nota_dia?: string | null;
};

export type Consumo = {
  id: number;
  sustancia: string;
  cantidad: number | null;
  unidad: string | null;
  momento: string | null;
  nota: string | null;
};

export type ComidaResumen = {
  id: string;
  momento: string | null;
  descripcion: string;
  kcal: number | null;
  prot_g: number | null;
  hc_g: number | null;
  grasa_g: number | null;
  lactosa: boolean | null;
  gluten: boolean | null;
  error_pct: number | null;
};

/** Fila de `v_dia_completo`: todo lo que se sabe de una fecha. */
export type DiaCompleto = {
  fecha: string;
  minutos_dormido: number | null;
  minutos_en_cama: number | null;
  eficiencia: number | null;
  sueno_inicio: string | null;
  sueno_fin: string | null;
  puntuacion_sueno: number | null;
  fc_reposo: number | null;
  hrv: number | null;
  fc_no_rem: number | null;
  frecuencia_respiratoria: number | null;
  pulsaciones_media: number | null;
  pulsaciones_min: number | null;
  pulsaciones_max: number | null;
  pasos: number | null;
  kcal_quemadas: number | null;
  spo2_media: number | null;
  temperatura_media: number | null;
  comidas: number | null;
  kcal_consumidas: number | null;
  prot_g: number | null;
  hc_g: number | null;
  grasa_g: number | null;
  sat_g: number | null;
  fibra_g: number | null;
  sal_g: number | null;
  algo_con_lactosa: boolean | null;
  algo_con_gluten: boolean | null;
  como_me_siento: number | null;
  animo: number | null;
  energia: number | null;
  nota_dia: string | null;
  // Solo en /dia/{fecha}, no en /dias:
  /** Cuándo se escribió el subjetivo, que no es lo mismo que a qué día se
   *  refiere. `null` = ese día no está registrado. Si va muy por detrás de
   *  `fecha`, el dato es un recuerdo y la pantalla tiene que decirlo. */
  subjetivo_registrado_en?: string | null;
  kcal_quemadas_aviso?: string;
  comidas_detalle?: ComidaResumen[];
  consumos?: Consumo[];
};

export type Semana = {
  semana_inicio: string;
  semana_fin: string;
  // 🔑 Los denominadores. Cada media de esta fila viaja con el suyo, y la
  //    pantalla tiene prohibido enseñar una media sin él (regla 3).
  noches_con_dato: number;
  dias_con_dato: number;
  dias_con_comida: number;
  dormido_min_media: number | null;
  eficiencia_media: number | null;
  puntuacion_sueno_media: number | null;
  fc_reposo_media: number | null;
  hrv_media: number | null;
  pulsaciones_media: number | null;
  spo2_media: number | null;
  pasos_media: number | null;
  pasos_total: number | null;
  kcal_quemadas_media: number | null;
  kcal_consumidas_media: number | null;
};

export type Fase = "deep" | "light" | "rem" | "wake";

export type Tramo = { inicio: string; fase: Fase; minutos: number };

export type Noche = {
  noche: string;
  inicio: string;
  fin: string;
  minutos_dormido: number | null;
  minutos_despierto: number | null;
  minutos_en_cama: number | null;
  eficiencia: number | null;
  hora_acostarse: string;
  hora_levantarse: string;
  dia_semana: string;
  es_finde: boolean;
  /** Los TOTALES oficiales, los del dispositivo. Nunca se recalculan sumando
   *  `tramos`: ver el comentario de la vista de Sueño. */
  fases_min: Partial<Record<Fase, number>>;
  /** El DIBUJO. Suman exactamente el tiempo en cama. */
  tramos: Tramo[];
};

export type Metrica = {
  metrica: string;
  registros: number;
  desde: string;
  hasta: string;
  dias: number;
};

export type Punto = { momento: string; valor: number; n: number };

export type Serie = {
  metrica: string;
  resolucion: "dia" | "minuto";
  agregacion: "avg" | "sum";
  puntos: Punto[];
};

export type Frecuente = {
  descripcion: string;
  veces: number;
  ultima: string;
  ultimo_id: string;
  kcal_tipicas: number | null;
};

export type ItemComida = {
  alimento_id: string;
  nombre: string;
  marca: string | null;
  cantidad_g: number;
  origen_cantidad: "envase" | "pesado" | "estimado";
  incertidumbre_pct: number | null;
  nota: string | null;
  kcal: number | null;
  prot_g: number | null;
  /** "si" | "no" | null. Texto, no booleano: son los tres estados del catálogo. */
  lactosa?: string | null;
  gluten?: string | null;
};

export type ComidaDetalle = ComidaResumen & {
  metodo: string | null;
  tanda_id: string | null;
  nota: string | null;
  items: ItemComida[];
};

export type Subjetivo = {
  fecha: string;
  como_me_siento: number | null;
  animo: number | null;
  energia: number | null;
  nota: string | null;
  /** Cuándo se escribió, que no es lo mismo que a qué día se refiere. Es lo que
   *  permite marcar un registro como retroactivo. */
  registrado_en: string;
};

// ──────────────────────────────────────────────────────────────────────────────
//  Lecturas
// ──────────────────────────────────────────────────────────────────────────────

/** La rejilla de un mes: SIEMPRE los 28-31 días, con dato o sin él. */
export const traerMes = (anio: number, mes: number) =>
  traer<Dia[]>(`/calendario/${anio}/${mes}`);

export const traerDia = (fecha: string) => traer<DiaCompleto>(`/dia/${fecha}`);

/** ⚠️ Solo devuelve los días que EXISTEN en la vista. Un día sin nada no viene
 *  como fila de nulos: no viene. El eje de fechas lo construye la pantalla, y
 *  las fechas que falten son huecos. */
export const traerDias = (desde: string, hasta: string) =>
  traer<DiaCompleto[]>(`/dias?desde=${desde}&hasta=${hasta}`);

export const traerSemanas = (limite = 12) =>
  traer<Semana[]>(`/salud/semanas?limite=${limite}`);

export const traerNoches = (limite = 60) =>
  traer<Noche[]>(`/salud/sueno?limite=${limite}`);

export const traerMetricas = () => traer<Metrica[]>("/salud/metricas");

export const traerSerie = (
  metrica: string, desde: string, hasta: string, resolucion: "dia" | "minuto",
) => traer<Serie>(
  `/salud/serie/${metrica}?desde=${desde}&hasta=${hasta}&resolucion=${resolucion}`,
);

export const traerFrecuentes = (limite = 6) =>
  traer<Frecuente[]>(`/comidas/frecuentes?limite=${limite}`);

export const traerComida = (id: string) => traer<ComidaDetalle>(`/comidas/${id}`);

/** El histórico subjetivo entero. Es una fila por día registrado, así que hoy
 *  son 0 filas y dentro de un año serán 365: cabe de sobra en una petición. */
export const traerSubjetivos = (limite = 400) =>
  traer<Subjetivo[]>(`/dia-subjetivo?limite=${limite}`);

// ──────────────────────────────────────────────────────────────────────────────
//  Escrituras
// ──────────────────────────────────────────────────────────────────────────────

/** Guarda los tres 0-10 de un día.
 *
 * 🔴 NO sobrescribe el día entero, aunque sea un PUT: el backend hace
 *    `coalesce(EXCLUDED.campo, dia_subjetivo.campo)`, así que un campo enviado
 *    como `null` DEJA EL VALOR ANTERIOR en vez de borrarlo. Es deliberado
 *    (preguntar solo por la energía no debe borrar el ánimo), pero significa
 *    que desde esta pantalla NO se puede vaciar un número ya guardado. La
 *    interfaz tiene que decirlo, no dejar creer lo contrario. */
export const guardarSubjetivo = (entrada: {
  fecha: string;
  como_me_siento?: number | null;
  animo?: number | null;
  energia?: number | null;
  nota?: string | null;
}) => enviar<Subjetivo>("PUT", "/dia-subjetivo", entrada);

/** Una fila por TOMA. Tres cafés son tres llamadas: la hora de cada uno cuenta. */
export const crearConsumo = (entrada: {
  fecha: string;
  sustancia: string;
  cantidad?: number | null;
  unidad?: string | null;
  momento?: string | null;
  nota?: string | null;
}) => enviar<Consumo>("POST", "/consumos", entrada);

export const borrarConsumo = (id: number) =>
  enviar<void>("DELETE", `/consumos/${id}`);

/** 🔴 No existe `PUT /comidas/{id}`: una comida no se corrige, se borra y se
 *  vuelve a componer — que aquí cuesta mucho más que en consumos, porque son
 *  varios ingredientes con su cantidad y su origen. La pantalla tiene que
 *  avisarlo antes de borrar. Un id que no existe da 404. */
export const borrarComida = (id: string) =>
  enviar<void>("DELETE", `/comidas/${id}`);

/** Repite una comida ya registrada en otra fecha.
 *
 * 🔑 Se copian los ingredientes, no los totales: los macros los recalcula la
 *    base a partir de los items (D15). Por eso el `kcal` de la nueva comida
 *    puede no ser idéntico si el catálogo ha cambiado — y eso es lo correcto.
 *
 * ⚠️ Se copian TAMBIÉN `incertidumbre_pct` y la `nota` de cada ingrediente. Son
 *    supuestos de método ("aceite absorbido al freír: se asume 40 %") que valen
 *    para esta comida porque es LA MISMA comida. Si se recortaran, el
 *    `error_pct` del nuevo registro saldría más bajo de lo que le corresponde,
 *    que es la clase de optimismo que el método prohíbe. */
export async function repetirComida(idOriginal: string, fecha: string) {
  const original = await traerComida(idOriginal);
  return enviar<{ id: string }>("POST", "/comidas", {
    fecha,
    descripcion: original.descripcion,
    // La hora NO se copia: el original puede no tenerla, y aunque la tuviera
    // sería la de aquel día. `null` es honesto; heredarla sería inventarla.
    momento: null,
    metodo: original.metodo,
    nota: original.nota,
    items: original.items.map((i) => ({
      alimento_id: i.alimento_id,
      cantidad_g: i.cantidad_g,
      origen_cantidad: i.origen_cantidad,
      incertidumbre_pct: i.incertidumbre_pct,
      nota: i.nota,
    })),
  });
}
