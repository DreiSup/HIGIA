# Higía

Sistema personal de seguimiento de salud: sueño, alimentación y rendimiento.
Uso individual, un solo usuario.

## Qué hay aquí

| | |
|---|---|
| `backend/` | API en FastAPI |
| `frontend/` | Interfaz en Next.js: el calendario de registro |
| `db/` | Esquema y migraciones de PostgreSQL + TimescaleDB |
| `scripts/` | Herramientas de datos (inspección y carga de exports de Google Takeout) |
| `docker-compose.yml` | Base de datos, backend y frontend en local |

## Levantarlo

```bash
cp app/.env.example .env      # en el directorio PADRE, no aquí dentro
# edita .env y pon una contraseña
cd app && docker compose up -d
curl localhost:8000/health
```

| Dónde | Qué |
|---|---|
| `localhost:5433` | La base. El 5432 suele estar ocupado |
| `localhost:8000/docs` | La API, documentada |
| `localhost:3000` | El calendario |

Los tres escuchan **solo en localhost**.

## Dónde están los datos

**Fuera de este repositorio, a propósito.** `../postgres_data/`, `../datos/` y `../.env`
viven en el directorio padre. Este repositorio es público y contiene un proyecto de datos de
salud: que los datos estén fuera del árbol de git hace que publicarlos por error no sea
improbable, sino imposible.

**Aquí no hay ni habrá datos personales.** Los ejemplos son inventados.
