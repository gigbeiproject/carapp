// Logs every API call to the console: method, URL, status, time taken,
// plus query/body (with sensitive fields masked) and the error response for 4xx/5xx.
// Disable with LOG_REQUESTS=false in .env.

const SENSITIVE_KEYS = ["password", "otp", "token", "authorization", "secret", "cardnumber", "cvv"];

const mask = (value) => {
  if (Array.isArray(value)) return value.map(mask);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) =>
        SENSITIVE_KEYS.some((s) => k.toLowerCase().includes(s)) ? [k, "***"] : [k, mask(v)]
      )
    );
  }
  return value;
};

const short = (obj, max = 1000) => {
  const s = typeof obj === "string" ? obj : JSON.stringify(obj);
  return s.length > max ? `${s.slice(0, max)}…(${s.length} chars)` : s;
};

const requestLogger = (req, res, next) => {
  if (process.env.LOG_REQUESTS === "false") return next();

  const start = process.hrtime.bigint();
  const time = new Date().toLocaleTimeString("en-IN", { hour12: false });

  // Capture the response body so failed calls show what was sent back.
  let responseBody;
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    responseBody = body;
    return originalJson(body);
  };

  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    const status = res.statusCode;
    const icon = status >= 500 ? "❌" : status >= 400 ? "⚠️ " : "✅";

    console.log(`${icon} [${time}] ${req.method} ${req.originalUrl} → ${status} (${ms.toFixed(0)} ms)`);

    if (Object.keys(req.query || {}).length) console.log(`   query: ${short(mask(req.query))}`);
    if (req.body && Object.keys(req.body).length) console.log(`   body:  ${short(mask(req.body))}`);
    if (status >= 400 && responseBody !== undefined) console.log(`   response: ${short(mask(responseBody))}`);
  });

  next();
};

module.exports = requestLogger;
