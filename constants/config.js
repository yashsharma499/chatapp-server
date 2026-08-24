// Allowed browser origins. CLIENT_URL may hold a single URL or a comma
// separated list so preview deployments can be whitelisted without a redeploy.
const clientUrls = (process.env.CLIENT_URL || "")
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);

const corsOptions = {
  origin: [
    "http://localhost:5173",
    "http://localhost:4173",
    "http://127.0.0.1:5173",
    ...clientUrls,
  ],
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  credentials: true,
};

const CHATTU_TOKEN = "chattu-token";
const CHATTU_ADMIN_TOKEN = "chattu-admin-token";

export { corsOptions, CHATTU_TOKEN, CHATTU_ADMIN_TOKEN };
