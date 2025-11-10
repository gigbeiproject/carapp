// routes/carRoutes.js
const express = require("express");
const router = express.Router();
const { searchCars } = require("../controllers/searchController"); // your searchCars function


// GET search cars by city and date
// Example: /search-cars?city=Delhi&pickupDateTime=2025-10-20T10:00:00&dropDateTime=2025-10-22T18:00:00
router.get("/search-cars", searchCars);

module.exports = router;
