// import nodemailer from "nodemailer";
// import cron from "node-cron";

// // Email transporter
// const transporter = nodemailer.createTransport({
//   service: "gmail",
//   auth: {
//     user: "debanjan.giri@clirnet.com",
//     pass: "bbdr okbe elza chty", // make sure this is the app password for devposto@gmail.com
//   },
// });

// // Email content
// const mailOptions = {
//   from: '"Devposto" <debanjan.giri@clirnet.com>',
//   to: "debanjan.py@gmail.com",
//   subject: "Daily SSL Reminder",
//   text: "Hello Debanjan! This is your daily automated SSL reminder email.",
// };

// // Schedule for testing every 1 minute
// cron.schedule("*/1 * * * *", () => {
//   console.log("📧 Running test email every minute");

//   transporter.sendMail(mailOptions, (error, info) => {
//     if (error) {
//       console.error("❌ Email failed:", error);
//     } else {
//       console.log("✅ Email sent:", info.response);
//     }
//   });
// });

// console.log("✅ Scheduler started...");
