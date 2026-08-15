const db = require("../config/db");
const { parsePagination, buildPaginationMeta } = require("../utils/pagination");

exports.getHostCompletedReservations = async (req, res) => {
  try {
    const hostId = req.user.id; // ✅ user ID from token (protect middleware)
    const { page, limit, offset } = parsePagination(req.query, { defaultLimit: 10 });

    const [countRows] = await db.query(
      "SELECT COUNT(*) AS total FROM reservations r WHERE r.hostId = ? AND r.status = 'COMPLETED'",
      [hostId]
    );
    const total = countRows[0].total;

    const [rows] = await db.query(
      `SELECT
          r.id,
          r.carId,
          r.amount,
          r.settlementStatus,
          r.status,
          c.title AS carName
       FROM reservations r
       LEFT JOIN cars c ON r.carId = c.id
       WHERE r.hostId = ? AND r.status = 'COMPLETED'
       ORDER BY r.createdAt DESC
       LIMIT ? OFFSET ?`,
      [hostId, limit, offset]
    );

    // An empty page is not an error — always 200, matching every other
    // paginated list endpoint.
    res.status(200).json({
      success: true,
      count: rows.length,
      data: rows,
      pagination: buildPaginationMeta(page, limit, total),
    });

  } catch (error) {
    console.error("Error fetching completed reservations:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message
    });
  }
};
