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
const bcrypt = require('bcrypt');
const { type } = require('os');
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
                upiId: 'bgpl2027@upi',
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
    await seedDefaultPrizes();
  })
  .catch(err => console.error('MongoDB Connection Error:', err));


// ==========================================
// 3. DATABASE SCHEMAS & MODELS
// ==========================================
// Hash password before saving new registration

// Player & Team Owner Schema (With Masked Identity Protection & Edit Queue)
const registrantSchema = new mongoose.Schema({
    playerId: { 
        type: String, 
        unique: true, 
        index: true 
    },
    fullName: { type: String, required: true, trim: true },
    role: { type: String, enum: ['Player', 'Team Owner', 'Both'], required: true },
    phone: { type: String, required: true, unique: true },
    email: { 
        type: String, 
        unique: true, 
        sparse: true, // Allows multiple documents to have no email (null/undefined)
        lowercase: true,
        trim: true,
        set: v => v === '' ? undefined : v // Converts empty strings to undefined automatically
    },
    password: { type: String, required: true },
    aadhaar: { type: String, required: true },
    age: { type: Number, default: 0 },
    address: { type: String, default: '' },
    description: { type: String, default: '' },
    status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
    auctionStatus: { type: String, enum: ['Unsold', 'Bidding', 'Sold'], default: 'Unsold' },
    category: { type: String, enum: ['Batsman', 'Bowler', 'All-Rounder','Wicket-Keeper','Wicket-Keeper + Batsman'], default: 'All Rounder' },
    basePrice: { type: Number, default: 500 },
    soldPrice: { type: Number, default: 0 },
    teamName: { type: String, default: '' },
    assignedTeam: { type: String, default: '' },
    teamDesignation: { type: String, default: '' },
    photoUrl: { type: String, default: '' },
    aadharPhotoUrl: { type: String, default: '' },
    teamLogoUrl: { type: String, default: '' },
    walletBalance: {type: Number, default: 0},
    paymentScreenshotUrl: { type: String, default: '' },
    paymentVerified: { type: Boolean, default: false },
    style : { type: String, enum: ['Right-Handed', 'Left-Handed'], default: 'Right-Handed' },
    jerseySize : { type: String, enum: ['S', 'M', 'L', 'XL','XXL'], default: 'M' },
    // pendingEdit: {
    //     fullName: { type: String },
    //     photoUrl: { type: String },
    //     phone: { type: String },
    //     email: { type: String },
    //     paymentScreenshotUrl: { type: String },
    //     maskedAadhaar: { type: String },
    //     hasPendingChanges: { type: Boolean, default: false }
    // },
    createdAt: { type: Date, default: Date.now }
});
// Middleware to auto-generate playerId ONLY on document creation
registrantSchema.pre('validate', function(next) {
    if (this.isNew && !this.playerId) {
        const randomFourDigits = Math.floor(1000 + Math.random() * 9000);
        this.playerId = `BGPL-${randomFourDigits}`;
    }
    next();
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

// --- Schemas & Models ---
const prizeSchema = new mongoose.Schema({
    title: { type: String, required: true },
    amount: { type: Number, required: true },
    perks: { type: String, default: '' },
    order: { type: Number, default: 0 }
});

// Seed default prizes on startup if none exist
async function seedDefaultPrizes() {
    const count = await Prize.countDocuments();
    if (count === 0) {
        await Prize.insertMany([
            { title: '1st Champions', amount: 50000, perks: 'Grand Trophy + Gold Medals', order: 1 },
            { title: '2nd Runners-Up', amount: 25000, perks: 'Runner Trophy + Silver Medals', order: 2 },
            { title: 'Man of the Tournament', amount: 5000, perks: 'Individual Trophy & Kit', order: 3 }
        ]);
    }
}

const committeeSchema = new mongoose.Schema({
    name: { type: String, required: true },
    designation: { type: String, required: true },
    phone: { type: String, required: true },
    photoUrl: { type: String, default: '' },
    order: { type: Number, default: 0 }
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
    upiId: { type: String, default: 'bgpl2027@upi' },
    qrCodeUrl: { type: String, default: '/uploads/qr-default.png' }
});
registrantSchema.pre('save', async function(next) {
    if (!this.isModified('password')) return next();
    this.password = await bcrypt.hash(this.password, 10);
    next();
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
        const prizes = await Prize.find({}).sort({ order: 1, amount: -1 });
        const committee = await Committee.find({}).sort({ order: 1 });
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
        else if (filter === 'Team') {

            query.$or = [
                { assignedTeam: { $exists: true, $ne: null, $ne: "" } },
                { teamName: { $exists: true, $ne: null, $ne: "" } }
            ];

        }
        const approvedPlayers = await Registrant.find(query).select('-__v');
        res.json({ notices, matches, prizes, committee, slides, players: approvedPlayers, rules, about });
    } catch (err) {
        res.status(500).json({ error: 'Could not fetch tournament data.' });
    }
});


app.get('/api/public/dataall', async (req, res) => {
    try {
        const { filter } = req.query;
        const notices = await Notice.find().sort({ createdAt: -1 });
        const matches = await Match.find({ status: 'Scheduled' }).sort({ matchDate: 1 });
        const prizes = await Prize.find({}).sort({ order: 1, amount: -1 });
        const committee = await Committee.find({}).sort({ order: 1 });
        const slides = await Slide.find().sort({ order: 1 });
        //const approvedPlayers = await Registrant.find({ status: 'Approved' }).select('-__v');
        const rules = await Rule.find().sort({ ruleNumber: 1 });
        const about = await About.findOne() || { title: 'About the League', content: 'The Bamundi Gram Premier League (BGPL) brings together local cricket talent...' };
        // Build query filter based on request parameter
        let query = {};
        if (filter === 'Player') {
            query.role = { $in: ['Player', 'Both'] };
        } else if (filter === 'Owner') {
            query.role = { $in: ['Team Owner', 'Both'] };
        }
        else if (filter === 'Team') {

            query.$or = [
                { assignedTeam: { $exists: true, $ne: null, $ne: "" } },
                { teamName: { $exists: true, $ne: null, $ne: "" } }
            ];

        }
        const approvedPlayers = await Registrant.find(query).select('-__v');
        res.json({ notices, matches, prizes, committee, slides, players: approvedPlayers, rules, about });
    } catch (err) {
        res.status(500).json({ error: 'Could not fetch tournament data.' });
    }
});
// Submit New Player / Owner Registration
// Multi-field upload middleware
const registrationUploads = upload.fields([
    { name: 'photo', maxCount: 1 },
    { name: 'aadharPhoto', maxCount: 1 },
    { name: 'teamLogo', maxCount: 1 },
    { name: 'paymentScreenshot', maxCount: 1 }
]);

// --- 1. INITIAL REGISTRATION ROUTE ---
app.post('/api/register', registrationUploads, async (req, res) => {
    try {
        const { fullName, role, age, phone, email, password, aadhaar, category, style, jerseySize, teamName, address, description } = req.body;

        if (!fullName || !phone || !aadhaar || !password) {
            return res.status(400).json({ error: 'Required identity or password fields missing.' });
        }

        const existing = await Registrant.findOne({ phone });
        if (existing) {
            return res.status(400).json({ error: 'A registration with this phone number already exists.' });
        }
        let walletBalance = 0;
                // Check if role is Team Owner or Both
        if (role === 'Team Owner' || role === 'Both') {
            walletBalance = 25000;
        }

        const lastFour = aadhaar.slice(-4);
        const maskedAadhaar = `XXXX-XXXX-${lastFour}`;

        const photoUrl = req.files && req.files['photo'] ? `/uploads/${req.files['photo'][0].filename}` : '';
        const aadharPhotoUrl = req.files && req.files['photaadharPhotoo'] ? `/uploads/${req.files['aadharPhoto'][0].filename}` : '';
        const teamLogoUrl = req.files && req.files['teamLogo'] ? `/uploads/${req.files['teamLogo'][0].filename}` : '';
        const paymentScreenshotUrl = req.files && req.files['paymentScreenshot'] ? `/uploads/${req.files['paymentScreenshot'][0].filename}` : '';

        const registrant = new Registrant({
            fullName,
            role,
            age: Number(age) || 0,
            phone,
            email: email && email.trim() !== '' ? email.trim() : undefined,
            password, // Will be hashed automatically by pre-save hook
            aadhaar,
            category,
            style,
            jerseySize,
            teamName,
            address,
            description,
            photoUrl,
            aadharPhotoUrl,
            teamLogoUrl,
            paymentScreenshotUrl,
            walletBalance
        });

        await registrant.save();
        res.status(201).json({ success: true, message: 'Registration submitted successfully!' });
    } catch (err) {
        console.error("Registration error:", err);
        if (err.code === 11000) {
            return res.status(400).json({ error: 'A record with this phone or email already exists.' });
        }
        res.status(500).json({ error: 'Registration submission failed.' });
    }
});

// --- 2. AUTHENTICATE & FETCH PROFILE FOR EDITING ---
app.post('/api/register/auth', async (req, res) => {
    try {
        const { identifier, password } = req.body; // identifier can be phone or email
        if (!identifier || !password) {
            return res.status(400).json({ error: 'Please provide phone/email and password.' });
        }

        const registrant = await Registrant.findOne({
            $or: [{ phone: identifier }, { email: identifier }]
        });

        if (!registrant) {
            return res.status(404).json({ error: 'Registrant not found.' });
        }

        const isMatch = await bcrypt.compare(password, registrant.password);
        if (!isMatch) {
            return res.status(401).json({ error: 'Incorrect password.' });
        }

        // Return user data (excluding password) for pre-filling the edit form
        const userData = registrant.toObject();
        delete userData.password;
        res.json({ success: true, registrant: userData });
    } catch (err) {
        res.status(500).json({ error: 'Authentication failed.' });
    }
});

// --- 3. SECURE PROFILE UPDATE ROUTE ---
app.put('/api/register/:id', registrationUploads, async (req, res) => {
    try {
        const { id } = req.params;
        const { fullName, role, age, phone, email, password, newPassword, teamName, address, aadhaar, description, category, style, jerseySize } = req.body;
        // Properly parse adminEdit string from FormData to boolean
        const adminEdit = req.body.adminEdit === 'true' || req.body.adminEdit === true;
        const registrant = await Registrant.findById(id);
        if (!registrant) {
            return res.status(404).json({ error: 'Registrant not found.' });
        }

        if (!adminEdit) {
            if (!password) {
                return res.status(400).json({ error: 'Current password is required to save changes.' });
            }

            const plainPassword = String(Array.isArray(password) ? password[0] : password || '').trim();
            const storedHash = String(registrant.password || '').trim();

            if (!storedHash) {
                return res.status(400).json({ error: 'No password found for this account.' });
            }

            const isMatch = await bcrypt.compare(plainPassword, storedHash);
            if (!isMatch) {
                return res.status(401).json({ error: 'Incorrect password. Update denied.' });
            }
        }

        // Update fields if provided
        if (fullName) registrant.fullName = fullName;
        if (role) registrant.role = role;
        if (age) registrant.age = Number(age);
        if (phone) registrant.phone = phone;
        if (aadhaar && aadhaar.length >= 4) registrant.aadhaar = aadhaar;
        if (email !== undefined) registrant.email = email.trim() !== '' ? email.trim() : undefined;
        if (address) registrant.address = address;
        if (description) registrant.description = description;
        if (category) registrant.category = category;
        if (style) registrant.style = style;
        if (jerseySize) registrant.jerseySize = jerseySize;
        if (teamName) registrant.teamName = teamName;
        if (newPassword && newPassword.trim() !== '') {
            registrant.password = await bcrypt.hash(newPassword, 10);
        }

        if (req.files && req.files['photo']) {
            registrant.photoUrl = `/uploads/${req.files['photo'][0].filename}`;
        }
        if (req.files && req.files['aadharPhoto']) {
            registrant.aadharPhotoUrl = `/uploads/${req.files['aadharPhoto'][0].filename}`;
        }
        if (req.files && req.files['teamLogo']) {
            registrant.teamLogoUrl = `/uploads/${req.files['teamLogo'][0].filename}`;
        }
        if (req.files && req.files['paymentScreenshot']) {
            registrant.paymentScreenshotUrl = `/uploads/${req.files['paymentScreenshot'][0].filename}`;
        }

        await registrant.save();
        res.json({ success: true, message: 'Profile updated successfully!' });
    } catch (err) {
        console.error("Update error:", err);
        res.status(500).json({ error: 'Failed to update profile.' });
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
            playerFee: 500, ownerFee: 2000, bothFee: 2500, upiId: 'bgpl2027@upi', qrCodeUrl: ''
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


// Update Registrant (Approval Status / Auction Prices)
// app.put('/api/admin/registrant/:id', verifyAdminJwt, async (req, res) => {
//     try {
//         const updated = await Registrant.findByIdAndUpdate(req.params.id, req.body, { new: true });
//         res.json({ success: true, updated });
//     } catch (err) {
//         res.status(500).json({ error: 'Failed to update record.' });
//     }
// });
// Update Registrant (Approval Status / Auction Prices & Wallet Deduction)
app.put('/api/admin/registrant/:id', verifyAdminJwt, async (req, res) => {
    try {
        const { assignedTeam, soldPrice } = req.body;
        
        // Find the player being updated first to check previous assignment
        const targetPlayer = await Registrant.findById(req.params.id);
        if (!targetPlayer) {
            return res.status(404).json({ error: 'Registrant not found.' });
        }

        // If a player is newly sold or their sold price/team changed, handle wallet deduction for the owner
        const finalSoldPrice = Number(soldPrice) || 0;
        const finalTeam = assignedTeam ? assignedTeam.trim() : '';

        if (finalTeam && finalSoldPrice > 0 && targetPlayer.assignedTeam !== finalTeam) {
            // Find the owner of this team (Role must be Team Owner or Both, and teamName matches case-insensitively)
            const teamOwner = await Registrant.findOne({
                role: { $in: ['Team Owner', 'Both'] },
                teamName: { $regex: new RegExp(`^${finalTeam}$`, 'i') }
            });

            if (teamOwner) {
                const currentBalance = teamOwner.walletBalance ? (typeof teamOwner.walletBalance.toNumber === 'function' ? teamOwner.walletBalance.toNumber() : Number(teamOwner.walletBalance)) : 0;

                if (currentBalance < finalSoldPrice) {
                    return res.status(400).json({ error: `Insufficient wallet balance for team owner "${teamOwner.fullName}" (${finalTeam}). Available: ₹${currentBalance}, Required: ₹${finalSoldPrice}` });
                }

                // Deduct from owner wallet and save
                teamOwner.walletBalance = currentBalance - finalSoldPrice;
                await teamOwner.save();
            }
        }

        // Perform the update
        const updated = await Registrant.findByIdAndUpdate(req.params.id, req.body, { new: true });
        res.json({ success: true, updated, message: 'Auction details saved successfully!' });
    } catch (err) {
        console.error("Auction update error:", err);
        res.status(500).json({ error: err.message || 'Failed to update record.' });
    }
});
// Delete Registrant
// app.delete('/api/admin/registrant/:id', verifyAdminJwt, async (req, res) => {
//     try {
//         await Registrant.findByIdAndDelete(req.params.id);
//         res.json({ success: true, message: 'Registrant record deleted.' });
//     } catch (err) {
//         res.status(500).json({ error: 'Failed to delete record.' });
//     }
// });

// Update Registrant (Approval Status / Auction Prices & Wallet Deduction)
// Delete Registrant & Refund Team Owner's Wallet Balance
app.delete('/api/admin/registrant/:id', verifyAdminJwt, async (req, res) => {
    try {
        const registrant = await Registrant.findById(req.params.id);
        if (!registrant) {
            return res.status(404).json({ error: 'Registrant not found.' });
        }

        // Scenario 1: Deleting a Player -> Refund sold price to team owner's wallet
        if (registrant.role === 'Player') {
            const soldPrice = Number(registrant.soldPrice) || 0;
            const assignedTeam = registrant.assignedTeam ? registrant.assignedTeam.trim() : '';

            if (assignedTeam && soldPrice > 0) {
                // Find the owner of this team
                const teamOwner = await Registrant.findOne({
                    role: { $in: ['Team Owner', 'Both'] },
                    teamName: { $regex: new RegExp(`^${assignedTeam}$`, 'i') }
                });

                if (teamOwner) {
                    const currentBalance = teamOwner.walletBalance 
                        ? (typeof teamOwner.walletBalance.toNumber === 'function' ? teamOwner.walletBalance.toNumber() : Number(teamOwner.walletBalance)) 
                        : 0;

                    // Refund the sold price back to the team owner's wallet
                    // Refund the sold price and cap it strictly at the 25,000 maximum limit
                    const totalBalance = currentBalance + soldPrice;
                    teamOwner.walletBalance = Math.min(25000, totalBalance);
                    await teamOwner.save();
                }
            }
        }

        // Scenario 2: Deleting a Team Owner -> Reset all players assigned to this team
        if ((registrant.role === 'Team Owner' || registrant.role === 'Both') && registrant.teamName) {
            const teamName = registrant.teamName.trim();
            if (teamName) {
                await Registrant.updateMany(
                    { assignedTeam: { $regex: new RegExp(`^${teamName}$`, 'i') } },
                    {
                        $set: {
                            assignedTeam: '',
                            soldPrice: 0,
                            auctionStatus: 'Unsold', // Or whatever your default status is for available players
                            teamDesignation: ''
                        }
                    }
                );
            }
        }

        // Delete the registrant record
        await Registrant.findByIdAndDelete(req.params.id);

        res.json({ success: true, message: 'Registrant deleted and related records updated successfully.' });
    } catch (err) {
        console.error("Delete error:", err);
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
// app.post('/api/admin/prizes', verifyAdminJwt, async (req, res) => {
//     const prize = new Prize(req.body);
//     await prize.save();
//     res.status(201).json({ success: true, prize });
// });
// Admin API to create or update a prize (Protected)
app.post('/api/admin/prizes', verifyAdminJwt, async (req, res) => {
    try {
        const { id, title, amount, perks, order } = req.body;
        if (id) {
            await Prize.findByIdAndUpdate(id, { 
                title, 
                amount: Number(amount), 
                perks, 
                order: Number(order) || 0 
            });
            res.json({ message: 'Prize updated successfully!' });
        } else {
            const count = await Prize.countDocuments();
            await Prize.create({ 
                title, 
                amount: Number(amount), 
                perks, 
                order: Number(order) !== undefined ? Number(order) : count + 1 
            });
            res.json({ message: 'Prize added successfully!' });
        }
    } catch (err) {
        res.status(500).json({ error: 'Failed to save prize.' });
    }
});
app.post('/api/admin/prizes/move', verifyAdminJwt, async (req, res) => {
    try {
        const { id, direction } = req.body;
        const currentPrize = await Prize.findById(id);
        if (!currentPrize) return res.status(404).json({ error: 'Prize not found.' });

        const currentOrder = currentPrize.order || 0;
        let targetPrize;

        if (direction === 'up') {
            targetPrize = await Prize.findOne({ order: { $lt: currentOrder } }).sort({ order: -1 });
        } else {
            targetPrize = await Prize.findOne({ order: { $gt: currentOrder } }).sort({ order: 1 });
        }

        if (targetPrize) {
            const tempOrder = targetPrize.order;
            targetPrize.order = currentOrder;
            currentPrize.order = tempOrder;
            await targetPrize.save();
            await currentPrize.save();
        } else {
            currentPrize.order = direction === 'up' ? Math.max(0, currentOrder - 1) : currentOrder + 1;
            await currentPrize.save();
        }

        res.json({ message: 'Sequence updated successfully!' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update sequence.' });
    }
});

// Admin API to delete a prize (Protected)
app.delete('/api/admin/prizes/:id', verifyAdminJwt, async (req, res) => {
    try {
        await Prize.findByIdAndDelete(req.params.id);
        res.json({ message: 'Prize deleted successfully!' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete prize.' });
    }
});

// app.delete('/api/admin/prizes/:id', verifyAdminJwt, async (req, res) => {
//     await Prize.findByIdAndDelete(req.params.id);
//     res.json({ success: true, message: 'Prize deleted.' });
// });

// Manage Committee CRUD
// app.post('/api/admin/committee', verifyAdminJwt, async (req, res) => {
//     const member = new Committee(req.body);
//     await member.save();
//     res.status(201).json({ success: true, member });
// });
app.post('/api/admin/committee', verifyAdminJwt, upload.single('photo'), async (req, res) => {
    try {
        const { id, name, designation, phone } = req.body;
        let updateData = { name, designation, phone };

        if (req.file) {
            updateData.photoUrl = `/uploads/${req.file.filename}`;
        }

        // Check if a valid MongoDB ID is provided and not empty
        if (id && mongoose.Types.ObjectId.isValid(id)) {
            await Committee.findByIdAndUpdate(id, updateData);
            res.json({ message: 'Committee member updated successfully!' });
        } else {
            const count = await Committee.countDocuments();
            await Committee.create({ 
                ...updateData, 
                photoUrl: updateData.photoUrl || '', 
                order: count + 1 
            });
            res.json({ message: 'Committee member added successfully!' });
        }
    } catch (err) {
        console.error("Committee save error:", err);
        res.status(500).json({ error: 'Failed to save committee member.' });
    }
});

// app.delete('/api/admin/committee/:id', verifyAdminJwt, async (req, res) => {
//     await Committee.findByIdAndDelete(req.params.id);
//     res.json({ success: true, message: 'Committee member deleted.' });
// });
app.delete('/api/admin/committee/:id', verifyAdminJwt, async (req, res) => {
    try {
        await Committee.findByIdAndDelete(req.params.id);
        res.json({ message: 'Committee member deleted successfully!' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete committee member.' });
    }
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