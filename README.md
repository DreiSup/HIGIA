# Higía

Sistema personal de seguimiento de salud: sueño, alimentación y rendimiento.
Uso individual, un solo usuario.

## Qué hay aquí

| | |
|---|---|
| `backend/` | API en FastAPI |
| `frontend/` | Interfaz en Next.js |
| `db/` | Esquema y migraciones de PostgreSQL + TimescaleDB |
| `scripts/` | Herramientas de datos (inspección de exports de Google Takeout) |
| `docker-compose.yml` | Base de datos y backend en local |

## Levantarlo

```bash
cp app/.env.example .env      # en el directorio PADRE, no aquí dentro
# edita .env y pon una contraseña
cd app && docker compose up -d
curl localhost:8000/health
```

La base queda en `localhost:5433` (el 5432 suele estar ocupado) y escucha **solo en
localhost**.

## Dónde están los datos

**Fuera de este repositorio, a propósito.** `../postgres_data/`, `../datos/` y `../.env`
viven en el directorio padre. Este repositorio es público y contiene un proyecto de datos de
salud: que los datos estén fuera del árbol de git hace que publicarlos por error no sea
improbable, sino imposible.

**Aquí no hay ni habrá datos personales.** Los ejemplos son inventados.
