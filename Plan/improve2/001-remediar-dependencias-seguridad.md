# Plan 001: Remediar las dependencias de producción (npm audit limpio)

> **Instrucciones para el ejecutor**: Sigue este plan paso a paso. Ejecuta cada
> comando de verificación y confirma el resultado esperado antes de pasar al
> siguiente paso. Si algo en la sección "Condiciones de STOP" ocurre, detente y
> reporta — no improvises. Al terminar, actualiza la fila de este plan en
> `Plan/improve2/README.md`.
>
> **Control de desvío (correr primero)**: el repositorio contiene trabajo sin
> confirmar (el árbol de trabajo es la fuente de verdad, NO el commit `09107cc`).
> Antes de tocar nada ejecuta `git status` en la raíz: deben aparecer
> modificaciones pendientes en `server/package.json` y `server/package-lock.json`.
> Lee `server/package.json` y confirma que las versiones son las que se citan en
> "Estado actual". Si no coinciden, es una condición de STOP.

## Estado

- **Prioridad**: P0
- **Esfuerzo**: M (una tarde, incluye tests)
- **Riesgo**: MEDIO (3 bump de versión mayor; la suite cubre happy paths de auth)
- **Depende de**: ninguno
- **Categoría**: security
- **Planeado en**: commit `09107cc` (árbol de trabajo), 2026-08-09
- **Issue**: —

## Por qué esto importa

`npm audit --omit=dev` (ejecutado el 2026-08-09) reporta **2 vulnerabilidades
críticas y 4 altas** en dependencias de producción directamente alcanzables:

- `@fastify/jwt` 9.1.0 → arrastra `fast-jwt <= 6.2.3` con **bypass de
  autenticación crítico (CVSS 9.1)**: "cache confusion" (devuelve las claims de
  otro token), confusión de algoritmo y aceptación de clave HMAC vacía. La
  verificación JWT es la frontera de confianza de **todas** las rutas API.
- `@fastify/static` ≤ 10.1.0 → path traversal / bypass de guards de rutas
  (CVSS 7.5). El plugin sirve el cliente (`client/` bajo `/`) y comparte origen
  con la API donde el POS guarda el token en `localStorage`.
- `drizzle-orm` < 0.45.2 → SQL injection al escapar identificadores. En este
  código el uso es de bajo riesgo (los identificadores son literales), pero la
  dependencia directa está marcada.
- `fast-uri` (transitiva, vía fastify) → confusión de host por backslash.
- `brace-expansion` (transitiva) → DoS; suele resolverse al subir `@fastify/static`.

Al terminar: `npm audit --omit=dev` no reporta critical/high, y la suite sigue
verde.

## Estado actual

- `server/package.json:21-30` contiene (entre otros) estas dependencias
  afectadas:
  - `"@fastify/jwt": "^9.1.0"`
  - `"@fastify/static": "^8.1.0"`
  - `"drizzle-orm": "^0.44.2"`
- El uso del plugin es mínimo y estable; esos son los únicos sitios:
  - `server/src/modules/auth/routes.ts:30-35` — `app.jwt.sign(payload, { expiresIn: "24h" })`.
  - `server/src/shared/middleware/auth.ts:14-20` — `request.jwtVerify()`.
  - `server/src/shared/middleware/auth.ts:4-9` — augmentación de tipos
    `declare module "@fastify/jwt" { interface FastifyJWT { payload: {...}; user: {...} } }`.
  - `server/src/app.ts:62-64` — `app.register(jwt, { secret: process.env.JWT_SECRET })`.
  - `server/tests/helpers.ts:30` — `app.register(jwt, { secret: ... })` (misma firma).

## Comandos que necesitarás

| Propósito | Comando (en `server/`) | Éxito esperado |
|-----------|------------------------|----------------|
| Instalar | `npm install` | exit 0 |
| Auditoría | `npm audit --omit=dev` | **0** critical/high (verificar; puede quedar algo de low/info) |
| Typecheck | `npm run check` | exit 0, sin errores TS |
| Tests | Ver "Prerrequisitos" abajo | todos pasan |
| Formato | no existe `lint` en el repo | — (no lo agregues) |

Prerrequisitos para `npm test` (BD local PostgreSQL en Docker):
`cd server` → `docker-compose up -d` → `npm install` → `npm run db:push` →
`$env:ADMIN_PASSWORD='admin123'; $env:CAJERO_PASSWORD='cajero123'; npm run db:seed`
→ `npm test`. Requiere que exista `server/tests/.env.test` apuntando a la BD de
prueba `orvayaya_test` (ver Plan 002; si no existe, `npm test` puede mutar la BD
de desarrollo: no lo corras sobre la BD de desarrollo).

## Alcance

**En alcance** (únicos archivos que puedes modificar):
- `server/package.json`
- `server/package-lock.json` (generado por `npm install`)
- `server/src/shared/middleware/auth.ts` — SOLO si la v10 rompe la augmentación
  de tipos y el mensaje del compilador lo confirma.

