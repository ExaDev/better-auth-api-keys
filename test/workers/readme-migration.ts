import readme from "../../README.md?raw";

/** The README's section on upgrading from 0.1.0, which holds the migration as hosts copy it. */
const UPGRADE_HEADING = "### Upgrading from 0.1.0";

/** Every fenced SQL block in the upgrade section, in order: the D1 migration file, then the same statements wrapped for plain SQLite. */
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

/** The README's D1 migration file, and its plain SQLite version. */
export function readmeMigration(): {
  readonly d1: string;
  readonly sqlite: string;
} {
  const [d1, sqlite, ...rest] = upgradeSqlBlocks();
  if (d1 === undefined || sqlite === undefined || rest.length > 0) {
    throw new Error(
      "The README's upgrade section must hold exactly two SQL blocks",
    );
  }

  return { d1, sqlite };
}

/** The statements of a SQL block, one per `;` that ends a line, as D1's `batch` takes them. */
export function statementsOf(sql: string): string[] {
  return sql
    .split(/;\s*$/mu)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}
