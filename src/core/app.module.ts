import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { LoggerModule } from "nestjs-pino";

import { DatabaseModule } from "@/infrastructure/database/database.module";
import { BookingModule } from "@/modules/booking/booking.module";

@Module({
	imports: [
		ConfigModule.forRoot({ isGlobal: true }),
		LoggerModule.forRoot(),
		DatabaseModule,
		BookingModule,
	],
})
export class AppModule {}
