"use client";

import { useCallback, useEffect, useState } from "react";
import { API, traerMes, type Dia } from "@/lib/api";

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
  "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS_CORTOS = ["LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB", "DOM"];
const DIAS_LARGOS = ["lunes", "martes", "miércoles", "jueves", "viernes",
  "sábado", "domingo"];

/** Los cuatro tipos de registro, en el orden en que se leen en la celda.
 *
 * La letra y el color son los mismos en la celda, en la leyenda y en el resumen.
 * Si cambiaran de sitio a sitio habría que consultar la leyenda cada vez. */
const TIPOS = [
  { bandera: "tiene_subjetivo", letra: "S", nombre: "Subjetivo", clase: "c-subjetivo" },
  { bandera: "tiene_comidas", letra: "C", nombre: "Comidas", clase: "c-comidas" },
  { bandera: "tiene_consumos", letra: "T", nombre: "Consumos", clase: "c-consumos" },
  { bandera: "tiene_pulsera", letra: "P", nombre: "Pulsera", clase: "c-pulsera" },
] as const;

type Tema = "oscuro" | "claro";

/** Fecha de hoy en horario local, AAAA-MM-DD.
 *
 * ⚠️ Con `toISOString()` esto daría UTC: a las 00:30 de Madrid marcaría como
 *    "hoy" el día anterior. Es la misma trampa que ya apareció en la base con
 *    `time_bucket`. */
