// import "./scheduler.js";
// import express from "express";
// import cors from "cors";
// import helmet from "helmet";
// import rateLimit from "express-rate-limit";
// import QuickLRU from "quick-lru";
// import tls from "tls";
// import mongoose from "mongoose";
// import compression from "compression";
// import dns from "dns";

// // ====== Config ======
// const app = express();
// const PORT = 3000;
// const MAX_CACHE_SIZE = 1000; // Increased cache size
// const MONGO_URI = `mongodb+srv://devposto:QG0X8FqYcLHfM8ET@cluster0.0smalyx.mongodb.net/?retryWrites=true&w=majority`;

// // ====== Enhanced MongoDB Configuration ======
// mongoose.set("strictQuery", false);
// const connectionOptions = {
//   maxPoolSize: 10, // Maintain up to 10 socket connections
//   minPoolSize: 2, // Minimum connections in pool
//   serverSelectionTimeoutMS: 5000, // Keep trying to send operations for 5 seconds
//   socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
//   maxIdleTimeMS: 30000, // Close connections after 30 seconds of inactivity
//   retryWrites: true,
//   w: "majority",
//   // Connection optimization
//   connectTimeoutMS: 10000,
//   heartbeatFrequencyMS: 10000,
//   // Remove deprecated options - these are now handled by mongoose directly
// };

// // ====== MongoDB Schema with Optimizations ======
// const domainSchema = new mongoose.Schema(
//   {
//     domain: { type: String, required: true, unique: true, index: true },
//     createdAt: { type: Date, default: Date.now, index: true },
//   },
//   {
//     // Schema optimizations
//     versionKey: false, // Remove __v field
//     minimize: false,
//     collection: "domains",
//   }
// );

// // Compound index for better query performance
// domainSchema.index({ createdAt: -1, domain: 1 });

// export const Domain = mongoose.model("Domain", domainSchema);

// // ====== Mongo Connection ======
// mongoose.connect(MONGO_URI, connectionOptions);
// mongoose.connection.on("connected", () => {
//   console.log("📦 Connected to MongoDB Atlas with optimized settings");
//   // Warm up connections and preload domains
//   setTimeout(() => {
//     preloadDomains();
//   }, 1000);
// });
// mongoose.connection.on("error", (err) => {
//   console.error("❌ MongoDB connection error:", err);
// });

// // ====== Enhanced Multi-Layer Caching System ======
// const certCache = new QuickLRU({
//   maxSize: MAX_CACHE_SIZE,
//   onEviction: (key, value) => {
//     console.log(`🗑️ Evicted ${key} from cert cache`);
//   },
// });

// // Separate cache for failed attempts (shorter TTL)
// const failureCache = new QuickLRU({ maxSize: 200 });

// // DNS cache with TTL
// const dnsCache = new Map();
// const DNS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// // Domain list cache to reduce DB queries
// let domainListCache = null;
// let domainListCacheTime = 0;
// const DOMAIN_LIST_CACHE_TTL = 30 * 1000; // 30 seconds

// const cachedLookup = (hostname, options, callback) => {
//   const cacheKey = `${hostname}:${JSON.stringify(options)}`;
//   const cached = dnsCache.get(cacheKey);

//   if (cached && Date.now() - cached.timestamp < DNS_CACHE_TTL) {
//     return process.nextTick(() =>
//       callback(null, cached.address, cached.family)
//     );
//   }

//   dns.lookup(hostname, options, (err, address, family) => {
//     if (!err) {
//       dnsCache.set(cacheKey, {
//         address,
//         family,
//         timestamp: Date.now(),
//       });
//     }
//     callback(err, address, family);
//   });
// };

// // ====== Optimized Middleware ======
// // Use compression with optimized settings
// app.use(
//   compression({
//     level: 6, // Balance between compression and CPU usage
//     threshold: 1024, // Only compress responses > 1KB
//     filter: (req, res) => {
//       if (req.headers["x-no-compression"]) return false;
//       return compression.filter(req, res);
//     },
//   })
// );

// app.use(
//   cors({
//     origin: true, // Allow all origins for better performance (adjust for production)
//     credentials: false,
//     optionsSuccessStatus: 200,
//   })
// );

