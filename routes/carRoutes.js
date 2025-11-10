const express = require("express");
const { protect } = require("../middleware/auth");
const upload = require("../middleware/upload");
const { createListing,getAllCars,getCarById,updateCar,deleteCar,toggleCarEnabled, getCarsByUser,toggleCarRepairMode,getCarsByUserId } = require("../controllers/carController");

const router = express.Router();

// Accept multiple files grouped by field names
router.post(
  "/cars/create-listing",
  protect,
  upload.fields([
    { name: "carImages", maxCount: 10 },
    { name: "rc", maxCount: 5 },
    { name: "insurance", maxCount: 5 },
    { name: "pollution", maxCount: 5 },
    { name: "aadhar", maxCount: 5 },
    { name: "license", maxCount: 5 },
    { name: "video", maxCount: 1 },
  ]),
  createListing
);


router.get("/", getAllCars);       // GET all
router.get("/:id",getCarById);       

router.get("/user/:userId", getCarsByUserId);


router.put("/:id", protect, upload.fields([
  { name: "carImages" },
  { name: "rc" },
  { name: "insurance" },
  { name: "pollution" },
  { name: "aadhar" },
  { name: "license" },
  { name: "video" }
]), updateCar);

// Delete
router.delete("/:id", protect, deleteCar);


router.put("/:id", protect, toggleCarEnabled);


router.put("/repair/:id", protect, toggleCarRepairMode);


// get car by host
router.get("/man", protect, getCarsByUser);



module.exports = router;
