# 🔒 SSL Certificate Monitor & Expiry Alert System

A Node.js and Express.js-based web service that fetches, caches, and monitors SSL certificate information for any domain. It uses MongoDB to store domains and automatically sends expiry alert emails when certificates are close to expiration.

## 🚀 Features

- 🔍 Fetch live SSL certificate info (issuer, expiry, fingerprint, etc.)
- 💾 TLS data caching (via QuickLRU)
- 🧠 DNS lookup caching
- 📬 Daily automated email alerts for certificates expiring in the next 30 days
- 🧠 Stores domain list in MongoDB
- 🛡️ Helmet, CORS, rate limiting & compression enabled
- 🧹 Graceful server shutdown

---

## 🛠️ Technologies Used

- Node.js + Express.js
- MongoDB (Mongoose)
- TLS socket (for cert fetching)
- QuickLRU (in-memory cache)
- Node-Cron (for daily jobs)
- Nodemailer (for email alerts)
- Helmet, CORS, Compression, Rate-Limit

---

## 📦 Installation

```bash
git clone https://github.com/yourusername/ssl-monitor.git
cd ssl-monitor
npm install
