const db = require('../config/db');

const saveOtp = (mobile, otp, callback) => {
  const query = 'INSERT INTO otps (mobile, otp_code) VALUES (?, ?)';
  db.query(query, [mobile, otp], callback);
};

const verifyOtp = (mobile, otp, callback) => {
  const query = 'SELECT * FROM otps WHERE mobile = ? AND otp_code = ? ORDER BY created_at DESC LIMIT 1';
  db.query(query, [mobile, otp], callback);
};

module.exports = { saveOtp, verifyOtp };
