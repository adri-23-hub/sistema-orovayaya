# Plan 002: Guardia de seguridad para la BD de tests + aislamiento real

> **Instrucciones para el ejecutor**: Sigue este plan paso a paso. Ejecuta cada
> comando de verificación y confirma el resultado esperado antes de pasar al
> siguiente paso. Si algo en "Condiciones de STOP" ocurre, detente y reporta.
> Al terminar, actualiza la fila de este plan en `Plan/improve2/README.md`.
>
> **Control de desvío (correr primero)**: `git status` en la raíz debe mostrar
> trabajo sin confirmar que incluye `server/tests/setup.ts`,
> `server/tests/helpers.ts` y `server/vitest.config.ts`. Lee `tests/setup.ts` y
> `tests/helpers.ts` y confirma que coinciden con los extractos de "Estado
> actual". Si no coinciden, STOP.

## Estado

- **Prioridad**: P0
- **Esfuerzo**: M (una tarde, incluye verificar la suite 2 veces)
- **Riesgo**: MEDIO
- **Depende de**: ninguno (es base para los planes 003, 004 y 005)
- **Categoría**: tests
- **Planeado en**: commit `09107cc` (árbol de trabajo), 2026-08-09
- **Issue**: —

## Por qué esto importa

Hoy la suite de tests depende de un archivo `server/tests/.env.test` que está
**gitignored** (no existe en un checkout limpio). Si ese archivo falta,
`tests/setup.ts` cae al `.env` de desarrollo (una BD remota, no una de prueba) y
la suite entera se conecta a ella y la muta (los tests insertan ventas,
productos y borran `ventas`, `movimientos_inventario`, `transferencias`,
`sync_log`). Además la limpieza ocurre solo en `beforeAll` de 2 de 5 archivos y
el inventario (que no se restaura con el seed) decae en cada corrida hasta que
los tests de "Stock insuficiente" se revierten. Este plan hace la suite segura
(fallar rápido con una BD que no sea `_test`), reproducible en checkout limpio y
aislada entre corridas.

## Estado actual

- `server/tests/setup.ts:1-13` (archivo completo):
  ```ts
  import dotenv from "dotenv";
  import path from "path";
  import { fileURLToPath } from "url";

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  // Load .env.test if it exists, otherwise fall back to .env
  const envTestPath = path.resolve(__dirname, ".env.test");
  const envPath = path.resolve(__dirname, "../.env");

  dotenv.config({ path: envTestPath });
  dotenv.config({ path: envPath }); // fallback: won't override already-set vars
  ```
- `server/tests/helpers.ts:71-83`:
  ```ts
  export async function truncateTestTables() {
    // Solo permitir TRUNCATE si estamos en entorno de pruebas
    if (process.env.NODE_ENV !== "test" && !process.env.DATABASE_URL?.includes("test")) {
      console.warn("⚠️ truncateTestTables skipped: Not in a test environment.");
      return;
    }
    await db.execute(sql.raw(`
      DELETE FROM sync_log;
      DELETE FROM transferencias;
      DELETE FROM movimientos_inventario;
      DELETE FROM ventas;
    `));
  }
  ```
  (Vitest define `NODE_ENV=test` automáticamente, así que el único guard real es
  `DATABASE_URL` conteniendo "test".)
- `server/vitest.config.ts:5-9` — `setupFiles: ["./tests/setup.ts"]`.
- `.gitignore:10-14` — ignora `.env`, `.env.local`, `.env.development`,
  `.env.test`, `.env.production` (en cualquier directorio). Un archivo llamado
  `.env.test.example` NO cae bajo esa regla.
- `server/tests/sync_and_sales.test.ts:1-2,27-29`:
  ```ts
  import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
  import { buildApp, loginToken, truncateTestTables } from "./helpers.js";
  ...
  describe("Sales & Sync Module", () => {
    beforeAll(async () => {
      await truncateTestTables();
    });
  ```
  (`beforeEach` se importa pero no se usa; lo mismo en `tests/presentaciones.test.ts:1,19-22`.)
- `server/src/db/seed.ts:92-95` — el inventario de la Gaseosa se inserta en el
  seed con `cantidad: 300` (ciudad) y `120` (pueblo) solo si el producto es
  nuevo (`onConflictDoNothing`), por lo que re-correr el seed NO restaura el
  stock descontado por los tests.
- Convención del repo para tests: `buildApp()` + `loginToken(app, "admin@orvayaya.com", "admin123")`
  de `tests/helpers.ts:62-69` (devolver solo `res.json().token` sin comprobar
  status; vas a endurecerlo en el Paso 4).

## Comandos que necesitarás

