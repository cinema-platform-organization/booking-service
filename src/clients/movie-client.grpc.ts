import { toRpcException } from "@cinema-platform/common";
import type {
	GetMovieRequest,
	MovieServiceClient,
} from "@cinema-platform/contracts/gen/ts/movie";
import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { ClientGrpc } from "@nestjs/microservices";
import { lastValueFrom } from "rxjs";

@Injectable()
export class MovieClientGrpc implements OnModuleInit {
	private readonly logger = new Logger(MovieClientGrpc.name);

	private movieService!: MovieServiceClient;

	public constructor(
		@Inject("MOVIE_PACKAGE") private readonly client: ClientGrpc,
	) {}

	public onModuleInit() {
		this.movieService =
			this.client.getService<MovieServiceClient>("MovieService");
	}

	public async getById(data: GetMovieRequest) {
		try {
			return await lastValueFrom(this.movieService.getMovie(data));
		} catch (error) {
			this.logger.error(
				{ err: error as Error, movieId: data.id },
				"Failed to fetch movie",
			);

			throw toRpcException(error, "Failed to fetch movie details");
		}
	}
}
