import { RpcStatus } from "@cinema-platform/common";
import type {
	GetMovieRequest,
	MovieServiceClient,
} from "@cinema-platform/contracts/gen/ts/movie";
import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import type { ClientGrpc } from "@nestjs/microservices";
import { RpcException } from "@nestjs/microservices";
import { PinoLogger } from "nestjs-pino";
import { lastValueFrom } from "rxjs";

@Injectable()
export class MovieClientGrpc implements OnModuleInit {
	private movieService!: MovieServiceClient;

	public constructor(
		private readonly logger: PinoLogger,
		@Inject("MOVIE_PACKAGE") private readonly client: ClientGrpc,
	) {
		this.logger.setContext(MovieClientGrpc.name);
	}

	public onModuleInit() {
		this.movieService =
			this.client.getService<MovieServiceClient>("MovieService");
	}

	public async getById(data: GetMovieRequest) {
		try {
			return await lastValueFrom(this.movieService.getMovie(data));
		} catch (error) {
			if (error instanceof RpcException) {
				throw error;
			}

			this.logger.error("Failed to fetch movie:", error);
			throw new RpcException({
				code: RpcStatus.INTERNAL,
				details: "Failed to fetch movie details",
			});
		}
	}
}
