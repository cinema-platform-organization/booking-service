import * as fs from "fs";
import * as path from "path";

const name = process.argv[2];

if (!name) {
	console.error("Please provide migration name");
	process.exit(1);
}

const dir = path.resolve(process.cwd(), "migrations");

if (!fs.existsSync(dir)) {
	fs.mkdirSync(dir);
}

function nextNumber() {
	const files = fs.readdirSync(dir);

	const numbers = files
		.map(f => parseInt(f.split("_")[0]))
		.filter(n => !isNaN(n));

	return numbers.length === 0
		? "001"
		: String(Math.max(...numbers) + 1).padStart(3, "0");
}

const filename = `${nextNumber()}_${name}.sql`;

const filepath = path.join(dir, filename);

fs.writeFileSync(filepath, `-- migration: ${name}\n\n`);

console.log("Created migration: ", filename);