| Propósito | Comando (en `server/`) | Éxito esperado |
|-----------|------------------------|----------------|
| Typecheck | `npm run check` | exit 0 |
| Tests | `npm test` | todos pasan, dos veces seguidas |
| Prueba del guard | ver Pasos 1 y 6 | la suite aborta ANTES de correr los tests |

Prerrequisitos (una vez): `cd server` → `docker-compose up -d` → `npm install`
→ `npm run db:push` → `$env:ADMIN_PASSWORD='admin123'; $env:CAJERO_PASSWORD='cajero123'; npm run db:seed` → `npm test`.

## Alcance

**En alcance**:
- `server/tests/setup.ts`
- `server/tests/helpers.ts`
- `server/tests/.env.test.example` (CREAR)
- `server/tests/sync_and_sales.test.ts`
- `server/tests/presentaciones.test.ts`
- `server/tests/products.test.ts`
- `server/tests/planilla.test.ts`
- `server/tests/auth.test.ts` (solo reforzar `loginToken` ya está en helpers; auth.test no necesita hooks)

**Fuera de alcance**:
- `server/.env` , `server/tests/.env.test` (gitignored): NUNCA los crees ni los
  edites; en `tests/.env.test.example` usa placeholders, nunca credenciales reales.
- `server/src/**` (código de aplicación).
- `client/**`.
- Cambiar nombres de helpers que ya importan los tests: NO renombres
  `truncateTestTables` (los tests lo importan por ese nombre).

## Flujo de trabajo git

- Rama: `fix/tests-db-guard` (o convención del repo).
- Un commit por lógica: (1) guard + example, (2) aislamiento+reset. Mensajes al
  estilo repo (`fix: ...`).
- NO push / PR sin indicación.

## Pasos

### Paso 1: Guard fail-fast en `tests/setup.ts`

Agrega al final de `tests/setup.ts` (después de los dos `dotenv.config`) este
bloque que exige una BD de prueba:

```ts
// Fail-fast: nunca ejecutar la suite contra una BD que no sea _test.
// (Vitest fuerza NODE_ENV=test, así que ese check por sí solo no alcanza.)
function nombreDeBase(url: string): string | null {
  try {
    const u = new URL(url);
    const path = u.pathname || "";
    const dbName = path.replace(/^\//, "").split("?")[0];
    return dbName || null;
  } catch {
    return null;
  }
}

const dbUrl = process.env.DATABASE_URL;
const dbName = dbUrl ? nombreDeBase(dbUrl) : null;
if (!dbUrl || !dbName || !dbName.includes("test")) {
  throw new Error(
    `[tests] DATABASE_URL debe apuntar a una base *_test (recibida: ${dbName ?? dbUrl ?? "(vacía)"}). ` +
    `Crea server/tests/.env.test a partir de server/tests/.env.test.example.`
  );
}
```

Nota: como `dotenv.config({ path: envPath })` no sobreescribe variables ya
definidas, si `tests/.env.test` existe el guard valida ÉSA; si no existe, el
guard cae sobre la definida en `../.env` y aborta (previene tocar la BD de dev).

**Verificar**: crear temporalmente (solo para esta prueba) un archivo
`server/tests/guard-test.env` con `DATABASE_URL=postgres://u:p@localhost:5432/mi_dev_por_equivocacion`
`bloqueante=1` — NO hace falta: simplemente ejecuta `npm test` SIN que exista
`server/tests/.env.test` (si ya existe, renómbralo temporalmente a `.env.test.bak`
y RESTÁURALO al terminar) y confirma que la suite aborta mostrando el mensaje del
guard y que NO se ejecuta ningún test. Restaura `.env.test` después.

### Paso 2: Crear `server/tests/.env.test.example`

Con placeholders (es un archivo **commiteable**, no contiene secretos):

```env
# Copiar a tests/.env.test y completar (este archivo NO se ignora, .env.test sí).
# La base de datos debe ser dedicada y su nombre debe contener "test" (el guard de setup.ts lo exige).
DATABASE_URL=postgres://usuario:password@localhost:5432/orvayaya_test
# Contraseñas de seed para los usuarios de prueba (helpers.ts:loginToken usa admin123/cajero123).
ADMIN_PASSWORD=cambiar_me
CAJERO_PASSWORD=cambiar_me
```

**Verificar**: `git status` muestra `server/tests/.env.test.example` como
untracked (no ignorado).

### Paso 3: Aislamiento — limpieza en cada test

Reemplaza los `beforeAll` de truncado por `beforeEach` en los archivos que mutan
ventas/inventario:

- `tests/sync_and_sales.test.ts:26-29`
- `tests/presentaciones.test.ts:19-22`

