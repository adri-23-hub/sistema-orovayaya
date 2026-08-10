# Auditoría Técnica Completa — Sistema Orovayaya

> **Fecha:** 2026-08-10 · **Alcance:** Todo el proyecto · **Modo:** Solo lectura, sin modificaciones

---

## Resumen Ejecutivo

Sistema Orovayaya es un **POS offline-first con panel administrativo** para gestión de ventas, inventario y transferencias entre dos sucursales (ciudad/pueblo). El stack es sólido (Node.js 24, Fastify 5, Drizzle ORM, PostgreSQL, JS vanilla con Dexie). La arquitectura es coherente para el tamaño del proyecto. Sin embargo, existen **vulnerabilidades de seguridad críticas**, **problemas de integridad de datos en el modo offline**, y **oportunidades significativas de mejora** en testing, rendimiento y mantenibilidad.

---

## A. Problemas Críticos

### A.1 — Credenciales de base de datos de producción expuestas en `.env` commiteado

| Campo | Valor |
|-------|-------|
| **Archivo** | [.env](file:///c:/Users/Victus/Desktop/Sistema%20Orovayaya/server/.env) |
| **Ubicación** | Línea 5 |
| **Problema** | La URL de conexión a Neon (PostgreSQL en la nube) con usuario y contraseña está en el archivo `.env`, que está en `.gitignore` pero existe en el directorio. Si alguna vez fue commiteado o si el repositorio se comparte, las credenciales están expuestas |
| **Impacto** | Acceso completo a la base de datos de producción por cualquier persona con acceso al repositorio |
| **Severidad** | **CRÍTICA** |
| **Recomendación** | Rotar inmediatamente las credenciales de Neon. Verificar que `.env` nunca fue commiteado (`git log --all -- server/.env`). Usar variables de entorno del sistema o un gestor de secretos |
| **Requiere código** | No — rotación de credenciales y configuración de entorno |

### A.2 — JWT_SECRET es un string legible y predecible

| Campo | Valor |
|-------|-------|
| **Archivo** | [.env](file:///c:/Users/Victus/Desktop/Sistema%20Orovayaya/server/.env#L8) |
| **Ubicación** | Línea 8 |
| **Problema** | `JWT_SECRET=cambia-esto-por-un-secreto-seguro-en-produccion` — un string adivinable. Cualquiera que lo conozca puede forjar tokens JWT válidos |
| **Impacto** | Suplantación de identidad de cualquier usuario, incluyendo admin |
| **Severidad** | **CRÍTICA** |
| **Recomendación** | Generar un secreto de mínimo 256 bits con `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` |
| **Requiere código** | No — configuración de entorno |

### A.3 — Sin expiración de token ni mecanismo de revocación

| Campo | Valor |
|-------|-------|
| **Archivo** | [auth/routes.ts](file:///c:/Users/Victus/Desktop/Sistema%20Orovayaya/server/src/modules/auth/routes.ts#L30-L35) |
| **Ubicación** | Línea 35 |
| **Problema** | El JWT expira en 24h pero no hay mecanismo de revocación. Si un token se filtra o un usuario es eliminado, el token sigue siendo válido hasta su expiración |
| **Impacto** | Un usuario eliminado o con contraseña cambiada puede seguir accediendo al sistema durante 24h |
| **Severidad** | **CRÍTICA** |
| **Recomendación** | Implementar verificación de usuario activo en el middleware `authenticate`. Considerar refresh tokens o una blacklist de tokens |
| **Requiere código** | Sí |

### A.4 — Race condition TOCTOU en `/v1/transfers` (transferencia individual)

| Campo | Valor |
|-------|-------|
| **Archivo** | [inventory/routes.ts](file:///c:/Users/Victus/Desktop/Sistema%20Orovayaya/server/src/modules/inventory/routes.ts#L421-L429) |
| **Ubicación** | Líneas 421-429 |
| **Problema** | La verificación de stock (`originStock.cantidad < unidades`) se hace **fuera** de la transacción. Dos transferencias concurrentes pueden ambas pasar la verificación y sobre-descontar stock |
| **Impacto** | Stock negativo en la base de datos (el CHECK constraint lo puede prevenir, causando error 500 no manejado) |
| **Severidad** | **CRÍTICA** |
| **Recomendación** | Mover la verificación de stock dentro de la transacción, usando `FOR UPDATE` o el patrón atómico `WHERE cantidad >= :required` como ya se hace en `procesarVenta` |
| **Requiere código** | Sí |

### A.5 — Race condition TOCTOU en `/v1/inventory/adjust`

| Campo | Valor |
|-------|-------|
| **Archivo** | [inventory/routes.ts](file:///c:/Users/Victus/Desktop/Sistema%20Orovayaya/server/src/modules/inventory/routes.ts#L124-L143) |
| **Ubicación** | Líneas 124-143 |
| **Problema** | Similar a A.4: lee el stock actual fuera de la transacción, calcula el nuevo stock y luego lo escribe dentro. Dos ajustes concurrentes pueden sobre-escribirse |
| **Impacto** | Pérdida o corrupción de datos de inventario |
| **Severidad** | **CRÍTICA** |
| **Recomendación** | Usar operación atómica `SET cantidad = cantidad + delta WHERE cantidad + delta >= 0` dentro de la transacción |
| **Requiere código** | Sí |

---

## B. Bugs Potenciales

### B.1 — `authenticate` middleware no detiene la ejecución tras 401

| Campo | Valor |
|-------|-------|
| **Archivo** | [middleware/auth.ts](file:///c:/Users/Victus/Desktop/Sistema%20Orovayaya/server/src/shared/middleware/auth.ts#L14-L19) |
| **Ubicación** | Líneas 14-19 |
| **Problema** | Cuando `jwtVerify()` falla, se envía 401 pero **no se lanza excepción ni se retorna**. El handler de ruta continúa ejecutándose con `request.user` como `undefined`, pudiendo causar errores o acceso no autorizado |
| **Impacto** | Rutas protegidas podrían ejecutar parcialmente con user undefined |
| **Severidad** | **ALTA** |
| **Recomendación** | Añadir `return` después de `reply.status(401).send()`, o lanzar un `Error` explícito |
| **Requiere código** | Sí |

### B.2 — Descuento de stock local en POS no considera `factorConversion`

| Campo | Valor |
|-------|-------|
| **Archivo** | [pos/app.js](file:///c:/Users/Victus/Desktop/Sistema%20Orovayaya/client/pos/app.js#L542-L547) |
| **Ubicación** | Líneas 542-547 |
| **Problema** | `p.stock = Math.max(0, (p.stock \|\| 0) - item.cantidad)` resta la cantidad de presentaciones vendidas, no las unidades mínimas. Si se vende 1 "Paquete de 6", el stock local solo baja 1 en vez de 6 |
| **Impacto** | El stock local del POS es incorrecto, permitiendo sobreventas offline |
| **Severidad** | **ALTA** |
| **Recomendación** | Multiplicar por `factorConversion`: `p.stock -= item.cantidad * factorConversion` |
| **Requiere código** | Sí |

### B.3 — Filtro `search` en productos vulnerable a inyección LIKE

| Campo | Valor |
|-------|-------|
| **Archivo** | [catalog/routes.ts](file:///c:/Users/Victus/Desktop/Sistema%20Orovayaya/server/src/modules/catalog/routes.ts#L38-L44) |
| **Ubicación** | Líneas 38-44 |
| **Problema** | El parámetro `search` se interpola directamente en `%${search}%`. Caracteres especiales de LIKE (`%`, `_`) pueden usarse para wildcard attacks, causando consultas lentas o fugas de datos |
| **Impacto** | Rendimiento degradado, posible enumeración de datos |
| **Severidad** | **MEDIA** |
| **Recomendación** | Escapar caracteres especiales de LIKE: `search.replace(/[%_]/g, '\\$&')` |
| **Requiere código** | Sí |

### B.4 — `parseInt(limit)` en transfers sin validación puede causar consultas masivas

| Campo | Valor |
|-------|-------|
| **Archivo** | [inventory/routes.ts](file:///c:/Users/Victus/Desktop/Sistema%20Orovayaya/server/src/modules/inventory/routes.ts#L508) |
| **Ubicación** | Línea 508 |
| **Problema** | `.limit(parseInt(limit))` sin clamping. Un valor como `999999` puede devolver toda la tabla |
| **Impacto** | Potencial DoS por consumo de memoria |
| **Severidad** | **MEDIA** |
| **Recomendación** | Aplicar `Math.min(200, Math.max(1, parseInt(limit)))` como en otros endpoints |
| **Requiere código** | Sí |

### B.5 — Doble lectura de stock innecesaria en `transfers-batch`

| Campo | Valor |
|-------|-------|
| **Archivo** | [inventory/routes.ts](file:///c:/Users/Victus/Desktop/Sistema%20Orovayaya/server/src/modules/inventory/routes.ts#L316-L329) |
| **Ubicación** | Líneas 316-329 |
| **Problema** | Se lee `originStock` para verificar, y luego se lee *otra vez* `stockOrigenAntes` inmediatamente después. Son dos SELECT idénticos |
| **Impacto** | Consultas innecesarias, ralentización de transacciones |
| **Severidad** | **BAJA** |
| **Recomendación** | Eliminar la lectura duplicada |
| **Requiere código** | Sí |

### B.6 — `validateBody` acepta `ZodObject` pero se invoca con `crearPresentacionSchema as any`

| Campo | Valor |
|-------|-------|
| **Archivo** | [middleware/validation.ts](file:///c:/Users/Victus/Desktop/Sistema%20Orovayaya/server/src/shared/middleware/validation.ts#L8) |
| **Ubicación** | Línea 8 |
| **Problema** | El tipo `ZodObject` es demasiado restrictivo (Zod v4 usa `z.ZodObject`). Los casteos `as any` en las rutas ocultan errores de tipo |
| **Impacto** | Errores de tipo silenciados, posible fallo en validación |
| **Severidad** | **BAJA** |
| **Recomendación** | Usar `ZodType<any>` o `z.ZodSchema` como tipo del parámetro |
| **Requiere código** | Sí |

---

## C. Vulnerabilidades de Seguridad

### C.1 — XSS en renderizado del POS y Admin (innerHTML con datos no sanitizados)

| Campo | Valor |
|-------|-------|
| **Archivo** | [pos/app.js](file:///c:/Users/Victus/Desktop/Sistema%20Orovayaya/client/pos/app.js#L206-L236) y [admin/app.js](file:///c:/Users/Victus/Desktop/Sistema%20Orovayaya/client/admin/app.js) |
| **Ubicación** | Múltiples funciones de renderizado |
| **Problema** | Nombres de productos, categorías, proveedores, etc. se inyectan con `innerHTML` sin escapar HTML. Un producto con nombre `<img onerror=alert(1) src=x>` ejecutaría JavaScript |
| **Impacto** | XSS almacenado: cualquier admin puede inyectar código que se ejecuta en el navegador de todos los usuarios |
| **Severidad** | **ALTA** |
| **Recomendación** | Usar `textContent` o una función de escape HTML para todos los datos dinámicos |
| **Requiere código** | Sí |

### C.2 — Credenciales demo visibles en HTML de login

| Campo | Valor |
|-------|-------|
| **Archivo** | [login.html](file:///c:/Users/Victus/Desktop/Sistema%20Orovayaya/client/login.html#L240-L244) |
| **Ubicación** | Líneas 240-244 |
| **Problema** | Las credenciales de admin y cajero están visibles en el HTML: `admin@orvayaya.com / admin123`. Si esto llega a producción, cualquier persona puede acceder como admin |
| **Impacto** | Acceso total al sistema por cualquier visitante |
| **Severidad** | **ALTA** |
| **Recomendación** | Eliminar la sección `credentials-hint` en producción o condicionarla a una variable de entorno |
| **Requiere código** | Sí |

### C.3 — Sin rate limiting en login

| Campo | Valor |
|-------|-------|
| **Archivo** | [auth/routes.ts](file:///c:/Users/Victus/Desktop/Sistema%20Orovayaya/server/src/modules/auth/routes.ts#L10) |
| **Ubicación** | Línea 10 |
| **Problema** | El endpoint de login no tiene limitación de intentos. Se puede hacer fuerza bruta contra las contraseñas |
| **Impacto** | Compromiso de cuentas de usuario |
| **Severidad** | **ALTA** |
| **Recomendación** | Implementar `@fastify/rate-limit` para el endpoint de login |
| **Requiere código** | Sí |

### C.4 — Sin validación de fortaleza de contraseña en registro

| Campo | Valor |
|-------|-------|
| **Archivo** | [auth/routes.ts](file:///c:/Users/Victus/Desktop/Sistema%20Orovayaya/server/src/modules/auth/routes.ts#L60-L82) |
| **Ubicación** | Líneas 60-82 |
| **Problema** | El endpoint de registro acepta cualquier contraseña sin validar longitud mínima, complejidad, etc. |
| **Impacto** | Usuarios con contraseñas débiles |
| **Severidad** | **MEDIA** |
| **Recomendación** | Añadir validación Zod con `z.string().min(8)` y requisitos de complejidad |
| **Requiere código** | Sí |

### C.5 — Token JWT almacenado en localStorage

| Campo | Valor |
|-------|-------|
| **Archivo** | [shared/api.js](file:///c:/Users/Victus/Desktop/Sistema%20Orovayaya/client/shared/api.js#L9-L13) |
| **Ubicación** | Líneas 9, 13 |
| **Problema** | El token JWT se guarda en `localStorage`, accesible por cualquier JavaScript en la página (incluido XSS) |
| **Impacto** | Si se combina con C.1 (XSS), el token puede ser robado |
| **Severidad** | **MEDIA** (en contexto: el frontend no carga scripts de terceros excepto fuentes) |
| **Recomendación** | Considerar cookies HttpOnly+Secure para el token. A corto plazo, priorizar la mitigación de XSS (C.1) |
| **Requiere código** | Sí |

### C.6 — Sin validación de `rol` en registro

| Campo | Valor |
|-------|-------|
| **Archivo** | [auth/routes.ts](file:///c:/Users/Victus/Desktop/Sistema%20Orovayaya/server/src/modules/auth/routes.ts#L61-L62) |
| **Ubicación** | Línea 62 |
| **Problema** | Se castea `rol` como `"admin" \| "cajero"` pero no se valida que realmente sea uno de esos valores. Un payload con `rol: "superadmin"` pasaría al DB (aunque el enum de PostgreSQL lo rechazaría) |
| **Impacto** | Error 500 no descriptivo para el usuario |
| **Severidad** | **BAJA** |
| **Recomendación** | Validar con Zod: `z.enum(["admin", "cajero"])` |
| **Requiere código** | Sí |

### C.7 — CORS completamente abierto en desarrollo

| Campo | Valor |
|-------|-------|
| **Archivo** | [app.ts](file:///c:/Users/Victus/Desktop/Sistema%20Orovayaya/server/src/app.ts#L48-L53) |
| **Ubicación** | Líneas 48-53 |
| **Problema** | `origin: true` permite requests desde cualquier origen. Si NODE_ENV no está configurado correctamente, esto puede aplicarse en producción |
| **Impacto** | Ataques CSRF desde cualquier dominio |
| **Severidad** | **MEDIA** |
| **Recomendación** | En producción, CORS está deshabilitado (correcto para same-origin). Asegurar que `NODE_ENV=production` esté configurado en producción |
| **Requiere código** | No — configuración |

---

## D. Problemas de Datos / Base de Datos

### D.1 — Items de venta almacenados como JSONB sin integridad referencial

| Campo | Valor |
|-------|-------|
| **Archivo** | [schema/ventas.ts](file:///c:/Users/Victus/Desktop/Sistema%20Orovayaya/server/src/db/schema/ventas.ts#L20) |
| **Ubicación** | Línea 20 |
| **Problema** | `items: jsonb("items").$type<VentaItem[]>()` — los ítems de la venta se guardan como JSON. No hay integridad referencial con `productos` ni `presentaciones_venta`. Si se elimina un producto, las ventas históricas conservan los datos pero no hay forma de hacer JOIN |
| **Impacto** | No se puede generar reportes cruzados con datos actualizados de productos. Los reportes de ganancias ya manejan esto buscando en `prodMap` pero es frágil |
| **Severidad** | **MEDIA** |
| **Recomendación** | Considerar una tabla `venta_items` normalizada para mejor consulta, o aceptar la desnormalización documentándola como decisión consciente |
| **Requiere código** | Sí (si se normaliza) |

### D.2 — Sin índice en `historial_costos.producto_id`

| Campo | Valor |
|-------|-------|
| **Archivo** | [schema/historial_costos.ts](file:///c:/Users/Victus/Desktop/Sistema%20Orovayaya/server/src/db/schema/historial_costos.ts) |
| **Ubicación** | Todo el archivo |
| **Problema** | La tabla tiene FK a `productos.id` pero no tiene índice explícito. Las consultas filtradas por `producto_id` harán full scan |
| **Impacto** | Consultas lentas al crecer la tabla |
| **Severidad** | **BAJA** |
| **Recomendación** | Añadir `index("hc_producto_idx").on(table.productoId)` |
| **Requiere código** | Sí |

### D.3 — Sin `updatedAt` en varias tablas que podrían necesitarlo

| Campo | Valor |
|-------|-------|
| **Archivo** | [schema/usuarios.ts](file:///c:/Users/Victus/Desktop/Sistema%20Orovayaya/server/src/db/schema/usuarios.ts), [schema/sucursales.ts](file:///c:/Users/Victus/Desktop/Sistema%20Orovayaya/server/src/db/schema/sucursales.ts) |
| **Ubicación** | Esquemas completos |
| **Problema** | `usuarios` y `sucursales` no tienen `updatedAt`. No se puede saber cuándo fue la última modificación |
| **Impacto** | Auditoría limitada |
| **Severidad** | **BAJA** |
| **Recomendación** | Añadir `updatedAt` a ambas tablas |
| **Requiere código** | Sí |

### D.4 — `GenericCrudService.update` asume que todas las tablas tienen `updatedAt`

| Campo | Valor |
|-------|-------|
| **Archivo** | [services/crud.service.ts](file:///c:/Users/Victus/Desktop/Sistema%20Orovayaya/server/src/services/crud.service.ts#L42) |
| **Ubicación** | Línea 42 |
| **Problema** | `{ ...filtered, updatedAt: new Date() }` — se intenta setear `updatedAt` incondicionalmente, pero tablas como `categorias` y `marcas` no tienen ese campo. Drizzle descartará el campo silenciosamente, pero es inconsistente |
| **Impacto** | Actualización silenciosamente incompleta |
| **Severidad** | **BAJA** |
| **Recomendación** | Verificar si la tabla tiene `updatedAt` antes de setearlo, o añadir el campo a las tablas que lo usan |
| **Requiere código** | Sí |

### D.5 — Sin `ON DELETE` consistente entre tablas

| Campo | Valor |
|-------|-------|
| **Archivos** | Múltiples schemas |
| **Problema** | Algunas FKs usan `CASCADE`, otras `SET NULL`, sin una estrategia clara. Eliminar un producto cascadea inventario y ventas, lo cual puede ser destructivo |
| **Impacto** | Pérdida accidental de datos al eliminar entidades |
| **Severidad** | **MEDIA** |
| **Recomendación** | Considerar soft delete para productos (campo `deletedAt`) en lugar de CASCADE |
| **Requiere código** | Sí |

---

## E. Problemas del Modo Offline

### E.1 — Catálogo offline no incluye presentaciones en Dexie

| Campo | Valor |
|-------|-------|
| **Archivo** | [shared/db.js](file:///c:/Users/Victus/Desktop/Sistema%20Orovayaya/client/shared/db.js#L10-L14) |
| **Ubicación** | Líneas 10-14 |
| **Problema** | El schema de Dexie solo almacena `productos`, `ventasPendientes` y `config`. Las presentaciones se guardan en `localStorage` (`pos_pres`). `localStorage` tiene un límite de ~5MB y no es transaccional |
| **Impacto** | Si `localStorage` se llena o se limpia, las presentaciones se pierden y el POS offline no puede vender por presentación |
| **Severidad** | **ALTA** |
| **Recomendación** | Añadir tabla `presentaciones` a Dexie para almacenamiento offline robusto |
| **Requiere código** | Sí |

### E.2 — Stock offline es solo una estimación optimista

| Campo | Valor |
|-------|-------|
| **Archivo** | [pos/app.js](file:///c:/Users/Victus/Desktop/Sistema%20Orovayaya/client/pos/app.js#L542-L547) |
| **Ubicación** | Líneas 542-547 |
| **Problema** | El stock local solo se actualiza al vender. No hay forma de saber si otro cajero (u otra pestaña) también está vendiendo el mismo producto. Además, el descuento es incorrecto (ver B.2) |
| **Impacto** | Sobreventas offline que serán rechazadas al sincronizar |
| **Severidad** | **MEDIA** |
| **Recomendación** | Documentar como limitación conocida. Implementar notificaciones al usuario cuando la sync falle por stock insuficiente |
| **Requiere código** | Parcialmente |

### E.3 — Ventas fallidas en sync no se resincronizan automáticamente

| Campo | Valor |
|-------|-------|
| **Archivo** | [pos/app.js](file:///c:/Users/Victus/Desktop/Sistema%20Orovayaya/client/pos/app.js#L736-L741) |
| **Ubicación** | Líneas 736-741 |
| **Problema** | `markSaleFailed` establece `synced: 0`, lo cual significa que la próxima autoSync intentará reenviarla. Sin embargo, si el error es permanente (stock insuficiente), se reintentará infinitamente |
| **Impacto** | Ciclo infinito de reintentos fallidos, posible degradación de rendimiento |
| **Severidad** | **MEDIA** |
| **Recomendación** | Implementar un campo de `retryCount` y un máximo de reintentos. Después del máximo, marcar como `synced: -1` (error permanente) y notificar al usuario |
| **Requiere código** | Sí |

### E.4 — `autoSync` envía TODAS las ventas pendientes con una sola `idempotencyKey`

| Campo | Valor |
|-------|-------|
| **Archivo** | [pos/app.js](file:///c:/Users/Victus/Desktop/Sistema%20Orovayaya/client/pos/app.js#L704) |
| **Ubicación** | Línea 704 |
| **Problema** | `makeIdempotencyKey(pending)` genera una clave basada en TODOS los IDs pendientes. Si entre dos intentos se añade una venta nueva, la clave cambia, y el servidor la trata como un batch diferente. Las ventas del batch anterior podrían procesarse de nuevo (aunque la idempotencia a nivel de `ventaId` en `onConflictDoNothing` lo previene en el servidor) |
| **Impacto** | Bajo gracias a la doble idempotencia (key + ventaId), pero la semántica es confusa |
| **Severidad** | **BAJA** |
| **Recomendación** | Considerar enviar lotes fijos o una clave por sesión de sync |
| **Requiere código** | Sí |

### E.5 — Sin mecanismo de limpieza de IndexedDB

| Campo | Valor |
|-------|-------|
| **Archivo** | [shared/db.js](file:///c:/Users/Victus/Desktop/Sistema%20Orovayaya/client/shared/db.js) |
| **Ubicación** | Todo el archivo |
| **Problema** | No hay limpieza de datos antiguos en IndexedDB. Con el tiempo, el catálogo de productos crece sin poda |
| **Impacto** | Bajo — `syncCatalogToLocal` hace `clear()` + `bulkAdd()` en cada sync, así que se actualiza |
| **Severidad** | **BAJA** |
| **Recomendación** | Aceptable por ahora, pero considerar límites de almacenamiento |
| **Requiere código** | No |

---

## F. Problemas de Rendimiento

### F.1 — Dashboard ejecuta 5+ queries independientes secuencialmente

| Campo | Valor |
|-------|-------|
| **Archivo** | [dashboard/routes.ts](file:///c:/Users/Victus/Desktop/Sistema%20Orovayaya/server/src/modules/dashboard/routes.ts#L10-L98) |
| **Ubicación** | Líneas 10-98 |
| **Problema** | `salesTotal`, `lowStockAlerts`, `stockCiudad`, `stockPueblo`, `transferenciasRecientes` — todas secuenciales. Podrían ejecutarse en paralelo con `Promise.all` |
| **Impacto** | Latencia del dashboard = suma de todas las queries en lugar del máximo |
| **Severidad** | **MEDIA** |
| **Recomendación** | Envolver las 5 queries en `Promise.all()` |
| **Requiere código** | Sí |

### F.2 — Reporte de ganancias carga TODOS los productos para cada consulta

| Campo | Valor |
|-------|-------|
| **Archivo** | [reports/routes.ts](file:///c:/Users/Victus/Desktop/Sistema%20Orovayaya/server/src/modules/reports/routes.ts#L106-L107) |
| **Ubicación** | Líneas 106-107 |
| **Problema** | `const prods = await db.select().from(productos)` — carga todos los productos en memoria para construir `prodMap`. Con miles de productos, esto consume memoria |
| **Impacto** | Escalabilidad limitada |
| **Severidad** | **MEDIA** |
| **Recomendación** | Filtrar solo los productos referenciados en las ventas del periodo, o pre-calcular márgenes |
| **Requiere código** | Sí |

### F.3 — Catálogo POS carga 200 productos + inventario + presentaciones en secuencia

| Campo | Valor |
|-------|-------|
| **Archivo** | [pos/app.js](file:///c:/Users/Victus/Desktop/Sistema%20Orovayaya/client/pos/app.js#L105-L140) |
| **Ubicación** | Líneas 105-140 |
| **Problema** | 4 requests secuenciales al iniciar: `getProducts`, `getBranches`, `getInventory`, `getPresentaciones` |
| **Impacto** | Carga lenta del POS en conexiones lentas |
| **Severidad** | **MEDIA** |
| **Recomendación** | Paralelizar con `Promise.all` o crear un endpoint `/v1/pos/bootstrap` que devuelva todo en una sola respuesta |
| **Requiere código** | Sí |

### F.4 — Conexión PostgreSQL sin pool sizing explícito

| Campo | Valor |
|-------|-------|
| **Archivo** | [db/index.ts](file:///c:/Users/Victus/Desktop/Sistema%20Orovayaya/server/src/db/index.ts#L14) |
| **Ubicación** | Línea 14 |
| **Problema** | `const client = postgres(connectionString)` — usa defaults de postgres.js (10 connections). Para Neon serverless, podría necesitar configuración específica |
| **Impacto** | Posibles timeouts bajo carga |
| **Severidad** | **BAJA** |
| **Recomendación** | Configurar explícitamente `max`, `idle_timeout`, y `connection.application_name` |
| **Requiere código** | Sí |

### F.5 — `inventory/global` construye mapa en JS en vez de usar SQL

| Campo | Valor |
|-------|-------|
| **Archivo** | [inventory/routes.ts](file:///c:/Users/Victus/Desktop/Sistema%20Orovayaya/server/src/modules/inventory/routes.ts#L36-L69) |
| **Ubicación** | Líneas 36-69 |
| **Problema** | Carga todo el inventario y agrupa en JS. Esto debería ser un `GROUP BY` con condicionales `CASE WHEN tipo = 'ciudad'` |
| **Impacto** | Ineficiencia con muchos productos |
| **Severidad** | **BAJA** |
| **Recomendación** | Reescribir como una sola query SQL con `CASE WHEN` o `FILTER(WHERE)` |
| **Requiere código** | Sí |

---

## G. Problemas de Testing

### G.1 — Sin base de datos de test dedicada aislada

| Campo | Valor |
|-------|-------|
| **Archivo** | [tests/setup.ts](file:///c:/Users/Victus/Desktop/Sistema%20Orovayaya/server/tests/setup.ts) |
| **Ubicación** | Todo el archivo |
| **Problema** | `.env.test` define `orvayaya_test` pero si no existe, `dotenv` fallback al `.env` principal. Los tests podrían correr contra la base de datos de producción. `truncateTestTables` tiene un guard pero solo verifica si el nombre contiene "test" |
| **Impacto** | Posible destrucción de datos de producción si se ejecutan tests sin `.env.test` correcto |
| **Severidad** | **ALTA** |
| **Recomendación** | Lanzar error fatal si `DATABASE_URL` no contiene "test" cuando `NODE_ENV=test` |
| **Requiere código** | Sí |

### G.2 — Sin cobertura de test para módulos CRUD (proveedores, marcas, categorías)

| Campo | Valor |
|-------|-------|
| **Archivos** | [tests/](file:///c:/Users/Victus/Desktop/Sistema%20Orovayaya/server/tests) |
| **Problema** | Los tests solo cubren auth, products, sales, sync, planilla y presentaciones. No hay tests para: proveedores, marcas, categorías, usuarios, movimientos, historial-costos, dashboard, reports |
| **Impacto** | Regresiones no detectadas en módulos sin tests |
| **Severidad** | **MEDIA** |
| **Recomendación** | Añadir tests para cada módulo CRUD y para los reportes |
| **Requiere código** | Sí |

### G.3 — Sin tests de frontend/E2E

| Campo | Valor |
|-------|-------|
| **Archivos** | Ninguno |
| **Problema** | No hay tests para el frontend (ni unitarios ni E2E). La lógica del POS (carrito, checkout, sync, offline) no tiene cobertura |
| **Impacto** | Bugs en UX no detectados |
| **Severidad** | **MEDIA** |
| **Recomendación** | Añadir Playwright o Cypress para tests E2E críticos (login, venta, sync) |
| **Requiere código** | Sí |

### G.4 — Tests de sync dependen de datos seed existentes

| Campo | Valor |
|-------|-------|
| **Archivo** | [tests/sync_and_sales.test.ts](file:///c:/Users/Victus/Desktop/Sistema%20Orovayaya/server/tests/sync_and_sales.test.ts#L80-L86) |
| **Ubicación** | Líneas 80-86 |
| **Problema** | Los tests asumen que existen productos con presentaciones tipo "Paquete de 6" en la BD. Si el seed no se ejecutó o los datos cambian, los tests fallan |
| **Impacto** | Tests frágiles |
| **Severidad** | **MEDIA** |
| **Recomendación** | Crear datos de prueba explícitamente en `beforeAll` de cada suite |
| **Requiere código** | Sí |

---

## H. Deuda Técnica

### H.1 — Admin app.js es un monolito de 1296 líneas

| Campo | Valor |
|-------|-------|
| **Archivo** | [admin/app.js](file:///c:/Users/Victus/Desktop/Sistema%20Orovayaya/client/admin/app.js) |
| **Tamaño** | 1296 líneas / 71KB |
| **Problema** | Todo el panel admin está en un solo archivo: router, renderizado de 12+ secciones, modales, tablas, planillas. Es difícil de mantener, navegar y debuggear |
| **Severidad** | **ALTA** |
| **Recomendación** | Separar en módulos por sección (dashboard.js, productos.js, etc.) |
| **Requiere código** | Sí |

### H.2 — `inventory/routes.ts` tiene 511 líneas con lógica duplicada

| Campo | Valor |
|-------|-------|
| **Archivo** | [inventory/routes.ts](file:///c:/Users/Victus/Desktop/Sistema%20Orovayaya/server/src/modules/inventory/routes.ts) |
| **Tamaño** | 511 líneas |
| **Problema** | `/v1/transfers` y `/v1/transfers-batch` tienen lógica casi idéntica. `/v1/inventory/adjust` y `/v1/inventory/adjust-batch` también. Código duplicado propenso a bugs divergentes |
| **Severidad** | **MEDIA** |
| **Recomendación** | Extraer la lógica compartida a funciones de servicio (como ya se hizo con `procesarVenta`) |
| **Requiere código** | Sí |

### H.3 — Mezcla de idiomas en el código

| Campo | Valor |
|-------|-------|
| **Archivos** | Todo el proyecto |
| **Problema** | Nombres de tablas en español (`ventas`, `sucursales`, `movimientosInventario`), tipos en español (`NuevoUsuario`, `VentaItem`), endpoints en inglés (`/products`, `/inventory`, `/transfers`), comentarios en ambos. Variables mezclan camelCase español (`sucursalId`, `cantidadAnterior`) con inglés (`syncedIds`, `createdAt`) |
| **Severidad** | **BAJA** |
| **Recomendación** | Adoptar una convención consistente y documentarla |
| **Requiere código** | No (documentar) |

### H.4 — Casteos `as any` frecuentes en rutas

| Campo | Valor |
|-------|-------|
| **Archivos** | Múltiples [routes.ts](file:///c:/Users/Victus/Desktop/Sistema%20Orovayaya/server/src/modules/sales/routes.ts#L54) |
| **Problema** | `(request as any).user?.id`, `request.body as { ... }`, `createSaleSchema as any` — se pierden las garantías de TypeScript |
| **Severidad** | **MEDIA** |
| **Recomendación** | Usar types genéricos de Fastify: `RouteGenericInterface` con `Body`, `Params`, `Querystring` |
| **Requiere código** | Sí |

### H.5 — `isUuid` duplicada en catalog/routes.ts y sync/routes.ts

| Campo | Valor |
|-------|-------|
| **Archivos** | [catalog/routes.ts](file:///c:/Users/Victus/Desktop/Sistema%20Orovayaya/server/src/modules/catalog/routes.ts#L91-L93) y [sync/routes.ts](file:///c:/Users/Victus/Desktop/Sistema%20Orovayaya/server/src/modules/sync/routes.ts#L12-L14) |
| **Problema** | Misma función `isUuid` copiada en dos archivos |
| **Severidad** | **BAJA** |
| **Recomendación** | Mover a `shared/utils.ts` |
| **Requiere código** | Sí |

### H.6 — Archivos de desarrollo/scripts en raíz del server

| Campo | Valor |
|-------|-------|
| **Archivos** | [create-test-db.ts](file:///c:/Users/Victus/Desktop/Sistema%20Orovayaya/server/create-test-db.ts), [recreate-db.js](file:///c:/Users/Victus/Desktop/Sistema%20Orovayaya/server/recreate-db.js), [setup-test-db.js](file:///c:/Users/Victus/Desktop/Sistema%20Orovayaya/server/setup-test-db.js), [test-query.ts](file:///c:/Users/Victus/Desktop/Sistema%20Orovayaya/server/test-query.ts), [truncate-sucursales.ts](file:///c:/Users/Victus/Desktop/Sistema%20Orovayaya/server/truncate-sucursales.ts) |
| **Problema** | Scripts de desarrollo sueltos en la raíz del servidor. No están organizados ni documentados |
| **Severidad** | **BAJA** |
| **Recomendación** | Mover a `scripts/` o `src/db/scripts/` |
| **Requiere código** | No (reorganización) |

---

## I. Mejoras Recomendadas (Prioridad Alta)

| # | Mejora | Archivos | Esfuerzo |
|---|--------|----------|----------|
| I.1 | Rotar credenciales de DB y JWT_SECRET | `.env` | 30 min |
| I.2 | Corregir race conditions (A.4, A.5) con updates atómicos | `inventory/routes.ts` | 2h |
| I.3 | Añadir `return` al `authenticate` middleware (B.1) | `auth.ts` | 15 min |
| I.4 | Escapar HTML en todo renderizado frontend (C.1) | `pos/app.js`, `admin/app.js` | 4h |
| I.5 | Añadir rate limiting al login (C.3) | `app.ts` | 30 min |
| I.6 | Corregir descuento de stock offline (B.2) | `pos/app.js` | 30 min |
| I.7 | Almacenar presentaciones en Dexie (E.1) | `shared/db.js`, `pos/app.js` | 2h |
| I.8 | Guard en tests para no correr contra producción (G.1) | `tests/setup.ts` | 30 min |
| I.9 | Eliminar credenciales demo del HTML en producción (C.2) | `login.html` | 15 min |

---

## J. Mejoras Opcionales

| # | Mejora | Archivos | Esfuerzo |
|---|--------|----------|----------|
| J.1 | Paralelizar queries del dashboard (F.1) | `dashboard/routes.ts` | 1h |
| J.2 | Endpoint `/v1/pos/bootstrap` para carga inicial (F.3) | Nuevo archivo + `pos/app.js` | 3h |
| J.3 | Refactorizar admin/app.js en módulos (H.1) | `admin/app.js` → varios | 8h |
| J.4 | Extraer servicio de transferencias (H.2) | `inventory/routes.ts` → servicio | 4h |
| J.5 | Soft delete para productos (D.5) | Schema + rutas | 4h |
| J.6 | Añadir `HEALTHCHECK` al Dockerfile | `Dockerfile` | 15 min |
| J.7 | Graceful shutdown (handle SIGTERM) | `app.ts` | 1h |
| J.8 | Añadir tests para módulos CRUD faltantes (G.2) | `tests/` | 6h |
| J.9 | Tipado estricto con RouteGenericInterface (H.4) | Todas las rutas | 4h |
| J.10 | Normalizar `venta_items` como tabla separada (D.1) | Schema + servicio | 8h |
| J.11 | Añadir timestamps de auditoría a usuarios (D.3) | Schema + migración | 1h |
| J.12 | Optimizar `inventory/global` con SQL (F.5) | `inventory/routes.ts` | 1h |

---

## K. Cosas Bien Implementadas ✓

| # | Aspecto | Detalle |
|---|---------|---------|
| K.1 | **Idempotencia en sync** | Excelente implementación con `syncLog`, idempotency key, claim atómico, y manejo de stale locks. Los tests de concurrencia (409) lo verifican |
| K.2 | **Descuento atómico de stock en ventas** | `procesarVenta` usa `WHERE cantidad >= :required` dentro de transacción — patrón correcto que evita TOCTOU |
| K.3 | **Separación de precios servidor vs cliente** | El servidor nunca confía en precios/totales del cliente. Siempre resuelve desde la DB (línea 101-129 de `presentaciones.service.ts`) |
| K.4 | **Savepoints en sync batch** | Cada venta del batch tiene su propio savepoint, permitiendo fallar individualmente sin perder las exitosas |
| K.5 | **Validación Zod donde se usa** | Schemas como `crearPresentacionSchema`, `productSchema`, `createSaleSchema` están bien definidos |
| K.6 | **Movimientos de inventario como audit trail** | Cada cambio de stock genera un registro en `movimientos_inventario` con cantidad anterior/posterior |
| K.7 | **Offline-first architecture** | El POS guarda en IndexedDB primero y sincroniza después. `beforeunload` advierte de tickets no finalizados |
| K.8 | **Protección contra UUID inválidos** | Validación `isUuid()` antes de queries, y handler global para error PostgreSQL `22P02` |
| K.9 | **Multi-stage Docker** | Build limpio: stage 1 compila, stage 2 solo copia dist y node_modules de producción |
| K.10 | **Test de SQL injection** | Test explícito de inyección SQL vía `venta.id` malicioso en sync (`"x; DROP TABLE ventas--"`) |
| K.11 | **bcrypt con salt rounds = 10** | Hashing de contraseñas correcto con bcryptjs |
| K.12 | **Paginación con clamping** | `Math.min(200, Math.max(1, ...))` en la mayoría de endpoints paginados |
| K.13 | **CORS desactivado en producción** | Correcto para arquitectura same-origin |
| K.14 | **Compression (gzip/brotli)** | `@fastify/compress` habilitado para todo |
| K.15 | **Health check endpoint** | `/v1/health` existe y devuelve status + timestamp |
| K.16 | **Tests de atomicidad de batch** | Verifican que un error en un ítem revierte toda la planilla |
| K.17 | **Presentaciones con factor de conversión** | Modelo bien diseñado para manejar ventas por unidad y por paquete con precios independientes |
| K.18 | **Protección contra auto-eliminación** | El admin no puede eliminarse a sí mismo (`usuarios/routes.ts:69`) |
| K.19 | **Protección de presentación referenciada** | No se puede eliminar una presentación si tiene ventas asociadas (verificación JSONB) |

---

## Evaluación de Arquitectura

La arquitectura actual es **coherente y apropiada** para un sistema POS de dos sucursales:

- **Monolito modular**: Adecuado para el tamaño del equipo y proyecto
- **Offline-first**: Bien implementado con Dexie + sync batch idempotente
- **API versionada** (`/v1/`): Permite evolución futura
- **Schema Drizzle**: Bien definido con constraints, checks e índices donde importa
- **Frontend vanilla**: Apropiado para minimizar dependencias en el POS (cero bundler = cero complejidad de build)

> [!IMPORTANT]
> Las prioridades inmediatas son: **rotar credenciales (A.1, A.2)**, **corregir race conditions (A.4, A.5)**, **arreglar el middleware de auth (B.1)** y **mitigar XSS (C.1)**.
