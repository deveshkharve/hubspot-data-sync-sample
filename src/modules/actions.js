const Actions = require("../db/models/Actions");
const logger = require("../utils/logger");
const _ = require("lodash");

/**
 * Create an action in DB
 */
const createAction = async (action) => {
  const res = await Actions.create(action);
  logger.debug("action created", {
    actionId: res._id,
  });
  return res;
};

/**
 * Create a batch of actions in DB
 */
const createActionsBatch = async (actions) => {
  try {
    logger.info("Creating actions batch", {
      actionsLength: actions.length,
      actions,
    });

    return; // comment this to create actions in DB

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
