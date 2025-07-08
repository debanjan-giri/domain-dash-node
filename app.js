// import "./scheduler.js";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { v4 as uuidv4 } from "uuid";
import QuickLRU from "quick-lru";
import tls from "tls";
import fs from "fs/promises";

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_CACHE_SIZE = 200;
const DOMAIN_FILE = "domain.json";

// ====== Ensure file exists ======
async function ensureDomainFileExists() {
  try {
    await fs.access(DOMAIN_FILE);
  } catch {
    await fs.writeFile(DOMAIN_FILE, JSON.stringify([], null, 2));
  }
}
await ensureDomainFileExists();

// ====== In-memory SSL Cache ======
const certCache = new QuickLRU({ maxSize: MAX_CACHE_SIZE });

// ====== Middleware ======
app.use(cors());
app.use(express.json());
app.use(helmet());

// Rate Limiting
app.use(
  "/certificate-info",
  rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: "Too many requests. Please try again later.",
  })
);

// ====== Utilities ======
const formatLocalDate = (dateStr) =>
  new Date(dateStr).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour12: false,
  });

const validateDomain = (domain) =>
  typeof domain === "string" &&
  /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(domain.trim());

const getDomainData = async () => {
  const data = await fs.readFile(DOMAIN_FILE, "utf-8");
  return JSON.parse(data);
};

const saveDomainData = async (data) => {
  await fs.writeFile(DOMAIN_FILE, JSON.stringify(data, null, 2));
};

const getSSLCertificateCached = async (domain, port = 443) => {
  if (certCache.has(domain)) {
    console.log(`✅ [CACHE HIT] ${domain}`);
    return certCache.get(domain);
  }

  console.log(`🌐 [FETCHING] TLS data for ${domain}`);

  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      { host: domain, port, servername: domain, rejectUnauthorized: false },
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
  const domains = await getDomainData();
  res.json(domains);
});

// ➕ Add a domain
app.post("/certificate-create", async (req, res) => {
  const { domain } = req.body;

  if (!validateDomain(domain))
    return res.status(400).json({ error: "Invalid domain." });

  const domainTrimmed = domain.trim();
  const domains = await getDomainData();

  if (domains.some((d) => d.domain === domainTrimmed))
    return res.status(409).json({ error: "Domain already exists." });

  const newEntry = {
    id: uuidv4(),
    domain: domainTrimmed,
    createdAt: new Date().toISOString(),
  };

  domains.push(newEntry);
  await saveDomainData(domains);

  res.status(201).json({ message: "Domain added", id: newEntry.id });
});

// ❌ Delete a domain
app.delete("/certificate-delete/:id", async (req, res) => {
  const { id } = req.params;
  const domains = await getDomainData();
  const index = domains.findIndex((d) => d.id === id);

  if (index === -1) return res.status(404).json({ error: "Domain not found." });

  const [deleted] = domains.splice(index, 1);
  await saveDomainData(domains);

  certCache.delete(deleted.domain);
  res.json({ message: "Domain deleted." });
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
