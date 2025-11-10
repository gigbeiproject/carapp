const multer = require("multer");
const storage = multer.memoryStorage(); // store in memory before upload
module.exports = multer({ storage });
