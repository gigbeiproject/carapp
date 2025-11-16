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
exports.getCarsWithCategory = async (req, res) => {
  try {
    const { city, category } = req.query;

    let query = `
      SELECT 
        cars.id AS carId,
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
      WHERE 1=1
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

    // Group images under each car
    const carsMap = {};

    rows.forEach(row => {
      if (!carsMap[row.carId]) {
        carsMap[row.carId] = {
          carId: row.carId,
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
        carsMap[row.carId].images.push(row.imagePath);
      }
    });

    const finalData = Object.values(carsMap);

    res.status(200).json({
      success: true,
      data: finalData
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

