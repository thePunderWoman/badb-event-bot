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
const COLUMNS = {
  TITLE: 2,
  START_DATE: 3, // a Date-type question, or plain text you parse below
  START_TIME: 4,
  LOCATION: 5,
  DESCRIPTION: 6,
  REQUESTER_NAME: 7,
  REQUESTER_EMAIL: 8,
};

function onFormSubmit(e) {
  const row = e.values; // array of the submitted answers, in column order
  const responseUrl = e.range.getSheet().getParent().getUrl() + "#gid=" + e.range.getSheet().getSheetId();

  // Combine date + time columns into a single ISO string. Adjust parsing
  // here if your form captures date/time differently (e.g. one combined
  // "Date and time" question instead of two separate ones).
  const startIso = new Date(`${row[COLUMNS.START_DATE - 1]} ${row[COLUMNS.START_TIME - 1]}`).toISOString();

  const payload = {
    title: row[COLUMNS.TITLE - 1],
    startIso: startIso,
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
