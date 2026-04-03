'use strict';

const DRIVE_FILE_NAME = 'tcg-tracker-state.json';
const DRIVE_SPACE = 'appDataFolder';

/**
 * Loads tracker state from Google Drive.
 * Returns an empty object if no state file exists yet.
 *
 * @param {string} accessToken - Google OAuth access token
 * @param {{ fileId: string | null }} cache - Mutable object that caches the Drive file ID
 * @returns {Promise<Object>} TrackerState
 */
async function loadStateFromDrive(accessToken, cache) {
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?spaces=${DRIVE_SPACE}&q=name%3D'${DRIVE_FILE_NAME}'&fields=files(id)`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!searchRes.ok) throw new Error(`Drive search failed: ${searchRes.status}`);

  const { files } = await searchRes.json();
  if (!files || files.length === 0) return {};

  const fileId = files[0].id;
  if (cache) cache.fileId = fileId;

  const contentRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!contentRes.ok) throw new Error(`Drive read failed: ${contentRes.status}`);
  return await contentRes.json();
}

/**
 * Saves tracker state to Google Drive (creates or updates the state file).
 *
 * @param {Object} state - TrackerState
 * @param {string} accessToken - Google OAuth access token
 * @param {{ fileId: string | null }} cache - Mutable object caching the Drive file ID
 * @returns {Promise<void>}
 */
async function saveStateToDrive(state, accessToken, cache) {
  const body = JSON.stringify(state);

  if (cache && cache.fileId) {
    const res = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${cache.fileId}?uploadType=media`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body,
      }
    );
    if (!res.ok) throw new Error(`Drive update failed: ${res.status}`);
  } else {
    const metadata = { name: DRIVE_FILE_NAME, parents: [DRIVE_SPACE] };
    const form = new FormData();
    form.append(
      'metadata',
      new Blob([JSON.stringify(metadata)], { type: 'application/json' })
    );
    form.append('file', new Blob([body], { type: 'application/json' }));

    const res = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
      }
    );
    if (!res.ok) throw new Error(`Drive create failed: ${res.status}`);
    const { id } = await res.json();
    if (cache) cache.fileId = id;
  }
}

module.exports = {
  loadStateFromDrive,
  saveStateToDrive,
  DRIVE_FILE_NAME,
  DRIVE_SPACE,
};
