require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const e = require('express');
const multer = require('multer');
const fs = require('fs');
const app = express();

// ==========================================
// 1. SECURITY & MIDDLEWARE CONFIGURATION
// ==========================================

// Set secure HTTP response headers (disables default Content Security Policy for inline Tailwind scripts)
app.use(helmet({ contentSecurityPolicy: false }));

// Enable CORS for client applications
app.use(cors({ origin: process.env.CLIENT_URL || '*', credentials: true }));

// Limit request body size to block memory allocation / payload bomb attacks
app.use(express.json({ limit: '15mb' }));

// Sanitize user inputs to prevent MongoDB NoSQL operator injection & XSS
app.use(mongoSanitize());
app.use(xss());

// Global Rate Limiting (Prevents DDoS and bot spamming)
app.use('/api/', rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 200, // Limit each IP to 200 requests per 15 minutes
    message: { error: 'Too many requests from this IP. Please try again after 15 minutes.' }
}));
// Ensure the uploads directory exists
const uploadDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure Multer storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ storage });
// Serve static frontend files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Explicit page navigation routes for multi-page static site
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/directory', (req, res) => res.sendFile(path.join(__dirname, 'public', 'directory.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));
app.get('/edit-profile', (req, res) => res.sendFile(path.join(__dirname, 'public', 'edit-profile.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-login.html')));
app.get('/admin/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-dashboard.html')));

// ==========================================
// 2. DATABASE CONNECTION
// ==========================================
// Add this helper function below mongoose.connect
async function seedDefaultContent() {
    try {
        const aboutCount = await About.countDocuments();
        if (aboutCount === 0) {
            await About.create({
                title: "About the League",
                content: "The Bamundi Gram Premier League (BGPL) is the flagship local cricket tournament bringing together talented players, passionate cricket enthusiasts, and village sports lovers to foster grassroots talent and community unity."
            });
        }
        const ruleCount = await Rule.countDocuments();
        if (ruleCount === 0) {
            await Rule.insertMany([
                { ruleNumber: 1, title: "Player Verification", description: "All registered players must submit identity details for verification before the live auction phase." },
                { ruleNumber: 2, title: "Umpire Decision", description: "Umpires' decisions on the field are final and binding. Unsportsmanlike conduct leads to penalties." },
                { ruleNumber: 3, title: "Auction & Base Price", description: "Base price for approved players starts at ₹500. Franchise owners must stay within purse limits." },
                { ruleNumber: 4, title: "Match Timings", description: "Teams must report 30 minutes prior to scheduled match timings. Strict adherence to time is mandatory." }
            ]);
        }
        const feesCount = await FeeConfig.findOne({ key: 'tournament_settings' });
        if (!feesCount) {
            await FeeConfig.create({
                key: 'tournament_settings',
                playerFee: 500,
                ownerFee: 2000,
                bothFee: 2500,
                upiId: 'bgpl2026@upi',
                qrCodeUrl: '/uploads/qr-default.png'
            });
        }

    } catch (err) {
        console.error("Default content seeding failed:", err);
    }
}

mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/bgpl_tournament')
  .then(async () => {
    console.log('Secure MongoDB Connected');
    await seedDefaultContent();
  })
  .catch(err => console.error('MongoDB Connection Error:', err));


// ==========================================
// 3. DATABASE SCHEMAS & MODELS
// ==========================================

// Player & Team Owner Schema (With Masked Identity Protection & Edit Queue)
const registrantSchema = new mongoose.Schema({
    fullName: { type: String, required: true, trim: true },
    role: { type: String, enum: ['Player', 'Team Owner', 'Both'], required: true },
    phone: { type: String, required: true, unique: true },
    email: { type: String, unique: true , default: ''},
    maskedAadhaar: { type: String, required: true },
    status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
    auctionStatus: { type: String, enum: ['Unsold', 'Bidding', 'Sold'], default: 'Unsold' },
    basePrice: { type: Number, default: 500 },
    soldPrice: { type: Number, default: 0 },
    assignedTeam: { type: String, default: 'None' },
    photoUrl: { type: String, default: '' },
    paymentScreenshotUrl: { type: String, default: '' },
    paymentVerified: { type: Boolean, default: false },
    pendingEdit: {
        fullName: { type: String },
        photoUrl: { type: String },
        phone: { type: String },
        email: { type: String },
        paymentScreenshotUrl: { type: String },
        maskedAadhaar: { type: String },
        hasPendingChanges: { type: Boolean, default: false }
    },
    createdAt: { type: Date, default: Date.now }
});

