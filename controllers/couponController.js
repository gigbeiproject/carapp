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

/**
 * Checks a coupon against a booking. `baseAmount` is the booking amount the
 * coupon's minimum applies to (amount before discount and GST). Returns
 * { ok: true, coupon, discount } or { ok: false, message }.
 * Amounts are compared as numbers — MySQL DECIMALs come back as strings.
 */
async function validateCouponForBooking({ code, baseAmount, totalHours, userId }) {
  const [coupons] = await db.execute(
    "SELECT * FROM coupons WHERE code = ? AND startDate <= NOW() AND endDate >= NOW()",
    [code]
  );
  if (coupons.length === 0) return { ok: false, message: "Coupon not valid or expired" };
  const coupon = coupons[0];

  const amount = Number(baseAmount);
  const minAmount = Number(coupon.minAmount || 0);
  if (!Number.isFinite(amount) || amount < minAmount) {
    return {
      ok: false,
      message: `Coupon ${coupon.code} is valid only on bookings of ₹${minAmount.toLocaleString("en-IN")} or more`,
    };
  }

  if (coupon.usageLimit != null) {
    const [used] = await db.execute(
      "SELECT COUNT(*) AS usedCount FROM reservations WHERE userId = ? AND couponCode = ? AND status <> 'CANCELLED'",
      [userId, code]
    );
    if (Number(used[0].usedCount) >= Number(coupon.usageLimit)) {
      return { ok: false, message: "Coupon usage limit reached" };
    }
  }

  const value = Number(
    coupon.minHours && Number(totalHours) < thresholdInHours(coupon) ? coupon.belowMinHoursDiscount : coupon.discountValue
  ) || 0;
  let discount = coupon.discountType === "PERCENT" ? (amount * value) / 100 : value;
  if (coupon.discountType === "PERCENT" && coupon.maxDiscount != null) discount = Math.min(discount, Number(coupon.maxDiscount));
  discount = Math.min(discount, amount);

  return { ok: true, coupon, discount: Number(discount.toFixed(2)) };
}

exports.validateCouponForBooking = validateCouponForBooking;

// Amount/percentage sanity rules for a new coupon (also enforced in the
// admin form). Returns an error message, or null when valid.
function validateCouponFields(body) {
  const num = (v) => (v === undefined || v === null || v === "" ? null : Number(v));
  const value = num(body.discountValue);
  const minAmount = num(body.minAmount) ?? 0;
  const maxDiscount = num(body.maxDiscount);
  const below = num(body.belowMinHoursDiscount);
  const usageLimit = num(body.usageLimit);
  const percent = body.discountType === "PERCENT";

  if (!["PERCENT", "FIXED"].includes(body.discountType)) return "discountType must be PERCENT or FIXED";
  if (!(value > 0)) return "Discount value must be greater than 0";
  if (percent && value > 100) return "Percentage discount cannot be more than 100%";
  if (minAmount < 0) return "Minimum booking amount cannot be negative";
  if (maxDiscount !== null && !(maxDiscount > 0)) return "Max discount must be greater than 0";
  if (!percent && minAmount > 0 && value >= minAmount) {
    return `A ₹${value} discount must be less than the minimum booking amount (₹${minAmount})`;
  }
  if (below !== null && (below < 0 || (percent && below > 100))) return "Below-threshold discount is out of range";
  if (usageLimit !== null && !(usageLimit >= 1)) return "Usage limit must be at least 1";
  if (new Date(body.endDate) <= new Date(body.startDate)) return "End date must be after the start date";
  return null;
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

    const couponError = validateCouponFields(req.body);
    if (couponError) {
      return res.status(400).json({ success: false, message: couponError });
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

// ✅ Delete Coupon (Admin)
exports.deleteCoupon = async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await db.execute(`DELETE FROM coupons WHERE id = ?`, [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Coupon not found" });
    }

    res.status(200).json({ success: true, message: "Coupon deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Internal Server Error", error: err.message });
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

      const result = await validateCouponForBooking({ code: couponCode, baseAmount: bookingAmount, totalHours, userId });
      if (!result.ok) return res.status(400).json({ success: false, message: result.message });

      res.status(200).json({
        success: true,
        message: "Coupon applied successfully",
        discount: result.discount,
        finalAmount: parseFloat((Number(bookingAmount) - result.discount).toFixed(2)),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "Internal Server Error", error: err.message });
    }
  };

