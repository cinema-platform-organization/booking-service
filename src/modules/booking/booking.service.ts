import { isGrpcError, RpcStatus } from "@cinema-platform/common";
import type {
	CancelBookingRequest,
	ConfirmBookingRequest,
	CreateReservationRequest,
	ExistsForScreeningRequest,
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
import { Injectable, Logger } from "@nestjs/common";
import { RpcException } from "@nestjs/microservices";
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

function parseUtc(value: string) {
	const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(value);

	return new Date(hasZone ? value : `${value.replace(" ", "T")}Z`);
}

@Injectable()
export class BookingService {
	private readonly logger = new Logger(BookingService.name);

	public constructor(
		private readonly bookingRepository: BookingRepository,
		private readonly theaterClient: TheaterClientGrpc,
		private readonly hallClient: HallClientGrpc,
		private readonly seatClient: SeatClientGrpc,
		private readonly movieClient: MovieClientGrpc,
		private readonly screeningClient: ScreeningClientGrpc,
	) {}

	public async getUserBookings(data: GetUserBookingsRequest) {
		const { userId } = data;

		const limit = data.limit && data.limit > 0 ? data.limit : 20;
		const page = data.page && data.page > 0 ? data.page : 1;
		const offset = (page - 1) * limit;

		const orders = await this.bookingRepository.findUserPaidOrders(
			userId,
			limit,
			offset,
		);

		if (!orders.length) {
			return { bookings: [], total: 0 };
		}

		const total = orders[0].total_count;

		const context = this.createRequestContext();
		const bookings = await this.enrichOrders(orders, context);

		return { bookings, total };
	}

	public async createReservation(data: CreateReservationRequest) {
		const { userId, screeningId } = data;
		const seats = data.seats ?? [];

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

		const hallId = screening.hall?.id;

		if (!hallId) {
			this.logger.error({ screeningId }, "Screening has no hall");

			throw new RpcException({
				code: RpcStatus.FAILED_PRECONDITION,
				details: "Screening has no hall assigned",
			});
		}

		if (seats.length === 0) {
			throw new RpcException({
				code: RpcStatus.INVALID_ARGUMENT,
				details: "No seats selected",
			});
		}

		const seatIds = seats.map(s => s.seatId);
		const duplicate = seatIds.find((id, i) => seatIds.indexOf(id) !== i);

		if (duplicate) {
			throw new RpcException({
				code: RpcStatus.INVALID_ARGUMENT,
				details: `Seat ${duplicate} is selected more than once`,
			});
		}

		const pricedSeats = await Promise.all(
			seatIds.map(async seatId => {
				let seat: Seat | undefined;

				try {
					({ seat } = await this.seatClient.getById({ id: seatId }));
				} catch (error) {
					if (this.isNotFound(error)) {
						throw new RpcException({
							code: RpcStatus.NOT_FOUND,
							details: `Seat ${seatId} not found`,
						});
					}
					throw error;
				}

				if (!seat) {
					throw new RpcException({
						code: RpcStatus.NOT_FOUND,
						details: `Seat ${seatId} not found`,
					});
				}

				if (seat.hallId !== hallId) {
					this.logger.warn(
						{
							userId,
							screeningId,
							seatId,
							seatHallId: seat.hallId,
							hallId,
						},
						"Seat from another hall in reservation",
					);

					throw new RpcException({
						code: RpcStatus.INVALID_ARGUMENT,
						details: `Seat ${seatId} is not in this screening's hall`,
					});
				}

				return { seatId, price: seat.price ?? 0 };
			}),
		);

		const amount = pricedSeats.reduce((sum, s) => sum + s.price, 0);

		let result: { order: Order; tickets: Ticket[] };

		try {
			result = await this.bookingRepository.transaction(async tx => {
				const order = await this.bookingRepository.createOrder(
					{ user_id: userId, amount },
					tx,
				);

				const tickets: Ticket[] = [];

				for (const s of pricedSeats) {
					const existing =
						await this.bookingRepository.findExistingTicket(
							screeningId,
							s.seatId,
							tx,
						);

					if (existing) {
						throw new RpcException({
							code: RpcStatus.ALREADY_EXISTS,
							details: `Seat ${s.seatId} is already taken`,
						});
					}

					tickets.push(
						await this.bookingRepository.createTicket(
							{
								screening_id: screening.id,
								hall_id: hallId,
								seat_id: s.seatId,
								price: s.price,
								order_id: order.id,
							},
							tx,
						),
					);
				}

				return { order, tickets };
			});
		} catch (error) {
			if ((error as { code?: string }).code === "23505") {
				this.logger.warn(
					{ userId, screeningId },
					"Seat taken by a concurrent reservation",
				);

				throw new RpcException({
					code: RpcStatus.ALREADY_EXISTS,
					details: "One of the selected seats is already taken",
				});
			}
			throw error;
		}

		const { order, tickets } = result;

		this.logger.log(
			{ orderId: order.id, userId, screeningId, seats: seats.length },
			"Reservation created",
		);

		return {
			orderId: order.id,
			ticketIds: tickets.map(t => t.id),
			amount,
		};
	}

	public async confirmBooking(data: ConfirmBookingRequest) {
		const { bookingId } = data;

		await this.bookingRepository.transaction(async tx => {
			const ordersUpdated = await this.bookingRepository.markOrderPaid(
				bookingId,
				tx,
			);

			if (ordersUpdated === 0) {
				this.logger.error(
					{ orderId: bookingId },
					"Confirm for unknown order",
				);

				throw new RpcException({
					code: RpcStatus.NOT_FOUND,
					details: "Order not found",
				});
			}

			const ticketsUpdated = await this.bookingRepository.markTicketsPaid(
				{ order_id: bookingId, paid_at: new Date() },
				tx,
			);

			if (ticketsUpdated === 0) {
				this.logger.error(
					{ orderId: bookingId },
					"Confirm for order without tickets",
				);

				throw new RpcException({
					code: RpcStatus.FAILED_PRECONDITION,
					details: "Order has no tickets",
				});
			}
		});

		const qrDataUrl = await QRCode.toDataURL(bookingId);
		await this.bookingRepository.updateOrderQr(bookingId, qrDataUrl);

		this.logger.log({ orderId: bookingId }, "Booking confirmed");

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
			this.logger.warn(
				{ orderId: bookingId, userId },
				"User tried to cancel someone else's booking",
			);

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

		const tickets =
			await this.bookingRepository.findTicketsByOrderId(bookingId);
		const ticket = tickets[0];

		if (!ticket) {
			this.logger.warn(
				{ orderId: bookingId },
				"Paid order has no tickets",
			);

			throw new RpcException({
				code: RpcStatus.FAILED_PRECONDITION,
				details: "Order has no tickets",
			});
		}

		const { screening } = await this.screeningClient.getById({
			id: ticket.screening_id,
		});

		if (!screening) {
			throw new RpcException({
				code: RpcStatus.NOT_FOUND,
				details: "Screening not found",
			});
		}

		const refundCutoffMs = 2 * 60 * 60 * 1000; // 2 hours before screening
		const startsAt = parseUtc(screening.startAt).getTime();

		if (startsAt - Date.now() < refundCutoffMs) {
			throw new RpcException({
				code: RpcStatus.FAILED_PRECONDITION,
				details:
					"Cancellations are not allowed this close to the screening",
			});
		}

		await this.bookingRepository.cancelOrder(bookingId);
		await this.bookingRepository.deleteTicketsByOrderId(bookingId);

		this.logger.log({ orderId: bookingId, userId }, "Booking canceled");

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
		const bookings = await Promise.all(
			orders.map(async order => {
				const ticket = order.tickets[0];
				if (!ticket) {
					this.logger.warn(
						{ orderId: order.id },
						"Paid order has no tickets, skipping",
					);
					return null;
				}

				const screening = await this.getScreening(
					ticket.screening_id,
					ctx,
				);

				if (!screening) {
					this.logger.warn(
						{ orderId: order.id, screeningId: ticket.screening_id },
						"Screening not found for order, skipping",
					);
					return null;
				}

				const [movie, hall, theater] = await Promise.all([
					this.getMovie(screening.movie?.id, ctx),
					this.getHall(ticket.hall_id, ctx),
					this.getTheater(screening.theater?.id, ctx),
				]);

				const startAt = parseUtc(screening.startAt).toISOString();

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
					// UTC: "2026-10-15" and "13:00"
					screeningDate: startAt.slice(0, 10),
					screeningTime: startAt.slice(11, 16),
					movie,
					hall,
					theater,
					seats,
					qrCode: order.qr_code ?? "",
				};
			}),
		);

		return bookings.filter(
			(booking): booking is NonNullable<typeof booking> =>
				booking !== null,
		);
	}

	private isNotFound(error: unknown) {
		const payload =
			error instanceof RpcException ? error.getError() : error;

		return isGrpcError(payload) && payload.code === RpcStatus.NOT_FOUND;
	}

	private async getScreening(id: string, ctx: RequestContext) {
		if (!ctx.screenings.has(id)) {
			try {
				const { screening } = await this.screeningClient.getById({
					id,
				});
				ctx.screenings.set(id, screening);
			} catch (error) {
				if (!this.isNotFound(error)) {
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
				if (!this.isNotFound(error)) {
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
				if (!this.isNotFound(error)) {
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
				if (!this.isNotFound(error)) {
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
				if (!this.isNotFound(error)) {
					throw error;
				}
				ctx.seats.set(id, undefined);
			}
		}

		return ctx.seats.get(id);
	}

	public async existsForScreening(data: ExistsForScreeningRequest) {
		const exists = await this.bookingRepository.existsForScreening(
			data.screeningId,
		);

		return { exists };
	}
}
