const pool = require('../config/db'); // MySQL pool

// GET all car categories
exports.getAllCarCategories = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM car_categories');
    res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
};

// POST create new car category
exports.createCarCategory = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, message: 'Category name is required' });
    }

    const id = require('uuid').v4(); // generate UUID
    await pool.query('INSERT INTO car_categories (id, name) VALUES (?, ?)', [id, name]);

    res.status(201).json({ success: true, message: 'Category created', data: { id, name } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
};


// get by car category id
// get cars (NO approval status filter)
exports.getCarsWithCategory = async (req, res) => {
  try {
    const { city, category } = req.query;
    let pageNumber = parseInt(req.query.page, 10);
    let limitNumber = parseInt(req.query.limit, 10);
    if (!Number.isInteger(pageNumber) || pageNumber < 1) pageNumber = 1;
    if (!Number.isInteger(limitNumber) || limitNumber < 1) limitNumber = 4;
    if (limitNumber > 100) limitNumber = 100;
    const offset = (pageNumber - 1) * limitNumber;

    // Filters (and the category-name join) apply to both the count and the
    // page query, so build them once.
    const whereParts = ["cars.carApprovalStatus = 'APPROVED'"];
    const whereParams = [];
    if (city) {
      whereParts.push("cars.city LIKE ?");
      whereParams.push(`%${city}%`);
    }
    if (category) {
      whereParts.push("car_categories.name LIKE ?");
      whereParams.push(`%${category}%`);
    }
    const whereClause = `WHERE ${whereParts.join(" AND ")}`;
    const joinClause = `FROM cars LEFT JOIN car_categories ON cars.carCategoryId = car_categories.id ${whereClause}`;

    const [countRows] = await pool.query(`SELECT COUNT(*) AS total ${joinClause}`, whereParams);
    const totalCars = countRows[0].total;

    // Determine this page's cars (no image join here — that's 1-to-many
    // and would inflate/skew LIMIT/OFFSET). Active self-booking status is
    // computed inline via a correlated subquery instead of a per-car N+1
    // loop, and used to keep booked cars sorted to the bottom, same as
    // before.
    const [cars] = await pool.query(
      `
      SELECT
        cars.id, cars.userId, cars.title, cars.city, cars.pricePerHour,
        cars.securityDeposit, cars.seats, cars.doors, cars.luggageCapacity,
        cars.fuelType, cars.transmissionType, cars.carLocation, cars.carCategoryId,
        cars.lat, cars.lng, cars.driverAvailable, cars.pickupDropAvailable,
        cars.createdAt, cars.updatedAt, cars.carApprovalStatus, cars.repairMode, cars.carEnabled,
        car_categories.name AS categoryName,
        car_categories.image AS categoryImage,
        EXISTS (
          SELECT 1 FROM reservations r
          WHERE r.carId = cars.id AND r.status = 'SELFBOOK' AND r.endDate >= NOW()
        ) AS selfBook,
        (
          SELECT r2.endDate FROM reservations r2
          WHERE r2.carId = cars.id AND r2.status = 'SELFBOOK' AND r2.endDate >= NOW()
          ORDER BY r2.endDate ASC LIMIT 1
        ) AS freeAfter
      ${joinClause}
      ORDER BY selfBook ASC, cars.createdAt DESC
      LIMIT ? OFFSET ?
      `,
      [...whereParams, limitNumber, offset]
    );

    // Fetch images for just this page's cars.
    const carIds = cars.map((c) => c.id);
    const images = carIds.length
      ? (
          await pool.query(
            `SELECT carId, imagePath FROM car_images WHERE carId IN (${carIds.map(() => "?").join(",")})`,
            carIds
          )
        )[0]
      : [];

    const paginatedCars = cars.map((car) => ({
      id: car.id,
      userId: car.userId,
      title: car.title,
      city: car.city,
      pricePerHour: car.pricePerHour,
      securityDeposit: car.securityDeposit,
      seats: car.seats,
      doors: car.doors,
      luggageCapacity: car.luggageCapacity,
      fuelType: car.fuelType,
      transmissionType: car.transmissionType,
      carLocation: car.carLocation,
      carCategoryId: car.carCategoryId,
      lat: car.lat,
      lng: car.lng,
      driverAvailable: car.driverAvailable,
      pickupDropAvailable: car.pickupDropAvailable,
      createdAt: car.createdAt,
      updatedAt: car.updatedAt,
      carApprovalStatus: car.carApprovalStatus,
      repairMode: car.repairMode,
      carEnabled: car.carEnabled,
      category: { name: car.categoryName, image: car.categoryImage },
      images: images.filter((img) => img.carId === car.id).map((img) => img.imagePath),
      selfBook: !!car.selfBook,
      freeAfter: car.freeAfter || null,
    }));

    // Final response — same shape as before (this endpoint already had a
    // consumer relying on it), just backed by real SQL pagination now.
    res.status(200).json({
      success: true,
      pagination: {
        totalCars,
        currentPage: pageNumber,
        totalPages: Math.max(1, Math.ceil(totalCars / limitNumber)),
        limit: limitNumber
      },
      data: paginatedCars
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message
    });
  }
};





