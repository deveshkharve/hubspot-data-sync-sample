// require mongoose
const mongoose = require("mongoose");
const moment = require("moment");

const Schema = mongoose.Schema;

const ActionSchema = new Schema(
  {
    actionName: {
      type: String,
      required: true,
    },
    actionDate: {
      type: Date,
    },
    includeInAnalytics: {
      type: Boolean,
      required: true,
    },
    identity: {
      type: String,
    },
    properties: {
      type: Object,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { minimize: false, strict: false }
);

module.exports = mongoose.model("Action", ActionSchema);
