"use client";

import { useCallback, useEffect, useState } from "react";
import { API, traerMes, type Dia } from "@/lib/api";

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
  "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS_SEMANA = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

/** Fecha de hoy en horario local, en formato AAAA-MM-DD.
 *
 * ⚠️ Sin esto se acaba usando `new Date().toISOString()`, que da UTC: a las
 *    00:30 de Madrid marcaría como "hoy" el día anterior. Es la misma trampa
 *    que ya apareció en la base con `time_bucket`. */
function hoyLocal(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Día de la semana con la semana empezando en LUNES (0=lunes … 6=domingo).
 *
 * La fecha se parte a mano en lugar de pasarla a `new Date(cadena)`, que la
 * interpreta como UTC y desplaza el día entero en España. */
function diaDeLaSemana(fecha: string): number {
  const [a, m, d] = fecha.split("-").map(Number);
  return (new Date(a, m - 1, d).getDay() + 6) % 7;
}

/** Minutos → "6,3 h". Coma decimal, que es como se escribe en español. */
function horas(minutos: number): string {
  return `${(minutos / 60).toFixed(1).replace(".", ",")} h`;
}

function tieneAlgo(d: Dia): boolean {
  return d.tiene_subjetivo || d.tiene_comidas || d.tiene_consumos ||
    d.tiene_pulsera;
}

export default function Calendario() {
  const hoy = hoyLocal();
  const [anio, setAnio] = useState(() => Number(hoy.slice(0, 4)));
  const [mes, setMes] = useState(() => Number(hoy.slice(5, 7)));
  const [dias, setDias] = useState<Dia[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(() => {
    setError(null);
    setDias(null);
    traerMes(anio, mes)
      .then(setDias)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [anio, mes]);

  useEffect(cargar, [cargar]);

  function mover(delta: number) {
    const m = mes + delta;
    if (m < 1) { setAnio(anio - 1); setMes(12); } else
    if (m > 12) { setAnio(anio + 1); setMes(1); } else setMes(m);
  }

  return (
    <main>
      <div className="cabecera">
        <h1>{MESES[mes - 1]} {anio}</h1>
        <div className="crece" />
        <button onClick={() => mover(-1)} aria-label="Mes anterior">‹</button>
        <button onClick={() => {
          setAnio(Number(hoy.slice(0, 4)));
          setMes(Number(hoy.slice(5, 7)));
        }}>Hoy</button>
        <button onClick={() => mover(1)} aria-label="Mes siguiente">›</button>
      </div>

      {/* 🔑 Si la API no responde, se dice. Pintar la rejilla vacía sería
          mentir: parecería un mes sin registrar. */}
      {error && (
        <div className="aviso error">
          No se pudo leer el mes: {error}. ¿Está levantado el backend en{" "}
          <code>{API}</code>? <button onClick={cargar}>Reintentar</button>
        </div>
      )}

      {!error && !dias && <div className="aviso">Cargando el mes…</div>}

      {dias && (
        <>
          <div className="semana-cabecera">
            {DIAS_SEMANA.map((d) => <div key={d}>{d}</div>)}
          </div>
          <div className="rejilla">
            {/* Huecos de relleno hasta el primer día del mes. */}
            {Array.from({ length: diaDeLaSemana(dias[0].fecha) }, (_, i) => (
              <div key={`fuera-${i}`} className="celda fuera" />
            ))}
            {dias.map((d) => <Celda key={d.fecha} dia={d} hoy={hoy} />)}
          </div>
          <div className="leyenda">
            <span><i className="punto sub" /> subjetivo</span>
            <span><i className="punto com" /> comidas</span>
            <span><i className="punto con" /> consumos</span>
            <span><i className="punto pul" /> pulsera</span>
            <span>· celda apagada = día sin registrar (hueco, no cero)</span>
          </div>
        </>
      )}
    </main>
  );
}

function Celda({ dia, hoy }: { dia: Dia; hoy: string }) {
  const numero = Number(dia.fecha.slice(8, 10));
  const clases = ["celda"];
  if (!tieneAlgo(dia)) clases.push("vacia");
  if (dia.fecha === hoy) clases.push("hoy");

  return (
    <div className={clases.join(" ")} title={dia.fecha}>
      <div className="numero">{numero}</div>

      {/* Cada dato solo aparece si existe. Un `null` no se pinta: se calla. */}
      {dia.tiene_subjetivo && (
        <div className="dato">
          {[dia.como_me_siento, dia.animo, dia.energia]
            .map((n) => (n ?? "—"))
            .join(" · ")}
        </div>
      )}
      {dia.minutos_dormido != null && (
        <div className="dato">
          <span className="etiqueta">😴 </span>{horas(dia.minutos_dormido)}
        </div>
      )}
      {dia.kcal_consumidas != null && (
        <div className="dato">
          <span className="etiqueta">🍽 </span>
          {Math.round(dia.kcal_consumidas)} kcal
        </div>
      )}

      <div className="puntos">
        {dia.tiene_subjetivo && <i className="punto sub" />}
        {dia.tiene_comidas && <i className="punto com" />}
        {dia.tiene_consumos && <i className="punto con" />}
        {dia.tiene_pulsera && <i className="punto pul" />}
      </div>
    </div>
  );
}
