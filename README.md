# Sistema Orvayaya

> Sistema de ventas distribuido con POS offline-first para ciudad y pueblo.

## Stack Tecnológico

| Capa | Tecnología |
|------|-----------|
| **Runtime** | Node.js 20+ LTS |
| **Framework API** | Fastify 5 + @fastify/jwt + @fastify/cors |
| **ORM** | Drizzle ORM + drizzle-kit |
| **Base de Datos** | PostgreSQL 16 |
| **Frontend** | Vanilla JS (SPA sin framework pesado) |
| **IndexedDB** | Dexie.js |
| **PDF** | jsPDF |
| **Contenedor** | Docker + docker-compose |

## Inicio Rápido

### 1. Levantar PostgreSQL

```bash
cd server
docker-compose up -d
```

### 2. Instalar dependencias

```bash
cd server
npm install
```

### 3. Push del schema a la base de datos

```bash
npm run db:push
```

### 4. Seed de datos de prueba

```bash
npm run db:seed
```

### 5. Iniciar servidor de desarrollo

```bash
npm run dev
```

### 6. Abrir en navegador

- **Login:** http://localhost:3000/login.html
- **Admin Dashboard:** http://localhost:3000/admin/
- **POS:** http://localhost:3000/pos/

### Credenciales Demo

| Rol | Email | Password |
|-----|-------|----------|
| Admin | admin@orvayaya.com | admin123 |
| Cajero | cajero@orvayaya.com | cajero123 |

## Estructura del Proyecto

```
sistema-orvayaya/
├── server/
│   ├── src/
│   │   ├── modules/
│   │   │   ├── auth/        # Login + RBAC
│   │   │   ├── catalog/     # CRUD Productos
│   │   │   ├── inventory/   # Stock + Transferencias
│   │   │   ├── sales/       # Ventas
│   │   │   ├── sync/        # Motor de Sincronización
│   │   │   └── dashboard/   # KPIs + Reportes
│   │   ├── db/
│   │   │   ├── schema/      # Drizzle ORM schemas
│   │   │   ├── seed.ts      # Datos iniciales
│   │   │   └── index.ts     # Conexión DB
│   │   ├── shared/
│   │   │   └── middleware/   # Auth + RBAC guards
│   │   └── app.ts           # Entry point Fastify
│   ├── package.json
│   ├── tsconfig.json
│   └── docker-compose.yml
├── client/
│   ├── login.html           # Página de login
│   ├── admin/               # Dashboard Admin
│   ├── pos/                 # POS Offline-First
│   └── shared/              # API client + Dexie config
├── Plan/
│   └── PLAN_ARQUITECTURA.md
└── README.md
```

## API Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | /v1/auth/login | Iniciar sesión |
| POST | /v1/auth/register | Registrar usuario (admin) |
| GET | /v1/products | Listar productos |
| POST | /v1/products | Crear producto |
| PUT | /v1/products/:id | Actualizar producto |
| DELETE | /v1/products/:id | Eliminar producto |
| GET | /v1/inventory | Stock por sucursal |
| GET | /v1/inventory/global | Vista global de inventario |
| POST | /v1/transfers | Transferir stock ciudad→pueblo |
| GET | /v1/sales | Listar ventas |
| POST | /v1/sales | Crear venta directa |
| POST | /v1/sync | Sincronización batch (POS) |
| GET | /v1/dashboard/summary | Resumen KPIs |
