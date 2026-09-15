/**
 * Bound to the Google Sheet that collects form responses.
 * Extensions > Apps Script (in the Sheet, not the Form) > paste this in,
 * then Triggers (clock icon) > Add Trigger > onFormSubmit > From spreadsheet > On form submit.
 *
 * Update the COLUMN constants below to match your actual form's question
 * order (1-indexed, matching the columns in the response Sheet).
 */

const FORM_SUBMIT_URL = "https://YOUR-REGION-YOUR-PROJECT.cloudfunctions.net/badb-form-submit";
const SHARED_SECRET = "PUT_THE_SAME_VALUE_HERE_AS_FORM_SHARED_SECRET_ENV_VAR";

// 1-indexed column numbers in the response sheet. Adjust to match your form.
// Column 1 is always the Forms-added "Timestamp" column.
const COLUMNS = {
  REQUESTER_NAME: 2,
  REQUESTER_EMAIL: 3,
  EVENT_TYPE: 4,
  TITLE: 5,
  LOCATION: 6,
  EVENT_DATE: 7, // Date-type question (M/D/Y)
  ARRIVAL_TIME: 8, // Time-type question
  START_TIME: 9, // Time-type question
  END_TIME: 10, // Time-type question
  DESCRIPTION: 11,
};

// Combines the shared event-date column with a time column into a single
// ISO string. Adjust parsing here if your form captures date/time
// differently (e.g. one combined "Date and time" question).
function toIso(dateStr, timeStr) {
  return new Date(`${dateStr} ${timeStr}`).toISOString();
}

function onFormSubmit(e) {
  const row = e.values; // array of the submitted answers, in column order
  const responseUrl = e.range.getSheet().getParent().getUrl() + "#gid=" + e.range.getSheet().getSheetId();

  const eventDate = row[COLUMNS.EVENT_DATE - 1];

  const payload = {
    title: row[COLUMNS.TITLE - 1],
    eventType: row[COLUMNS.EVENT_TYPE - 1],
    startIso: toIso(eventDate, row[COLUMNS.START_TIME - 1]),
    endIso: toIso(eventDate, row[COLUMNS.END_TIME - 1]),
    arrivalIso: toIso(eventDate, row[COLUMNS.ARRIVAL_TIME - 1]),
    location: row[COLUMNS.LOCATION - 1],
    description: row[COLUMNS.DESCRIPTION - 1],
    requesterName: row[COLUMNS.REQUESTER_NAME - 1],
    requesterEmail: row[COLUMNS.REQUESTER_EMAIL - 1],
    formResponseUrl: responseUrl,
  };

  UrlFetchApp.fetch(FORM_SUBMIT_URL, {
    method: "post",
    contentType: "application/json",
    headers: { "x-form-secret": SHARED_SECRET },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
}
