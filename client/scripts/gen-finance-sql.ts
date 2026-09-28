// Regenera las migraciones SQL versionadas del servidor a partir de la única
// definición (`src/services/finance/sql.ts`). Uso: `npm run sql:gen -w client`.
// Un test falla si el fichero y el código divergen.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FINANCE_MIGRATIONS } from "../src/services/finance/sql";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, "../../server/prisma/migrations/finance");
mkdirSync(dir, { recursive: true });
for (const m of FINANCE_MIGRATIONS) {
  const file = path.join(dir, `${m.name}.sql`);
  writeFileSync(file, m.sql);
  console.log(`escrito ${path.relative(process.cwd(), file)}`);
}
