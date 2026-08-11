import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp, loginToken } from "./helpers.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;

const testUserIds: string[] = [];

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  for (const id of testUserIds) {
    const adminToken = await loginToken(app, "admin@orvayaya.com", "admin123");
    await app.inject({
      method: "DELETE",
      url: `/v1/usuarios/${id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
  }
  await app.close();
});

async function registerTestUser(email: string): Promise<string> {
  const adminToken = await loginToken(app, "admin@orvayaya.com", "admin123");
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { email, password: "test123", nombre: "Usuario Test", rol: "cajero" },
  });
  expect(res.statusCode).toBe(201);
  const body = res.json();
  testUserIds.push(body.user.id);
  return body.user.id;
}

describe("Auth Module", () => {
  it("login correcto devuelve token y usuario admin", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "admin@orvayaya.com", password: "admin123" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.token).toBeDefined();
    expect(body.user).toBeDefined();
    expect(body.user.rol).toBe("admin");
  });

  it("login con contraseña incorrecta devuelve 401 sin tumbar sesión", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "admin@orvayaya.com", password: "bad-password" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("Credenciales inválidas");
  });
});

describe("Revocación de sesiones (A.3)", () => {
  const callProducts = (token: string) =>
    app.inject({ method: "GET", url: "/v1/products", headers: { authorization: `Bearer ${token}` } });

  it("usuario eliminado → token revocado (401)", async () => {
    const email = `rev-del-${Date.now()}@orvayaya.com`;
    const id = await registerTestUser(email);
    const token = await loginToken(app, email, "test123");

    expect((await callProducts(token)).statusCode).toBe(200);

    const adminToken = await loginToken(app, "admin@orvayaya.com", "admin123");
    const del = await app.inject({
      method: "DELETE",
      url: `/v1/usuarios/${id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(del.statusCode).toBe(200);

    expect((await callProducts(token)).statusCode).toBe(401);
  });

  it("contraseña cambiada → token anterior revocado (401)", async () => {
    const email = `rev-pw-${Date.now()}@orvayaya.com`;
    const id = await registerTestUser(email);
    const token = await loginToken(app, email, "test123");

    expect((await callProducts(token)).statusCode).toBe(200);

    const adminToken = await loginToken(app, "admin@orvayaya.com", "admin123");
    const upd = await app.inject({
      method: "PUT",
      url: `/v1/usuarios/${id}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { password: "nueva123" },
    });
    expect(upd.statusCode).toBe(200);

    expect((await callProducts(token)).statusCode).toBe(401);
  });

  it("token admin vigente sigue funcionando (200)", async () => {
    const adminToken = await loginToken(app, "admin@orvayaya.com", "admin123");
    expect((await callProducts(adminToken)).statusCode).toBe(200);
  });
});
