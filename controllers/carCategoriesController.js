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
    const { city, category } = req.query; // optional filters

    let query = `
      SELECT 
        cars.id AS carId,
        cars.title,
        cars.city,
        cars.pricePerHour,
        cars.seats,
        cars.doors,
        cars.luggageCapacity,
        cars.fuelType,
        cars.transmissionType,
        cars.carLocation,
        cars.lat,
        cars.lng,
        cars.driverAvailable,
        cars.pickupDropAvailable,
        car_categories.id AS categoryId,
        car_categories.name AS categoryName,
        car_categories.image AS categoryImage
      FROM cars
      LEFT JOIN car_categories ON cars.carCategoryId = car_categories.id
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
    res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
};