// app.use(
//   express.json({
//     limit: "10kb", // Limit payload size
//     strict: true,
//   })
// );

// // Optimized helmet configuration
// app.use(
//   helmet({
//     contentSecurityPolicy: false, // Disable CSP for API
//     crossOriginEmbedderPolicy: false,
//   })
// );

// // Memory-based rate limiter store for better performance
// const createMemoryStore = () => {
//   const store = new Map();
//   return {
//     incr: (key, callback) => {
//       const now = Date.now();
//       const record = store.get(key) || { count: 0, resetTime: now + 60000 };

//       if (now > record.resetTime) {
//         record.count = 1;
//         record.resetTime = now + 60000;
//       } else {
//         record.count++;
//       }

//       store.set(key, record);
//       callback(null, record.count, record.resetTime);
//     },
//     decrement: (key) => {
//       const record = store.get(key);
//       if (record && record.count > 0) {
//         record.count--;
//         store.set(key, record);
//       }
//     },
//     resetKey: (key) => {
//       store.delete(key);
//     },
//   };
// };

// const rateLimitStore = createMemoryStore();

// app.use(
//   "/certificate-info",
//   rateLimit({
//     windowMs: 60 * 1000,
//     max: 50, // Increased limit
//     store: rateLimitStore,
//     message: { error: "Too many requests. Please try again later." },
//     standardHeaders: false,
//     legacyHeaders: false,
//   })
// );

// app.use(
//   "/certificate-bulk",
//   rateLimit({
//     windowMs: 60 * 1000,
//     max: 15, // Slightly increased
//     store: rateLimitStore,
//     message: { error: "Too many bulk requests. Please try again later." },
//     standardHeaders: false,
//     legacyHeaders: false,
//   })
// );
// // ====== Optimized Utility Functions ======
// const formatLocalDate = (dateStr) => {
//   try {
//     return new Date(dateStr).toLocaleString("en-IN", {
//       timeZone: "Asia/Kolkata",
//       hour12: false,
//     });
//   } catch (error) {
//     console.warn(`⚠️ Date formatting error: ${error.message}`);
//     return dateStr;
//   }
// };

// const validateDomain = (domain) => {
//   if (typeof domain !== "string") return false;
//   const trimmed = domain.trim();
//   return (
//     trimmed.length > 0 &&
//     trimmed.length < 254 &&
//     /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(trimmed)
//   );
// };

// // Smart cache key generation
// const getCacheKey = (domain, port = 443) => `${domain.toLowerCase()}:${port}`;

// export const getSSLCertificateCached = async (domain, port = 443) => {
//   const cacheKey = getCacheKey(domain, port);

//   // Check main cache first
//   if (certCache.has(cacheKey)) {
//     console.log(`✅ [CACHE HIT] ${domain}`);
//     return certCache.get(cacheKey);
//   }

//   // Check failure cache
//   const failureKey = `fail:${cacheKey}`;
//   if (failureCache.has(failureKey)) {
//     const failureData = failureCache.get(failureKey);
//     if (Date.now() - failureData.timestamp < 60000) {
//       // 1 minute failure cache
//       throw new Error(failureData.error);
//     } else {
//       failureCache.delete(failureKey);
//     }
//   }

//   console.log(`🌐 [FETCHING] TLS data for ${domain}`);

//   return new Promise((resolve, reject) => {
//     const startTime = Date.now();
//     const socket = tls.connect(
//       {
//         host: domain,
//         port,
//         servername: domain,
//         rejectUnauthorized: false,
//         lookup: cachedLookup,
//         timeout: 6000, // Reduced timeout
//         secureProtocol: "TLS_method", // Use latest TLS
//         ciphers: "HIGH:!aNULL:!MD5:!RC4", // Optimize cipher selection
//       },
//       () => {
//         try {
//           const cert = socket.getPeerCertificate();
//           if (!cert || !Object.keys(cert).length) {
//             const error = "No certificate found.";
//             failureCache.set(failureKey, { error, timestamp: Date.now() });
//             return reject(new Error(error));
//           }

