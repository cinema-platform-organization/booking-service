import { RpcStatus } from "@cinema-platform/common";
import type {
	GetTheaterRequest,
	TheaterServiceClient,
} from "@cinema-platform/contracts/gen/ts/theater";
import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import type { ClientGrpc } from "@nestjs/microservices";
import { RpcException } from "@nestjs/microservices";
import { PinoLogger } from "nestjs-pino";
import { lastValueFrom } from "rxjs";

@Injectable()
export class TheaterClientGrpc implements OnModuleInit {
	private theaterService!: TheaterServiceClient;

	public constructor(
		private readonly logger: PinoLogger,
		@Inject("THEATER_PACKAGE") private readonly client: ClientGrpc,
	) {
		this.logger.setContext(TheaterClientGrpc.name);
	}

	public onModuleInit() {
		this.theaterService =
			this.client.getService<TheaterServiceClient>("TheaterService");
	}

	public async getById(data: GetTheaterRequest) {
		try {
			return await lastValueFrom(this.theaterService.getTheater(data));
		} catch (error) {
			if (error instanceof RpcException) {
				throw error;
			}

			this.logger.error("Failed to fetch theater:", error);
			throw new RpcException({
				code: RpcStatus.INTERNAL,
				details: "Failed to fetch theater details",
			});
		}
	}
}
