const express = require("express");
const tls = require("tls");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

function formatLocalDate(dateStr) {
  return new Date(dateStr).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour12: false,
  });
}

function getSSLCertificate(domain, port = 443) {
  return new Promise((resolve, reject) => {
    const options = {
      host: domain,
      port: port,
      servername: domain,
      rejectUnauthorized: false,
    };

    const socket = tls.connect(options, () => {
      const cert = socket.getPeerCertificate(false);
      if (!cert || Object.keys(cert).length === 0) {
        return reject(new Error("No certificate found."));
      }

      resolve({
        domain,
        subject: {
          commonName: cert.subject.CN || "",
          organization: cert.subject.O || "<Not part of certificate>",
          organizationalUnit: cert.subject.OU || "<Not part of certificate>",
        },
        issuer: {
          commonName: cert.issuer.CN || "",
          organization: cert.issuer.O || "",
          organizationalUnit: cert.issuer.OU || "<Not part of certificate>",
        },
        issuedOn: formatLocalDate(cert.valid_from),
        expiresOn: formatLocalDate(cert.valid_to),
        serialNumber: cert.serialNumber,
        fingerprint: cert.fingerprint256,
      });

      socket.end();
    });

    socket.on("error", (err) => {
      reject(err);
    });
  });
}

app.get("/certificate-info", async (req, res) => {
  const domain = req.query.domain;

  if (!domain) {
    return res.status(400).json({ error: "Missing domain parameter." });
  }

  try {
    const certInfo = await getSSLCertificate(domain);
    res.json(certInfo);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
