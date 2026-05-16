import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export async function createTestDirectory(name: string): Promise<string> {
  const directory = path.join(
    process.cwd(),
    ".tmp",
    "tests",
    `${name}-${randomUUID()}`
  );
  await fs.mkdir(directory, { recursive: true });
  return directory;
}

