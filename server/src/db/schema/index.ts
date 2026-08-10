// Re-export all schemas from a single entry point
export { usuarios, rolEnum } from "./usuarios.js";
export type { Usuario, NuevoUsuario } from "./usuarios.js";

export { sucursales, tipoSucursalEnum } from "./sucursales.js";
export type { Sucursal, NuevaSucursal } from "./sucursales.js";

export { marcas } from "./marcas.js";
export type { Marca, NuevaMarca } from "./marcas.js";

export { proveedores } from "./proveedores.js";
export type { Proveedor, NuevoProveedor } from "./proveedores.js";

export { categorias } from "./categorias.js";
export type { Categoria, NuevaCategoria } from "./categorias.js";

export { productos } from "./productos.js";
export type { Producto, NuevoProducto } from "./productos.js";

export { inventario } from "./inventario.js";
export type { Inventario, NuevoInventario } from "./inventario.js";

export { transferencias } from "./transferencias.js";
export type { Transferencia, NuevaTransferencia } from "./transferencias.js";

export { ventas } from "./ventas.js";
export type { Venta, NuevaVenta, VentaItem } from "./ventas.js";

export { syncLog } from "./sync_log.js";
export type { SyncLogEntry, NuevoSyncLogEntry } from "./sync_log.js";

export { movimientosInventario, tipoMovimientoEnum } from "./movimientos_inventario.js";
export type { MovimientoInventario, NuevoMovimientoInventario } from "./movimientos_inventario.js";

export { historialCostos } from "./historial_costos.js";
export type { HistorialCosto, NuevoHistorialCosto } from "./historial_costos.js";

export { presentacionesVenta } from "./presentaciones.js";
export type { PresentacionVenta, NuevaPresentacionVenta } from "./presentaciones.js";
export { crearPresentacionSchema, actualizarPresentacionSchema } from "./presentaciones.js";
