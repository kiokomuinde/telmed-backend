const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
  });
}
const db = admin.firestore();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    const data = req.body;
    const stkCallback = data?.Body?.stkCallback || {};
    const checkoutRequestId = stkCallback.CheckoutRequestID;
    const resultCode = stkCallback.ResultCode;

    if (checkoutRequestId) {
      const status = resultCode === 0 ? "completed" : "failed";
      
      // Update Firebase with the final result
      await db.collection("payments").doc(checkoutRequestId).update({
        status: status,
        result_desc: stkCallback.ResultDesc
      });
    }

    // You MUST return a 200 OK so Safaricom knows you received it
    res.status(200).send("Acknowledged");
  } catch (error) {
    console.error("Webhook Error:", error);
    res.status(500).send("Server Error");
  }
}