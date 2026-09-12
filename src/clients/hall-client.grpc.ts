import { RpcStatus } from "@cinema-platform/common";
import type {
	GetHallRequest,
	HallServiceClient,
} from "@cinema-platform/contracts/gen/ts/hall";
import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import type { ClientGrpc } from "@nestjs/microservices";
import { RpcException } from "@nestjs/microservices";
import { PinoLogger } from "nestjs-pino";
import { lastValueFrom } from "rxjs";

@Injectable()
export class HallClientGrpc implements OnModuleInit {
	private hallService!: HallServiceClient;

	public constructor(
		private readonly logger: PinoLogger,
		@Inject("HALL_PACKAGE") private readonly client: ClientGrpc,
	) {
		this.logger.setContext(HallClientGrpc.name);
	}

	public onModuleInit() {
		this.hallService =
			this.client.getService<HallServiceClient>("HallService");
	}

	public async getById(data: GetHallRequest) {
		try {
			return await lastValueFrom(this.hallService.getHall(data));
		} catch (error) {
			if (error instanceof RpcException) {
				throw error;
			}

			this.logger.error("Failed to fetch hall:", error);
			throw new RpcException({
				code: RpcStatus.INTERNAL,
				details: "Failed to fetch hall details",
			});
		}
	}
}
