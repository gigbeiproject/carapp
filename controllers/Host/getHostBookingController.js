const db = require("../../config/db");


const getHostReservations = async (req, res) => {
  try {
    const hostId = req.user.id; // ✅ Host ID from token

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
       WHERE r.hostId = ?
       ORDER BY r.createdAt DESC`,
      [hostId]
    );

    if (rows.length === 0) {
      return res.json({
        success: true,
        message: "No reservations found",
        upcoming: [],
        completed: [],
      });
    }

    // ✅ Filter upcoming and completed based on status
    const upcoming = rows.filter(
      (r) => r.status === "PENDING" || r.status === "CONFIRMED" || r.status === "START"
    );

    const completed = rows.filter((r) => r.status === "COMPLETED");

    res.json({
      success: true,
      message: "Reservations fetched successfully",
      upcomingCount: upcoming.length,
      completedCount: completed.length,
      upcoming,
      completed,
    });
  } catch (error) {
    console.error("getHostReservations error:", error);
    res
      .status(500)
      .json({ success: false, message: "Server error", error: error.message });
  }
};




module.exports = { getHostReservations };
