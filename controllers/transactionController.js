const db = require("../config/db");

exports.getHostCompletedReservations = async (req, res) => {
  try {
    const hostId = req.user.id; // ✅ user ID from token (protect middleware)

    const [rows] = await db.execute(
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
       ORDER BY r.createdAt DESC`,
      [hostId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No completed reservations found"
      });
    }

    res.status(200).json({
      success: true,
      count: rows.length,
      data: rows
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
