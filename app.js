// require modules
const config = require("./src/config");
const db = require("./src/db");
const worker = require("./src/worker");

const packageJson = require("./package.json");
process.env.VERSION = packageJson.version;

db.dbConnection(config.MONGO_URI).then(() => {
  console.log("connected to database");
  // load db models
  db.loadModels();
  // worker setup
  worker();
});

process.env.instance = "app";

// server setup
require("./src/server");
