import { RpcStatus } from "@cinema-platform/common";
import type {
	CancelBookingRequest,
	ConfirmBookingRequest,
	CreateReservationRequest,
	GetUserBookingsRequest,
	ListReservedSeatsRequest,
} from "@cinema-platform/contracts/gen/ts/booking";
import { Hall } from "@cinema-platform/contracts/gen/ts/hall";
import { Movie } from "@cinema-platform/contracts/gen/ts/movie";
import {
	Screening,
	Theater,
} from "@cinema-platform/contracts/gen/ts/screening";
import { Seat } from "@cinema-platform/contracts/gen/ts/seat";
import { Injectable } from "@nestjs/common";
import { RpcException } from "@nestjs/microservices";
import { PinoLogger } from "nestjs-pino";
import QRCode from "qrcode";

import { HallClientGrpc } from "@/clients/hall-client.grpc";
import { MovieClientGrpc } from "@/clients/movie-client.grpc";
import { ScreeningClientGrpc } from "@/clients/screening-client.grpc";
import { SeatClientGrpc } from "@/clients/seat-client";
import { TheaterClientGrpc } from "@/clients/theater-client.grpc";

import { BookingRepository } from "./booking.repository";
import { OrderStatus } from "./enums/order-status.enum";
import { Order } from "./interfaces/order-interface";
import { Ticket } from "./interfaces/ticket-interface";

interface RequestContext {
	screenings: Map<string, Screening | undefined>;
	halls: Map<string, Hall | undefined>;
	seats: Map<string, Seat | undefined>;
	movies: Map<string, Movie | undefined>;
	theaters: Map<string, Theater | undefined>;
}

type OrderWithTickets = Order & { tickets: Ticket[] };

@Injectable()
export class BookingService {
	public constructor(
		private readonly logger: PinoLogger,
		private readonly bookingRepository: BookingRepository,
		private readonly theaterClient: TheaterClientGrpc,
		private readonly hallClient: HallClientGrpc,
		private readonly seatClient: SeatClientGrpc,
		private readonly movieClient: MovieClientGrpc,
		private readonly screeningClient: ScreeningClientGrpc,
	) {
		this.logger.setContext(BookingService.name);
	}

	public async getUserBookings(data: GetUserBookingsRequest) {
		const { userId } = data;

		const orders = await this.bookingRepository.findUserPaidOrders(userId);

		if (!orders.length) {
			return { bookings: [] };
		}

		const context = this.createRequestContext();
		const bookings = await this.enrichOrders(orders, context);

		return { bookings };
	}

	public async createReservation(data: CreateReservationRequest) {
		const { userId, screeningId, seats } = data;

		const response = await this.screeningClient.getById({
			id: screeningId,
		});
		const screening = response.screening;

		if (!screening) {
			throw new RpcException({
				code: RpcStatus.NOT_FOUND,
				details: "Screening not found",
			});
		}

		const amount = seats.reduce((s, a) => s + a.price, 0);

		const order = await this.bookingRepository.createOrder({
			user_id: userId,
			amount,
		});

		const tickets = await Promise.all(
			seats.map(async s => {
				const existing =
					await this.bookingRepository.findExistingTicket(
						screeningId,
						s.seatId,
					);

				if (existing) {
					throw new RpcException({
						code: RpcStatus.ALREADY_EXISTS,
						details: `Seat ${s.seatId} is already taken`,
					});
				}

				return this.bookingRepository.createTicket({
					screening_id: screening.id,
					hall_id: screening.hall?.id!,
					seat_id: s.seatId,
					price: s.price,
					order_id: order.id,
				});
			}),
		);

		return {
			orderId: order.id,
			ticketIds: tickets.map(t => t.id),
			amount,
		};
	}

	public async confirmBooking(data: ConfirmBookingRequest) {
		const { bookingId } = data;

		await this.bookingRepository.markOrderPaid(bookingId);

		const now = new Date();

		await this.bookingRepository.markTicketsPaid({
			order_id: bookingId,
			paid_at: now,
		});

		const qrDataUrl = await QRCode.toDataURL(bookingId);
		await this.bookingRepository.updateOrderQr(bookingId, qrDataUrl);

		return { ok: true };
	}

