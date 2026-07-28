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
    // ✅ Added page and limit in req.query (default page 1, limit 4)
    const { city, category, page = 1, limit = 4 } = req.query;

    let query = `
      SELECT 
        cars.id,
        cars.userId,
        cars.title,
        cars.city,
        cars.pricePerHour,
        cars.securityDeposit,
        cars.seats,
        cars.doors,
        cars.luggageCapacity,
        cars.fuelType,
        cars.transmissionType,
        cars.carLocation,
        cars.carCategoryId,
        cars.lat,
        cars.lng,
        cars.driverAvailable,
        cars.pickupDropAvailable,
        cars.createdAt,
        cars.updatedAt,
        cars.carApprovalStatus,
        cars.repairMode,
        cars.carEnabled,
        
        car_categories.name AS categoryName,
        car_categories.image AS categoryImage,
        
        car_images.imagePath
      FROM cars
      LEFT JOIN car_categories ON cars.carCategoryId = car_categories.id
      LEFT JOIN car_images ON cars.id = car_images.carId
      WHERE cars.carApprovalStatus = 'APPROVED'
    `;

    const params = [];

    if (city) {
      query += " AND cars.city LIKE ?";
      params.push(`%${city}%`);
    }

    if (category) {
      query += " AND car_categories.name LIKE ?";
      params.push(`%${category}%`);
    }

    const [rows] = await pool.query(query, params);

    // Group images per car
    const carsMap = {};

    rows.forEach(row => {
      if (!carsMap[row.id]) {
        carsMap[row.id] = {
          id: row.id,
          userId: row.userId,
          title: row.title,
          city: row.city,
          pricePerHour: row.pricePerHour,
          securityDeposit: row.securityDeposit,
          seats: row.seats,
          doors: row.doors,
          luggageCapacity: row.luggageCapacity,
          fuelType: row.fuelType,
          transmissionType: row.transmissionType,
          carLocation: row.carLocation,
          carCategoryId: row.carCategoryId,
          lat: row.lat,
          lng: row.lng,
          driverAvailable: row.driverAvailable,
          pickupDropAvailable: row.pickupDropAvailable,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          carApprovalStatus: row.carApprovalStatus,
          repairMode: row.repairMode,
          carEnabled: row.carEnabled,

          category: {
            name: row.categoryName,
            image: row.categoryImage
          },

          images: []
        };
      }

      if (row.imagePath) {
        carsMap[row.id].images.push(row.imagePath);
      }
    });

    const finalCars = Object.values(carsMap);

    // =====================================
    // CHECK ACTIVE SELF BOOKING FOR EACH CAR
    // =====================================
    for (const car of finalCars) {
      car.selfBook = false;
      car.freeAfter = null;

      const [selfBooking] = await pool.query(
        `
        SELECT endDate
        FROM reservations
        WHERE carId = ?
        AND status = 'SELFBOOK'
        AND endDate >= NOW()
        ORDER BY endDate ASC
        LIMIT 1
        `,
        [car.id]
      );

      if (selfBooking.length > 0) {
        car.selfBook = true;
        car.freeAfter = selfBooking[0].endDate;
      }
    }

    // =====================================
    // ✅ 1. SORTING: Move Booked Cars to Bottom
    // =====================================
    finalCars.sort((a, b) => {
      if (a.selfBook && !b.selfBook) return 1;  // a is booked, send it down
      if (!a.selfBook && b.selfBook) return -1; // b is booked, keep a up
      return 0; // both are same (either both booked or both free)
    });

    // =====================================
    // ✅ 2. PAGINATION: Limit to 4 per page
    // =====================================
    const pageNumber = parseInt(page);
    const limitNumber = parseInt(limit);
    
    // Calculate start and end index for slicing array
    const startIndex = (pageNumber - 1) * limitNumber;
    const endIndex = pageNumber * limitNumber;

    // Extract only the cars for the current page
    const paginatedCars = finalCars.slice(startIndex, endIndex);

    // Final response
    res.status(200).json({
      success: true,
      pagination: {
        totalCars: finalCars.length,
        currentPage: pageNumber,
        totalPages: Math.ceil(finalCars.length / limitNumber),
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





