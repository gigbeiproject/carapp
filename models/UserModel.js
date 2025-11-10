const db = require('../config/db');

const getUserByMobile = (mobile, callback) => {
  const query = 'SELECT * FROM users WHERE mobile = ?';
  db.query(query, [mobile], callback);
};

const createUser = (name, mobile, role, callback) => {
  const query = 'INSERT INTO users (name, mobile, role) VALUES (?, ?, ?)';
  db.query(query, [name, mobile, role], callback);
};

module.exports = { getUserByMobile, createUser };