//           const certInfo = {
//             domain,
//             subject: {
//               commonName: cert.subject?.CN || "",
//               organization: cert.subject?.O || "<N/A>",
//               organizationalUnit: cert.subject?.OU || "<N/A>",
//             },
//             issuer: {
//               commonName: cert.issuer?.CN || "",
//               organization: cert.issuer?.O || "",
//               organizationalUnit: cert.issuer?.OU || "<N/A>",
//             },
//             issuedOn: formatLocalDate(cert.valid_from),
//             expiresOn: formatLocalDate(cert.valid_to),
//             serialNumber: cert.serialNumber,
//             fingerprint: cert.fingerprint256,
//             fetchTime: Date.now() - startTime,
//           };

//           certCache.set(cacheKey, certInfo);
//           resolve(certInfo);
//         } catch (error) {
//           const errorMsg = `Certificate processing error: ${error.message}`;
//           failureCache.set(failureKey, {
//             error: errorMsg,
//             timestamp: Date.now(),
//           });
//           reject(new Error(errorMsg));
//         } finally {
//           socket.end();
//         }
//       }
//     );

//     socket.on("error", (err) => {
//       const errorMsg = `TLS error for ${domain}: ${err.message}`;
//       console.error(`❌ ${errorMsg}`);
//       failureCache.set(failureKey, { error: errorMsg, timestamp: Date.now() });
//       reject(new Error(`TLS error for ${domain}`));
//     });

//     socket.setTimeout(6000, () => {
//       socket.destroy();
//       const errorMsg = "TLS request timed out.";
//       failureCache.set(failureKey, { error: errorMsg, timestamp: Date.now() });
//       reject(new Error(errorMsg));
//     });
//   });
// };

// // ====== Smart Domain Preloading ======
// const preloadDomains = async () => {
//   console.log("🚀 Prewarming TLS cache with smart prioritization...");
//   try {
//     const topDomains = await Domain.find()
//       .sort({ createdAt: -1 })
//       .limit(30) // Increased preload count
//       .lean()
//       .exec();

//     // Process in smaller concurrent batches for better performance
//     const CONCURRENT_PRELOAD = 5;
//     for (let i = 0; i < topDomains.length; i += CONCURRENT_PRELOAD) {
//       const batch = topDomains.slice(i, i + CONCURRENT_PRELOAD);
//       const promises = batch.map(async ({ domain }) => {
//         try {
//           await getSSLCertificateCached(domain);
//           return { domain, success: true };
//         } catch (e) {
//           console.warn(`⚠️ Failed to preload ${domain}: ${e.message}`);
//           return { domain, success: false };
//         }
//       });

//       await Promise.all(promises);
//       // Small delay between batches
//       if (i + CONCURRENT_PRELOAD < topDomains.length) {
//         await new Promise((resolve) => setTimeout(resolve, 200));
//       }
//     }

//     console.log(`✅ Prewarming completed. Cache size: ${certCache.size}`);
//   } catch (err) {
//     console.error("❌ Failed to preload domains:", err.message);
//   }
// };

// // ====== Optimized Helper Functions ======
// const parseLocalDateToUnix = (dateStr) => {
//   if (!dateStr) return null;

//   try {
//     const [datePart, timePart] = dateStr.split(",");
//     const [day, month, year] = datePart.trim().split("/").map(Number);
//     const [hours, minutes, seconds] = timePart.trim().split(":").map(Number);

//     const date = new Date(year, month - 1, day, hours, minutes, seconds);
//     return Math.floor(date.getTime() / 1000);
//   } catch (error) {
//     console.error(`❌ Date parsing error for "${dateStr}":`, error.message);
//     return null;
//   }
// };

// // Optimized domain processing with parallel SSL fetch
// const getDomainWithSSLData = async (domainDoc) => {
//   try {
//     const sslData = await getSSLCertificateCached(domainDoc.domain);

//     return {
//       ...domainDoc,
//       data: {
//         registrar: sslData.issuer?.organization || "-",
//         expiration_date: parseLocalDateToUnix(sslData.expiresOn),
//         issued_date: parseLocalDateToUnix(sslData.issuedOn),
//         raw_issued_date: sslData.issuedOn,
//         raw_expiry_date: sslData.expiresOn,
//       },
//       status: "success",
//       lastChecked: new Date(),
//     };
//   } catch (error) {
//     console.error(`❌ SSL Data Error for ${domainDoc.domain}:`, error.message);
//     return {
//       ...domainDoc,
//       data: null,
//       status: "error",
//       lastChecked: new Date(),
//     };
//   }
// };