	public async cancelBooking(data: CancelBookingRequest) {
		const { bookingId, userId } = data;

		const order = await this.bookingRepository.findOrderById(bookingId);

		if (!order) {
			throw new RpcException({
				code: RpcStatus.NOT_FOUND,
				details: "Order not found",
			});
		}
		if (order.user_id !== userId) {
			throw new RpcException({
				code: RpcStatus.PERMISSION_DENIED,
				details: "You have no rights to cancel this booking",
			});
		}
		if (order.status === OrderStatus.CANCELED) {
			return { ok: true };
		}
		if (order.status !== OrderStatus.PAID) {
			throw new RpcException({
				code: RpcStatus.FAILED_PRECONDITION,
				details: "Reservation not paid or already canceled",
			});
		}

		await this.bookingRepository.cancelOrder(bookingId);
		await this.bookingRepository.deleteTicketsByOrderId(bookingId);

		return { ok: true };
	}

	public async listReservedSeats(data: ListReservedSeatsRequest) {
		const { hallId, screeningId } = data;

		const seats = await this.bookingRepository.findReservedSeatIds(
			hallId,
			screeningId,
		);

		return {
			reservedSeatIds: seats.map(s => s.seat_id),
		};
	}

	private createRequestContext(): RequestContext {
		return {
			screenings: new Map(),
			halls: new Map(),
			seats: new Map(),
			movies: new Map(),
			theaters: new Map(),
		};
	}

	private async enrichOrders(
		orders: OrderWithTickets[],
		ctx: RequestContext,
	) {
		return Promise.all(
			orders.map(async order => {
				const ticket = order.tickets[0];
				if (!ticket) {
					return null;
				}

				const screening = await this.getScreening(
					ticket.screening_id,
					ctx,
				);

				if (!screening) {
					return null;
				}

				const [movie, hall, theater] = await Promise.all([
					this.getMovie(screening.movie?.id, ctx),
					this.getHall(ticket.hall_id, ctx),
					this.getTheater(screening.theater?.id, ctx),
				]);

				const seats = await Promise.all(
					order.tickets.map(async t => {
						const seat = await this.getSeat(t.seat_id, ctx);
						return {
							id: t.seat_id,
							row: seat?.row ?? 0,
							number: seat?.number ?? 0,
						};
					}),
				);

				return {
					id: order.id,
					screeningDate: new Date(screening.startAt)
						.toISOString()
						.split("T")[0],
					screeningTime: new Date(
						screening.startAt,
					).toLocaleTimeString("uk-UA", {
						hour: "2-digit",
						minute: "2-digit",
					}),
					movie,
					hall,
					theater,
					seats,
					qrCode: order.qr_code ?? "",
				};
			}),
		);
	}

	private async getScreening(id: string, ctx: RequestContext) {
		if (!ctx.screenings.has(id)) {
			try {
				const { screening } = await this.screeningClient.getById({
					id,
				});
				ctx.screenings.set(id, screening);
			} catch (error) {
				if (error instanceof RpcException) {
					throw error;
				}
				ctx.screenings.set(id, undefined);
			}
		}

		return ctx.screenings.get(id);
	}

	private async getMovie(id: string | undefined, ctx: RequestContext) {
		if (!id) {
			return null;
		}
		if (!ctx.movies.has(id)) {
			try {
				const { movie } = await this.movieClient.getById({ id });
				ctx.movies.set(id, movie);
			} catch (error) {
				if (error instanceof RpcException) {
					throw error;
				}
				ctx.movies.set(id, undefined);
			}
		}
		return ctx.movies.get(id);
	}

	private async getHall(id: string, ctx: RequestContext) {
		if (!ctx.halls.has(id)) {
			try {
				const { hall } = await this.hallClient.getById({ id });
				ctx.halls.set(id, hall);
			} catch (error) {
				if (error instanceof RpcException) {
					throw error;
				}
				ctx.halls.set(id, undefined);
			}
		}

		return ctx.halls.get(id);
	}

	private async getTheater(id: string | undefined, ctx: RequestContext) {
		if (!id) {
			return null;
		}
		if (!ctx.theaters.has(id)) {
			try {
				const { theater } = await this.theaterClient.getById({ id });
				ctx.theaters.set(id, theater);
			} catch (error) {
				if (error instanceof RpcException) {
					throw error;
				}
				ctx.theaters.set(id, undefined);
			}
		}

		return ctx.theaters.get(id);
	}

	private async getSeat(id: string, ctx: RequestContext) {
		if (!ctx.seats.has(id)) {
			try {
				const { seat } = await this.seatClient.getById({ id });
				ctx.seats.set(id, seat);
			} catch (error) {
				if (error instanceof RpcException) {
					throw error;
				}
				ctx.seats.set(id, undefined);
			}
		}

		return ctx.seats.get(id);
	}
}
