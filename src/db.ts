import { PrismaClient } from "@prisma/client";

export type Db = PrismaClient;

export function createDb(): Db {
  return new PrismaClient();
}
