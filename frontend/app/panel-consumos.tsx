"use client";

/**
 * Los consumos del día: café, nicotina, suplementos y alcohol. Paso 3 (D18).
 *
 * 🔑 UNA FILA POR TOMA, y la hora es el dato. Tres cafés son tres filas, no un
 *    contador `cafés: 3`: un café a las 09:00 y otro a las 18:00 no son lo
 *    mismo para el sueño de esa noche, y agrupar destruiría justo lo que se
 *    quiere medir.
 *
 * 🔴 Y la regla espejo de la del panel subjetivo: allí se corrige y no se
 *    vacía; aquí NO SE CORRIGE, se borra. No existe `PUT /consumos/{id}`, así
 *    que el único arreglo es borrar y volver a añadir — el gesto de borrar
 *    tiene que ser alcanzable (es la única salida) y a la vez imposible de
 *    disparar sin querer (no hay deshacer).
 *
 * Un solo componente para los dos sitios donde se registra, por la misma razón
 * que en el paso 2: dos formularios sobre la misma tabla divergen.
 *
 * Diseño: "Higia Consumos.dc.html" (Claude Design, proyecto f5288ae1).
 */

import { useState } from "react";
import { borrarConsumo, crearConsumo, type Consumo } from "@/lib/api";
import { HUECO, diaYMes, hora, plural } from "@/lib/formato";

/** Los cuatro atajos, fijados por el usuario el 2026-08-21.
 *
 * 🔑 `detalle` es lo que se lee en la píldora y `unidad` lo que se GUARDA. No
 *    son lo mismo a propósito: en el botón cabe "1 cig." y en la base tiene que
 *    quedar la palabra entera, que es la que se leerá dentro de un año.
 *
 * ⚠️ La creatina NO está aquí (D11): es diaria y constante, así que un atajo
 *    para ella sería ruido cada día para un dato que no cambia. */
const ATAJOS = [
  { sustancia: "café", cantidad: 1, unidad: "taza", detalle: "1 taza" },
  { sustancia: "nicotina", cantidad: 1, unidad: "cigarrillo", detalle: "1 cig." },
  { sustancia: "l-teanina", cantidad: 1, unidad: "cápsula", detalle: "1 cáps." },
  { sustancia: "alcohol", cantidad: 1, unidad: "copa", detalle: "1 copa" },
];

const HORA_VALIDA = /^([01]?\d|2[0-3]):([0-5]\d)$/;

const dos = (n: number) => String(n).padStart(2, "0");

/** Días enteros entre dos fechas AAAA-MM-DD, sin pasar por UTC. */
function diasEntre(desde: string, hasta: string): number {
  const [a1, m1, d1] = desde.split("-").map(Number);
  const [a2, m2, d2] = hasta.split("-").map(Number);
  const uno = new Date(a1, m1 - 1, d1).getTime();
  const dos_ = new Date(a2, m2 - 1, d2).getTime();
  return Math.round((dos_ - uno) / 86_400_000);
}

/** `fecha` + "hh:mm" → el ISO con zona que espera la API.
 *
 * 🔴 El desfase se saca de ESE día, no de hoy. Agosto y enero no tienen el
 *    mismo (+02:00 y +01:00), así que estampar el de hoy sobre una fecha de
 *    invierno guardaría un instante que no es — y el fallo pasaría todas las
 *    pruebas que se hagan hoy.
 *
 * 🔑 Y de aquí sale que `fecha` y `momento` NO PUEDAN contar cosas distintas:
 *    la hora se monta siempre sobre la fecha del panel. La API no lo comprueba
 *    —se puede guardar el día 21 con hora del 12— así que lo impide esto o no
 *    lo impide nadie. */
function momentoDe(fecha: string, hhmm: string): string {
  const [a, m, d] = fecha.split("-").map(Number);
  const [h, min] = hhmm.split(":").map(Number);
  const desfase = -new Date(a, m - 1, d, h, min).getTimezoneOffset();
  const signo = desfase < 0 ? "-" : "+";
  const abs = Math.abs(desfase);
  return `${fecha}T${dos(h)}:${dos(min)}:00`
    + `${signo}${dos(Math.floor(abs / 60))}:${dos(abs % 60)}`;
}

