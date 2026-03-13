const admin = require('firebase-admin');

module.exports = async (req, res) => {
  // Safaricom Daraja only sends POST requests
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  // 1. Log the exact receipt Safaricom sends us so we can trace it in Vercel Logs
  console.log("🔔 SAFARICOM WEBHOOK RECEIVED:", JSON.stringify(req.body));

  try {
    // 2. Initialize Firebase securely (Crash-Proof)
    if (!admin.apps.length) {
      if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
         throw new Error("FIREBASE_SERVICE_ACCOUNT environment variable is missing.");
      }
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
    }
    const db = admin.firestore();

    // 3. Parse the Safaricom Payload
    const stkCallback = req.body?.Body?.stkCallback;
    
    if (!stkCallback) {
        console.error("❌ Invalid Payload from Safaricom");
        return res.status(400).send("Invalid Payload");
    }

    const checkoutRequestId = stkCallback.CheckoutRequestID;
    const resultCode = stkCallback.ResultCode; // 0 means the user entered the correct PIN
    
    console.log(`⚙️ Processing Payment ID: ${checkoutRequestId} | ResultCode: ${resultCode}`);

    // 4. Update your Firebase Database
    if (checkoutRequestId) {
      // If resultCode is 0, the payment worked. Anything else (like 1032) means they canceled/failed.
      const status = resultCode === 0 ? "completed" : "failed";
      
      await db.collection("payments").doc(checkoutRequestId).update({
        status: status,
        result_desc: stkCallback.ResultDesc || "Processed"
      });
      console.log(`✅ Firebase Successfully Updated to: ${status}`);
    }

    // 5. You MUST return a 200 OK so Safaricom knows you received the receipt
    return res.status(200).send("Acknowledged");

  } catch (error) {
    console.error("🔥 Webhook Crash Error:", error);
    return res.status(500).send("Internal Server Error");
  }
};