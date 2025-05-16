const DomainService = require("./domains");
const { getHubspotClient, checkAndRefreshToken } = require("./hubspot");

const logger = require("../utils/logger");
const { filterNullValuesFromObject, delay } = require("../utils/common");
const NodeCache = require("node-cache");

const cache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });

const hubspotClient = getHubspotClient();

const generateLastModifiedDateFilter = (
  date,
  nowDate,
  propertyName = "hs_lastmodifieddate"
) => {
  console.log("date", date);
  console.log("nowDate", nowDate);
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

const getCompanyAssociations = async (contactIds) => {
  // contact to company association
  const contactsToAssociate = contactIds;
  const companyAssociationsResults =
    (
      await (
        await hubspotClient.apiRequest({
          method: "post",
          path: "/crm/v3/associations/CONTACTS/COMPANIES/batch/read",
          body: {
            inputs: contactsToAssociate.map((contactId) => ({
              id: contactId,
            })),
          },
        })
      ).json()
    )?.results || [];

  const companyAssociations = {};

  // Process each association result
  for (const association of companyAssociationsResults) {
    logger.debug("companyassociation", { association });
    if (association.from) {
      const contactId = association.from.id;
      const companyId = association.to[0]?.id;

      // Remove the contact from the list of contacts to associate
      const contactIndex = contactsToAssociate.indexOf(contactId);
      if (contactIndex !== -1) {
        contactsToAssociate.splice(contactIndex, 1);
      }

      // Store the contact-to-company mapping
      if (companyId) {
        companyAssociations[contactId] = companyId;
      }
    }
  }

  return { companyAssociations, contactsToAssociate };
};

const getContactDetails = async (contactId) => {
  try {
    // cache response or use database
    const cachedContact = cache.get(contactId);
    if (cachedContact) {
      return cachedContact;
    }

    const contact = await hubspotClient.crm.contacts.basicApi.getById(
      contactId,
      [
        "firstname",
        "lastname",
        "email",
        "jobtitle",
        "hs_analytics_source",
        "hs_lead_status",
        "hubspotscore",
      ]
    );

    const contactDetails = {
      id: contactId,
      email: contact.properties.email,
      contact_name: (
        (contact.properties.firstname || "") +
        " " +
        (contact.properties.lastname || "")
      ).trim(),
      contact_title: contact.properties.jobtitle,
      contact_source: contact.properties.hs_analytics_source,
      contact_status: contact.properties.hs_lead_status,
      contact_score: parseInt(contact.properties.hubspotscore) || 0,
    };

    cache.set(contactId, contactDetails);

    return contactDetails;
  } catch (err) {
    logger.error(`Failed to fetch contact ${contactId}`, {
      error: err.message,
    });
    return null;
  }
};

const getContactDetailsInBatch = async (contactIds) => {
  try {
    const contactDetails = await hubspotClient.crm.contacts.batchApi.read(
      contactIds,
      [
        "firstname",
        "lastname",
        "email",
        "jobtitle",
        "hs_analytics_source",
        "hs_lead_status",
        "hubspotscore",
      ]
    );

    contactDetails.forEach((contact) => {
      cache.set(contact.id, contact);
    });

    return contactDetails;
  } catch (err) {
    logger.error(`Failed to fetch contact details in batch`, {
      error: err.message,
    });
    return null;
  }
};

/**
 * Get recently modified contacts as 100 contacts per page
 */
const processContacts = async (domain, hubId, qu) => {
  logger.info("processing contacts", { domain: domain._id, hubId });
  const account = domain.integrations.hubspot.accounts.find(
    (account) => account.hubId === hubId
  );
  const lastPulledDate = new Date(account.lastPulledDates.contacts);
  const now = new Date();

  let hasMore = true;
  const offsetObject = {};
  const limit = 100;

  while (hasMore) {
    const lastModifiedDate = offsetObject.lastModifiedDate || lastPulledDate;
    const lastModifiedDateFilter = generateLastModifiedDateFilter(
      lastModifiedDate,
      now,
      "lastmodifieddate"
    );
    const searchObject = {
      filterGroups: [lastModifiedDateFilter],
      sorts: [{ propertyName: "lastmodifieddate", direction: "ASCENDING" }],
      properties: [
        "firstname",
        "lastname",
        "jobtitle",
        "email",
        "hubspotscore",
        "hs_lead_status",
        "hs_analytics_source",
        "hs_latest_source",
      ],
      limit,
      after: offsetObject.after,
    };

    let searchResult = {};

    let tryCount = 0;
    while (tryCount <= 4) {
      try {
        searchResult = await hubspotClient.crm.contacts.searchApi.doSearch(
          searchObject
        );
        break;
      } catch (err) {
        logger.error("Failed to fetch contacts", {
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
      logger.error("Failed to fetch contacts for the 4th time. Aborting.");
      throw new Error("Failed to fetch contacts for the 4th time. Aborting.");
    }

    const data = searchResult.results || [];
    offsetObject.after = parseInt(searchResult.paging?.next?.after);

    logger.debug("fetched contact batch", {
      count: data.length,
      after: offsetObject.after,
    });

    const contactIds = data.map((contact) => contact.id);

    const { companyAssociations, contactsToAssociate } =
      await getCompanyAssociations(contactIds);

    data.forEach((contact) => {
      if (!contact.properties || !contact.properties.email) return;

      const companyId = companyAssociations[contact.id];

      const isCreated = new Date(contact.createdAt) > lastPulledDate;

      const userProperties = {
        company_id: companyId,
        contact_name: (
          (contact.properties.firstname || "") +
          " " +
          (contact.properties.lastname || "")
        ).trim(),
        contact_title: contact.properties.jobtitle,
        contact_source: contact.properties.hs_analytics_source,
        contact_status: contact.properties.hs_lead_status,
        contact_score: parseInt(contact.properties.hubspotscore) || 0,
      };

      const actionTemplate = {
        includeInAnalytics: 0,
        identity: contact.properties.email,
        properties: filterNullValuesFromObject(userProperties),
      };

      logger.info("processing contact info", contact.id);

      qu.push({
        actionName: isCreated ? "Contact Created" : "Contact Updated",
        actionDate: new Date(isCreated ? contact.createdAt : contact.updatedAt),
        ...actionTemplate,
      });
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

  account.lastPulledDates.contacts = now;
  await DomainService.saveDomain(domain);

  return true;
};

const ContactService = {
  processContacts,
  getContactDetails,
  getContactDetailsInBatch,
};

module.exports = ContactService;
