import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

const check = spawnSync(process.execPath, ["scripts/build.mjs"], { stdio: "inherit" });
if (check.status !== 0) process.exit(check.status ?? 1);
const { default: worker } = await import("../dist/server/index.js");

const sqlite = new DatabaseSync(":memory:");
const migrations = (await readdir("drizzle")).filter((entry) => entry.endsWith(".sql")).sort();
for (const migration of migrations) sqlite.exec(await readFile("drizzle/" + migration, "utf8"));
const DB = {
  prepare(sql) {
    const statement = sqlite.prepare(sql);
    function query(values) {
      return {
        bind: (...params) => query(params),
        first: async () => statement.get(...values) || null,
        all: async () => ({ results: statement.all(...values) }),
        run: () => ({ meta: { changes: statement.run(...values).changes } }),
      };
    }
    return query([]);
  },
  batch(statements) {
    sqlite.exec("BEGIN");
    try {
      const results = statements.map((statement) => statement.run());
      sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }
  },
};

const env = { DB, OWNER_BOOKMARK_SECRET: "findwho-local-preview-bookmark" };
const port = Number(process.env.PORT || 4317);
createServer(async (incoming, outgoing) => {
  try {
    const parts = [];
    for await (const part of incoming) parts.push(part);
    const request = new Request("http://" + incoming.headers.host + incoming.url, {
      method: incoming.method,
      headers: incoming.headers,
      body: parts.length ? Buffer.concat(parts) : undefined,
    });
    const response = await worker.fetch(request, env);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error(error);
    outgoing.writeHead(500);
    outgoing.end();
  }
}).listen(port, "127.0.0.1", () => console.log("Local: http://127.0.0.1:" + port));
