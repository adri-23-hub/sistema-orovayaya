import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "./helpers.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

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
