import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import postgres from "postgres";

dotenv.config();

const sql = postgres({
	host: process.env.DATABASE_HOST,
	port: Number(process.env.DATABASE_PORT),
	user: process.env.DATABASE_USERNAME,
	password: process.env.DATABASE_PASSWORD,
	database: process.env.DATABASE_NAME,
	max: 10,
	idle_timeout: 20,
});

async function main() {
	console.log("Checking for pending migration...");

	await sql.unsafe(`
        CREATE TABLE IF NOT EXISTS migrations (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);

	const dir = path.resolve(process.cwd(), "migrations");
	const files = fs.readdirSync(dir).sort();

	const applied = await sql<
		{ name: string }[]
	>`SELECT name FROM migrations ORDER BY id ASC`;

	const appliedSet = new Set(applied.map(m => m.name));

	for (const file of files) {
		if (appliedSet.has(file)) {
			continue;
		}

		const filepath = path.join(dir, file);
		const content = fs.readFileSync(filepath, "utf-8");

		console.log("Applying migration: ", file);

		try {
			await sql.unsafe(content);

			await sql`INSERT INTO migrations (name) VALUES (${file})`;

			console.log("Migration applied: ", file);
		} catch (error) {
			console.error("Migration failed: ", error);
			process.exit(1);
		}
	}

	console.log("All migrations applied");

	await sql.end();
	process.exit(0);
}

main();
