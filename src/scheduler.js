import nodemailer from "nodemailer";
import cron from "node-cron";
import { Domain, getSSLCertificateCached } from "./index.js";

// Email transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "debanjan.py@gmail.com",
    pass: "sphd szzw xdbd nmpx",
  },
});

// Helper function to get precise time until expiry
const getTimeUntilExpiry = (expiryDateStr) => {
  try {
    // Parse the local date format from your SSL data
    const [datePart, timePart] = expiryDateStr.split(",");
    const [day, month, year] = datePart.trim().split("/").map(Number);
    const [hours, minutes, seconds] = timePart.trim().split(":").map(Number);

    const expiryDate = new Date(year, month - 1, day, hours, minutes, seconds);
    const now = new Date();
    const diffTime = expiryDate.getTime() - now.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor(diffTime / (1000 * 60 * 60));

    return {
      days: diffDays,
      hours: diffHours,
      totalMs: diffTime,
      expiryDate,
    };
  } catch (error) {
    console.error(`❌ Error parsing expiry date: ${expiryDateStr}`, error);
    return { days: null, hours: null, totalMs: null, expiryDate: null };
  }
};

// Function to check for domains at specific expiry thresholds
const checkSpecificExpiryThresholds = async (
  targetDays = null,
  targetHours = null
) => {
  try {
    const domains = await Domain.find().lean();
    const matchingDomains = [];

    for (const { domain } of domains) {
      try {
        const cert = await getSSLCertificateCached(domain.trim());
        const { days, hours, totalMs } = getTimeUntilExpiry(cert.expiresOn);

        if (days === null || hours === null) continue;

        const domainInfo = {
          domain,
          expiryDate: cert.expiresOn,
          daysLeft: days,
          hoursLeft: hours,
        };

        // Check for exact day matches (with some tolerance for timing)
        if (targetDays !== null) {
          if (days === targetDays) {
            matchingDomains.push(domainInfo);
          }
        }

        // Check for 2-hour threshold (between 1-3 hours remaining)
        if (targetHours !== null) {
          if (hours >= 1 && hours <= 3) {
            matchingDomains.push(domainInfo);
          }
        }
      } catch (err) {
        console.warn(`⚠️ Could not fetch cert for ${domain}: ${err.message}`);
      }
    }

    return matchingDomains;
  } catch (err) {
    console.error("❌ Error checking certificates:", err.message);
    throw err;
  }
};

