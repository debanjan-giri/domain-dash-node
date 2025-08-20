import "./scheduler.js";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import QuickLRU from "quick-lru";
import tls from "tls";
import mongoose from "mongoose";
import compression from "compression";
import dns from "dns";
import { promisify } from "util";

// ====== Config ======
const app = express();
const PORT = 3000;
const MAX_CACHE_SIZE = 1000; // Increased cache size
const MONGO_URI = `mongodb+srv://devposto:QG0X8FqYcLHfM8ET@cluster0.0smalyx.mongodb.net/?retryWrites=true&w=majority`;

// Promisify DNS functions for easier async/await usage
const dnsResolveNs = promisify(dns.resolveNs);
const dnsResolve4 = promisify(dns.resolve4);
const dnsResolve6 = promisify(dns.resolve6);

// ====== Enhanced MongoDB Configuration ======
mongoose.set("strictQuery", false);
const connectionOptions = {
  maxPoolSize: 10, // Maintain up to 10 socket connections
  minPoolSize: 2, // Minimum connections in pool
  serverSelectionTimeoutMS: 5000, // Keep trying to send operations for 5 seconds
  socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
  maxIdleTimeMS: 30000, // Close connections after 30 seconds of inactivity
  retryWrites: true,
  w: "majority",
  // Connection optimization
  connectTimeoutMS: 10000,
  heartbeatFrequencyMS: 10000,
  // Remove deprecated options - these are now handled by mongoose directly
};

// ====== MongoDB Schema with Optimizations ======
const domainSchema = new mongoose.Schema(
  {
    domain: { type: String, required: true, unique: true, index: true },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  {
    // Schema optimizations
    versionKey: false, // Remove __v field
    minimize: false,
    collection: "domains",
  }
);

// Compound index for better query performance
domainSchema.index({ createdAt: -1, domain: 1 });

export const Domain = mongoose.model("Domain", domainSchema);

// ====== Mongo Connection ======
mongoose.connect(MONGO_URI, connectionOptions);
mongoose.connection.on("connected", () => {
  console.log("📦 Connected to MongoDB Atlas with optimized settings");
  // Warm up connections and preload domains
  setTimeout(() => {
    preloadDomains();
  }, 1000);
});
mongoose.connection.on("error", (err) => {
  console.error("❌ MongoDB connection error:", err);
});

// ====== Ultra-Fast Multi-Layer Caching System ======
const certCache = new QuickLRU({
  maxSize: MAX_CACHE_SIZE,
  onEviction: (key, value) => {
    console.log(`🗑️ Evicted ${key} from cert cache`);
  },
});

// Separate cache for failed attempts (shorter TTL)
const failureCache = new QuickLRU({ maxSize: 200 });

// DNS cache with TTL
const dnsCache = new Map();
const DNS_CACHE_TTL = 10 * 60 * 1000; // Increased to 10 minutes

// DNS info cache with extended TTL for better performance
const dnsInfoCache = new QuickLRU({
  maxSize: MAX_CACHE_SIZE * 2, // Doubled cache size
  onEviction: (key, value) => {
    console.log(`🗑️ Evicted DNS info for ${key}`);
  },
});

// Domain list cache to reduce DB queries
let domainListCache = null;
let domainListCacheTime = 0;
const DOMAIN_LIST_CACHE_TTL = 60 * 1000; // Increased to 60 seconds

const cachedLookup = (hostname, options, callback) => {
  const cacheKey = `${hostname}:${JSON.stringify(options)}`;
  const cached = dnsCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < DNS_CACHE_TTL) {
    return process.nextTick(() =>
      callback(null, cached.address, cached.family)
    );
  }

  dns.lookup(hostname, options, (err, address, family) => {
    if (!err) {
      dnsCache.set(cacheKey, {
        address,
        family,
        timestamp: Date.now(),
      });
    }
    callback(err, address, family);
  });
};

