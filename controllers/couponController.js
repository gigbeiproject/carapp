const { v4: uuidv4 } = require("uuid");
const db = require("../config/db"); // your mysql pool/connection

// A coupon's duration threshold (`minHours`) is stored as a plain number
// whose unit is given by `durationUnit` — convert it to hours (the unit
// bookings' `totalHours` is measured in) before comparing. MONTHS uses a
// flat 30-day approximation since booking durations don't need
// calendar-exact month lengths for this comparison.
const DURATION_UNIT_TO_HOURS = {
  HOURS: 1,
  WEEKS: 24 * 7,
  MONTHS: 24 * 30,
};

function thresholdInHours(coupon) {
  const factor = DURATION_UNIT_TO_HOURS[coupon.durationUnit] || 1;
  return coupon.minHours * factor;
}

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
      usageLimit,
      minHours,
      durationUnit,
      belowMinHoursDiscount
    } = req.body;

    if (!code || !discountType || !discountValue || !startDate || !endDate) {
      return res.status(400).json({ success: false, message: "Required fields missing" });
    }

    // If a duration threshold is given, the "below threshold" discount is
    // required too — otherwise there's no defined behavior for shorter
    // bookings.
    if (minHours && (belowMinHoursDiscount === undefined || belowMinHoursDiscount === null || belowMinHoursDiscount === '')) {
      return res.status(400).json({
        success: false,
        message: "belowMinHoursDiscount is required when minHours is set"
      });
    }

    await db.execute(
      `INSERT INTO coupons
       (id, code, discountType, discountValue, minAmount, maxDiscount, startDate, endDate, usageLimit, minHours, durationUnit, belowMinHoursDiscount)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(),
        code,
        discountType,
        discountValue,
        minAmount || 0,
        maxDiscount || null,
        startDate,
        endDate,
        usageLimit || 1,
        minHours || null,
        minHours ? (durationUnit || "HOURS") : null,
        minHours ? belowMinHoursDiscount : null
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
    // NOW() rather than CURDATE()/DATE() — coupons can now have
    // hour-precision or relative-duration validity windows (e.g. "valid
    // for 48 hours"), and truncating to whole days would keep a coupon
    // showing as active for the rest of its expiry day after it's
    // actually expired.
    const [coupons] = await db.execute(`
      SELECT *
      FROM coupons
      WHERE
        NOW() BETWEEN startDate AND endDate
      ORDER BY createdAt DESC
    `);

    res.status(200).json({
      success: true,
      data: coupons,
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: err.message,
    });
  }
};

// ✅ Apply Coupon (During Booking)
  exports.applyCoupon = async (req, res) => {
    try {
      const { couponCode, bookingAmount, totalHours } = req.body;
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

      // 4️⃣ Calculate discount — duration-tiered when the coupon has a
      // threshold configured: bookings shorter than the threshold (converted
      // to hours from whatever unit — Hours/Weeks/Months — the coupon was
      // configured with) use belowMinHoursDiscount instead of discountValue.
      const applicableDiscountValue =
        coupon.minHours && Number(totalHours) < thresholdInHours(coupon)
          ? coupon.belowMinHoursDiscount
          : coupon.discountValue;

      let discount = 0;
      if (coupon.discountType === "PERCENT") {
        discount = (bookingAmount * applicableDiscountValue) / 100;
        if (coupon.maxDiscount) discount = Math.min(discount, coupon.maxDiscount);
      } else {
        discount = applicableDiscountValue;
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

