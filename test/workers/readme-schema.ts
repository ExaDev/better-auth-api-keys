import readme from "../../README.md?raw";

/** The README's section on the database table, which holds the SQL hosts copy to create it. */
const SCHEMA_HEADING = "## Database schema";

/** The README's SQL that creates the `api_key` table in a new database, read from the README itself so the tests build their table from exactly what hosts copy. */
export function readmeSchemaSql(): string {
  const start = readme.indexOf(SCHEMA_HEADING);
  if (start === -1) throw new Error(`The README has no "${SCHEMA_HEADING}"`);
  const nextSection = readme.indexOf("\n## ", start + SCHEMA_HEADING.length);
  const section = readme.slice(
    start,
    nextSection === -1 ? undefined : nextSection,
  );
  const blocks = [...section.matchAll(/```sql\n([\s\S]*?)```/gu)].map(
    (match) => {
      const [, body] = match;
      if (body === undefined) throw new Error("An SQL block has no body");

      return body;
    },
  );
  const [sql, ...rest] = blocks;
  if (sql === undefined || rest.length > 0) {
    throw new Error(
      "The README's database schema section must hold exactly one SQL block",
    );
  }

  return sql;
}

/** The statements of a SQL block, one per `;` that ends a line, as D1's `batch` takes them. */
export function statementsOf(sql: string): string[] {
  return sql
    .split(/;\s*$/mu)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}
