import { toRpcException } from "@cinema-platform/common";
import type {
	GetSeatRequest,
	SeatServiceClient,
} from "@cinema-platform/contracts/gen/ts/seat";
import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { ClientGrpc } from "@nestjs/microservices";
import { lastValueFrom } from "rxjs";

@Injectable()
export class SeatClientGrpc implements OnModuleInit {
	private readonly logger = new Logger(SeatClientGrpc.name);

	private seatService!: SeatServiceClient;

	public constructor(
		@Inject("SEAT_PACKAGE") private readonly client: ClientGrpc,
	) {}

	public onModuleInit() {
		this.seatService =
			this.client.getService<SeatServiceClient>("SeatService");
	}

	public async getById(data: GetSeatRequest) {
		try {
			return await lastValueFrom(this.seatService.getSeat(data));
		} catch (error) {
			this.logger.error(
				{ err: error as Error, seatId: data.id },
				"Failed to fetch seat",
			);

			throw toRpcException(error, "Failed to fetch seat details");
		}
	}
}
