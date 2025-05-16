const { queue } = require("async");
const logger = require("./logger");
const _ = require("lodash");
const ActionService = require("../modules/actions");

const disallowedValues = [
  "[not provided]",
  "placeholder",
  "[[unknown]]",
  "not set",
  "not provided",
  "unknown",
  "undefined",
  "n/a",
];

const filterNullValuesFromObject = (object) =>
  Object.fromEntries(
    Object.entries(object).filter(
      ([_, v]) =>
        v !== null &&
        v !== "" &&
        typeof v !== "undefined" &&
        (typeof v !== "string" ||
          !disallowedValues.includes(v.toLowerCase()) ||
          !v.toLowerCase().includes("!$record"))
    )
  );

const normalizePropertyName = (key) =>
  key
    .toLowerCase()
    .replace(/__c$/, "")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");

// Where the batched data is written
const goal = async (actions) => {
  await ActionService.createActionsBatch(actions);
};

const createQueue = (domain, actions) => {
  const q = queue(async (action, callback) => {
    try {
      logger.debug("create action to queue", {
        action,
        actionsLength: actions.length,
      });

      actions.push(action);

      if (actions.length > 100) {
        const copyOfActions = _.cloneDeep(actions);
        actions.splice(0, actions.length);

        await goal(copyOfActions);
      }
      if (callback) {
        callback();
      }
    } catch (err) {
      logger.error("Queue worker error", { error: err.message });
      if (callback) {
        callback(err);
      }
    }
  }, 100000000); // High concurrency

  return q;
};

const drainQueue = async (domain, actions, q) => {
  if (q.length() > 0) await q.drain();

  if (actions.length > 0) {
    await goal(actions);
  }

  return true;
};

const delay = (ms) => {
  return new Promise((resolve, reject) => setTimeout(resolve, ms));
};

module.exports = {
  filterNullValuesFromObject,
  normalizePropertyName,
  goal,
  createQueue,
  drainQueue,
  delay,
};