function hoyLocal(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function fechaISO(anio: number, mes: number, dia: number): string {
  return `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** Día de la semana empezando en LUNES (0=lunes … 6=domingo). */
function diaDeLaSemana(anio: number, mes: number, dia: number): number {
  return (new Date(anio, mes - 1, dia).getDay() + 6) % 7;
}

function diasDelMes(anio: number, mes: number): number {
  return new Date(anio, mes, 0).getDate();
}

const num = (n: number) => n.toLocaleString("es-ES");

/** Minutos → "6,3 h". Coma decimal, que es como se escribe en español. */
const horas = (minutos: number) =>
  `${(minutos / 60).toFixed(1).replace(".", ",")} h`;

function tieneAlgo(d: Dia | undefined): boolean {
  return !!d && TIPOS.some((t) => d[t.bandera]);
}

/** Lo que se enseña de cada tipo en el resumen del día.
 *
 * 🔑 `null` significa "no hay dato" y se pinta "—". Nunca 0: la API ya se
 *    encarga de no mandar ceros falsos y aquí no se van a inventar. */
function valorResumen(d: Dia | undefined, bandera: string): string | null {
  if (!d || !d[bandera as keyof Dia]) return null;

  if (bandera === "tiene_subjetivo") {
    const tres = [d.como_me_siento, d.animo, d.energia];
    if (tres.every((n) => n == null)) return "Registrado";
    return tres.map((n) => (n == null ? "—" : n)).join(" · ");
  }

  if (bandera === "tiene_comidas") {
    const partes = [`${d.comidas} ${d.comidas === 1 ? "comida" : "comidas"}`];
    if (d.kcal_consumidas != null) {
      partes.push(`${num(Math.round(d.kcal_consumidas))} kcal`);
    }
    return partes.join(" · ");
  }

  if (bandera === "tiene_pulsera") {
    const partes: string[] = [];
    if (d.minutos_dormido != null) partes.push(horas(d.minutos_dormido));
    if (d.pasos != null) partes.push(`${num(d.pasos)} pasos`);
    return partes.length ? partes.join(" · ") : "Registrado";
  }

  // Consumos: `/calendario` devuelve la bandera, no el detalle. El desglose por
  // toma vive en `/consumos?fecha=`, y es del panel del día (paso 3).
  return "Registrado";
}

export default function Calendario() {
  const hoy = hoyLocal();
  const [anio, setAnio] = useState(() => Number(hoy.slice(0, 4)));
  const [mes, setMes] = useState(() => Number(hoy.slice(5, 7)));
  const [dias, setDias] = useState<Dia[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seleccion, setSeleccion] = useState(hoy);
  // `null` hasta que se monta: en el servidor no se sabe qué tema toca, y
  // adivinarlo es lo que rompía la hidratación. Mientras es `null`, el botón no
  // afirma nada.
  const [tema, setTema] = useState<Tema | null>(null);

  useEffect(() => {
    const guardado = localStorage.getItem("higia-tema");
    if (guardado === "claro" || guardado === "oscuro") {
      setTema(guardado);
      document.documentElement.dataset.tema = guardado;
      return;
    }
    // Sin elección guardada manda el sistema, que es lo que el CSS ya pinta.
    const claro = window.matchMedia("(prefers-color-scheme: light)").matches;
    setTema(claro ? "claro" : "oscuro");
  }, []);

  function alternarTema() {
    const nuevo: Tema = tema === "claro" ? "oscuro" : "claro";
    setTema(nuevo);
    localStorage.setItem("higia-tema", nuevo);
    document.documentElement.dataset.tema = nuevo;
  }

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

  const porFecha = new Map((dias ?? []).map((d) => [d.fecha, d]));
  const conDatos = (dias ?? []).filter((d) => tieneAlgo(d)).length;
  const nombreMes = MESES[mes - 1];
  const titulo = nombreMes[0].toUpperCase() + nombreMes.slice(1) + " " + anio;

  let subtitulo: string;
  if (error) subtitulo = "Sin lectura del mes";
  else if (!dias) subtitulo = `Leyendo ${nombreMes}…`;
  else if (conDatos === 0) {
    subtitulo = `Ningún día registrado en ${nombreMes}. Normal: los huecos no se rellenan.`;
  } else {
    subtitulo = conDatos === 1 ? "1 día con registros"
      : `${conDatos} días con registros`;
  }

  return (
    <div className="pagina">
      <div className="columna">

        <div className="tira">
          <div className="marca">
            <div className="kicker">Higía · seguimiento personal</div>
            <div className="lema">
              Un hueco es un hueco. Los días sin registrar no muestran ceros ni
              anillos: no muestran nada.
            </div>
          </div>
          <button className="boton-pildora" onClick={alternarTema}>
            {tema === "claro" ? "Tema oscuro" : "Tema claro"}
          </button>
        </div>

        <div className="mes">
          <div>
            <h1>{titulo}</h1>
            <div className="subtitulo">{subtitulo}</div>
          </div>
          <div className="navegacion">
            <button className="boton-icono" onClick={() => mover(-1)}
                    aria-label="Mes anterior">‹</button>
            <button className="boton" onClick={() => {
              setAnio(Number(hoy.slice(0, 4)));
              setMes(Number(hoy.slice(5, 7)));
              setSeleccion(hoy);
            }}>Hoy</button>
            <button className="boton-icono" onClick={() => mover(1)}
                    aria-label="Mes siguiente">›</button>
          </div>
        </div>

        {/* 🔑 Con la API caída NO se dibuja ninguna celda. Pintar 31 huecos sería
            inventarse el dato: "no se pudo leer" y "no registré nada" son cosas
            distintas y la pantalla tiene que decir cuál de las dos es. */}
        {error && (
          <div className="error">
            <div className="error-etiqueta">
              <span /> Error de conexión
            </div>
            <h2>No se ha podido leer {nombreMes} de {anio}</h2>
            <p>
              La API no ha respondido, así que{" "}
              <strong>no se sabe qué hay en este mes</strong>. No es un mes
              vacío: es un mes que no se ha podido leer. Por eso no se dibuja
              ninguna celda — pintar {diasDelMes(anio, mes)} huecos sería
              inventarse el dato.
            </p>
            <div className="mono">GET {API}/calendario/{anio}/{mes}</div>
            <div className="mono-error">{error}</div>
            <button className="boton-error" onClick={cargar}>Reintentar</button>
          </div>
        )}

        {!error && (
          <div className="rejilla-bloque">
            <div className="semana">
              {DIAS_CORTOS.map((d, i) => (
                <div key={d} className={"dia-semana" + (i > 4 ? " finde" : "")}>
                  {d}
                </div>
              ))}
            </div>
            <div className="rejilla">
              <Celdas anio={anio} mes={mes} hoy={hoy} porFecha={porFecha}
                      cargando={!dias} seleccion={seleccion}
                      elegir={setSeleccion} />
            </div>
          </div>
        )}

        {dias && !error && (
          <Resumen dia={porFecha.get(seleccion)} fecha={seleccion} hoy={hoy} />
        )}

        <div className="leyenda">
          {TIPOS.map((t) => (
            <div key={t.letra}>
              <span className={"leyenda-marca " + t.clase}>{t.letra}</span>
              <span>{t.nombre}</span>
            </div>
          ))}
          <div className="leyenda-hueco">
            <span className="leyenda-marca">—</span>
            <span>Sin dato (no es un cero)</span>
          </div>
        </div>

      </div>
    </div>
  );
}

function Celdas({ anio, mes, hoy, porFecha, cargando, seleccion, elegir }: {
  anio: number; mes: number; hoy: string;
  porFecha: Map<string, Dia>; cargando: boolean;
  seleccion: string; elegir: (f: string) => void;
}) {
  const total = diasDelMes(anio, mes);
  const desplazamiento = diaDeLaSemana(anio, mes, 1);
  const celdas: React.ReactNode[] = [];

  for (let i = 0; i < desplazamiento; i++) {
    celdas.push(<div key={`antes-${i}`} className="relleno" />);
  }

  for (let d = 1; d <= total; d++) {
    const fecha = fechaISO(anio, mes, d);

    if (cargando) {
      // La rejilla late con el mes ya dibujado en vez de desaparecer: así el
      // contenido no salta de sitio cuando llegan los datos.
      celdas.push(
        <div key={fecha} className="celda cargando"
             style={{ animationDelay: `${(d % 7) * 0.06}s` }}>
          <span className="numero">{d}</span>
          <div className="senales" />
        </div>,
      );
      continue;
    }

    const dato = porFecha.get(fecha);
    const clases = ["celda"];
    if (tieneAlgo(dato)) clases.push("con-datos");
    // Un día que aún no ha pasado no es un hueco: no había nada que registrar.
    const futuro = fecha > hoy;
    if (futuro) clases.push("futuro");
    if (fecha === seleccion) clases.push("elegido");

    celdas.push(
      <div key={fecha} className={clases.join(" ")} title={fecha}
           onClick={futuro ? undefined : () => elegir(fecha)}>
        <span className={"numero" + (fecha === hoy ? " hoy" : "")}>{d}</span>
        <div className="senales">
          {TIPOS.map((t) => (
            <span key={t.letra} className="hueco-senal">
              <span className={
                "senal " + t.clase + (dato?.[t.bandera] ? "" : " ausente")
              }>{t.letra}</span>
            </span>
          ))}
        </div>
      </div>,
    );
  }

  while (celdas.length % 7 !== 0) {
    celdas.push(<div key={`despues-${celdas.length}`} className="relleno" />);
  }

  return <>{celdas}</>;
}

function Resumen({ dia, fecha, hoy }: {
  dia: Dia | undefined; fecha: string; hoy: string;
}) {
  const [a, m, d] = fecha.split("-").map(Number);
  const nombreDia = DIAS_LARGOS[diaDeLaSemana(a, m, d)];
  const titulo = nombreDia[0].toUpperCase() + nombreDia.slice(1) +
    `, ${d} de ${MESES[m - 1]}`;

  let nota = tieneAlgo(dia)
    ? "Solo lectura · el panel del día es el paso 2"
    : "Día sin registros";
  if (fecha === hoy) nota = "Hoy · " + nota.toLowerCase();
  else if (fecha > hoy) nota = "Día futuro";

  return (
    <div className="resumen">
      <div className="resumen-cabecera">
        <div className="resumen-fecha">{titulo}</div>
        <div className="resumen-nota">{nota}</div>
      </div>
      <div className="cajas">
        {TIPOS.map((t) => {
          const valor = valorResumen(dia, t.bandera);
          return (
            <div key={t.letra} className={"caja" + (valor ? " presente" : "")}>
              <div className="caja-etiqueta">
                {/* La clase es el nombre del token: `c-comidas` → `--c-comidas`. */}
                <span className="punto"
                      style={valor ? {
                        background: `var(--${t.clase})`,
                        borderColor: `var(--${t.clase})`,
                      } : undefined} />
                {t.nombre}
              </div>
              <div className="caja-valor">{valor ?? "—"}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
