const { v4: uuidv4 } = require("uuid");
const db = require("../config/db"); // your mysql pool/connection

// ✅ Create Coupon (Admin)
exports.createCoupon = async (req, res) => {
  try {
    const {
      code,
      discountType,
      discountValue,
      minAmount,
      maxDiscount,
      startDate,
      endDate,
      usageLimit
    } = req.body;

    if (!code || !discountType || !discountValue || !startDate || !endDate) {
      return res.status(400).json({ success: false, message: "Required fields missing" });
    }

    await db.execute(
      `INSERT INTO coupons
       (id, code, discountType, discountValue, minAmount, maxDiscount, startDate, endDate, usageLimit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(),
        code,
        discountType,
        discountValue,
        minAmount || 0,
        maxDiscount || null,
        startDate,
        endDate,
        usageLimit || 1
      ]
    );

    res.status(201).json({ success: true, message: "Coupon created successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Internal Server Error", error: err.message });
  }
};

// ✅ Get All Coupons (Admin)
exports.getAllCoupons = async (req, res) => {
  try {
    const [coupons] = await db.execute("SELECT * FROM coupons ORDER BY createdAt DESC");
    res.status(200).json({ success: true, data: coupons });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Internal Server Error", error: err.message });
  }
};

// ✅ Apply Coupon (During Booking)
  exports.applyCoupon = async (req, res) => {
    try {
      const { couponCode, bookingAmount } = req.body;
      const userId = req.user.id; // ✅ get userId from token

      if (!couponCode || !bookingAmount) {
        return res.status(400).json({ success: false, message: "Required fields missing" });
      }

      // 1️⃣ Check coupon validity
      const [coupons] = await db.execute(
        `SELECT * FROM coupons
        WHERE code = ? AND startDate <= NOW() AND endDate >= NOW()`,
        [couponCode]
      );

      if (coupons.length === 0) {
        return res.status(400).json({ success: false, message: "Coupon not valid or expired" });
      }

      const coupon = coupons[0];

      // 2️⃣ Check minimum booking amount
      if (bookingAmount < coupon.minAmount) {
        return res.status(400).json({
          success: false,
          message: `Booking amount must be at least ${coupon.minAmount}`
        });
      }

      // 3️⃣ Check usage limit for this user
      const [used] = await db.execute(
        `SELECT COUNT(*) AS usedCount FROM reservations WHERE userId = ? AND couponCode = ?`,
        [userId, couponCode]
      );

      if (used[0].usedCount >= coupon.usageLimit) {
        return res.status(400).json({ success: false, message: "Coupon usage limit reached" });
      }

      // 4️⃣ Calculate discount
      let discount = 0;
      if (coupon.discountType === "PERCENT") {
        discount = (bookingAmount * coupon.discountValue) / 100;
        if (coupon.maxDiscount) discount = Math.min(discount, coupon.maxDiscount);
      } else {
        discount = coupon.discountValue;
      }

      res.status(200).json({
        success: true,
        message: "Coupon applied successfully",
        discount: parseFloat(discount.toFixed(2)),
        finalAmount: parseFloat((bookingAmount - discount).toFixed(2))
      });

    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "Internal Server Error", error: err.message });
    }
  };