const noticeSchema = new mongoose.Schema({
    title: { type: String, required: true },
    content: { type: String, required: true },
    category: { type: String, enum: ['Urgent', 'Match', 'Auction', 'General'], default: 'General' },
    createdAt: { type: Date, default: Date.now }
});

const matchSchema = new mongoose.Schema({
    teamA: { type: String, required: true },
    teamB: { type: String, required: true },
    venue: { type: String, required: true },
    matchDate: { type: Date, required: true },
    status: { type: String, enum: ['Scheduled', 'Live', 'Completed'], default: 'Scheduled' },
    result: { type: String, default: 'TBD' }
});

const prizeSchema = new mongoose.Schema({
    title: { type: String, required: true },
    amount: { type: Number, required: true },
    perks: { type: String, default: '' }
});

const committeeSchema = new mongoose.Schema({
    name: { type: String, required: true },
    designation: { type: String, required: true },
    phone: { type: String, required: true },
    photoUrl: { type: String, default: '' }
});

const slideSchema = new mongoose.Schema({
    imageUrl: { type: String, required: true },
    caption: { type: String, default: '' },
    order: { type: Number, default: 0 }
});
const ruleSchema = new mongoose.Schema({
    ruleNumber: { type: Number, required: true },
    title: { type: String, required: true },
    description: { type: String, required: true }
});

const aboutSchema = new mongoose.Schema({
    title: { type: String, default: 'About the League' },
    content: { type: String, required: true }
});
const feesSchema = new mongoose.Schema({
    key: { type: String, default: 'tournament_settings', unique: true },
    playerFee: { type: Number, default: 500 },
    ownerFee: { type: Number, default: 2000 },
    bothFee: { type: Number, default: 2500 },
    upiId: { type: String, default: 'bgpl2026@upi' },
    qrCodeUrl: { type: String, default: '/uploads/qr-default.png' }
});

const Rule = mongoose.model('Rule', ruleSchema);
const About = mongoose.model('About', aboutSchema);
const Registrant = mongoose.model('Registrant', registrantSchema);
const Notice = mongoose.model('Notice', noticeSchema);
const Match = mongoose.model('Match', matchSchema);
const Prize = mongoose.model('Prize', prizeSchema);
const Committee = mongoose.model('Committee', committeeSchema);
const Slide = mongoose.model('Slide', slideSchema);
const FeeConfig = mongoose.model('FeeConfig', feesSchema);
// ==========================================
// 4. AUTHENTICATION & JWT MIDDLEWARE
// ==========================================

const verifyAdminJwt = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(403).json({ error: 'Admin access token required.' });

    jwt.verify(token, process.env.JWT_SECRET || 'supersecret_jwt_key', (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid or expired session token.' });
        req.user = user;
        next();
    });
};

// Admin Login Route
app.post('/api/admin/login', (req, res) => {
    const { username, pin } = req.body;
    const expectedUser = process.env.ADMIN_USER || 'admin';
    const expectedPin = process.env.ADMIN_PLAINTEXT_PIN || 'admin123';

    if (username === expectedUser && pin === expectedPin) {
        const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET || 'supersecret_jwt_key', { expiresIn: '6h' });
        return res.json({ success: true, token });
    }
    res.status(401).json({ error: 'Invalid admin credentials.' });
});

// ==========================================
// 5. PUBLIC API ROUTES
// ==========================================

// Get all public tournament information
app.get('/api/public/data', async (req, res) => {
    try {
        const { filter } = req.query;
        const notices = await Notice.find().sort({ createdAt: -1 });
        const matches = await Match.find({ status: 'Scheduled' }).sort({ matchDate: 1 });
        const prizes = await Prize.find();
        const committee = await Committee.find();
        const slides = await Slide.find().sort({ order: 1 });
        //const approvedPlayers = await Registrant.find({ status: 'Approved' }).select('-__v');
        const rules = await Rule.find().sort({ ruleNumber: 1 });
        const about = await About.findOne() || { title: 'About the League', content: 'The Bamundi Gram Premier League (BGPL) brings together local cricket talent...' };
        // Build query filter based on request parameter
        let query = { status: 'Approved' };
        if (filter === 'Player') {
            query.role = { $in: ['Player', 'Both'] };
        } else if (filter === 'Owner') {
            query.role = { $in: ['Team Owner', 'Both'] };
        }
        const approvedPlayers = await Registrant.find(query).select('-__v');
        res.json({ notices, matches, prizes, committee, slides, players: approvedPlayers, rules, about });
    } catch (err) {
        res.status(500).json({ error: 'Could not fetch tournament data.' });
    }
});
// Submit New Player / Owner Registration
app.post('/api/register', async (req, res) => {
    try {
        const { fullName, role, phone,email, aadhaar, photoUrl, paymentScreenshotUrl } = req.body;
        if (!fullName || !phone || !aadhaar) {
            return res.status(400).json({ error: 'Required identity fields missing.' });
        }
        
        const existing = await Registrant.findOne({ phone });
        if (existing) {
            return res.status(400).json({ error: 'A registration with this phone number already exists.' });
        }

        // Redact & mask raw identity input before writing to database
        const lastFour = aadhaar.slice(-4);
        const maskedAadhaar = `XXXX-XXXX-${lastFour}`;

        const registrant = new Registrant({
            fullName,
            role,
            phone,
            email,
            maskedAadhaar,
            photoUrl: photoUrl || '',
            paymentScreenshotUrl: paymentScreenshotUrl || ''
        });

        await registrant.save();
        res.status(201).json({ success: true, message: 'Registration submitted successfully for verification.' });
    } catch (err) {
        res.status(500).json({ error: 'Registration submission failed.' });
    }
});

