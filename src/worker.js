const _ = require("lodash");
const { createQueue, drainQueue } = require("./utils/common");
const DomainService = require("./modules/domains");
const CompanyService = require("./modules/companies");
const ContactService = require("./modules/contacts");
const MeetingService = require("./modules/meetings");

const logger = require("./utils/logger");

const { refreshAccessToken } = require("./modules/hubspot");

const propertyPrefix = "hubspot__";

const pullDataFromHubspot = async () => {
  logger.info("start pulling data from HubSpot");

  // get domain data
  const domain = await DomainService.getDomain();

  for (const account of domain.integrations.hubspot.accounts) {
    logger.info(`start processing account: ${JSON.stringify(account)}`);

    try {
      await refreshAccessToken(domain, account.hubId);
    } catch (err) {
      logger.error(`failed to refresh access token: ${err.message}`, {
        apiKey: domain.apiKey,
        metadata: { operation: "refreshAccessToken" },
      });
    }

    const actions = [];
    const qu = createQueue(domain, actions);

    try {
      await ContactService.processContacts(domain, account.hubId, qu);
      logger.info("processed contacts");
    } catch (err) {
      logger.error(`failed to process contacts: ${err.message}`, {
        apiKey: domain.apiKey,
        metadata: { operation: "processContacts", hubId: account.hubId },
      });
    }

    try {
      await CompanyService.processCompanies(domain, account.hubId, qu);
      logger.info("processed companies");
    } catch (err) {
      logger.error(`failed to process companies: ${err.message}`, {
        apiKey: domain.apiKey,
        metadata: { operation: "processCompanies", hubId: account.hubId },
      });
    }

    try {
      await MeetingService.processMeetings(domain, account.hubId, qu);
      logger.info("processed meetings");
    } catch (err) {
      logger.error(`failed to process meetings: ${err.message}`, {
        apiKey: domain.apiKey,
        metadata: { operation: "processMeetings", hubId: account.hubId },
      });
    }

    try {
      await drainQueue(domain, actions, qu);
      logger.info("drained queue");
    } catch (err) {
      logger.error(`failed to drain queue: ${err.message}`, {
        apiKey: domain.apiKey,
        metadata: { operation: "drainQueue", hubId: account.hubId },
      });
    }

    await DomainService.saveDomain(domain);

    logger.info("finish processing account");
  }

  logger.info("finish pulling data from HubSpot. exiting...");
  // process.exit();
};

module.exports = pullDataFromHubspot;