// Function to send specific threshold alerts
const sendThresholdAlert = async (domains, thresholdType) => {
  if (domains.length === 0) {
    console.log(`✅ No domains found for ${thresholdType} threshold`);
    return;
  }

  // Helper function to format domain list
  const formatDomainList = (domains) => {
    return domains
      .map((d) => {
        if (d.hoursLeft !== undefined) {
          return `• ${d.domain} (expires: ${d.expiryDate}, ${d.hoursLeft} hours left)`;
        }
        return `• ${d.domain} (expires: ${d.expiryDate}, ${d.daysLeft} days left)`;
      })
      .join("\n");
  };

  let subject, htmlColor, bgColor, borderColor, priority, timeframe, action;

  switch (thresholdType) {
    case "2hours":
      subject = "Automatic Alert: SSL Certificates Expiring in 2 HOURS";
      htmlColor = "#dc3545";
      bgColor = "#f8d7da";
      borderColor = "#dc3545";
      priority = "EMERGENCY";
      timeframe = "2 HOURS";
      action = "IMMEDIATE ACTION REQUIRED NOW!";
      break;
    case "1day":
      subject = "Automatic Alert: SSL Certificates Expiring in 1 DAY";
      htmlColor = "#dc3545";
      bgColor = "#f8d7da";
      borderColor = "#dc3545";
      priority = "CRITICAL";
      timeframe = "1 DAY";
      action = "IMMEDIATE ACTION REQUIRED!";
      break;
    case "2days":
      subject = "Automatic Alert: SSL Certificates Expiring in 2 DAYS";
      htmlColor = "#fd7e14";
      bgColor = "#ffeaa7";
      borderColor = "#fd7e14";
      priority = "HIGH PRIORITY";
      timeframe = "2 DAYS";
      action = "ACTION NEEDED SOON!";
      break;
    case "7days":
      subject = "Automatic Alert: SSL Certificates Expiring in 7 DAYS";
      htmlColor = "#ffc107";
      bgColor = "#fff3cd";
      borderColor = "#ffc107";
      priority = "NOTICE";
      timeframe = "7 DAYS";
      action = "Please plan for renewal";
      break;
  }

  try {
    const mailOptions = {
      from: "SSL Monitor <debanjan.py@gmail.com>",
      to: "suman.rana@clirnet.com, ashu@clirnet.com, debanjan.py@gmail.com",
      subject: subject,
      html: `
        <h2 style="color: ${htmlColor};">${priority} SSL EXPIRY ALERT</h2>
        <p><strong>The following ${
          domains.length
        } domain(s) have SSL certificates expiring within ${timeframe}:</strong></p>
        <div style="background: ${bgColor}; padding: 15px; border-left: 4px solid ${borderColor}; margin: 10px 0;">
          <pre style="margin: 0; font-family: monospace;">${formatDomainList(
            domains
          )}</pre>
        </div>
        <p><strong>⚠️ ${action}</strong></p>
        <hr>
        <p><em>Automated SSL Certificate Monitor - Triggered at ${new Date().toLocaleString(
          "en-IN",
          { timeZone: "Asia/Kolkata" }
        )}</em></p>
      `,
      text: `${priority}: SSL certificates expiring within ${timeframe}:\n\n${formatDomainList(
        domains
      )}\n\n⚠️ ${action}`,
    };

    await transporter.sendMail(mailOptions);
    console.log(
      `✅ ${priority} alert sent for ${domains.length} domain(s) expiring in ${timeframe}`
    );
  } catch (err) {
    console.error(`❌ Failed to send ${thresholdType} alert:`, err.message);
  }
};

// Individual threshold check functions
const check7DayExpiry = async () => {
  console.log("🟡 Checking for domains expiring in exactly 7 days...");
  try {
    const domains = await checkSpecificExpiryThresholds(7);
    await sendThresholdAlert(domains, "7days");
  } catch (err) {
    console.error("❌ 7-day expiry check failed:", err.message);
  }
};

const check2DayExpiry = async () => {
  console.log("🔶 Checking for domains expiring in exactly 2 days...");
  try {
    const domains = await checkSpecificExpiryThresholds(2);
    await sendThresholdAlert(domains, "2days");
  } catch (err) {
    console.error("❌ 2-day expiry check failed:", err.message);
  }
};

const check1DayExpiry = async () => {
  console.log("🚨 Checking for domains expiring in exactly 1 day...");
  try {
    const domains = await checkSpecificExpiryThresholds(1);
    await sendThresholdAlert(domains, "1day");
  } catch (err) {
    console.error("❌ 1-day expiry check failed:", err.message);
  }
};

// ====== CRON SCHEDULES ======

// 🟡 Check for domains expiring in exactly 7 days - Daily at 9:00 AM IST
cron.schedule(
  "0 9 * * *",
  () => {
    console.log("📅 Running 7-day SSL expiry check at 9:00 AM IST...");
    check7DayExpiry();
  },
  {
    timezone: "Asia/Kolkata",
  }
);

// 🔶 Check for domains expiring in exactly 2 days - Daily at 10:00 AM IST
cron.schedule(
  "0 10 * * *",
  () => {
    console.log("📅 Running 2-day SSL expiry check at 10:00 AM IST...");
    check2DayExpiry();
  },
  {
    timezone: "Asia/Kolkata",
  }
);

// 🚨 Check for domains expiring in exactly 1 day - Daily at 11:00 AM IST
cron.schedule(
  "0 11 * * *",
  () => {
    console.log("📅 Running 1-day SSL expiry check at 11:00 AM IST...");
    check1DayExpiry();
  },
  {
    timezone: "Asia/Kolkata",
  }
);
