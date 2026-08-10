CREATE TABLE "presentaciones_venta" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"producto_id" uuid NOT NULL,
	"nombre_presentacion" varchar(100) NOT NULL,
	"factor_conversion" integer NOT NULL,
	"precio_venta" numeric(12, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "factor_conversion_positivo" CHECK ("presentaciones_venta"."factor_conversion" > 0)
);
--> statement-breakpoint
ALTER TABLE "presentaciones_venta" ADD CONSTRAINT "presentaciones_venta_producto_id_productos_id_fk" FOREIGN KEY ("producto_id") REFERENCES "public"."productos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pv_producto_nombre_idx" ON "presentaciones_venta" USING btree ("producto_id","nombre_presentacion");--> statement-breakpoint
ALTER TABLE "inventario" ADD CONSTRAINT "cantidad_no_negativa" CHECK ("inventario"."cantidad" >= 0);