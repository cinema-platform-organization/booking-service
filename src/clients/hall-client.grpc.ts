import { toRpcException } from "@cinema-platform/common";
import type {
	GetHallRequest,
	HallServiceClient,
} from "@cinema-platform/contracts/gen/ts/hall";
import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { ClientGrpc } from "@nestjs/microservices";
import { lastValueFrom } from "rxjs";

@Injectable()
export class HallClientGrpc implements OnModuleInit {
	private readonly logger = new Logger(HallClientGrpc.name);

	private hallService!: HallServiceClient;

	public constructor(
		@Inject("HALL_PACKAGE") private readonly client: ClientGrpc,
	) {}

	public onModuleInit() {
		this.hallService =
			this.client.getService<HallServiceClient>("HallService");
	}

	public async getById(data: GetHallRequest) {
		try {
			return await lastValueFrom(this.hallService.getHall(data));
		} catch (error) {
			this.logger.error(
				{ err: error as Error, hallId: data.id },
				"Failed to fetch hall",
			);

			throw toRpcException(error, "Failed to fetch hall details");
		}
	}
}
