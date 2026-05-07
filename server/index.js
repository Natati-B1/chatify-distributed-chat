require("dotenv").config();

const path = require("path");
const http = require("http");
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const session = require("express-session");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { Server } = require("socket.io");
const { createAdapter } = require("@socket.io/redis-adapter");
const { createClient } = require("redis");
const RedisStore = require("connect-redis").default;

const User = require("./models/User");
const Message = require("./models/Message");

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-secret-change-me";
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/chatify";
const REDIS_URL = process.env.REDIS_URL || "";
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN || "";

const COOKIE_SECURE = process.env.COOKIE_SECURE === "true";

const app = express();
const server = http.createServer(app);

const ioCors = PUBLIC_ORIGIN
  ? { origin: PUBLIC_ORIGIN.split(",").map((s) => s.trim()), credentials: true }
  : { origin: true, credentials: true };

const io = new Server(server, { cors: ioCors, transports: ["websocket", "polling"] });

app.set("trust proxy", 1);
app.use(
  cors(
    PUBLIC_ORIGIN
      ? { origin: PUBLIC_ORIGIN.split(",").map((s) => s.trim()), credentials: true }
      : { origin: true, credentials: true }
  )
);
app.use(express.json());
app.use(cookieParser());

let sessionMiddleware;
let presenceClient;

function presenceKey(userId) {
  return `chatify:presence:${String(userId)}`;
}

async function buildPresenceClient() {
  if (!REDIS_URL) return null;
  const client = createClient({ url: REDIS_URL });
  client.on("error", (err) => console.error("Redis (presence) error:", err.message));
  await client.connect();
  return client;
}

async function presenceOn(userId) {
  if (!presenceClient) {
    await User.updateOne({ _id: userId }, { $set: { online: true } });
    io.emit("presence:update", { userId: String(userId), online: true });
    return;
  }
  const key = presenceKey(userId);
  const n = await presenceClient.incr(key);
  // Only broadcast "online" when first connection appears across ALL nodes.
  if (n === 1) {
    await User.updateOne({ _id: userId }, { $set: { online: true } });
    io.emit("presence:update", { userId: String(userId), online: true });
  }
}

async function presenceOff(userId) {
  if (!presenceClient) {
    await User.updateOne({ _id: userId }, { $set: { online: false } });
    io.emit("presence:update", { userId: String(userId), online: false });
    return;
  }
  const key = presenceKey(userId);
  let n = await presenceClient.decr(key);
  
  if (n < 0) {
    await presenceClient.set(key, "0");
    n = 0;
  }

  if (n === 0) {
    await User.updateOne({ _id: userId }, { $set: { online: false } });
    io.emit("presence:update", { userId: String(userId), online: false });
  }
}


async function finalizeUserOffline(userId) {
  const id = String(userId);
  if (presenceClient) {
    await presenceClient.del(presenceKey(id));
  }
  await User.updateOne({ _id: id }, { $set: { online: false } });
  io.emit("presence:update", { userId: id, online: false });
}

async function buildSessionMiddleware() {
  const base = {
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    name: "chatify.sid",
    cookie: {
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: "lax",
      secure: COOKIE_SECURE,
    },
  };

  if (REDIS_URL) {
    const client = createClient({ url: REDIS_URL });
    client.on("error", (err) => console.error("Redis (session) error:", err.message));
    await client.connect();
    return session({
      ...base,
      store: new RedisStore({ client, prefix: "chatify:sess:" }),
    });
  }

  console.warn("[chatify] REDIS_URL not set — using in-memory sessions (not for multi-node).");
  return session(base);
}

async function attachRedisAdapter() {
  if (!REDIS_URL) {
    console.warn("[chatify] Socket.io running without Redis adapter (single-node only).");
    return;
  }
  const pubClient = createClient({ url: REDIS_URL });
  const subClient = pubClient.duplicate();
  pubClient.on("error", (e) => console.error("Redis pub:", e.message));
  subClient.on("error", (e) => console.error("Redis sub:", e.message));
  await Promise.all([pubClient.connect(), subClient.connect()]);
  io.adapter(createAdapter(pubClient, subClient));
  console.log("[chatify] Socket.io Redis adapter enabled (pub/sub across nodes).");
}

function conversationId(a, b) {
  const ids = [String(a), String(b)].sort();
  return `${ids[0]}:${ids[1]}`;
}


const LEGACY_DEMO_EMAILS = [
  "alice@chatify.com",
  "bob@chatify.com",
  "charlie@chatify.com",
  "diana@chatify.com",
  "eve@chatify.com",
];

async function removeLegacyDemoAccounts() {
  const legacy = await User.find({ email: { $in: LEGACY_DEMO_EMAILS } }).select("_id").lean();
  if (!legacy.length) return;
  const ids = legacy.map((u) => u._id);
  const delMsgs = await Message.deleteMany({
    $or: [{ fromUserId: { $in: ids } }, { toUserId: { $in: ids } }],
  });
  const delUsers = await User.deleteMany({ _id: { $in: ids } });
  console.log(
    "[chatify] Removed legacy demo accounts:",
    delUsers.deletedCount,
    "users,",
    delMsgs.deletedCount,
    "messages"
  );
}

