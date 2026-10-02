import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { AppError } from "./errors.js";

// Single shared secret in the X-API-Key header. Gate writes with this; reads
// of public data stay open.
export function requireApiKey(expected: string): RequestHandler {
  const expectedBuf = Buffer.from(expected);
  return (req, _res, next) => {
    const provided = req.header("x-api-key");
    const ok =
      provided !== undefined &&
      Buffer.byteLength(provided) === expectedBuf.length &&
      timingSafeEqual(Buffer.from(provided), expectedBuf);
    if (!ok) {
      return next(
        new AppError(401, "UNAUTHORIZED", "Missing or invalid X-API-Key header"),
      );
    }
    next();
  };
}
