import { toRpcException } from "@cinema-platform/common";
import type {
	GetTheaterRequest,
	TheaterServiceClient,
} from "@cinema-platform/contracts/gen/ts/theater";
import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { ClientGrpc } from "@nestjs/microservices";
import { lastValueFrom } from "rxjs";

@Injectable()
export class TheaterClientGrpc implements OnModuleInit {
	private readonly logger = new Logger(TheaterClientGrpc.name);

	private theaterService!: TheaterServiceClient;

	public constructor(
		@Inject("THEATER_PACKAGE") private readonly client: ClientGrpc,
	) {}

	public onModuleInit() {
		this.theaterService =
			this.client.getService<TheaterServiceClient>("TheaterService");
	}

	public async getById(data: GetTheaterRequest) {
		try {
			return await lastValueFrom(this.theaterService.getTheater(data));
		} catch (error) {
			this.logger.error(
				{ err: error as Error, theaterId: data.id },
				"Failed to fetch theater",
			);

			throw toRpcException(error, "Failed to fetch theater details");
		}
	}
}