// ====== Ultra-Fast DNS Information Functions ======
const getDNSInfo = async (domain) => {
  const cacheKey = `dns_info:${domain.toLowerCase()}`;

  // Check cache first
  if (dnsInfoCache.has(cacheKey)) {
    console.log(`⚡ [DNS CACHE HIT] ${domain}`);
    return dnsInfoCache.get(cacheKey);
  }

  console.log(`🔍 [FAST DNS LOOKUP] ${domain}`);

  try {
    const dnsInfo = {
      nameServers: [],
      dnsHost: [],
    };

    // Aggressive parallel DNS lookups with reduced timeouts
    const dnsPromises = [];

    // NS records with 1.5s timeout
    dnsPromises.push(
      Promise.race([
        dnsResolveNs(domain),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("NS timeout")), 1500)
        ),
      ])
        .then((result) => {
          dnsInfo.nameServers = result || [];
        })
        .catch(() => {
          dnsInfo.nameServers = [];
        })
    );

    // A records with 1.5s timeout
    dnsPromises.push(
      Promise.race([
        dnsResolve4(domain),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("A timeout")), 1500)
        ),
      ])
        .then((result) => {
          dnsInfo.dnsHost.push(...(result || []));
        })
        .catch(() => {
          // A record lookup failed, continue
        })
    );

    // Execute all DNS lookups in parallel with max 2s total wait
    await Promise.race([
      Promise.allSettled(dnsPromises),
      new Promise((resolve) => setTimeout(resolve, 2000)), // Max 2s wait
    ]);

    // Aggressive caching - cache for 15 minutes for better performance
    const cacheValue = { ...dnsInfo, cachedAt: Date.now() };
    dnsInfoCache.set(cacheKey, cacheValue);

    return dnsInfo;
  } catch (error) {
    console.warn(`⚠️ Fast DNS lookup failed for ${domain}:`, error.message);
    // Return empty arrays and cache them to avoid repeated failures
    const emptyDnsInfo = { nameServers: [], dnsHost: [], cachedAt: Date.now() };
    dnsInfoCache.set(cacheKey, emptyDnsInfo);
    return { nameServers: [], dnsHost: [] };
  }
};

// ====== Background DNS Fetching for Better Performance ======
const backgroundDNSQueue = new Map();
const processingDNSQueue = new Set();

const queueBackgroundDNS = (domain) => {
  if (!backgroundDNSQueue.has(domain) && !processingDNSQueue.has(domain)) {
    backgroundDNSQueue.set(domain, Date.now());
  }
};

const processBackgroundDNS = async () => {
  if (backgroundDNSQueue.size === 0) return;

  const domains = Array.from(backgroundDNSQueue.keys()).slice(0, 3); // Process 3 at a time

  for (const domain of domains) {
    backgroundDNSQueue.delete(domain);
    processingDNSQueue.add(domain);

    try {
      await getDNSInfo(domain);
    } catch (error) {
      console.warn(`Background DNS failed for ${domain}:`, error.message);
    } finally {
      processingDNSQueue.delete(domain);
    }
  }
};

// Process background DNS every 5 seconds
setInterval(processBackgroundDNS, 5000);

// ====== Optimized Middleware (Same as Doc 2) ======
app.use(
  compression({
    level: 6,
    threshold: 1024,
    filter: (req, res) => {
      if (req.headers["x-no-compression"]) return false;
      return compression.filter(req, res);
    },
  })
);

app.use(
  cors({
    origin: true,
    credentials: false,
    optionsSuccessStatus: 200,
  })
);

app.use(
  express.json({
    limit: "10kb",
    strict: true,
  })
);

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

// Memory-based rate limiter store for better performance
const createMemoryStore = () => {
  const store = new Map();
  return {
    incr: (key, callback) => {
      const now = Date.now();
      const record = store.get(key) || { count: 0, resetTime: now + 60000 };

      if (now > record.resetTime) {
        record.count = 1;
        record.resetTime = now + 60000;
      } else {
        record.count++;
      }

      store.set(key, record);
      callback(null, record.count, record.resetTime);
    },
    decrement: (key) => {
      const record = store.get(key);
      if (record && record.count > 0) {
        record.count--;
        store.set(key, record);
      }
    },
    resetKey: (key) => {
      store.delete(key);
    },
  };
};

const rateLimitStore = createMemoryStore();

app.use(
  "/certificate-info",
  rateLimit({
    windowMs: 60 * 1000,
    max: 60, // Increased limit
    store: rateLimitStore,
    message: { error: "Too many requests. Please try again later." },
    standardHeaders: false,
    legacyHeaders: false,
  })
);

app.use(
  "/certificate-bulk",
  rateLimit({
    windowMs: 60 * 1000,
    max: 20, // Increased
    store: rateLimitStore,
    message: { error: "Too many bulk requests. Please try again later." },
    standardHeaders: false,
    legacyHeaders: false,
  })
);

