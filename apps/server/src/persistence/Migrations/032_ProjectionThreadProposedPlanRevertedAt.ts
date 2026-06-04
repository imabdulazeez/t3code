import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const columns = yield* sql<{ name: string }>`
    PRAGMA table_info(projection_thread_proposed_plans)
  `;

  if (!columns.some((column) => column.name === "reverted_at")) {
    yield* sql`
      ALTER TABLE projection_thread_proposed_plans
      ADD COLUMN reverted_at TEXT
    `;
  }
});
