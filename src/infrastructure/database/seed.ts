import * as dotenv from "dotenv";
import * as fs from "fs";
import { MongoClient } from "mongodb";
import { nanoid } from "nanoid";
import * as path from "path";
import postgres from "postgres";

const isProduction = process.env.NODE_ENV === "production";

if (!isProduction) {
	const envName = process.env.NODE_ENV || "development";
	const envFileName = `.env.${envName}.local`;
	const envPath = path.resolve(process.cwd(), envFileName);

	if (fs.existsSync(envPath)) {
		dotenv.config({ path: envPath });
		console.log(`[Seeder] Loaded environment from ${envFileName}`);
	} else {
		const fallbackPath = path.resolve(process.cwd(), ".env");
		if (fs.existsSync(fallbackPath)) {
			dotenv.config({ path: fallbackPath });
			console.log(`[Seeder] Loaded fallback environment from .env`);
		}
	}
} else {
	console.log(
		"[Seeder] Running in production. Using environment variables injected by Docker.",
	);
}

interface ScreeningRow {
	_id: string;
	hallId: string;
}

interface SeatRow {
	id: string;
	price: number;
}

const BOOKING_RATIO = 0.2; // 20% of screenings get booked

async function main() {
	// booking-service's own DB
	const bookingSql = postgres({
		host: process.env.DATABASE_HOST,
		port: Number(process.env.DATABASE_PORT),
		username: process.env.DATABASE_USERNAME,
		password: process.env.DATABASE_PASSWORD,
		database: process.env.DATABASE_NAME,
	});

	// theater-service's DB — read-only, seeding purposes only
	const theaterSql = postgres({
		host: process.env.THEATER_DATABASE_HOST,
		port: Number(process.env.THEATER_DATABASE_PORT),
		username: process.env.THEATER_DATABASE_USERNAME,
		password: process.env.THEATER_DATABASE_PASSWORD,
		database: process.env.THEATER_DATABASE_NAME,
	});

	const screeningMongoUri = process.env.SCREENING_MONGO_URI;

	if (!screeningMongoUri) {
		throw new Error("SCREENING_MONGO_URI is not set");
	}

	console.log("Connecting to screening-service MongoDB...");
	const mongoClient = new MongoClient(screeningMongoUri);
	await mongoClient.connect();

	const screeningsCollection = mongoClient.db().collection("screenings");

	console.log("Fetching screenings...");
	const rawScreenings = await screeningsCollection
		.find({}, { projection: { _id: 1, hallId: 1 } })
		.toArray();

	const allScreenings: ScreeningRow[] = rawScreenings.map(s => ({
		_id: String(s._id),
		hallId: s.hallId as string,
	}));

	const bookCount = Math.floor(allScreenings.length * BOOKING_RATIO);
	const shuffled = [...allScreenings].sort(() => Math.random() - 0.5);
	const screeningsToBook = shuffled.slice(0, bookCount);

	console.log(
		`Targeting ${screeningsToBook.length} of ${allScreenings.length} screenings for booking...`,
	);

	// cache seats per hall so we don't re-query theater-service per screening
	const seatsByHall = new Map<string, SeatRow[]>();

	async function getSeatsForHall(hallId: string): Promise<SeatRow[]> {
		if (!seatsByHall.has(hallId)) {
			const seats = await theaterSql<SeatRow[]>`
                SELECT id, price FROM seats WHERE hall_id = ${hallId}
            `;
			seatsByHall.set(hallId, seats);
		}

		return seatsByHall.get(hallId)!;
	}

	const USER_IDS = Array.from({ length: 8 }, () => nanoid());

	let orderCount = 0;
	let ticketCount = 0;

	for (const screening of screeningsToBook) {
		const seats = await getSeatsForHall(screening.hallId);
		if (!seats.length) {
			continue; // Skip if no seats exist for this hall
		}

		const seatCount = Math.min(
			seats.length,
			1 + Math.floor(Math.random() * 4), // 1-4 seats per order
		);
		const shuffledSeats = [...seats].sort(() => Math.random() - 0.5);
		const chosenSeats = shuffledSeats.slice(0, seatCount);

		const amount = chosenSeats.reduce((sum, s) => sum + s.price, 0);
		const orderId = nanoid();
		const userId = USER_IDS[Math.floor(Math.random() * USER_IDS.length)];
		const qrCode = nanoid(); // Unique QR code for the order

		const isPaid = Math.random() < 0.9; // 90% paid, 10% still just reserved
		const orderStatus = isPaid ? "PAID" : "PENDING";
		const ticketStatus = isPaid ? "PAID" : "RESERVED";
		const paidAt = isPaid ? new Date() : null;

		await bookingSql`
            INSERT INTO orders (id, amount, status, user_id, qr_code)
            VALUES (${orderId}, ${amount}, ${orderStatus}, ${userId}, ${qrCode})
        `;
		orderCount++;

		for (const seat of chosenSeats) {
			await bookingSql`
                INSERT INTO tickets (
                    id, price, status, paid_at,
                    screening_id, hall_id, seat_id, order_id
                )
                VALUES (
                    ${nanoid()}, ${seat.price}, ${ticketStatus}, ${paidAt},
                    ${screening._id}, ${screening.hallId}, ${seat.id}, ${orderId}
                )
            `;
			ticketCount++;
		}
	}

	console.log(
		`Seed completed! Created ${orderCount} orders, ${ticketCount} tickets.`,
	);

	await bookingSql.end();
	await theaterSql.end();
	await mongoClient.close();

	process.exit(0);
}

main();