// // Cached domain list retrieval
// const getCachedDomainList = async () => {
//   const now = Date.now();
//   if (domainListCache && now - domainListCacheTime < DOMAIN_LIST_CACHE_TTL) {
//     return domainListCache;
//   }

//   const domains = await Domain.find().sort({ createdAt: -1 }).lean().exec();

//   domainListCache = domains;
//   domainListCacheTime = now;
//   return domains;
// };

// // ====== Optimized Routes ======

// // 🔍 Get certificate info (single domain)
// app.get("/certificate-info", async (req, res) => {
//   const { domain } = req.query;

//   if (!validateDomain(domain)) {
//     return res.status(400).json({ error: "Invalid or missing domain." });
//   }

//   try {
//     const certInfo = await getSSLCertificateCached(domain.trim());

//     const enhancedCertInfo = {
//       ...certInfo,
//       expiration_date_unix: parseLocalDateToUnix(certInfo.expiresOn),
//       issued_date_unix: parseLocalDateToUnix(certInfo.issuedOn),
//     };

//     res.json(enhancedCertInfo);
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// // 📄 Get all domains with SSL data (bulk endpoint) - Optimized
// app.get("/certificate-bulk", async (_, res) => {
//   try {
//     console.log("🚀 [BULK REQUEST] Fetching all domains with SSL data...");
//     const domains = await getCachedDomainList();

//     // Optimized parallel processing with better concurrency control
//     const BATCH_SIZE = 8; // Optimized batch size
//     const results = [];

//     for (let i = 0; i < domains.length; i += BATCH_SIZE) {
//       const batch = domains.slice(i, i + BATCH_SIZE);
//       const batchPromises = batch.map((domain) => getDomainWithSSLData(domain));
//       const batchResults = await Promise.allSettled(batchPromises);

//       // Handle settled promises
//       batchResults.forEach((result, index) => {
//         if (result.status === "fulfilled") {
//           results.push(result.value);
//         } else {
//           console.error(
//             `❌ Batch error for ${batch[index].domain}:`,
//             result.reason
//           );
//           results.push({
//             ...batch[index],
//             data: null,
//             status: "error",
//             lastChecked: new Date(),
//           });
//         }
//       });

//       // Micro delay between batches
//       if (i + BATCH_SIZE < domains.length) {
//         await new Promise((resolve) => setTimeout(resolve, 50));
//       }
//     }

//     console.log(`✅ [BULK REQUEST] Processed ${results.length} domains`);
//     res.json(results);
//   } catch (err) {
//     console.error("❌ [BULK REQUEST] Error:", err.message);
//     res.status(500).json({ error: "Failed to fetch domains with SSL data." });
//   }
// });

// // 📄 List all domains (cached for performance)
// app.get("/certificate-list", async (_, res) => {
//   try {
//     const domains = await getCachedDomainList();
//     res.json(domains);
//   } catch (err) {
//     console.error("❌ [LIST] Error:", err.message);
//     res.status(500).json({ error: "Failed to fetch domains." });
//   }
// });

// // ➕ Add a domain and return it with SSL data (optimized)
// app.post("/certificate-create", async (req, res) => {
//   const { domain } = req.body;

//   if (!validateDomain(domain)) {
//     return res.status(400).json({ error: "Invalid domain." });
//   }

//   const domainTrimmed = domain.trim().toLowerCase();

//   try {
//     // Use faster findOne with lean()
//     const existing = await Domain.findOne({ domain: domainTrimmed })
//       .lean()
//       .exec();
//     if (existing) {
//       return res.status(409).json({ error: "Domain already exists." });
//     }

//     const newEntry = await Domain.create({ domain: domainTrimmed });

//     // Invalidate domain list cache
//     domainListCache = null;

//     // Get SSL data for the new domain
//     const domainWithSSLData = await getDomainWithSSLData({
//       _id: newEntry._id,
//       domain: newEntry.domain,
//       createdAt: newEntry.createdAt,
//     });