// ====== Optimized Utility Functions ======
const formatLocalDate = (dateStr) => {
  try {
    return new Date(dateStr).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour12: false,
    });
  } catch (error) {
    console.warn(`⚠️ Date formatting error: ${error.message}`);
    return dateStr;
  }
};

const validateDomain = (domain) => {
  if (typeof domain !== "string") return false;
  const trimmed = domain.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length < 254 &&
    /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(trimmed)
  );
};

// Smart cache key generation
const getCacheKey = (domain, port = 443) => `${domain.toLowerCase()}:${port}`;

export const getSSLCertificateCached = async (domain, port = 443) => {
  const cacheKey = getCacheKey(domain, port);

  // Check main cache first
  if (certCache.has(cacheKey)) {
    console.log(`⚡ [SSL CACHE HIT] ${domain}`);
    return certCache.get(cacheKey);
  }

  // Check failure cache
  const failureKey = `fail:${cacheKey}`;
  if (failureCache.has(failureKey)) {
    const failureData = failureCache.get(failureKey);
    if (Date.now() - failureData.timestamp < 60000) {
      throw new Error(failureData.error);
    } else {
      failureCache.delete(failureKey);
    }
  }

  console.log(`🚀 [FAST SSL FETCH] ${domain}`);

  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const socket = tls.connect(
      {
        host: domain,
        port,
        servername: domain,
        rejectUnauthorized: false,
        lookup: cachedLookup,
        timeout: 5000, // Optimized timeout
        secureProtocol: "TLS_method",
        ciphers: "HIGH:!aNULL:!MD5:!RC4",
      },
      () => {
        try {
          const cert = socket.getPeerCertificate();
          if (!cert || !Object.keys(cert).length) {
            const error = "No certificate found.";
            failureCache.set(failureKey, { error, timestamp: Date.now() });
            return reject(new Error(error));
          }

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
            fetchTime: Date.now() - startTime,
          };

          certCache.set(cacheKey, certInfo);
          resolve(certInfo);
        } catch (error) {
          const errorMsg = `Certificate processing error: ${error.message}`;
          failureCache.set(failureKey, {
            error: errorMsg,
            timestamp: Date.now(),
          });
          reject(new Error(errorMsg));
        } finally {
          socket.end();
        }
      }
    );

    socket.on("error", (err) => {
      const errorMsg = `TLS error for ${domain}: ${err.message}`;
      console.error(`❌ ${errorMsg}`);
      failureCache.set(failureKey, { error: errorMsg, timestamp: Date.now() });
      reject(new Error(`TLS error for ${domain}`));
    });

    socket.setTimeout(5000, () => {
      socket.destroy();
      const errorMsg = "TLS request timed out.";
      failureCache.set(failureKey, { error: errorMsg, timestamp: Date.now() });
      reject(new Error(errorMsg));
    });
  });
};

