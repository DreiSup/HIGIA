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

/** Un día de la rejilla. Casi todo opcional: la mayoría de días son huecos. */
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

/** La rejilla de un mes: SIEMPRE los 28-31 días, con dato o sin él. */
export async function traerMes(anio: number, mes: number): Promise<Dia[]> {
  const r = await fetch(`${API}/calendario/${anio}/${mes}`, {
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`La API respondió ${r.status}`);
  return r.json();
}
