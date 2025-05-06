const { google } = require('googleapis');
const fs = require('fs');

// Google Drive Setup
const KEYFILE_PATH = './credentials.json'; // Path to your credentials.json file
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

const auth = new google.auth.GoogleAuth({
  keyFile: KEYFILE_PATH,
  scopes: SCOPES,
});

const drive = google.drive({ version: 'v3', auth });

// Helper function to create a folder in Google Drive
async function createFolder(folderName, parentFolderId = null) {
  const fileMetadata = {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder',
    parents: parentFolderId ? [parentFolderId] : [],
  };

  const response = await drive.files.create({
    resource: fileMetadata,
    fields: 'id',
  });

  console.log(`Folder "${folderName}" created with ID: ${response.data.id}`);
  return response.data.id;
}

// Helper function to upload a file to Google Drive
async function uploadFile(filePath, fileName, mimeType, parentFolderId) {
  const fileMetadata = {
    name: fileName,
    parents: [parentFolderId],
  };
  const media = {
    mimeType: mimeType,
    body: fs.createReadStream(filePath),
  };

  const response = await drive.files.create({
    resource: fileMetadata,
    media: media,
    fields: 'id',
  });

  console.log(`File "${fileName}" uploaded to Google Drive with ID: ${response.data.id}`);
  return response.data.id;
}

// Add this function to help diagnose service account issues
async function logServiceAccountInfo() {
  try {
    // Get the service account email from credentials
    const auth = drive.context.options.auth;
    if (auth && auth.email) {
      console.log('Service account email:', auth.email);
      return auth.email;
    } else if (auth && auth.credentials && auth.credentials.client_email) {
      console.log('Service account email:', auth.credentials.client_email);
      return auth.credentials.client_email;
    } else {
      console.log('Could not determine service account email from auth object');
      console.log('Auth object structure:', JSON.stringify(Object.keys(auth || {})));
      return null;
    }
  } catch (error) {
    console.error('Error retrieving service account info:', error);
    return null;
  }
}

module.exports = {
  drive,           // Add this line to export the drive object
  createFolder,
  uploadFile,
  logServiceAccountInfo
};