// ====== Smart Domain Preloading ======
const preloadDomains = async () => {
  console.log("🚀 Ultra-fast prewarming with smart DNS background loading...");
  try {
    const topDomains = await Domain.find()
      .sort({ createdAt: -1 })
      .limit(40) // Increased preload count
      .lean()
      .exec();

    // Process SSL first with higher concurrency
    const CONCURRENT_PRELOAD = 8; // Increased concurrency
    for (let i = 0; i < topDomains.length; i += CONCURRENT_PRELOAD) {
      const batch = topDomains.slice(i, i + CONCURRENT_PRELOAD);
      const promises = batch.map(async ({ domain }) => {
        try {
          // Load SSL immediately
          await getSSLCertificateCached(domain);
          // Queue DNS for background processing
          queueBackgroundDNS(domain);
          return { domain, success: true };
        } catch (e) {
          console.warn(`⚠️ Failed to preload ${domain}: ${e.message}`);
          return { domain, success: false };
        }
      });

      await Promise.all(promises);
      // Minimal delay between batches
      if (i + CONCURRENT_PRELOAD < topDomains.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    console.log(
      `⚡ Ultra-fast prewarming completed. SSL cache: ${certCache.size}`
    );
  } catch (err) {
    console.error("❌ Failed to preload domains:", err.message);
  }
};

// ====== Optimized Helper Functions ======
const parseLocalDateToUnix = (dateStr) => {
  if (!dateStr) return null;

  try {
    const [datePart, timePart] = dateStr.split(",");
    const [day, month, year] = datePart.trim().split("/").map(Number);
    const [hours, minutes, seconds] = timePart.trim().split(":").map(Number);

    const date = new Date(year, month - 1, day, hours, minutes, seconds);
    return Math.floor(date.getTime() / 1000);
  } catch (error) {
    console.error(`❌ Date parsing error for "${dateStr}":`, error.message);
    return null;
  }
};

// Ultra-fast domain processing with smart DNS strategy
const getDomainWithSSLData = async (domainDoc, fastMode = false) => {
  try {
    if (fastMode) {
      // Fast mode: SSL first, DNS from cache or queue for background
      const sslData = await getSSLCertificateCached(domainDoc.domain);

      // Try to get DNS from cache
      const dnsInfoKey = `dns_info:${domainDoc.domain.toLowerCase()}`;
      let dnsInfo = dnsInfoCache.get(dnsInfoKey) || {
        nameServers: [],
        dnsHost: [],
      };

      // If no DNS in cache, queue for background processing
      if (dnsInfo.nameServers.length === 0 && dnsInfo.dnsHost.length === 0) {
        queueBackgroundDNS(domainDoc.domain);
      }

      return {
        ...domainDoc,
        data: {
          registrar: sslData.issuer?.organization || "-",
          expiration_date: parseLocalDateToUnix(sslData.expiresOn),
          issued_date: parseLocalDateToUnix(sslData.issuedOn),
          raw_issued_date: sslData.issuedOn,
          raw_expiry_date: sslData.expiresOn,
        },
        nameServers: dnsInfo.nameServers || [],
        dnsHost: dnsInfo.dnsHost || [],
        status: "success",
        lastChecked: new Date(),
      };
    } else {
      // Normal mode: parallel SSL + DNS
      const [sslData, dnsInfo] = await Promise.all([
        getSSLCertificateCached(domainDoc.domain),
        getDNSInfo(domainDoc.domain),
      ]);

      return {
        ...domainDoc,
        data: {
          registrar: sslData.issuer?.organization || "-",
          expiration_date: parseLocalDateToUnix(sslData.expiresOn),
          issued_date: parseLocalDateToUnix(sslData.issuedOn),
          raw_issued_date: sslData.issuedOn,
          raw_expiry_date: sslData.expiresOn,
        },
        nameServers: dnsInfo.nameServers,
        dnsHost: dnsInfo.dnsHost,
        status: "success",
        lastChecked: new Date(),
      };
    }
  } catch (error) {
    console.error(`❌ SSL Data Error for ${domainDoc.domain}:`, error.message);

    // Still try to get DNS info from cache
    const dnsInfoKey = `dns_info:${domainDoc.domain.toLowerCase()}`;
    let dnsInfo = dnsInfoCache.get(dnsInfoKey) || {
      nameServers: [],
      dnsHost: [],
    };

    return {
      ...domainDoc,
      data: null,
      nameServers: dnsInfo.nameServers || [],
      dnsHost: dnsInfo.dnsHost || [],
      status: "error",
      lastChecked: new Date(),
    };
  }
};

// Cached domain list retrieval
const getCachedDomainList = async () => {
  const now = Date.now();
  if (domainListCache && now - domainListCacheTime < DOMAIN_LIST_CACHE_TTL) {
    return domainListCache;
  }

  const domains = await Domain.find().sort({ createdAt: -1 }).lean().exec();

  domainListCache = domains;
  domainListCacheTime = now;
  return domains;
};

// ====== Ultra-Fast Routes ======

// 🔍 Get certificate info (single domain) with smart DNS
app.get("/certificate-info", async (req, res) => {
  const { domain } = req.query;

  if (!validateDomain(domain)) {
    return res.status(400).json({ error: "Invalid or missing domain." });
  }

  try {
    // Fast mode: SSL first, DNS from cache or background queue
    const [certInfo] = await Promise.all([
      getSSLCertificateCached(domain.trim()),
    ]);

    // Try to get DNS from cache
    const dnsInfoKey = `dns_info:${domain.trim().toLowerCase()}`;
    let dnsInfo = dnsInfoCache.get(dnsInfoKey);

    if (!dnsInfo) {
      // No cache, queue for background and return empty for now
      queueBackgroundDNS(domain.trim());
      dnsInfo = { nameServers: [], dnsHost: [] };
    }

    const enhancedCertInfo = {
      ...certInfo,
      expiration_date_unix: parseLocalDateToUnix(certInfo.expiresOn),
      issued_date_unix: parseLocalDateToUnix(certInfo.issuedOn),
      nameServers: dnsInfo.nameServers || [],
      dnsHost: dnsInfo.dnsHost || [],
    };

    res.json(enhancedCertInfo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 📄 Get all domains with SSL data (ultra-fast bulk endpoint)
app.get("/certificate-bulk", async (_, res) => {
  try {
    console.log("⚡ [ULTRA-FAST BULK] Processing with smart DNS strategy...");
    const domains = await getCachedDomainList();

    // Ultra-fast mode: Increased batch size, smart DNS handling
    const BATCH_SIZE = 10; // Increased from 6 to 10
    const results = [];

    for (let i = 0; i < domains.length; i += BATCH_SIZE) {
      const batch = domains.slice(i, i + BATCH_SIZE);
      const batchPromises = batch.map((domain) =>
        getDomainWithSSLData(domain, true)
      ); // Fast mode enabled
      const batchResults = await Promise.allSettled(batchPromises);

      // Handle settled promises
      batchResults.forEach((result, index) => {
        if (result.status === "fulfilled") {
          results.push(result.value);
        } else {
          console.error(
            `❌ Batch error for ${batch[index].domain}:`,
            result.reason
          );
          results.push({
            ...batch[index],
            data: null,
            nameServers: [],
            dnsHost: [],
            status: "error",
            lastChecked: new Date(),
          });
        }
      });

      // Minimal delay between batches
      if (i + BATCH_SIZE < domains.length) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    console.log(
      `⚡ [ULTRA-FAST BULK] Processed ${results.length} domains in fast mode`
    );
    res.json(results);
  } catch (err) {
    console.error("❌ [BULK REQUEST] Error:", err.message);
    res.status(500).json({ error: "Failed to fetch domains with SSL data." });
  }
});

// 📄 List all domains (cached for performance)
app.get("/certificate-list", async (_, res) => {
  try {
    const domains = await getCachedDomainList();
    res.json(domains);
  } catch (err) {
    console.error("❌ [LIST] Error:", err.message);
    res.status(500).json({ error: "Failed to fetch domains." });
  }
});

// ➕ Add a domain and return it with SSL data (ultra-fast)
app.post("/certificate-create", async (req, res) => {
  const { domain } = req.body;

  if (!validateDomain(domain)) {
    return res.status(400).json({ error: "Invalid domain." });
  }

  const domainTrimmed = domain.trim().toLowerCase();

  try {
    const existing = await Domain.findOne({ domain: domainTrimmed })
      .lean()
      .exec();
    if (existing) {
      return res.status(409).json({ error: "Domain already exists." });
    }

    const newEntry = await Domain.create({ domain: domainTrimmed });
    domainListCache = null;

    // Fast mode for immediate response
    const domainWithSSLData = await getDomainWithSSLData(
      {
        _id: newEntry._id,
        domain: newEntry.domain,
        createdAt: newEntry.createdAt,
      },
      true
    ); // Fast mode enabled

    res.status(201).json({
      message: "Domain added successfully",
      domain: domainWithSSLData,
    });
  } catch (err) {
    console.error("❌ [CREATE] Error:", err.message);
    if (err.code === 11000) {
      return res.status(409).json({ error: "Domain already exists." });
    }
    res.status(500).json({ error: "Failed to create domain." });
  }
});

// 🔍 Get single domain with SSL data (fast mode)
app.get("/certificate-single/:id", async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: "Invalid ID format." });
  }

  try {
    const domain = await Domain.findById(id).lean().exec();
    if (!domain) {
      return res.status(404).json({ error: "Domain not found." });
    }

    // Use normal mode for single domain requests (better data completeness)
    const domainWithSSLData = await getDomainWithSSLData(domain, false);
    res.json(domainWithSSLData);
  } catch (err) {
    console.error("❌ [SINGLE] Error:", err.message);
    res.status(500).json({ error: "Failed to fetch domain data." });
  }
});

// ❌ Delete a domain (optimized with DNS cache cleanup)
app.delete("/certificate-delete/:id", async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: "Invalid ID format." });
  }

  try {
    const deleted = await Domain.findByIdAndDelete(id).lean().exec();
    if (!deleted) {
      return res.status(404).json({ error: "Domain not found." });
    }

    // Clean up all caches
    const cacheKey = getCacheKey(deleted.domain);
    const dnsInfoKey = `dns_info:${deleted.domain.toLowerCase()}`;

    certCache.delete(cacheKey);
    dnsInfoCache.delete(dnsInfoKey);
    backgroundDNSQueue.delete(deleted.domain);
    processingDNSQueue.delete(deleted.domain);
    domainListCache = null;

    res.json({ message: "Domain deleted." });
  } catch (err) {
    console.error("❌ [DELETE] Error:", err.message);
    res.status(500).json({ error: "Failed to delete domain." });
  }
});

