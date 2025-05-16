const Actions = require("../db/models/Actions");
const logger = require("../utils/logger");
const _ = require("lodash");

const createAction = async (action) => {
  const res = await Actions.create(action);
  logger.debug("action created", {
    actionId: res._id,
  });
  return res;
};

const createActionsBatch = async (actions) => {
  try {
    logger.info("Creating actions batch", {
      actionsLength: actions.length,
    });
    //   return;
    // _.map(actions, ActionService.createAction);
    const res = await Actions.insertMany(actions);
    logger.debug("actions created", {
      actionsLength: res.length,
    });
  } catch (err) {
    logger.error("Error creating actions batch", {
      error: err.message,
    });
  }
};

const ActionService = {
  createAction,
  createActionsBatch,
};

module.exports = ActionService;
