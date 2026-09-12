import { RpcStatus } from "@cinema-platform/common";
import type {
	GetScreeningRequest,
	ScreeningServiceClient,
} from "@cinema-platform/contracts/gen/ts/screening";
import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import type { ClientGrpc } from "@nestjs/microservices";
import { RpcException } from "@nestjs/microservices";
import { PinoLogger } from "nestjs-pino";
import { lastValueFrom } from "rxjs";

@Injectable()
export class ScreeningClientGrpc implements OnModuleInit {
	private screeningService!: ScreeningServiceClient;

	public constructor(
		private readonly logger: PinoLogger,
		@Inject("SCREENING_PACKAGE") private readonly client: ClientGrpc,
	) {
		this.logger.setContext(ScreeningClientGrpc.name);
	}

	public onModuleInit() {
		this.screeningService =
			this.client.getService<ScreeningServiceClient>("ScreeningService");
	}

	public async getById(data: GetScreeningRequest) {
		try {
			return await lastValueFrom(
				this.screeningService.getScreening(data),
			);
		} catch (error) {
			if (error instanceof RpcException) {
				throw error;
			}

			this.logger.error("Failed to fetch screening:", error);
			throw new RpcException({
				code: RpcStatus.INTERNAL,
				details: "Failed to fetch screening details",
			});
		}
	}
}
