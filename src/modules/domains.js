const Domain = require("../db/models/Domain");
const logger = require("../utils/logger");

const saveDomain = async (domain) => {
  // disable this for testing purposes
  return;

  domain.markModified("integrations.hubspot.accounts");
  await domain.save();
};

const getDomain = async () => {
  const domain = await Domain.findOne({});
  return domain;
};

const DomainService = {
  saveDomain,
  getDomain,
};

module.exports = DomainService;