function setupRoutes() {
  app.use(sessionMiddleware);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "chatify" });
  });

  app.post("/api/register", async (req, res) => {
    try {
      const { email, password, displayName } = req.body;
      if (!email || !password || !displayName) {
        return res.status(400).json({ error: "Missing fields" });
      }
      if (await User.findOne({ email: email.toLowerCase() })) {
        return res.status(409).json({ error: "Email already registered" });
      }
      const passwordHash = await bcrypt.hash(password, 10);
      const user = await User.create({
        email: email.toLowerCase(),
        displayName: String(displayName).trim(),
        passwordHash,
      });
      req.session.userId = user._id.toString();
      req.session.email = user.email;
      req.session.displayName = user.displayName;
      res.json({
        user: { id: user._id, email: user.email, displayName: user.displayName },
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.post("/api/login", async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) return res.status(400).json({ error: "Missing credentials" });
      const user = await User.findOne({ email: email.toLowerCase() });
      if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
        return res.status(401).json({ error: "Invalid email or password" });
      }
      req.session.userId = user._id.toString();
      req.session.email = user.email;
      req.session.displayName = user.displayName;
      res.json({
        user: { id: user._id, email: user.email, displayName: user.displayName },
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.post("/api/logout", async (req, res) => {
    try {
      const uid = req.session?.userId;
      if (uid) {
        try {
          io.in(`user:${uid}`).disconnectSockets(true);
        } catch (err) {
          console.error("[chatify] disconnectSockets:", err.message);
        }
        await finalizeUserOffline(uid);
      }
      req.session.destroy(() => {
        res.clearCookie("chatify.sid");
        res.json({ ok: true });
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.get("/api/me", async (req, res) => {
    if (!req.session?.userId) return res.status(401).json({ error: "Unauthorized" });
    const user = await User.findById(req.session.userId).lean();
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    res.json({
      user: { id: user._id, email: user.email, displayName: user.displayName },
    });
  });

  app.get("/api/contacts", async (req, res) => {
    if (!req.session?.userId) return res.status(401).json({ error: "Unauthorized" });
    const me = req.session.userId;
    const users = await User.find({ _id: { $ne: me } })
      .select("displayName email online")
      .sort({ displayName: 1 })
      .lean();
    res.json({
      contacts: users.map((u) => ({
        id: u._id,
        name: u.displayName,
        email: u.email,
        online: u.online,
      })),
    });
  });

  app.get("/api/messages/:peerId", async (req, res) => {
    if (!req.session?.userId) return res.status(401).json({ error: "Unauthorized" });
    const me = req.session.userId;
    const peer = req.params.peerId;
    const conv = conversationId(me, peer);
    const rows = await Message.find({ conversationId: conv })
      .sort({ createdAt: 1 })
      .limit(200)
      .lean();
    res.json({
      messages: rows.map((m) => ({
        id: m._id,
        body: m.body,
        fromUserId: String(m.fromUserId),
        toUserId: String(m.toUserId),
        createdAt: m.createdAt,
        readAt: m.readAt,
      })),
    });
  });

  const publicDir = path.join(__dirname, "..", "public");
  app.use(express.static(publicDir));
}

function setupSocketIO() {
  io.use((socket, next) => {
    sessionMiddleware(socket.request, {}, next);
  });

  io.use((socket, next) => {
    const sid = socket.request.session?.userId;
    if (!sid) return next(new Error("Unauthorized"));
    socket.userId = sid;
    next();
  });

  io.on("connection", async (socket) => {
    const userId = socket.userId;
    socket.join(`user:${userId}`);
    await presenceOn(userId);

    socket.on("message:send", async (payload, cb) => {
      try {
        const { toUserId, body } = payload || {};
        if (!toUserId || !body || !String(body).trim()) {
          return cb?.({ error: "Invalid message" });
        }
        const conv = conversationId(userId, toUserId);
        const msg = await Message.create({
          conversationId: conv,
          fromUserId: userId,
          toUserId,
          body: String(body).trim(),
          readAt: new Date(),
        });
        const sender = await User.findById(userId).select("displayName").lean();
        const out = {
          id: msg._id,
          body: msg.body,
          fromUserId: String(msg.fromUserId),
          toUserId: String(msg.toUserId),
          fromName: sender?.displayName || "Someone",
          createdAt: msg.createdAt,
          readAt: msg.readAt,
        };
        io.to(`user:${toUserId}`).emit("message:new", out);
        io.to(`user:${userId}`).emit("message:new", out);
        cb?.({ ok: true, message: out });
      } catch (e) {
        console.error(e);
        cb?.({ error: "Failed to send" });
      }
    });

    socket.on("disconnect", async () => {
      await presenceOff(userId);
    });
  });
}

async function main() {
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  console.log("[chatify] MongoDB connected");

  await removeLegacyDemoAccounts();

  presenceClient = await buildPresenceClient();

  sessionMiddleware = await buildSessionMiddleware();
  await attachRedisAdapter();
  setupRoutes();
  setupSocketIO();

  server.listen(PORT, HOST, () => {
    console.log(`[chatify] listening on http://localhost:${PORT} (bind ${HOST} — use your LAN IP from other devices)`);
  });
}

main().catch((err) => {
  if (err?.name === "MongooseServerSelectionError" || String(err?.message).includes("ECONNREFUSED")) {
    console.error(
      "[chatify] Cannot reach MongoDB at",
      MONGODB_URI,
      "\n  Start MongoDB locally, or run: docker compose up -d mongo redis"
    );
  } else {
    console.error(err);
  }
  process.exit(1);
});
