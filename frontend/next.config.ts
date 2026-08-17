import type { NextConfig } from "next";

const config: NextConfig = {
  // Uso individual y local: nada de telemetría ni de optimizaciones que
  // dependan de salir a internet.
  reactStrictMode: true,

  // 🔴 SIN ESTO LA PÁGINA NO SE HIDRATA, Y FALLA EN SILENCIO.
  //    El servidor de desarrollo de Next 16 bloquea las peticiones a sus
  //    propios chunks si el navegador llega por un host que no reconoce. Aquí
  //    llega por 127.0.0.1, y el contenedor solo se reconoce como `localhost`:
  //    devolvía 503 en dos chunks, la consola del navegador no decía NADA y la
  //    pantalla se quedaba clavada en "Cargando el mes…" para siempre.
  //    El aviso solo aparece en `docker compose logs frontend`.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default config;
