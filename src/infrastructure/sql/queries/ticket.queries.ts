export const TICKET_QUERIES = {
	FIND_EXISTING_TICKET: `
        SELECT *
        FROM tickets
        WHERE screening_id=$1 AND seat_id=$2
    `,

	LIST_RESERVED_SEATS: `
        SELECT seat_id
        FROM tickets
        WHERE hall_id=$1
          AND screening_id=$2
          AND status IN ('RESERVED','PAID')
    `,
	EXISTS_FOR_SCREENING: `
		SELECT 1 FROM tickets WHERE screening_id = $1 LIMIT 1
	`,
	FIND_TICKETS_BY_ORDER_ID: `
		SELECT *
		FROM tickets
		WHERE order_id=$1
	`,
} as const;
