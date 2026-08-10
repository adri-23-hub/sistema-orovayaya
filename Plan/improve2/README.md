# Planes de Implementación — Sistema Orvayaya (ronda 2: improve2)

Generados por la skill `improve` el 2026-08-09 sobre el commit `09107cc`
(árbol de trabajo: hay trabajo sin confirmar sobre presentaciones/presentaciones
y demás; el árbol es la fuente de verdad, NO el commit). Cada plan está escrito
para un ejecutor sin contexto previo: rutas exactas, extractos de código,
comandos de verificación y condiciones de STOP. Léelo completo antes de empezar
y respeta sus límites de alcance.

## Orden de ejecución y estado

| Plan | Título | Prioridad | Esfuerzo | Depende de | Estado |
|------|--------|-----------|----------|------------|--------|
| 001 | Remediar dependencias de producción (npm audit limpio) | P0 | M | — | TODO |
| 002 | Guardia de BD de tests (`*_test`) + aislamiento real entre corridas | P0 | M | — | TODO |

Estado: TODO | IN PROGRESS | DONE | BLOCKED (razón) | REJECTED (razón).

> Nota: 002 es el suelo de verificación. Todo plan futuro que toque
> ventas/inventario/movimientos (p. ej. 003/004/005 de una siguiente ronda)
> que requiera regresiones usa el `beforeEach(truncateTestTables)` y el guard
> de 002. Se asientan aquí como precedente; no hay planes 003+ aún.

## Notas de dependencia

- **001 y 002 son independientes.** Pueden ejecutarse en cualquier orden.
- **002 (guard) debe estar ANTES** de cualquier trabajo que corra
  `npm test` sobre la BD de desarrollo: sin `tests/.env.test` válido, la suite
  hoy apunta a `server/.env` (BD real) y la muta. El plan 001 incluye tests y
  por eso su paso de prerrequisitos avisa de este riesgo.
- Tras 002, la suite se auto-limpia (stock de Gaseosa restaurado a 1000) y aborta
  si `DATABASE_URL` no termina en `_test`: es seguro correr tests en cualquier
  máquina con la BD de prueba levantada.

## Comandos de verificación del repo

| Propósito | Comando | Resultado esperado |
|-----------|---------|--------------------|
| Typecheck | `cd server; npm run check` (alias `tsc --noEmit`, solo `src/**`) | exit 0 |
| Tests | `cd server; npm test` | requiere Postgres + seed + `tests/.env.test` |
| Sin lint | `npm run lint` | **no existe** — ver plan 001 de improve (009) |

Paso previo para tests (documentado en 002):
`cd server` → `docker-compose up -d` → `npm install` → `npm run db:push` →
`$env:ADMIN_PASSWORD='admin123'; $env:CAJERO_PASSWORD='cajero123'; npm run db:seed`
→ `npm test`. Y crear `server/tests/.env.test` a partir de
`server/tests/.env.test.example` (placeholders; NUNCA credenciales reales).

## Hallazgos considerados y rechazados (ronda 2)

- Reporte `npm audit --omit=dev` 2026-08-09: 2 critical y 4 high; NO son
  rechazados, son el plan 001 (son directamente alcanzables: JWT y static).
- Fallback a `.env` en `tests/setup.ts`: es un bug de tooling, pero no se
  repara "a lo bruto" (borrando el fallback y ya); se repara con guard fail-fast
  + ejemplo commiteable + aislamiento, porque el fallback en sí no es el
  problema: la falta de guardia sí lo es. → plan 002.
- Aislamiento solo en `beforeAll` de 2/5 archivos y stock que decae entre
  corridas: no se rechazan; son el plan 002 (mismo archivo).

## Archivos de trabajo

- `Plan/improve2/001-remediar-dependencias-seguridad.md`
- `Plan/improve2/002-guard-bd-tests-aislamiento.md`

(La ronda 1, toda DONE, vive en `Plan/improve/` — ver su README.)