De:
```ts
describe("...", () => {
  beforeAll(async () => {
    await truncateTestTables();
  });
```
A:
```ts
describe("...", () => {
  beforeEach(async () => {
    await truncateTestTables();
  });
```

Agrega el mismo `beforeEach` (importando `truncateTestTables`) dentro del
`describe` de `tests/products.test.ts` (línea 19) y de `tests/planilla.test.ts`
(todo su `describe`). `tests/auth.test.ts` no toca esas tablas: no le agregues nada.

**Verificar**: `npm run check` → exit 0 (los imports de `beforeEach` ya existen
en sync y presentaciones; agrega los que falten).

### Paso 4: Hacer que `loginToken` falle ruidosamente

En `tests/helpers.ts:62-69`, reemplaza el cuerpo de `loginToken`:

```ts
export async function loginToken(app: FastifyInstance, email: string, password: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { email, password },
  });
  if (res.statusCode !== 200) {
    throw new Error(
      `loginToken falló para ${email}: status ${res.statusCode}, body ${res.body?.slice(0, 200)}. ` +
      `¿El seed creó ese usuario con esa contraseña?`
    );
  }
  return res.json().token;
}
```

**Verificar**: `npm run check` → exit 0.

### Paso 5: Restablecer el inventario de la Gaseosa en cada limpieza

El seed no restaura stock (ver Estado actual). Para que la suite no decaiga,
amplía `truncateTestTables` en `tests/helpers.ts` añadiendo al final del bloque
mitad de ejecución (dentro de la misma guarda), después de los `DELETE`:

```ts
// el inventario no se borra (los tests leen de él); solo se re-baselinea la
// Gaseosa (SKU-GAS01), único producto que los tests venden, para que el stock
// nunca se agote entre corridas.
await db.execute(sql.raw(`
  UPDATE inventario
  SET cantidad = 1000
  WHERE producto_id = (SELECT id FROM productos WHERE sku = 'SKU-GAS01');
`));
```

Elige `1000` (mayor que cualquier venta de test: la mayor es 12 unidades mínimas
en `sync_and_sales.test.ts:215`). Las aserciones de stock de los tests comparan
**deltas**, no absolutos, así que el valor no afecta su validez.

**Verificar**: `npm run check` → exit 0.

### Paso 6: Verificación final de la suite

**Verificar**: `npm test` → todos los tests pasan. Vuelve a ejecutarlo
**inmediatamente una segunda vez** sin tocar nada → también pasa. La corrida 2 es
la prueba real de aislamiento (no debe haber residuos de la corrida 1 que rompan
el inventario o dupliquen ventas).

## Plan de pruebas

- No se añaden tests nuevos (esto es infraestructura). La verificación es ejecutar
  la suite existente 2 veces consecutivas en verde y el aborto del guard.
- Patrón de referencia de cada test file: `tests/auth.test.ts` (no muta tablas) y
  `tests/sync_and_sales.test.ts` (usa `cbeforeEach`+delta de stock).

## Criterios de terminación

TODOS deben cumplirse:

- [ ] `git status` no muestra cambios en `server/src/**` ni `client/**`
- [ ] `npm run check` → exit 0
- [ ] Con `tests/.env.test` ausente (renombrado temporalmente), `npm test` aborta
      con el mensaje del guard y NO ejecuta tests; restaurado después
- [ ] `npm test` pasa 2 veces consecutivas con la misma BD de prueba
- [ ] `server/tests/.env.test.example` existe y solo contiene placeholders
- [ ] `git grep -n "beforeAll(async () => { await truncateTestTables"` → 0 matches
      (los truncados ahora son `beforeEach`)
- [ ] `Plan/improve2/README.md` — fila de estado actualizada

## Condiciones de STOP

Detente y reporta (no improvises) si:

- Los extractos de "Estado actual" no coinciden con los archivos vivos.
- Algún test dependía del stock absoluto de la Gaseosa (revisa: todos usan
  deltas; si encuentras una aserción absoluta, es un desvío: reporta).
- `npm test` con `_test` correcta falla de forma no relacionada con la limpieza
  (p. ej. falla el login). NO empieces a reescribir tests de aplicación.
- Un paso falla dos veces tras un intento razonable.

## Notas de mantenimiento

- Cualquier nuevo archivo de test que muta ventas/inventario debe incluir
  `beforeEach(() => truncateTestTables())`.
- Si un día la Gaseosa deja de ser el único producto vendido en tests, el reset
  del Paso 5 debe generalizarse (resetear inventario completo vía seed).
- El guard usa `URL` (global de Node ≥ 10); no agregues dependencias.