/** El mismo orden que devuelve la API: por hora, y las que no la tienen al
 *  final. Se replica aquí solo para colocar la fila que acaba de llegar del
 *  201 sin recargar la lista entera. */
function ordenar(cs: Consumo[]): Consumo[] {
  const instante = (c: Consumo) => new Date(c.momento!).getTime();
  return [
    ...cs.filter((c) => c.momento).sort((a, b) => instante(a) - instante(b)),
    ...cs.filter((c) => !c.momento),
  ];
}

/** Cómo se nombra una toma cuando hay que preguntar por ella. Con ocho filas
 *  parecidas, el riesgo real no es borrar sin querer: es borrar la de al lado. */
function nombrar(c: Consumo): string {
  const h = hora(c.momento);
  return c.sustancia + (h ? ` de las ${h}` : " sin hora");
}

const CAMPOS_VACIOS = { sustancia: "", cantidad: "", unidad: "", hora: "", nota: "" };

export function PanelConsumos({ fecha, hoy, inicial, onCambio }: {
  fecha: string;
  hoy: string;
  /** Lo que trajo `GET /dia/{fecha}`. `[]` significa que no hay ninguna: la
   *  pantalla anfitriona tiene prohibido pasar `[]` mientras esté cargando. */
  inicial: Consumo[];
  /** Para que la pantalla anfitriona refresque lo suyo —el contador de Hoy, el
   *  punto de la celda del calendario— sin tocar lo que ya enseña este panel. */
  onCambio?: () => void;
}) {
  // 🔑 Igual que en el panel subjetivo: en cuanto se escribe una vez, manda lo
  //    local y no se vuelve a mezclar con las props. Mezclar duplicaría la fila
  //    recién creada en cuanto el anfitrión recargue. `key={fecha}` lo reinicia.
  const [lista, setLista] = useState<Consumo[] | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [errorAnadir, setErrorAnadir] = useState<string | null>(null);
  const [detalle, setDetalle] = useState(false);
  const [campos, setCampos] = useState(CAMPOS_VACIOS);
  const [armada, setArmada] = useState<number | null>(null);
  const [borrando, setBorrando] = useState<number | null>(null);
  const [errorBorrar, setErrorBorrar] = useState<{ id: number; texto: string } | null>(null);

  const tomas = lista ?? inicial;
  const atrasado = diasEntre(fecha, hoy);
  const esFuturo = atrasado < 0;
  const esHoy = atrasado === 0;

  const conHora = tomas.filter((c) => c.momento);
  const sinHora = tomas.filter((c) => !c.momento);

  const fijar = (k: keyof typeof CAMPOS_VACIOS, v: string) =>
    setCampos((c) => ({ ...c, [k]: v }));

  // La cantidad es texto libre y puede no ser un número. Vacío es un hueco
  // legítimo; "dos" no lo es, y mandarlo como `null` sería tirar lo tecleado
  // sin decirlo. Una cantidad NEGATIVA sí sale hacia la API a propósito: el 422
  // es suyo y se enseña literal.
  const cantidadCruda = campos.cantidad.trim().replace(",", ".");
  const cantidad = cantidadCruda === "" ? null : Number(cantidadCruda);
  const cantidadRota = cantidad != null && Number.isNaN(cantidad);
  const horaCruda = campos.hora.trim();
  const horaRota = horaCruda !== "" && !HORA_VALIDA.test(horaCruda);

  async function anadir(entrada: Parameters<typeof crearConsumo>[0], marca: string) {
    setErrorAnadir(null);
    setArmada(null);
    setOcupado(marca);
    try {
      const fila = await crearConsumo(entrada);
      // 🔑 Manda la fila que DEVUELVE la API, no la que se mandó: un trigger
      //    normaliza la sustancia a minúsculas y sin espacios, así que "Café"
      //    se guarda `café`. Pintar lo tecleado sería mentir sobre la base.
      // 🔴 Y se aplica sobre el estado ANTERIOR, no sobre el `tomas` que se leyó
      //    al empezar: un atajo y un borrado pueden estar en vuelo a la vez, y
      //    con la lista capturada en la clausura el segundo en volver pisaría al
      //    primero — la fila borrada reaparecería, sin un solo error, que es
      //    justo la desincronización que el resto de la pieza se esfuerza en
      //    hacer visible.
      setLista((prev) => ordenar([...(prev ?? inicial), fila]));
      setCampos(CAMPOS_VACIOS);
      setDetalle(false);
      onCambio?.();
    } catch (e) {
      setErrorAnadir(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(null);
    }
  }

  const anadirAtajo = (a: (typeof ATAJOS)[number]) => anadir({
    fecha,
    sustancia: a.sustancia,
    cantidad: a.cantidad,
    unidad: a.unidad,
    // 🔴 "Ahora" solo existe hoy. Sobre un día pasado el atajo guarda SIN hora:
    //    se conserva el gesto de un toque y no se inventa una hora que no fue.
    momento: esHoy ? momentoDe(fecha, `${dos(new Date().getHours())}:${dos(new Date().getMinutes())}`) : null,
  }, a.sustancia);

  const anadirDetalle = () => anadir({
    fecha,
    sustancia: campos.sustancia.trim(),
    cantidad,
    unidad: campos.unidad.trim() || null,
    momento: horaCruda === "" ? null : momentoDe(fecha, horaCruda),
    nota: campos.nota.trim() || null,
  }, "otro");

  async function borrar(c: Consumo) {
    setArmada(null);
    setErrorBorrar(null);
    setBorrando(c.id);
    try {
      await borrarConsumo(c.id);
      setLista((prev) => (prev ?? inicial).filter((t) => t.id !== c.id));
      onCambio?.();
    } catch (e) {
      // ⚠️ Incluido el 404 de borrar algo que ya no existe, que es el único
      //    error que SÍ podría quitar la fila. No se quita: si desapareciera
      //    sola sería idéntica a un borrado con éxito, y nadie sabría que la
      //    lista estaba desincronizada con la base.
      setErrorBorrar({ id: c.id, texto: e instanceof Error ? e.message : String(e) });
    } finally {
      setBorrando(null);
    }
  }

  // Una función, no un componente: definir un componente dentro del render lo
  // remonta entero en cada pasada, y una fila que se remonta pierde su animación
  // justo mientras está latiendo.
  function fila(c: Consumo) {
    const h = hora(c.momento);
    // Coma decimal: la base guarda 2.5 y en español eso se lee 2,5. Sin
    // `toFixed`, que convertiría un 1 limpio en "1,0".
    const medida = [
      c.cantidad?.toLocaleString("es-ES"),
      c.unidad,
    ].filter((x) => x != null && x !== "").join(" ") || HUECO;

    if (errorBorrar?.id === c.id) {
      return (
        <div key={c.id} className="consumo-fila con-error">
          <div className="consumo-linea">
            <span className={"consumo-hora" + (h ? "" : " sin-hora")}>{h ?? "sin hora"}</span>
            <span className={"consumo-punto" + (h ? "" : " hueco")} />
            <span className="consumo-sustancia">{c.sustancia}</span>
            <span className="consumo-medida">{medida}</span>
          </div>
          <div className="mono-error">
            DELETE /consumos/{c.id}<br />{errorBorrar.texto}
          </div>
          <div className="consumo-reintento">
            <span className="nota-menor">Sigue en la lista.</span>
            {/* Reintentar vuelve a ARMAR, no borra directo: el segundo toque
                sigue siendo deliberado aunque el primero fallara. */}
            <button type="button" className="boton-pildora boton-error-fino"
                    onClick={() => { setErrorBorrar(null); setArmada(c.id); }}>
              Reintentar
            </button>
          </div>
        </div>
      );
    }

    if (armada === c.id) {
      return (
        <div key={c.id} className="consumo-fila">
          <span className="consumo-pregunta">¿Borrar {nombrar(c)}? No hay deshacer.</span>
          <button type="button" className="boton-pildora" onClick={() => setArmada(null)}>
            Dejarla
          </button>
          <button type="button" className="boton-pildora boton-borrar-de-verdad"
                  onClick={() => borrar(c)}>
            Borrar
          </button>
        </div>
      );
    }

    return (
      <div key={c.id}
           className={"consumo-fila" + (borrando === c.id ? " en-vuelo" : "")}>
        <span className={"consumo-hora" + (h ? "" : " sin-hora")}>{h ?? "sin hora"}</span>
        <span className={"consumo-punto" + (h ? "" : " hueco")} />
        <div className="consumo-texto">
          <div className="consumo-linea">
            <span className="consumo-sustancia">{c.sustancia}</span>
            <span className="consumo-medida">{medida}</span>
          </div>
          {!!c.nota && <span className="consumo-nota">{c.nota}</span>}
        </div>
        {/* La ✕ no borra: arma. Discreta porque no es la acción principal, pero
            siempre visible y en la misma columna — esconderla tras un
            deslizamiento la haría indescubrible en escritorio. */}
        <button type="button" className="boton-armar" aria-label={`Borrar ${nombrar(c)}`}
                disabled={borrando === c.id} onClick={() => setArmada(c.id)}>
          ✕
        </button>
      </div>
    );
  }

  return (
    <div className="tarjeta panel-consumos">

      <div className="panel-subjetivo-cabecera">
        <div className="rotulo">
          <span className="rotulo-punto" style={{ background: "var(--c-consumos)" }} />
          Consumos
        </div>
        <span className={tomas.length ? "nota-menor" : "nota-fina"}>
          {esFuturo ? diaYMes(fecha)
            : tomas.length === 0 ? "ninguna" : plural(tomas.length, "toma")}
        </span>
      </div>

      {/* 🔴 Un día futuro no dibuja atajos apagados: no dibuja atajos. Un botón
          desactivado invita a tocarlo. */}
      {esFuturo ? (
        <div className="vacio">
          <span className="vacio-titulo">El {diaYMes(fecha)} todavía no ha pasado</span>
          <span className="vacio-texto">
            No se apunta lo que no se ha tomado. Los días futuros tampoco se
            pueden seleccionar en la rejilla del mes.
          </span>
        </div>
      ) : (
        <>
          <div className="pila" style={{ gap: 8 }}>
            <div className="atajos">
              {ATAJOS.map((a) => (
                <button key={a.sustancia} type="button" className="atajo"
                        disabled={ocupado != null} onClick={() => anadirAtajo(a)}>
                  {a.sustancia}
                  {/* La medida no se esconde detrás del atajo: se lee en la
                      propia píldora, así que se sabe qué se va a guardar antes
                      de tocar. */}
                  <b>{esHoy ? a.detalle : "sin hora"}</b>
                </button>
              ))}
              <button type="button" className="atajo atajo-otro"
                      disabled={ocupado != null} onClick={() => setDetalle(true)}>
                Otro…
              </button>
            </div>
            <span className="nota-fina">
              {esHoy
                ? "Un toque = una fila con la hora de ahora y la medida de"
                  + " siempre. «Otro…» abre cantidad, unidad, hora y nota."
                : "Sobre un día pasado los atajos no ponen hora: «ahora» sería"
                  + " mentira. La hora exacta se escribe en «Otro…»."}
            </span>
          </div>

          {detalle && (
            <div className="detalle-consumo">
              <div className="panel-subjetivo-cabecera">
                <span className="nota-menor" style={{ fontWeight: 600 }}>
                  {esHoy ? "Añadir una toma" : `Añadir una toma del ${diaYMes(fecha)}`}
                </span>
                <span className="nota-fina">Solo la sustancia es obligatoria</span>
              </div>

              <div className="pila" style={{ gap: 8 }}>
                <input type="text" className="campo" placeholder="sustancia"
                       value={campos.sustancia} disabled={ocupado != null}
                       onChange={(e) => fijar("sustancia", e.target.value)} />
                <div className="campos-en-fila">
                  <input type="text" className="campo campo-corto" placeholder="cantidad"
                         value={campos.cantidad} disabled={ocupado != null}
                         onChange={(e) => fijar("cantidad", e.target.value)} />
                  {/* Sin desplegable de unidades: insinuaría un catálogo cerrado
                      que la API no tiene. Es texto libre y se dice. */}
                  <input type="text" className="campo" placeholder="unidad"
                         value={campos.unidad} disabled={ocupado != null}
                         onChange={(e) => fijar("unidad", e.target.value)} />
                </div>
                <div className="campos-en-fila">
                  <input type="text" className="campo campo-corto" placeholder="hh:mm"
                         value={campos.hora} disabled={ocupado != null}
                         onChange={(e) => fijar("hora", e.target.value)} />
                  <span className="nota-fina">
                    {esHoy
                      ? "En blanco = sin hora apuntada."
                      : `La hora se guarda sobre el ${diaYMes(fecha)}. En blanco = sin hora.`}
                  </span>
                </div>
                <input type="text" className="campo" placeholder="nota (opcional)"
                       value={campos.nota} disabled={ocupado != null}
                       onChange={(e) => fijar("nota", e.target.value)} />
              </div>

              {(cantidadRota || horaRota) && (
                <span className="nota-fina">
                  {cantidadRota
                    ? "La cantidad tiene que ser un número. Déjala en blanco si no la sabes:"
                      + " un hueco es más honesto que un número inventado."
                    : "La hora se escribe hh:mm, de 00:00 a 23:59. En blanco = sin hora."}
                </span>
              )}

              <div className="campos-en-fila">
                <button type="button" className="boton-guardar boton-consumo"
                        disabled={!campos.sustancia.trim() || cantidadRota || horaRota
                          || ocupado != null}
                        onClick={anadirDetalle}>
                  {ocupado === "otro" ? "Añadiendo…" : "Añadir toma"}
                </button>
                <button type="button" className="boton"
                        disabled={ocupado != null}
                        onClick={() => { setDetalle(false); setCampos(CAMPOS_VACIOS); }}>
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {/* El fallo va DEBAJO del formulario, que es donde está el ojo, y dice
              explícitamente que no se ha creado ninguna fila. */}
          {!!errorAnadir && (
            <div className="fallo-guardar">
              <div className="error-etiqueta"><span /> No se pudo añadir</div>
              <div className="mono-error">POST /consumos<br />{errorAnadir}</div>
              {/* ⚠️ Solo hay formulario que preservar si «Otro…» está abierto.
                  Desde un atajo no se ha tecleado nada, y decir "lo tecleado
                  sigue arriba" señalaría a un sitio que no existe. */}
              <span className="nota-menor">
                No se ha creado ninguna fila.
                {detalle && " Lo tecleado sigue arriba, en el formulario."}
              </span>
            </div>
          )}

          {tomas.length > 0 ? (
            <div className="lista-consumos">
              {conHora.map(fila)}
              {/* Las que no tienen hora no se mezclan ni se disimulan: llegan al
                  final desde la API y ahí se quedan, bajo su propia línea. Ni
                  "desconocida", ni icono de aviso, ni 00:00 — apuntar una toma
                  sin mirar el reloj es legítimo. */}
              {sinHora.length > 0 && conHora.length > 0 && (
                <div className="consumo-separador">Sin hora apuntada</div>
              )}
              {sinHora.map(fila)}
            </div>
          ) : (
            <div className="vacio vacio-fino">
              <span className="vacio-titulo" style={{ fontSize: 13 }}>
                {esHoy ? "Ninguna toma hoy" : "Ninguna toma ese día"}
              </span>
              <span className="vacio-texto">
                La API devolvió una lista vacía: no hay ninguna. No es que no se
                haya podido leer.
              </span>
            </div>
          )}

          <span className="nota-fina">
            {esHoy
              ? "Una fila por toma: tres cafés son tres filas. Una toma no se"
                + " edita — se borra y se vuelve a añadir."
              : `Aquí no hay «ahora»: los atajos guardan sin hora y la hora se`
                + ` pone a mano en «Otro…». Nunca se apunta una hora que no`
                + ` cuadre con el ${diaYMes(fecha)}.`}
          </span>
        </>
      )}

    </div>
  );
}
