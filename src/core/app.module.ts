import { MetricsModule, ServiceLoggerModule } from "@cinema-platform/common";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { DatabaseModule } from "@/infrastructure/database/database.module";
import { BookingModule } from "@/modules/booking/booking.module";

@Module({
	imports: [
		ConfigModule.forRoot({
			isGlobal: true,
			envFilePath: [
				`.env.${process.env.NODE_ENV}.local`,
				`.env.${process.env.NODE_ENV}`,
				".env",
			],
		}),
		ServiceLoggerModule.forRoot("booking-service"),
		MetricsModule.forRoot("booking-service"),
		DatabaseModule,
		BookingModule,
	],
})
export class AppModule {}