//     res.status(201).json({
//       message: "Domain added successfully",
//       domain: domainWithSSLData,
//     });
//   } catch (err) {
//     console.error("❌ [CREATE] Error:", err.message);
//     if (err.code === 11000) {
//       return res.status(409).json({ error: "Domain already exists." });
//     }
//     res.status(500).json({ error: "Failed to create domain." });
//   }
// });

// // 🔍 Get single domain with SSL data (optimized)
// app.get("/certificate-single/:id", async (req, res) => {
//   const { id } = req.params;

//   if (!mongoose.Types.ObjectId.isValid(id)) {
//     return res.status(400).json({ error: "Invalid ID format." });
//   }

//   try {
//     const domain = await Domain.findById(id).lean().exec();
//     if (!domain) {
//       return res.status(404).json({ error: "Domain not found." });
//     }

//     const domainWithSSLData = await getDomainWithSSLData(domain);
//     res.json(domainWithSSLData);
//   } catch (err) {
//     console.error("❌ [SINGLE] Error:", err.message);
//     res.status(500).json({ error: "Failed to fetch domain data." });
//   }
// });

// // ❌ Delete a domain (optimized)
// app.delete("/certificate-delete/:id", async (req, res) => {
//   const { id } = req.params;

//   if (!mongoose.Types.ObjectId.isValid(id)) {
//     return res.status(400).json({ error: "Invalid ID format." });
//   }

//   try {
//     const deleted = await Domain.findByIdAndDelete(id).lean().exec();
//     if (!deleted) {
//       return res.status(404).json({ error: "Domain not found." });
//     }

//     // Clean up caches
//     const cacheKey = getCacheKey(deleted.domain);
//     certCache.delete(cacheKey);
//     domainListCache = null; // Invalidate domain list cache

//     res.json({ message: "Domain deleted." });
//   } catch (err) {
//     console.error("❌ [DELETE] Error:", err.message);
//     res.status(500).json({ error: "Failed to delete domain." });
//   }
// });

// // Health check endpoint
// app.get("/health", (req, res) => {
//   res.json({
//     status: "healthy",
//     cache: {
//       cert_cache_size: certCache.size,
//       dns_cache_size: dnsCache.size,
//       failure_cache_size: failureCache.size,
//     },
//     memory: process.memoryUsage(),
//     uptime: process.uptime(),
//   });
// });

// // ====== Start Server with Optimizations ======
// const server = app.listen(PORT, () => {
//   console.log(`🚀 High-Performance Server running at http://localhost:${PORT}`);
//   console.log(
//     `📊 Cache sizes - Cert: ${MAX_CACHE_SIZE}, DNS TTL: ${DNS_CACHE_TTL}ms`
//   );
// });

// // Optimize server settings
// server.keepAliveTimeout = 65000; // Slightly higher than ALB idle timeout
// server.headersTimeout = 66000; // Slightly higher than keepAliveTimeout
// server.maxHeadersCount = 1000;
// server.timeout = 30000; // 30 second timeout

// // ====== Enhanced Graceful Shutdown ======
// const gracefulShutdown = () => {
//   console.log("\n🛑 Gracefully shutting down...");

//   server.close(() => {
//     console.log("🔌 HTTP server closed");

//     mongoose.connection.close(false, () => {
//       console.log("📦 MongoDB connection closed");

//       // Clear caches
//       certCache.clear();
//       dnsCache.clear();
//       failureCache.clear();

//       console.log("✅ Graceful shutdown completed");
//       process.exit(0);
//     });
//   });

//   // Force close after 10 seconds
//   setTimeout(() => {
//     console.error("⚠️ Forced shutdown after timeout");
//     process.exit(1);
//   }, 10000);
// };

// process.on("SIGINT", gracefulShutdown);
// process.on("SIGTERM", gracefulShutdown);

// // Handle uncaught exceptions
// process.on("uncaughtException", (err) => {
//   console.error("❌ Uncaught Exception:", err);
//   gracefulShutdown();
// });

// process.on("unhandledRejection", (reason, promise) => {
//   console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
// });

// // Memory optimization - periodic cleanup
// setInterval(() => {
//   if (global.gc) {
//     global.gc();
//   }
// }, 5 * 60 * 1000); // Every 5 minutes
