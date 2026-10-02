import readme from "../../README.md?raw";

/** The README's section on migrating the database from 0.1.0, which holds the migration as hosts copy it. */
const UPGRADE_HEADING = "### Migrating the database from 0.1.0";

/** Every fenced SQL block in the migration section, in order: the D1 migration file, the same statements wrapped for plain SQLite, and the deletion of orphaned keys. */
function upgradeSqlBlocks(): string[] {
  const start = readme.indexOf(UPGRADE_HEADING);
  if (start === -1) throw new Error(`The README has no "${UPGRADE_HEADING}"`);
  const nextSection = readme.indexOf("\n## ", start);
  const section = readme.slice(
    start,
    nextSection === -1 ? undefined : nextSection,
  );

  return [...section.matchAll(/```sql\n([\s\S]*?)```/gu)].map((match) => {
    const [, body] = match;
    if (body === undefined) throw new Error("An SQL block has no body");

    return body;
  });
}

/** The README's D1 migration file, its plain SQLite version, and the statement that deletes orphaned keys before either. */
export function readmeMigration(): {
  readonly d1: string;
  readonly sqlite: string;
  readonly deleteOrphans: string;
} {
  const [d1, sqlite, deleteOrphans, ...rest] = upgradeSqlBlocks();
  if (
    d1 === undefined ||
    sqlite === undefined ||
    deleteOrphans === undefined ||
    rest.length > 0
  ) {
    throw new Error(
      "The README's migration section must hold exactly three SQL blocks",
    );
  }

  return { d1, sqlite, deleteOrphans };
}

/** The statements of a SQL block, one per `;` that ends a line, as D1's `batch` takes them. */
export function statementsOf(sql: string): string[] {
  return sql
    .split(/;\s*$/mu)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}
