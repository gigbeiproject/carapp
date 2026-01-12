const s3 = require("../config/s3");

const uploadToS3 = async (file, folder = "cars") => {
  if (!file || !Buffer.isBuffer(file.buffer)) {
    console.error("Invalid file object:", file);
    throw new Error("Invalid file buffer");
  }

  const params = {
    Bucket: "carapprent",
    Key: `${folder}/${Date.now()}-${file.originalname}`,
    Body: file.buffer,                // ✅ FIX
    ContentType: file.mimetype,        // ✅ IMPORTANT
   
  };

  const result = await s3.upload(params).promise();
  return result.Location; // ✅ RETURN URL
};

module.exports = uploadToS3;
