/**
 * BTP ANS (Alert Notification Service) integration.
 * In production: bind ANS service instance and set ANS_* env vars.
 * In local dev: notifications are logged to console and stored in DB only.
 */
const axios = require('axios');

const ANS_URL      = process.env.ANS_URL;
const ANS_CLIENT   = process.env.ANS_CLIENT_ID;
const ANS_SECRET   = process.env.ANS_CLIENT_SECRET;
const ANS_TOKEN_URL= process.env.ANS_TOKEN_URL;

let _ansToken = null;
let _tokenExpiry = 0;

async function getAnsToken() {
  if (_ansToken && Date.now() < _tokenExpiry) return _ansToken;
  if (!ANS_TOKEN_URL || !ANS_CLIENT || !ANS_SECRET) return null;
  try {
    const res = await axios.post(`${ANS_TOKEN_URL}/oauth/token`, null, {
      params: { grant_type: 'client_credentials' },
      auth: { username: ANS_CLIENT, password: ANS_SECRET }
    });
    _ansToken   = res.data.access_token;
    _tokenExpiry = Date.now() + (res.data.expires_in - 60) * 1000;
    return _ansToken;
  } catch (e) {
    console.warn('[ANS] Token fetch failed:', e.message);
    return null;
  }
}

async function send(srv, bidRequestId, eventType, recipient, subject, body) {
  const { BidNotifications } = srv.entities;

  // Always persist notification record first
  const notifId = require('@sap/cds').utils.uuid();
  await INSERT.into(BidNotifications).entries({
    ID: notifId,
    bidRequest_ID: bidRequestId,
    eventType,
    recipient,
    subject,
    body,
    sentAt: new Date().toISOString(),
    status: 'pending'
  });

  // Try ANS delivery if configured
  const token = await getAnsToken();
  if (token && ANS_URL) {
    try {
      await axios.post(`${ANS_URL}/cf/producer/v1/resource-events`, {
        body: {
          region: process.env.ANS_REGION || 'eu10',
          resourceType: 'BidPilot',
          resourceName: subject,
          resourceInstance: bidRequestId,
          eventType,
          severity: 'INFO',
          category: 'NOTIFICATION',
          subject,
          body,
          tags: { recipient }
        }
      }, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
      });

      await UPDATE(BidNotifications).set({ status: 'sent' }).where({ ID: notifId });
      console.log(`[ANS] Sent: ${eventType} → ${recipient}`);
    } catch (e) {
      await UPDATE(BidNotifications).set({ status: 'failed' }).where({ ID: notifId });
      console.warn(`[ANS] Delivery failed for ${eventType}:`, e.message);
    }
  } else {
    // Dev mode — just log
    console.log(`[NOTIFY] ${eventType} → ${recipient}: ${subject}`);
    await UPDATE(BidNotifications).set({ status: 'sent' }).where({ ID: notifId });
  }
}

module.exports = { send };
