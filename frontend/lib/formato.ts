/**
 * Fechas y números, en español y sin inventar nada.
 *
 * 🔑 Todas las funciones de número aceptan `null | undefined` y devuelven "—".
 *    Es la única forma de que un hueco no se cuele como 0 por descuido en
 *    alguna pantalla: no hace falta acordarse de comprobarlo en cada sitio.
 */

export const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const DIAS_CORTOS = ["LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB", "DOM"];
export const DIAS_LARGOS = ["lunes", "martes", "miércoles", "jueves", "viernes",
  "sábado", "domingo"];

/** El hueco. Un solo sitio donde se decide cómo se ve "no hay dato". */
export const HUECO = "—";

/** Fecha de hoy en horario local, AAAA-MM-DD.
 *
 * ⚠️ Con `toISOString()` esto daría UTC: a las 00:30 de Madrid marcaría como
 *    "hoy" el día anterior. Es la misma trampa que ya apareció en la base con
 *    `time_bucket`. */
export function hoyLocal(): string {
  return fechaLocal(new Date());
}

export function fechaLocal(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function fechaISO(anio: number, mes: number, dia: number): string {
  return `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** Suma días a una fecha AAAA-MM-DD sin pasar por UTC. */
export function sumarDias(fecha: string, dias: number): string {
  const [a, m, d] = fecha.split("-").map(Number);
  return fechaLocal(new Date(a, m - 1, d + dias));
}

/** Día de la semana empezando en LUNES (0=lunes … 6=domingo). */
export function diaDeLaSemana(anio: number, mes: number, dia: number): number {
  return (new Date(anio, mes - 1, dia).getDay() + 6) % 7;
}

export function diaSemanaDe(fecha: string): number {
  const [a, m, d] = fecha.split("-").map(Number);
  return diaDeLaSemana(a, m, d);
}

export function diasDelMes(anio: number, mes: number): number {
  return new Date(anio, mes, 0).getDate();
}

/** "Lunes, 17 de agosto". */
export function fechaLarga(fecha: string): string {
  const [, m, d] = fecha.split("-").map(Number);
  const nombre = DIAS_LARGOS[diaSemanaDe(fecha)];
  return `${nombre[0].toUpperCase()}${nombre.slice(1)}, ${d} de ${MESES[m - 1]}`;
}

/** "12 de agosto". El día nombrado sin el día de la semana: es lo que lee el
 *  botón de guardar justo antes de pulsarlo. */
export function diaYMes(fecha: string): string {
  const [, m, d] = fecha.split("-").map(Number);
  return `${d} de ${MESES[m - 1]}`;
}

/** "12 ago". */
export function fechaCorta(fecha: string): string {
  const [, m, d] = fecha.split("-").map(Number);
  return `${d} ${MESES[m - 1].slice(0, 3)}`;
}

export function mesEnMayuscula(mes: number, anio: number): string {
  const n = MESES[mes - 1];
  return `${n[0].toUpperCase()}${n.slice(1)} ${anio}`;
}

// ── Números ───────────────────────────────────────────────────────────────────

type Quizas = number | null | undefined;

/** Separador de miles español. */
export function num(n: Quizas, decimales = 0): string {
  if (n == null) return HUECO;
  return n.toLocaleString("es-ES", {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  });
}

/** Minutos → "6 h 42 min". Para cuando el número es el protagonista. */
export function duracion(minutos: Quizas): string {
  if (minutos == null) return HUECO;
  const h = Math.floor(minutos / 60);
  const m = Math.round(minutos % 60);
  return `${h} h ${String(m).padStart(2, "0")} min`;
}

/** Minutos → "6,7 h". Coma decimal, que es como se escribe en español. */
export function horas(minutos: Quizas): string {
  if (minutos == null) return HUECO;
  return `${(minutos / 60).toFixed(1).replace(".", ",")} h`;
}

/** "22:05" a partir de un timestamp con zona. Devuelve `null` si no hay hora:
 *  una comida sin `momento` no tiene hora, y "00:00" sería inventarla. */
export function hora(momento: string | null | undefined): string | null {
  if (!momento) return null;
  const d = new Date(momento);
  if (Number.isNaN(d.getTime())) return null;
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** "3 comidas" / "1 comida" / "0 comidas". */
export function plural(n: number, singular: string, prural = singular + "s"): string {
  return `${n} ${n === 1 ? singular : prural}`;
}

/** El denominador de una media, tal cual y siempre visible (regla 3). */
export function denominador(con: number, de: number, unidad: string): string {
  return `${con} de ${de} ${unidad}`;
}
