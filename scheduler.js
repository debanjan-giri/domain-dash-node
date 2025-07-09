import nodemailer from "nodemailer";
import cron from "node-cron";
import { Domain, getSSLCertificateCached } from "./app.js";

// Email transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "debanjan.py@gmail.com",
    pass: "sphd szzw xdbd nmpx",
  },
});

const sendExpiringCertsEmail = async () => {
  try {
    const domains = await Domain.find().lean();
    const expiringSoon = [];

    const now = new Date();
    const threshold = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    for (const { domain } of domains) {
      try {
        const cert = await getSSLCertificateCached(domain.trim());
        const expiryDate = new Date(cert.expiresOn);

        if (expiryDate <= threshold) {
          expiringSoon.push(`${domain} (expires on ${cert.expiresOn})`);
        }
      } catch (err) {
        console.warn(`⚠️ Could not fetch cert for ${domain}: ${err.message}`);
      }
    }

    if (expiringSoon.length > 0) {
      const mailOptions = {
        from: "Debanjan <debanjan.py@gmail.com>",
        to: "suman.rana@clirnet.com, ashu@clirnet.com, devposto@gmail.com",
        subject: "⚠️ Automated SSL Expiry Alert - Domains Expiring Soon",
        text:
          "The following domains have SSL certificates expiring in less than 30 days:\n\n" +
          expiringSoon.join("\n"),
      };

      await transporter.sendMail(mailOptions);
      console.log("✅ Expiry alert email sent.");
    } else {
      console.log("✅ No domains expiring soon.");
    }
  } catch (err) {
    console.error("❌ Failed to send expiry email:", err.message);
  }
};

cron.schedule(
  "16 11 * * *",
  () => {
    console.log("📅 Running daily SSL expiry check at 11:13 AM IST...");
    sendExpiringCertsEmail();
  },
  {
    timezone: "Asia/Kolkata",
  }
);

console.log("✅ Scheduler started...");
