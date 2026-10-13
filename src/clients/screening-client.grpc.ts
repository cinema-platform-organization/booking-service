import { toRpcException } from "@cinema-platform/common";
import type {
	GetScreeningRequest,
	ScreeningServiceClient,
} from "@cinema-platform/contracts/gen/ts/screening";
import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { ClientGrpc } from "@nestjs/microservices";
import { lastValueFrom } from "rxjs";

@Injectable()
export class ScreeningClientGrpc implements OnModuleInit {
	private readonly logger = new Logger(ScreeningClientGrpc.name);

	private screeningService!: ScreeningServiceClient;

	public constructor(
		@Inject("SCREENING_PACKAGE") private readonly client: ClientGrpc,
	) {}

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
			this.logger.error(
				{ err: error as Error, screeningId: data.id },
				"Failed to fetch screening",
			);

			throw toRpcException(error, "Failed to fetch screening details");
		}
	}
}
