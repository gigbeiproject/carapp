const express = require('express');
const router = express.Router();
const {
  getAllCarCategories,
  createCarCategory,
  getCarsWithCategory
} = require('../controllers/carCategoriesController');

// GET all categories
router.get('/', getAllCarCategories);

// POST new category
router.post('/', createCarCategory);

router.get('/cars', getCarsWithCategory);

module.exports = router;
