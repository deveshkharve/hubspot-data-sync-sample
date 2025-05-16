const { getHubspotClient, checkAndRefreshToken } = require("./hubspot");
const DomainService = require("./domains");
const logger = require("../utils/logger");
const { delay, filterNullValuesFromObject } = require("../utils/common");
const { getContactDetails } = require("./contacts");

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
 * Get associated contacts for a meeting
 */
const getAssociatedContacts = async (meetingId) => {
  try {
    const response = await hubspotClient.crm.objects.associationsApi.getAll(
      "meetings",
      meetingId,
      "contacts"
    );
    return response.results.map((assoc) => assoc.id);
  } catch (err) {
    logger.error(`Failed to get associated contacts for meeting ${meetingId}`, {
      error: err.message,
    });
    return [];
  }
};

/**
 * Get meeting details
 */
const getMeetingDetails = async (meetingId) => {
  logger.info(`Getting meeting details for ${meetingId}`);
  try {
    const response = await hubspotClient.apiRequest({
      method: "get",
      path: `/crm/v3/objects/meetings/${meetingId}`,
    });

    const data = await response.json();
    logger.debug("meeting data", data);
    return data;
  } catch (error) {
    logger.error(`Failed to get meeting details for ${meetingId}`, {
      error: error.message,
    });
    return null;
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

const processMeetingRecord = async (meetingData, lastPulledDate, qu) => {
  if (!meetingData.properties) return;

  const isCreated = new Date(meetingData.createdAt) > lastPulledDate;
  logger.debug("Processing meeting", {
    meetingId: meetingData.id,
    isCreated,
  });

  const meetingDetails = await getMeetingDetails(meetingData.id);
  //   console.log("meetingData>>>", meetingData);
  if (!meetingData) return;

  const contactIds = await getAssociatedContacts(meetingData.id);
  const contactDetailsList = [];
  //   console.log("contactIds>>>", contactIds);

  for (const contactId of contactIds) {
    const contactDetails = await getContactDetails(contactId);
    logger.debug("Fetched contactProps for:", {
      meetingId: meetingData.id,
      contactId,
      contactDetails,
    });
    if (contactDetails) {
      contactDetailsList.push(contactDetails);
    }
  }

  logger.debug("Meeting & contacts processed", {
    meetingId: meetingData.id,
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
    qu.push(
      {
        actionName: isCreated ? "Meeting Created" : "Meeting Updated",
        actionDate: new Date(
          isCreated ? meetingData.createdAt : meetingData.updatedAt
        ),
        ...actionTemplate,
      },
      (err) => {
        if (err) {
          console.error("Meeting Queue action failed", err);
        } else {
          console.log("Meeting Action completed");
        }
      }
    );
  } catch (err) {
    logger.error("error queuing action>>>", err);
  }
};

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

    const data = searchResult?.results || [];
    offsetObject.after = parseInt(searchResult?.paging?.next?.after);

    logger.info("fetched meetings batch", {
      count: data.length,
      after: offsetObject.after,
    });

    // process meetings data

    // Process each meeting sequentially to avoid async issues in forEach
    const batchSize = 10; // Adjust batch size as needed
    for (let i = 0; i < data.length; i += batchSize) {
      const batch = data.slice(i, i + batchSize);
      await Promise.all(
        batch.map((meetingData) =>
          processMeetingRecord(meetingData, lastPulledDate, qu)
        )
      );
      logger.debug(`Processed batch of ${batch.length} meetings`);
    }

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