// Self-Service Profile Edit Request (Staged until Admin approval)
app.post('/api/profile/request-edit', async (req, res) => {
    try {
        const { phone, fullName, photoUrl, paymentScreenshotUrl, aadhaar } = req.body;
        if (!phone) return res.status(400).json({ error: 'Phone number is required.' });

        const registrant = await Registrant.findOne({ phone });
        if (!registrant) return res.status(404).json({ error: 'Profile not found.' });

        let maskedAadhaar = registrant.maskedAadhaar;
        if (aadhaar && aadhaar.length >= 4) {
            maskedAadhaar = `XXXX-XXXX-${aadhaar.slice(-4)}`;
        }

        // Store into pendingEdit sub-document queue
        registrant.pendingEdit = {
            fullName: fullName || registrant.fullName,
            photoUrl: photoUrl !== undefined ? photoUrl : registrant.photoUrl,
            paymentScreenshotUrl: paymentScreenshotUrl !== undefined ? paymentScreenshotUrl : registrant.paymentScreenshotUrl,
            maskedAadhaar,
            hasPendingChanges: true
        };

        await registrant.save();
        res.json({ success: true, message: 'Edit request submitted for admin approval.' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to submit edit request.' });
    }
});
// Public API to fetch configuration
app.get('/api/public/config', async (req, res) => {
    try {
        const config = await FeeConfig.findOne({ key: 'tournament_settings' }) || {
            playerFee: 500, ownerFee: 2000, bothFee: 2500, upiId: 'bgpl2026@upi', qrCodeUrl: ''
        };
        res.json(config);
    } catch (err) {
        res.status(500).json({ error: 'Could not fetch tournament configuration.' });
    }
});


// ==========================================
// 6. ADMIN PROTECTED ROUTES (JWT REQUIRED)
// ==========================================

// Get Analytics Overview
app.get('/api/admin/analytics', verifyAdminJwt, async (req, res) => {
    try {
        const totalPlayers = await Registrant.countDocuments({ role: { $in: ['Player', 'Both'] } });
        const totalOwners = await Registrant.countDocuments({ role: { $in: ['Team Owner', 'Both'] } });
        const pendingApprovals = await Registrant.countDocuments({ status: 'Pending' });
        const pendingEditsCount = await Registrant.countDocuments({ 'pendingEdit.hasPendingChanges': true });
        
        res.json({
            registrations: { totalPlayers, totalOwners, pendingApprovals, pendingEditsCount },
            upcomingMatchesCount: await Match.countDocuments({ status: 'Scheduled' }),
            totalNotices: await Notice.countDocuments()
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to generate analytics.' });
    }
});
// Rules CRUD
app.post('/api/admin/rules', verifyAdminJwt, async (req, res) => {
    const rule = new Rule(req.body);
    await rule.save();
    res.status(201).json({ success: true, rule });
});

app.put('/api/admin/rules/:id', verifyAdminJwt, async (req, res) => {
    const updated = await Rule.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ success: true, updated });
});

app.delete('/api/admin/rules/:id', verifyAdminJwt, async (req, res) => {
    await Rule.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Rule deleted.' });
});

// About Section Update
app.post('/api/admin/about', verifyAdminJwt, async (req, res) => {
    let about = await About.findOne();
    if (about) {
        about.title = req.body.title || about.title;
        about.content = req.body.content || about.content;
        await about.save();
    } else {
        about = new About(req.body);
        await about.save();
    }
    res.json({ success: true, about });
});
// Get All Registrants
app.get('/api/admin/registrants', verifyAdminJwt, async (req, res) => {
    try {
        const registrants = await Registrant.find().sort({ createdAt: -1 });
        res.json(registrants);
    } catch (err) {
        res.status(500).json({ error: 'Could not fetch registrants list.' });
    }
});

// Approve or Reject Staged Profile Edits
app.post('/api/admin/registrants/:id/handle-edits', verifyAdminJwt, async (req, res) => {
    try {
        const { action } = req.body; // 'approve' or 'reject'
        const registrant = await Registrant.findById(req.params.id);
        if (!registrant || !registrant.pendingEdit?.hasPendingChanges) {
            return res.status(400).json({ error: 'No pending edits found.' });
        }

        if (action === 'approve') {
            registrant.fullName = registrant.pendingEdit.fullName || registrant.fullName;
            registrant.photoUrl = registrant.pendingEdit.photoUrl || registrant.photoUrl;
            registrant.paymentScreenshotUrl = registrant.pendingEdit.paymentScreenshotUrl || registrant.paymentScreenshotUrl;
            registrant.maskedAadhaar = registrant.pendingEdit.maskedAadhaar || registrant.maskedAadhaar;
        }

        registrant.pendingEdit = { hasPendingChanges: false };
        await registrant.save();
        res.json({ success: true, message: `Profile edit request ${action}d.` });
    } catch (err) {
        res.status(500).json({ error: 'Failed to process edit request.' });
    }
});

// Update Registrant (Approval Status / Auction Prices)
app.put('/api/admin/registrant/:id', verifyAdminJwt, async (req, res) => {
    try {
        const updated = await Registrant.findByIdAndUpdate(req.params.id, req.body, { new: true });
        res.json({ success: true, updated });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update record.' });
    }
});

// Delete Registrant
app.delete('/api/admin/registrant/:id', verifyAdminJwt, async (req, res) => {
    try {
        await Registrant.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'Registrant record deleted.' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete record.' });
    }
});

// Manage Notices CRUD
app.post('/api/admin/notices', verifyAdminJwt, async (req, res) => {
    const notice = new Notice(req.body);
    await notice.save();
    res.status(201).json({ success: true, notice });
});

app.delete('/api/admin/notices/:id', verifyAdminJwt, async (req, res) => {
    await Notice.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Notice deleted.' });
});

// Manage Matches CRUD
app.post('/api/admin/matches', verifyAdminJwt, async (req, res) => {
    const match = new Match(req.body);
    await match.save();
    res.status(201).json({ success: true, match });
});

app.delete('/api/admin/matches/:id', verifyAdminJwt, async (req, res) => {
    await Match.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Match deleted.' });
});

// Manage Prizes CRUD
app.post('/api/admin/prizes', verifyAdminJwt, async (req, res) => {
    const prize = new Prize(req.body);
    await prize.save();
    res.status(201).json({ success: true, prize });
});

app.delete('/api/admin/prizes/:id', verifyAdminJwt, async (req, res) => {
    await Prize.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Prize deleted.' });
});

// Manage Committee CRUD
app.post('/api/admin/committee', verifyAdminJwt, async (req, res) => {
    const member = new Committee(req.body);
    await member.save();
    res.status(201).json({ success: true, member });
});

app.delete('/api/admin/committee/:id', verifyAdminJwt, async (req, res) => {
    await Committee.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Committee member deleted.' });
});

// Manage Photo Slides CRUD
app.post('/api/admin/slides', verifyAdminJwt, async (req, res) => {
    const slide = new Slide(req.body);
    await slide.save();
    res.status(201).json({ success: true, slide });
});

app.delete('/api/admin/slides/:id', verifyAdminJwt, async (req, res) => {
    await Slide.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Slide deleted.' });
});
// Admin API to update fees, UPI ID, and QR code (Protected)
app.post('/api/admin/config', verifyAdminJwt, upload.single('qrCodeFile'), async (req, res) => {
    try {
        const { playerFee, ownerFee, bothFee, upiId } = req.body;
        
        let updateData = {
            playerFee: Number(playerFee),
            ownerFee: Number(ownerFee),
            bothFee: Number(bothFee),
            upiId
        };

        if (req.file) {
            updateData.qrCodeUrl = `/uploads/${req.file.filename}`;
        }

        await FeeConfig.findOneAndUpdate(
            { key: 'tournament_settings' },
            updateData,
            { upsert: true, new: true }
        );

        res.json({ message: 'Tournament settings updated successfully!' });
    } catch (err) {
        console.error("Config update error:", err);
        res.status(500).json({ error: 'Failed to update configuration.' });
    }
});

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Modular BGPL Server active at http://localhost:${PORT}`));