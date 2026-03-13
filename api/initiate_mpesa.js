const axios = require('axios');
const admin = require('firebase-admin');

// Prevent Vercel from initializing Firebase multiple times on cold starts
if (!admin.apps.length) {
  admin.initializeApp({
    // We will store the Firebase JSON as an environment variable in Vercel
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
  });
}
const db = admin.firestore();

export default async function handler(req, res) {
  // --- CORS HEADERS ADDED HERE ---
  // These headers allow your local Flutter app to talk to the live Vercel server
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*'); // Allows requests from any origin (including localhost)
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // Handle the "pre-flight" OPTIONS request that Chrome sends before a POST request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  // -------------------------------

  // Only allow POST requests
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const { phone, amount = 1 } = req.body;
  const shortcode = "174379"; // Sandbox shortcode
  const passkey = process.env.MPESA_PASSKEY;
  const consumerKey = process.env.MPESA_CONSUMER_KEY;
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET;

  try {
    // 1. Generate Access Token
    const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
    const tokenRes = await axios.get("https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials", {
      headers: { Authorization: `Basic ${auth}` }
    });
    const token = tokenRes.data.access_token;

    // 2. Generate Password and Timestamp
    // Formats date as YYYYMMDDHHMMSS
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');

    // 3. Initiate STK Push
    const stkRes = await axios.post("https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest", {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: amount,
      PartyA: phone,
      PartyB: shortcode,
      PhoneNumber: phone,
      // Vercel automatically provides VERCEL_URL so the webhook routes back to itself
      CallBackURL: `https://${process.env.VERCEL_URL}/api/mpesa_webhook`, 
      AccountReference: "datatricks@telmed.co.ke",
      TransactionDesc: "Consultation Booking"
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });

    const checkoutRequestId = stkRes.data.CheckoutRequestID;

    // 4. Save to Firebase so Flutter can listen
    if (checkoutRequestId) {
       await db.collection("payments").doc(checkoutRequestId).set({
           phone: phone,
           status: "pending"
       });
    }

    res.status(200).json({ status: "success", checkoutRequestID: checkoutRequestId });
  } catch (error) {
    console.error(error.response ? error.response.data : error.message);
    res.status(500).json({ error: "Failed to initiate M-Pesa" });
  }
}