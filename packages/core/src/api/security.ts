import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import type { Logger } from "../log/logger.ts";

function reject(
  c: Parameters<MiddlewareHandler>[0],
  reason: "host" | "origin" | "token",
  status: 401 | 403,
  logger: Logger,
) {
  logger.record({ level: "warn", module: "api", event: "http.rejected", data: { reason } });
  return c.text(status === 401 ? "unauthorized" : "forbidden", status);
}

export function hostGuard(getPort: () => number, logger: Logger): MiddlewareHandler {
  return async (c, next) => {
    const host = c.req.header("host");
    const port = getPort();
    const expected = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (!host || !expected.includes(host)) return reject(c, "host", 403, logger);
    await next();
  };
}

export function originGuard(logger: Logger): MiddlewareHandler {
  return async (c, next) => {
    const origin = c.req.header("origin");
    const host = c.req.header("host");
    if (origin && origin !== `http://${host}`) return reject(c, "origin", 403, logger);
    await next();
  };
}

export function tokenGuard(token: string, logger: Logger): MiddlewareHandler {
  return async (c, next) => {
    const authorization = c.req.header("authorization");
    const expected = `Bearer ${token}`;
    const actual = authorization ?? "";
    const actualBytes = Buffer.from(actual);
    const expectedBytes = Buffer.from(expected);
    const valid = actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
    if (!valid) return reject(c, "token", 401, logger);
    await next();
  };
}