// Enhanced health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    cache: {
      cert_cache_size: certCache.size,
      dns_cache_size: dnsCache.size,
      dns_info_cache_size: dnsInfoCache.size,
      failure_cache_size: failureCache.size,
      background_dns_queue: backgroundDNSQueue.size,
      processing_dns_queue: processingDNSQueue.size,
    },
    memory: process.memoryUsage(),
    uptime: process.uptime(),
  });
});

// ====== Start Server with Optimizations ======
const server = app.listen(PORT, () => {
  console.log(
    `⚡ Ultra-Fast High-Performance Server running at http://localhost:${PORT}`
  );
  console.log(
    `📊 Enhanced caches - Cert: ${MAX_CACHE_SIZE}, DNS TTL: ${DNS_CACHE_TTL}ms`
  );
});

// Optimize server settings
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
server.maxHeadersCount = 1000;
server.timeout = 30000;

// ====== Enhanced Graceful Shutdown ======
const gracefulShutdown = () => {
  console.log("\n🛑 Gracefully shutting down...");

  server.close(() => {
    console.log("🔌 HTTP server closed");

    mongoose.connection.close(false, () => {
      console.log("📦 MongoDB connection closed");

      // Clear all caches
      certCache.clear();
      dnsCache.clear();
      dnsInfoCache.clear();
      failureCache.clear();
      backgroundDNSQueue.clear();
      processingDNSQueue.clear();

      console.log("✅ Graceful shutdown completed");
      process.exit(0);
    });
  });

  setTimeout(() => {
    console.error("⚠️ Forced shutdown after timeout");
    process.exit(1);
  }, 10000);
};

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);

