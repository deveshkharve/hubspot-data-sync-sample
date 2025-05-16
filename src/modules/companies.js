const { getHubspotClient, checkAndRefreshToken } = require("./hubspot");
const DomainService = require("./domains");
const logger = require("../utils/logger");
const { delay } = require("../utils/common");

const hubspotClient = getHubspotClient();

const generateLastModifiedDateFilter = (
  date,
  nowDate,
  propertyName = "hs_lastmodifieddate"
) => {
  const lastModifiedDateFilter = date
    ? {
        filters: [
          { propertyName, operator: "GTE", value: `${date.valueOf()}` },
          { propertyName, operator: "LTE", value: `${nowDate.valueOf()}` },
        ],
      }
    : {};

  return lastModifiedDateFilter;
};

const processCompanyRecord = async (company, lastPulledDate, qu) => {
  if (!company.properties) return;

  const actionTemplate = {
    includeInAnalytics: 0,
    properties: {
      company_id: company.id,
      company_domain: company.properties.domain,
      company_industry: company.properties.industry,
    },
  };

  const isCreated =
    !lastPulledDate || new Date(company.createdAt) > lastPulledDate;

  logger.info(
    `Getting Company data for ${company.id}. isCreated: ${isCreated}`
  );

  qu.push({
    actionName: isCreated ? "Company Created" : "Company Updated",
    actionDate:
      new Date(isCreated ? company.createdAt : company.updatedAt) - 2000,
    ...actionTemplate,
  });
};

const getCompanies = async (lastPulledDate, now, offsetObject, limit) => {
  const lastModifiedDate = offsetObject.lastModifiedDate || lastPulledDate;
  const lastModifiedDateFilter = generateLastModifiedDateFilter(
    lastModifiedDate,
    now
  );
  const searchObject = {
    filterGroups: [lastModifiedDateFilter],
    sorts: [{ propertyName: "hs_lastmodifieddate", direction: "ASCENDING" }],
    properties: [
      "name",
      "domain",
      "country",
      "industry",
      "description",
      "annualrevenue",
      "numberofemployees",
      "hs_lead_status",
    ],
    limit,
    after: offsetObject.after,
  };

  let searchResult = {};

  let tryCount = 0;
  while (tryCount <= 4) {
    try {
      searchResult = await hubspotClient.crm.companies.searchApi.doSearch(
        searchObject
      );
      break;
    } catch (err) {
      logger.error("Failed to fetch companies", {
        error: err.message,
        searchObject,
        tryCount,
      });

      tryCount++;

      await checkAndRefreshToken(domain, hubId);

      logger.debug(`retrying...[${tryCount}]`);
      await delay(5000 * Math.pow(2, tryCount));
    }
  }

  if (!searchResult) {
    logger.error("Failed to fetch companies for the 4th time. Aborting.");
    throw new Error("Failed to fetch companies for the 4th time. Aborting.");
  }

  return searchResult;
};

/**
 * Get recently modified companies as 100 companies per page
 */
const processCompanies = async (domain, hubId, qu) => {
  logger.info("Processing companies for domain", domain._id);
  const account = domain.integrations.hubspot.accounts.find(
    (account) => account.hubId === hubId
  );
  const lastPulledDate = new Date(account.lastPulledDates.companies);
  const now = new Date();

  let hasMore = true;
  const offsetObject = {};
  const limit = 100;

  while (hasMore) {
    const searchResult = await getCompanies(
      lastPulledDate,
      now,
      offsetObject,
      limit
    );
    const data = searchResult?.results || [];
    offsetObject.after = parseInt(searchResult?.paging?.next?.after);

    logger.info("fetch company batch", {
      count: data.length,
      after: offsetObject.after,
    });

    // check if can be processed in batch
    data.forEach((company) => {
      processCompanyRecord(company, lastPulledDate, qu);
    });

    if (!offsetObject?.after) {
      hasMore = false;
      break;
    } else if (offsetObject?.after >= 9900) {
      offsetObject.after = 0;
      offsetObject.lastModifiedDate = new Date(
        data[data.length - 1].updatedAt
      ).valueOf();
    }
  }

  account.lastPulledDates.companies = now;

  // update the domain with the new lastPulledDates
  logger.info(`Updating domain with new lastPulledDates: ${domain._id}`);
  await DomainService.saveDomain(domain);

  return true;
};

const CompanyService = {
  processCompanies,
};

module.exports = CompanyService;
