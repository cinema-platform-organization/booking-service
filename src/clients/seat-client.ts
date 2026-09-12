import { RpcStatus } from "@cinema-platform/common";
import type {
	GetSeatRequest,
	SeatServiceClient,
} from "@cinema-platform/contracts/gen/ts/seat";
import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import type { ClientGrpc } from "@nestjs/microservices";
import { RpcException } from "@nestjs/microservices";
import { PinoLogger } from "nestjs-pino";
import { lastValueFrom } from "rxjs";

@Injectable()
export class SeatClientGrpc implements OnModuleInit {
	private seatService!: SeatServiceClient;

	public constructor(
		private readonly logger: PinoLogger,
		@Inject("SEAT_PACKAGE") private readonly client: ClientGrpc,
	) {
		this.logger.setContext(SeatClientGrpc.name);
	}

	public onModuleInit() {
		this.seatService =
			this.client.getService<SeatServiceClient>("SeatService");
	}

	public async getById(data: GetSeatRequest) {
		try {
			return await lastValueFrom(this.seatService.getSeat(data));
		} catch (error) {
			if (error instanceof RpcException) {
				throw error;
			}

			this.logger.error("Failed to fetch seat:", error);
			throw new RpcException({
				code: RpcStatus.INTERNAL,
				details: "Failed to fetch seat details",
			});
		}
	}
}
