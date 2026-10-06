// Push notifications to every device a user has registered.
//
// Tokens live in `user_tokens.expoPushToken` (column name kept from the RN
// app). Two kinds are stored there:
//   - "ExponentPushToken[...]" from the old React Native/Expo app → Expo push API
//   - Firebase (FCM) tokens from the Flutter app → firebase-admin
//
// Firebase credentials (same Firebase project as the app, notification-1fa7e):
//   FIREBASE_SERVICE_ACCOUNT_JSON  — the key JSON as one env var (for Vercel), or
//   FIREBASE_SERVICE_ACCOUNT_PATH  — path to the key file
//   default: config/firebase-service-account.json
//
// sendPushToUser never throws: a failed notification must not fail the
// booking / chat request that triggered it.

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const admin = require("firebase-admin");
const db = require("../config/db");

// Must match the channel the Flutter app creates (PushNotificationService).
const ANDROID_CHANNEL_ID = "carlust_default_channel";

let firebaseReady = null; // null = not tried yet
const initFirebase = () => {
  if (firebaseReady !== null) return firebaseReady;
  try {
    let serviceAccount;
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    } else {
      const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
        || path.join(__dirname, "../config/firebase-service-account.json");
      serviceAccount = JSON.parse(fs.readFileSync(keyPath, "utf8"));
    }
    if (!admin.apps.length) {
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    }
    firebaseReady = true;
  } catch (err) {
    console.error("⚠️ Firebase Admin not configured — FCM push disabled:", err.message);
    firebaseReady = false;
  }
  return firebaseReady;
};

const isExpoToken = (t) => typeof t === "string" && t.startsWith("ExponentPushToken");

// FCM data values must be strings.
const stringifyData = (data = {}) =>
  Object.fromEntries(Object.entries(data).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]));

const sendExpo = async (tokens, { title, body, data }) => {
  if (!tokens.length) return;
  try {
    await axios.post(
      "https://exp.host/--/api/v2/push/send",
      tokens.map((to) => ({ to, sound: "default", title, body, data })),
      { headers: { Accept: "application/json", "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Expo push failed:", err.response?.data || err.message);
  }
};

const sendFcm = async (tokens, { title, body, data }) => {
  if (!tokens.length || !initFirebase()) return;
  try {
    const result = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title, body },
      data: stringifyData(data),
      android: { priority: "high", notification: { channelId: ANDROID_CHANNEL_ID, sound: "default" } },
      apns: { payload: { aps: { sound: "default" } } },
    });

    // Drop tokens Firebase says are dead (app uninstalled / token rotated).
    const dead = [];
    result.responses.forEach((r, i) => {
      const code = r.error?.code;
      if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") {
        dead.push(tokens[i]);
      } else if (r.error) {
        console.error("FCM push error:", code, r.error.message);
      }
    });
    if (dead.length) {
      await db.query(`DELETE FROM user_tokens WHERE expoPushToken IN (${dead.map(() => "?").join(",")})`, dead);
    }
  } catch (err) {
    console.error("FCM push failed:", err.message);
  }
};

/**
 * @param {string} userId  receiver
 * @param {{title: string, body: string, data?: object}} payload
 */
const sendPushToUser = async (userId, payload) => {
  try {
    if (!userId) return;
    const [rows] = await db.query("SELECT DISTINCT expoPushToken FROM user_tokens WHERE userId = ?", [userId]);
    const tokens = rows.map((r) => r.expoPushToken).filter(Boolean);
    if (!tokens.length) {
      console.log(`🔕 No push token for user ${userId} — "${payload.title}" not sent`);
      return;
    }
    await Promise.all([
      sendExpo(tokens.filter(isExpoToken), payload),
      sendFcm(tokens.filter((t) => !isExpoToken(t)), payload),
    ]);
    console.log(`🔔 Push "${payload.title}" sent to user ${userId} (${tokens.length} device(s))`);
  } catch (err) {
    console.error("sendPushToUser failed:", err.message);
  }
};

module.exports = { sendPushToUser, isExpoToken };
