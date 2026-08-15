const db = require("../../config/db");
const { parsePagination, buildPaginationMeta } = require("../../utils/pagination");

const HOST_BOOKING_TAB_STATUSES = {
  upcoming: ["PENDING", "CONFIRMED", "START"],
  completed: ["COMPLETED"],
};

const getHostReservations = async (req, res) => {
  try {
    const hostId = req.user.id; // ✅ Host ID from token
    const { page, limit, offset } = parsePagination(req.query, { defaultLimit: 10 });
    const tab = (req.query.tab || "upcoming").toLowerCase();
    const statuses = HOST_BOOKING_TAB_STATUSES[tab] || HOST_BOOKING_TAB_STATUSES.upcoming;
    const statusPlaceholders = statuses.map(() => "?").join(",");

    const [countRows] = await db.query(
      `SELECT COUNT(*) AS total FROM reservations r WHERE r.hostId = ? AND r.status IN (${statusPlaceholders})`,
      [hostId, ...statuses]
    );
    const total = countRows[0].total;

    const [rows] = await db.query(
      `SELECT r.*,
              u.name AS userName,
              u.email AS userEmail,
              c.title AS carTitle,
              c.city AS carCity,
              c.pricePerHour
       FROM reservations r
       LEFT JOIN users u ON r.userId = u.id
       LEFT JOIN cars c ON r.carId = c.id
       WHERE r.hostId = ? AND r.status IN (${statusPlaceholders})
       ORDER BY r.createdAt DESC
       LIMIT ? OFFSET ?`,
      [hostId, ...statuses, limit, offset]
    );

    res.json({
      success: true,
      message: "Reservations fetched successfully",
      data: rows,
      pagination: buildPaginationMeta(page, limit, total),
    });
  } catch (error) {
    console.error("getHostReservations error:", error);
    res
      .status(500)
      .json({ success: false, message: "Server error", error: error.message });
  }
};




module.exports = { getHostReservations };
