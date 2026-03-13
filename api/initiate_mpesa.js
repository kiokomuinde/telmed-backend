const axios = require('axios');
const admin = require('firebase-admin');

// Helper function to force CORS headers no matter what happens
const setCorsHeaders = (res) => {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*'); 
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );
};

module.exports = async (req, res) => {
  // 1. ALWAYS set CORS headers first so the browser doesn't block errors
  setCorsHeaders(res);

  // 2. Handle the Chrome Pre-flight request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 3. Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // 4. SAFELY Initialize Firebase (This is where it usually crashes)
  try {
    if (!admin.apps.length) {
      if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
         throw new Error("FIREBASE_SERVICE_ACCOUNT environment variable is missing.");
      }
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
    }
  } catch (initError) {
    console.error("🔥 FATAL FIREBASE INIT ERROR:", initError.message);
    // Returning 500 so Flutter actually sees the error instead of a CORS block
    return res.status(500).json({ error: "Server Configuration Error: " + initError.message });
  }

  const db = admin.firestore();
  const { phone, amount = 1 } = req.body;
  const shortcode = "174379"; 
  const passkey = process.env.MPESA_PASSKEY;
  const consumerKey = process.env.MPESA_CONSUMER_KEY;
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET;

  try {
    // Generate Access Token
    const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
    const tokenRes = await axios.get("https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials", {
      headers: { Authorization: `Basic ${auth}` }
    });
    const token = tokenRes.data.access_token;

    // Generate Password and Timestamp
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');

    // Initiate STK Push
    const stkRes = await axios.post("https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest", {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: amount,
      PartyA: phone,
      PartyB: shortcode,
      PhoneNumber: phone,
      // 🚨 HARDCODED CALLBACK URL TO PREVENT SAFARICOM ROUTING ERRORS 🚨
      CallBackURL: "https://telmed-backend.vercel.app/api/mpesa_webhook", 
      AccountReference: "datatricks@telmed.co.ke", // Ensured correct business entity
      TransactionDesc: "Consultation Booking"
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });

    const checkoutRequestId = stkRes.data.CheckoutRequestID;

    // Save to Firebase
    if (checkoutRequestId) {
       await db.collection("payments").doc(checkoutRequestId).set({
           phone: phone,
           status: "pending"
       });
    }

    return res.status(200).json({ status: "success", checkoutRequestID: checkoutRequestId });
  } catch (error) {
    console.error("💳 M-PESA API ERROR:", error.response ? error.response.data : error.message);
    return res.status(500).json({ 
      error: "Failed to initiate M-Pesa", 
      details: error.response ? error.response.data : error.message 
    });
  }
};