process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err);
  gracefulShutdown();
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
});

// Memory optimization - periodic cleanup
setInterval(() => {
  if (global.gc) {
    global.gc();
  }
}, 5 * 60 * 1000); // Every 5 minutes

// ====== Performance Monitoring ======
let performanceMetrics = {
  sslCacheHits: 0,
  sslCacheMisses: 0,
  dnsCacheHits: 0,
  dnsCacheMisses: 0,
  backgroundDNSProcessed: 0,
  totalRequests: 0,
};

// Reset metrics every hour
setInterval(() => {
  performanceMetrics = {
    sslCacheHits: 0,
    sslCacheMisses: 0,
    dnsCacheHits: 0,
    dnsCacheMisses: 0,
    backgroundDNSProcessed: 0,
    totalRequests: 0,
  };
  console.log("📊 Performance metrics reset");
}, 60 * 60 * 1000);

// Performance metrics endpoint
app.get("/metrics", (req, res) => {
  const hitRate =
    performanceMetrics.totalRequests > 0
      ? (
          ((performanceMetrics.sslCacheHits + performanceMetrics.dnsCacheHits) /
            (performanceMetrics.totalRequests * 2)) *
          100
        ).toFixed(2)
      : 0;

  res.json({
    performance: performanceMetrics,
    hitRate: `${hitRate}%`,
    cacheEfficiency: {
      ssl:
        performanceMetrics.sslCacheHits > 0
          ? (
              (performanceMetrics.sslCacheHits /
                (performanceMetrics.sslCacheHits +
                  performanceMetrics.sslCacheMisses)) *
              100
            ).toFixed(2) + "%"
          : "0%",
      dns:
        performanceMetrics.dnsCacheHits > 0
          ? (
              (performanceMetrics.dnsCacheHits /
                (performanceMetrics.dnsCacheHits +
                  performanceMetrics.dnsCacheMisses)) *
              100
            ).toFixed(2) + "%"
          : "0%",
    },
    backgroundDNS: {
      queued: backgroundDNSQueue.size,
      processing: processingDNSQueue.size,
      processed: performanceMetrics.backgroundDNSProcessed,
    },
  });
});
