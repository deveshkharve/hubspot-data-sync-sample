const mongoose = require("mongoose");
mongoose.set("strictQuery", false);

// mongoose connection
const dbConnection = (MONGO_URI) =>
  mongoose.connect(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

const loadModels = () => {
  require("./models/Domain");
  require("./models/Actions");
};

const db = {
  dbConnection,
  loadModels,
};

module.exports = db;
