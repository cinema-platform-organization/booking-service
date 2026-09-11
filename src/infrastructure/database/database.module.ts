import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import postgres from "postgres";

import { getDatabaseConfig } from "@/config/database.config";

import { PG } from "./database.constants";
import { DatabaseService } from "./database.service";

@Global()
@Module({
	providers: [
		{
			provide: PG,
			useFactory: (configService: ConfigService) => {
				const options = getDatabaseConfig(configService);

				return postgres(options);
			},
			inject: [ConfigService],
		},
		DatabaseService,
	],
	exports: [PG, DatabaseService],
})
export class DatabaseModule {}