**Fuera de alcance** (NO tocar, aunque parezcan relacionados):
- `server/src/modules/auth/routes.ts`, `server/src/app.ts`,
  `server/tests/helpers.ts` — deben seguir funcionando SIN cambios; si algo ahí
  deja de compilar, reajusta SOLO la augmentación de tipos en `auth.ts` o STOP.
- `client/` cualquier archivo.
- Migraciones de BD, esquema Drizzle.
- No cambies la lógica de negocio ni los nombres de rutas.

## Flujo de trabajo git

- Rama: `fix/npm-audit-2026` (o la convención del repo si se observa una).
- Un commit al final con mensaje tipo repo, ej. `fix: subir dependencias para
  mitigar advisory de seguridad` (observa `git log --oneline`: el repo mezcla
  estilos; usa `fix:`/`chore:` con minúsculas y descripción corta).
- NO hagas push ni abras PR salvo que el operador lo indique.

## Pasos

### Paso 1: Subir las tres dependencias directas

En `server/package.json` edita:

- `"@fastify/jwt": "^9.1.0"` → `"@fastify/jwt": "^10.2.1"`
- `"@fastify/static": "^8.1.0"` → `"@fastify/static": "^10.1.3"`
- `"drizzle-orm": "^0.44.2"` → `"drizzle-orm": "^0.45.2"`

**Verificar**: `npm install` → exit 0 y sin errores de permisos/red.

### Paso 2: Typecheck

**Verificar**: `npm run check` → exit 0.

- Si falla SOLO la augmentación de tipos `@fastify/jwt` (la interface
  `FastifyJWT` de `shared/middleware/auth.ts:4-9`), consulta los tipos de la v10
  (`node_modules/@fastify/jwt/dist/index.d.ts`) y ajusta únicamente ese bloque
  (payload/user siguen siendo `{ id, email, rol, nombre }`).
- Si falla cualquier otro archivo o una firma de `sign`/`jwtVerify`, es una
  condición de STOP.

### Paso 3: Tests

Con la BD de prueba disponible (prerrequisitos de arriba):
**Verificar**: `npm test` → todos los tests pasan. Presta atención a
`tests/auth.test.ts` (login) y `tests/sync_and_sales.test.ts` (usan tokens JWT).

### Paso 4: Auditoría final

**Verificar**: `npm audit --omit=dev` → **0** vulnerabilities critical/high.
Interpretación:
- Si el único remanente es `fast-uri` o `brace-expansion` (transitivas), intenta
  `npm install fastify@^5 @fastify/static@^10.1.3` para arrastrar versiones fijas
  y repite `npm audit` (esto modifica de nuevo `package.json`/lock; está dentro
  de alcance). Si siguen reportando HIGH y no se resuelven razonablemente,
  documenta el remanente en una línea del README del índice y déjalo pasar SOLO
  si no es critical.
- No intentes `overrides` en `package.json` sin reportar antes: es salida de
  alcance.

## Plan de pruebas

- Sin tests nuevos: la cobertura existente (`tests/auth.test.ts`,
  `tests/sync_and_sales.test.ts`) ya ejercita las rutas que dependen de
  `@fastify/jwt`. Si agregas algún test, el patrón es `tests/auth.test.ts`
  (usa `buildApp()` de `tests/helpers.ts` y `app.inject`).
- Verificación: `npm test` → todos pasan.

## Criterios de terminación

TODOS deben cumplirse:

- [ ] `npm audit --omit=dev` (en `server/`) no reporta critical/high
- [ ] `npm run check` (en `server/`) → exit 0
- [ ] `npm test` (en `server/`, BD de prueba) → todos pasan
- [ ] `npm run db:push` no arrojó cambios de esquema nuevos (no debes tocar el esquema)
- [ ] Solo se modificaron archivos del alcance (`git status` lo confirma)
- [ ] `Plan/improve2/README.md` — fila de estado actualizada

## Condiciones de STOP

Detente y reporta (no improvises) si:

- El contenido de `server/package.json` no coincide con las versiones indicadas
  (el árbol de trabajo cambió desde que se escribió este plan).
- `npm run check` falla en archivos fuera del bloque de tipos de `auth.ts`.
- La v10 de `@fastify/jwt` requiere cambiar la firma de `sign`/`jwtVerify` en
  `auth/routes.ts` o `helpers.ts` (usar otra API que no sea la actual).
- `npm install` modifica más de los dos `package*.json` (p. ej. instala algo nuevo).
- Un paso falla dos veces tras un intento razonable de corrección.

## Notas de mantenimiento

- El próximo `npm audit` debe quedar limpio; tenlo como gate en el próximo
  despliegue (esto NO implementa el runner de migraciones ni CI, queda fuera).
- `@fastify/static` v10 cambiò opciones del registro: si en el futuro se
  añaden predicados `wildcard`/`allowedPath`, léelos contra la doc de v10.
- La augmentación de tipos de `@fastify/jwt` aparece 2 veces en el repo
  (`auth.ts` y `helpers.ts` es la misma vía); si la v10 la cambia para siempre,
  revisa que ambos sitios dependan del mismo tipo.