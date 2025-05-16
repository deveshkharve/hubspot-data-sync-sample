const dotenv = require("dotenv");
const path = require("path");

dotenv.config({ path: path.join(__dirname, "../.env") });

module.exports = {
  MONGO_URI: process.env.MONGO_URI,
  PORT: process.env.PORT,
  VERSION: process.env.VERSION,
};
