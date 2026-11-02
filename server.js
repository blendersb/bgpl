const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

const JWT_SECRET = process.env.JWT_SECRET || 'bgpl_super_secure_secret_key_2026';
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://your_username:your_password@cluster.mongodb.net/bamundi_db?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
  .then(() => console.log("Connected to MongoDB successfully"))
  .catch(err => console.error("MongoDB connection error:", err));

// Database Schema
const AppSchema = new mongoose.Schema({
  key: { type: String, unique: true, default: 'main_state' },
  payload: {
    notices: Array, // Array of notice objects: [{ id, text, timestamp }]
    prize: Array,
    teams: Array,
    players: Array
  }
});
const AppModel = mongoose.model('AppModel', AppSchema);

// Default state with initial notice array
const DEFAULT_STATE = {
  notices: [
    { id: 101, text: "Welcome to Bamundi Gram Premier League 2026! Player registrations are now open.", timestamp: Date.now() }
  ],
  prize: [
    { position: 'Winner', amount: 50000, order: 1 },
    { position: '1st Runner Up', amount: 30000, order: 2 },
    { position: '2nd Runner Up', amount: 20000, order: 3 }
  ],
  teams: [
    { id: 't1', name: 'Bamundi Strikers', purse: 100000 },
    { id: 't2', name: 'Royal Challengers Bamundi', purse: 100000 },
    { id: 't3', name: 'Bamundi Titans', purse: 100000 },
    { id: 't4', name: 'Bamundi Super Kings', purse: 100000 }
  ],
  players: [
    { id: 101, name: 'Aman Kumar', role: 'Batsman', phone: '9876543210', utr: 'UTR981273', team: 'Bamundi Strikers', auctionRate: 12500, status: 'Approved' }
  ]
};

async function getDBState() {
  let doc = await AppModel.findOne({ key: 'main_state' });
  if (!doc) {
    doc = new AppModel({ key: 'main_state', payload: DEFAULT_STATE });
    await doc.save();
  }
  // Ensure array structure if migrating from older single-notice string
  if (!Array.isArray(doc.payload.notices)) {
    const oldNoticeText = doc.payload.notice || "Welcome to BGPL 2026!";
    doc.payload.notices = [{ id: Date.now(), text: oldNoticeText, timestamp: Date.now() }];
    doc.markModified('payload');
    await doc.save();
  }
  return doc.payload;
}

// Middleware for Admin Auth
function verifyAdmin(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized: No token provided' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Forbidden: Invalid or expired token' });
    req.user = user;
    next();
  });
}

// ================= API ENDPOINTS =================

app.get('/api/data', async (req, res) => {
  try {
    const data = await getDBState();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;
  const ADMIN_USER = process.env.ADMIN_USER || "admin";
  const ADMIN_PASS = process.env.ADMIN_PASS || "bgpl2026@admin";

  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '4h' });
    return res.json({ success: true, token });
  }
  res.status(401).json({ success: false, error: 'Invalid admin credentials' });
});

// SECURED: Add New Notice (Prepends to make it newest first)
app.post('/api/notice', verifyAdmin, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: "Notice text is required" });

    let doc = await AppModel.findOne({ key: 'main_state' });
    const newNotice = {
      id: Date.now(),
      text: text.trim(),
      timestamp: Date.now()
    };
    
    // Unshift adds to the beginning (newest first)
    doc.payload.notices.unshift(newNotice);
    doc.markModified('payload');
    await doc.save();
    
    res.json({ success: true, notices: doc.payload.notices });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SECURED: Delete a Notice by ID
app.delete('/api/notice/:id', verifyAdmin, async (req, res) => {
  try {
    const noticeId = Number(req.params.id);
    let doc = await AppModel.findOne({ key: 'main_state' });
    doc.payload.notices = doc.payload.notices.filter(n => n.id !== noticeId);
    doc.markModified('payload');
    await doc.save();
    res.json({ success: true, notices: doc.payload.notices });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SECURED: Update Prize Money
app.put('/api/prize', verifyAdmin, async (req, res) => {
  try {
    const { prize } = req.body;
    let doc = await AppModel.findOne({ key: 'main_state' });
    doc.payload.prize = prize;
    doc.markModified('payload');
    await doc.save();
    res.json({ success: true, prize: doc.payload.prize });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUBLIC: Register Player
app.post('/api/register', async (req, res) => {
  try {
    const newPlayer = { id: Date.now(), ...req.body, status: 'Pending', team: 'Pending', auctionRate: 0 };
    let doc = await AppModel.findOne({ key: 'main_state' });
    doc.payload.players.push(newPlayer);
    doc.markModified('payload');
    await doc.save();
    res.json({ success: true, player: newPlayer });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SECURED: Approve / Update Player
app.put('/api/player/:id', verifyAdmin, async (req, res) => {
  try {
    const playerId = Number(req.params.id);
    const { team, auctionRate, status } = req.body;
    let doc = await AppModel.findOne({ key: 'main_state' });
    
    const player = doc.payload.players.find(p => p.id === playerId);
    if (!player) return res.status(404).json({ error: 'Player not found' });

    if (team !== undefined) player.team = team;
    if (auctionRate !== undefined) player.auctionRate = Number(auctionRate);
    if (status !== undefined) player.status = status;

    doc.markModified('payload');
    await doc.save();
    res.json({ success: true, players: doc.payload.players });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`BGPL Secure Server running on port ${PORT}`));