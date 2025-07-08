import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import QuickLRU from "quick-lru";
import tls from "tls";
import mongoose from "mongoose";

// ====== Config ======
const app = express();
const PORT = process.env.PORT || 3000;
const MAX_CACHE_SIZE = 500;

// ✅ Recommended URI Format with TLS
const MONGO_URI = `mongodb+srv://devposto:QG0X8FqYcLHfM8ET@cluster0.0smalyx.mongodb.net/test?retryWrites=true&w=majority&tls=true`;
mongoose.set("strictQuery", true); // ✅ Avoid deprecation warnings

// ====== MongoDB Schema ======
const domainSchema = new mongoose.Schema({
  domain: { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now },
});
const Domain = mongoose.model("Domain", domainSchema);

// ====== MongoDB Connection ======
mongoose
  .connect(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    tls: true,
    // tlsInsecure: true, // ⚠️ Only enable if debugging and trust risk
  })
  .then(() => console.log("📦 Connected to MongoDB Atlas"))
  .catch((err) =>
    console.error("❌ MongoDB connection error:\n", err.message)
  );

// ====== Cache & Middleware ======
const certCache = new QuickLRU({ maxSize: MAX_CACHE_SIZE });
app.use(cors());
app.use(express.json());
app.use(helmet());
app.use(
  "/certificate-info",
  rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: "Too many requests. Please try again later.",
  })
);

// ====== Helpers ======
const formatLocalDate = (dateStr) =>
  new Date(dateStr).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour12: false,
  });

const validateDomain = (domain) =>
  typeof domain === "string" &&
  /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(domain.trim());

const getSSLCertificateCached = async (domain, port = 443) => {
  if (certCache.has(domain)) {
    console.log(`✅ [CACHE HIT] ${domain}`);
    return certCache.get(domain);
  }

  console.log(`🌐 [FETCHING] TLS data for ${domain}`);

  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      {
        host: domain,
        port,
        servername: domain,
        rejectUnauthorized: false, // <== allow even self-signed certs
      },
      () => {
        const cert = socket.getPeerCertificate();
        if (!cert || !Object.keys(cert).length)
          return reject(new Error("No certificate found."));

        const certInfo = {
          domain,
          subject: {
            commonName: cert.subject?.CN || "",
            organization: cert.subject?.O || "<N/A>",
            organizationalUnit: cert.subject?.OU || "<N/A>",
          },
          issuer: {
            commonName: cert.issuer?.CN || "",
            organization: cert.issuer?.O || "",
            organizationalUnit: cert.issuer?.OU || "<N/A>",
          },
          issuedOn: formatLocalDate(cert.valid_from),
          expiresOn: formatLocalDate(cert.valid_to),
          serialNumber: cert.serialNumber,
          fingerprint: cert.fingerprint256,
        };

        certCache.set(domain, certInfo);
        resolve(certInfo);
        socket.end();
      }
    );

    socket.on("error", (err) => {
      console.error(`❌ [TLS ERROR] ${domain}: ${err.message}`);
      reject(err);
    });
  });
};

// ====== Routes ======

// 🔍 Get certificate info
app.get("/certificate-info", async (req, res) => {
  const { domain } = req.query;
  if (!validateDomain(domain))
    return res.status(400).json({ error: "Invalid or missing domain." });

  try {
    const certInfo = await getSSLCertificateCached(domain.trim());
    res.json(certInfo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 📄 List all domains
app.get("/certificate-list", async (_, res) => {
  try {
    const domains = await Domain.find().sort({ createdAt: -1 });
    res.json(domains);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch domains." });
  }
});

// ➕ Add a domain
app.post("/certificate-create", async (req, res) => {
  const { domain } = req.body;
  if (!validateDomain(domain))
    return res.status(400).json({ error: "Invalid domain." });

  try {
    const domainTrimmed = domain.trim();
    const existing = await Domain.findOne({ domain: domainTrimmed });
    if (existing)
      return res.status(409).json({ error: "Domain already exists." });

    const newEntry = await Domain.create({ domain: domainTrimmed });
    res.status(201).json({ message: "Domain added", id: newEntry._id });
  } catch (err) {
    res.status(500).json({ error: "Failed to create domain." });
  }
});

// ❌ Delete a domain
app.delete("/certificate-delete/:id", async (req, res) => {
  try {
    const deleted = await Domain.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Domain not found." });

    certCache.delete(deleted.domain);
    res.json({ message: "Domain deleted." });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete domain." });
  }
});

// ====== Start Server ======
const server = app.listen(PORT, () =>
  console.log(`🚀 Server running at http://localhost:${PORT}`)
);

// ====== Graceful Shutdown ======
process.on("SIGINT", () => {
  console.log("\n🛑 Gracefully shutting down...");
  server.close(() => {
    console.log("✅ Server closed.");
    process.exit(0);
  });
});
