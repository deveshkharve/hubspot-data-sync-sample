const { getHubspotClient, checkAndRefreshToken } = require("./hubspot");
const DomainService = require("./domains");
const logger = require("../utils/logger");
const { delay, filterNullValuesFromObject } = require("../utils/common");
const { getContactDetails } = require("./contacts");
const { rateLimited } = require("../utils/rate-limiter");

const hubspotClient = getHubspotClient();

/**
 * Generate the last modified date filter
 */
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

/**
 * Get associated contacts for a meeting. This is a rate limited function.
 */
const getAssociatedContacts = async (meetingId) => {
  try {
    const getAllLimited = rateLimited(
      hubspotClient.crm.objects.associationsApi.getAll.bind(
        hubspotClient.crm.objects.associationsApi
      )
    );

    const response = await getAllLimited("meetings", meetingId, "contacts");
    return response.results.map((assoc) => assoc.id);
  } catch (err) {
    logger.error(`Failed to get associated contacts for meeting ${meetingId}`, {
      error: err.message,
    });
    return [];
  }
};

/**
 * Prepare the meeting action object
 */
const prepareMeetingActionObject = (meetingDetails, contactDetailsList) => {
  return {
    meeting_id: meetingDetails.id,
    meeting_title: meetingDetails.properties.hs_meeting_title,
    meeting_description: meetingDetails.properties.hs_meeting_body,
    hs_meeting_outcome: meetingDetails.properties.hs_meeting_outcome,
    meeting_notes: meetingDetails.properties.hs_internal_meeting_notes,
    meeting_start_time: meetingDetails.properties.hs_meeting_start_time,
    meeting_end_time: meetingDetails.properties.hs_meeting_end_time,
    contact_details: contactDetailsList,
  };
};

/**
 * Process a meeting record
 */
const processMeetingRecord = async (meetingDetails, lastPulledDate, qu) => {
  if (!meetingDetails.properties) return;

  const isCreated = new Date(meetingDetails.createdAt) > lastPulledDate;
  logger.debug("Processing meeting", {
    meetingId: meetingDetails.id,
    isCreated,
  });

  if (!meetingDetails) return;

  // TODO: figure out if batch API is available
  const contactIds = await getAssociatedContacts(meetingDetails.id);
  const contactDetailsList = [];

  for (const contactId of contactIds) {
    const contactDetails = await getContactDetails(contactId);
    logger.debug("Fetched contactProps for:", {
      meetingId: meetingDetails.id,
      contactId,
      contactDetails,
    });
    if (contactDetails) {
      contactDetailsList.push(contactDetails);
    }
  }

  logger.debug("Meeting & contacts processed", {
    meetingId: meetingDetails.id,
    contacts: contactDetailsList.length,
  });

  const meetingProperties = prepareMeetingActionObject(
    meetingDetails,
    contactDetailsList
  );

  const actionTemplate = {
    includeInAnalytics: 0,
    identity: `${meetingDetails.id}`,
    properties: filterNullValuesFromObject(meetingProperties),
  };

  try {
    qu.push({
      actionName: isCreated ? "Meeting Created" : "Meeting Updated",
      actionDate: new Date(
        isCreated ? meetingDetails.createdAt : meetingDetails.updatedAt
      ),
      ...actionTemplate,
    });
  } catch (err) {
    logger.error("error queuing action>>>", err);
  }
};

/**
 * Get meetings with last modified date filter
 */
const getMeetings = async (lastPulledDate, now, offsetObject, limit) => {
  const lastModifiedDate = offsetObject.lastModifiedDate || lastPulledDate;
  const lastModifiedDateFilter = generateLastModifiedDateFilter(
    lastModifiedDate,
    now
  );
  const searchObject = {
    filterGroups: [lastModifiedDateFilter],
    sorts: [{ propertyName: "hs_lastmodifieddate", direction: "ASCENDING" }],
    properties: [
      "hs_timestamp",
      "hubspot_owner_id",
      "hs_meeting_title",
      "hs_meeting_body",
      "hs_internal_meeting_notes",
      "hs_meeting_external_url",
      "hs_meeting_location",
      "hs_meeting_start_time",
      "hs_meeting_end_time",
      "hs_meeting_outcome",
    ],
    limit,
    after: offsetObject.after,
  };

  let searchResult = {};

  let tryCount = 0;
  while (tryCount <= 4) {
    try {
      searchResult =
        await hubspotClient.crm.objects.meetings.searchApi.doSearch(
          searchObject
        );
      break;
    } catch (err) {
      logger.error("Failed to fetch meetings", {
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
    logger.error("Failed to fetch meetings for the 4th time. Aborting.");
    throw new Error("Failed to fetch meetings for the 4th time. Aborting.");
  }

  return searchResult;
};

/**
 * Process meetings results data in batches
 */
const processMeetingsDataInBatch = async (
  meetings,
  lastPulledDate,
  qu,
  batchSize = 10
) => {
  const totalBatches = Math.ceil(meetings.length / batchSize);

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const start = batchIndex * batchSize;
    const batch = meetings.slice(start, start + batchSize);

    await Promise.all(
      batch.map((meetingData) =>
        processMeetingRecord(meetingData, lastPulledDate, qu)
      )
    );

    logger.debug(
      `Processed batch ${batchIndex + 1}/${totalBatches} (${
        batch.length
      } meetings)`
    );
  }
};

/**
 * Fetch and process meetings
 */
const processMeetings = async (domain, hubId, qu) => {
  logger.info("Processing meetings for domain", domain._id);
  const account = domain.integrations.hubspot.accounts.find(
    (account) => account.hubId === hubId
  );

  const lastPulledDate = new Date(account.lastPulledDates.meetings);
  const now = new Date();

  let hasMore = true;
  const offsetObject = {};
  const limit = 100;

  while (hasMore) {
    // get meeting data with cursor
    const searchResult = await getMeetings(
      lastPulledDate,
      now,
      offsetObject,
      limit
    );

    const data = searchResult?.results || [];
    offsetObject.after = parseInt(searchResult?.paging?.next?.after);

    logger.info("fetched meetings batch", {
      count: data.length,
      after: offsetObject.after,
    });

    // Process each meeting data in batch
    await processMeetingsDataInBatch(data, lastPulledDate, qu, 10);

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

  account.lastPulledDates.meetings = now;

  // update the domain with the new lastPulledDates
  logger.info(`Updating domain with new lastPulledDates: ${domain._id}`);
  await DomainService.saveDomain(domain);

  return true;
};

const MeetingService = {
  processMeetings,
};

module.exports = MeetingService;
