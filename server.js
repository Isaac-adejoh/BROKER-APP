const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// MongoDB Models
const userSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    email: { type: String, required: true },
    balance: { type: Number, default: 50000 },
    role: { type: String, default: 'user' },
    holdings: { type: Array, default: [] },
    transactions: { type: Array, default: [] },
    withdrawalRequests: { type: Array, default: [] },
    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now }
});

const userSessionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    ipAddress: { type: String, required: true },
    deviceInfo: { type: String, default: 'Unknown Device' },
    userAgent: { type: String },
    loggedInAt: { type: Date, default: Date.now },
    lastActive: { type: Date, default: Date.now }
});

const stockSchema = new mongoose.Schema({
    id: { type: Number, unique: true },
    name: String,
    price: Number,
    change: Number
});

const settingSchema = new mongoose.Schema({
    key: { type: String, unique: true },
    value: mongoose.Schema.Types.Mixed,
    updatedAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const UserSession = mongoose.model('UserSession', userSessionSchema);
const Stock = mongoose.model('Stock', stockSchema);
const Setting = mongoose.model('Setting', settingSchema);

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/broker')
    .then(() => console.log('✅ MongoDB connected'))
    .catch(err => console.log('❌ MongoDB error:', err));

// Initialize data
async function initData() {
    // Add stocks
    const stockCount = await Stock.countDocuments();
    if (stockCount === 0) {
        await Stock.insertMany([
            { id: 1, name: 'TechGrowth', price: 245.50, change: 5.2 },
            { id: 2, name: 'GreenEnergy', price: 89.75, change: 12.3 },
            { id: 3, name: 'HealthPlus', price: 156.30, change: -2.1 },
            { id: 4, name: 'AICorp', price: 432.80, change: 8.7 },
            { id: 5, name: 'CryptoWorld', price: 67.25, change: 15.4 },
            { id: 6, name: 'RealEstate', price: 312.60, change: 3.2 }
        ]);
        console.log('✅ Stocks added');
    }
    
    // Add admin
    const adminExists = await User.findOne({ role: 'admin' });
    if (!adminExists) {
        const hashedPassword = await bcrypt.hash('admin123', 10);
        await User.create({
            username: 'admin',
            password: hashedPassword,
            email: 'admin@broker.com',
            balance: 0,
            role: 'admin',
            isActive: true
        });
        console.log('✅ Admin created: admin / admin123');
    }
    
    // Add demo user
    const userExists = await User.findOne({ username: 'demo' });
    if (!userExists) {
        const hashedPassword = await bcrypt.hash('demo123', 10);
        await User.create({
            username: 'demo',
            password: hashedPassword,
            email: 'demo@user.com',
            balance: 50000,
            role: 'user',
            isActive: true
        });
        console.log('✅ Demo user created: demo / demo123');
    }
    
    // Initialize payment settings
    const cryptoSetting = await Setting.findOne({ key: 'crypto_wallets' });
    if (!cryptoSetting) {
        await Setting.create({
            key: 'crypto_wallets',
            value: {
                btc: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
                usdt_trc20: 'TQm9x6nZ7QyX8wLpR3sKjH2gFd1cVbNmA',
                usdt_erc20: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb5'
            }
        });
        console.log('✅ Default crypto wallets added');
    }
    
    const bankSetting = await Setting.findOne({ key: 'bank_info' });
    if (!bankSetting) {
        await Setting.create({
            key: 'bank_info',
            value: {
                bankName: 'Demo Bank',
                accountName: 'Investment Broker Ltd',
                accountNumber: '1234567890',
                routingNumber: '021000021',
                swiftCode: 'DEMOUSA33',
                wireInstructions: 'For wire transfers, please include your username in the reference field.'
            }
        });
        console.log('✅ Default bank info added');
    }
}

initData();

// Helper function to get client IP
function getClientIp(req) {
    return req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
}

// Helper function to get device info
function getDeviceInfo(req) {
    const userAgent = req.headers['user-agent'] || 'Unknown';
    let deviceInfo = 'Unknown Device';
    
    if (userAgent.includes('iPhone')) deviceInfo = 'iPhone';
    else if (userAgent.includes('iPad')) deviceInfo = 'iPad';
    else if (userAgent.includes('Android')) deviceInfo = 'Android Phone';
    else if (userAgent.includes('Windows')) deviceInfo = 'Windows PC';
    else if (userAgent.includes('Mac')) deviceInfo = 'Mac Computer';
    else if (userAgent.includes('Linux')) deviceInfo = 'Linux Computer';
    
    return deviceInfo;
}

// Auth middleware
async function auth(req, res, next) {
    const token = req.headers.authorization;
    if (!token) {
        return res.status(401).json({ error: 'No token' });
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'mysecretkey');
        const user = await User.findById(decoded.userId);
        if (!user) {
            return res.status(401).json({ error: 'User not found' });
        }
        req.user = user;
        req.userId = decoded.userId;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid token' });
    }
}

// ============ LOGIN ROUTE WITH DEVICE LIMIT ============
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username });
        
        if (!user) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }
        
        if (!user.isActive) {
            return res.status(400).json({ error: 'Account disabled' });
        }
        
        const valid = await bcrypt.compare(password, user.password);
        if (!valid) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }
        
        // Check device limit for non-admin users
        const ipAddress = getClientIp(req);
        const deviceInfo = getDeviceInfo(req);
        const userAgent = req.headers['user-agent'];
        
        if (user.role !== 'admin') {
            // Get active sessions for this user
            const activeSessions = await UserSession.find({ userId: user._id });
            
            // Check if this IP already has a session
            const existingSession = activeSessions.find(s => s.ipAddress === ipAddress);
            
            if (!existingSession && activeSessions.length >= 2) {
                return res.status(403).json({ 
                    error: 'Maximum 2 devices allowed. Please logout from another device first.' 
                });
            }
            
            // Update or create session
            if (existingSession) {
                existingSession.lastActive = new Date();
                existingSession.deviceInfo = deviceInfo;
                existingSession.userAgent = userAgent;
                await existingSession.save();
            } else {
                await UserSession.create({
                    userId: user._id,
                    ipAddress: ipAddress,
                    deviceInfo: deviceInfo,
                    userAgent: userAgent,
                    loggedInAt: new Date(),
                    lastActive: new Date()
                });
            }
        }
        
        const token = jwt.sign({ userId: user._id, role: user.role }, process.env.JWT_SECRET || 'mysecretkey');
        
        res.json({ 
            success: true, 
            token, 
            user: { 
                id: user._id, 
                username: user.username, 
                role: user.role,
                balance: user.balance 
            } 
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Logout endpoint - remove session
app.post('/api/logout', auth, async (req, res) => {
    try {
        const ipAddress = getClientIp(req);
        await UserSession.findOneAndDelete({ userId: req.userId, ipAddress: ipAddress });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get current user
app.get('/api/me', auth, async (req, res) => {
    const user = await User.findById(req.userId).select('-password');
    res.json(user);
});

// Get all stocks
app.get('/api/stocks', async (req, res) => {
    const stocks = await Stock.find();
    res.json(stocks);
});

// Get payment methods
app.get('/api/payment-methods', auth, async (req, res) => {
    const cryptoWallets = await Setting.findOne({ key: 'crypto_wallets' });
    const bankInfo = await Setting.findOne({ key: 'bank_info' });
    
    res.json({
        crypto: cryptoWallets?.value || {},
        bank: bankInfo?.value || {}
    });
});

// Buy stock
app.post('/api/buy', auth, async (req, res) => {
    try {
        const { stockId, quantity, paymentMethod } = req.body;
        const user = await User.findById(req.userId);
        const stock = await Stock.findOne({ id: stockId });
        
        if (!stock) return res.status(404).json({ error: 'Stock not found' });
        
        const totalCost = stock.price * quantity;
        if (totalCost > user.balance) {
            return res.status(400).json({ error: 'Insufficient balance' });
        }
        
        user.balance -= totalCost;
        
        let holding = user.holdings.find(h => h.stockId === stockId);
        if (holding) {
            holding.quantity += quantity;
            holding.totalInvestment += totalCost;
            holding.avgPrice = holding.totalInvestment / holding.quantity;
        } else {
            user.holdings.push({
                stockId: stockId,
                stockName: stock.name,
                quantity: quantity,
                avgPrice: stock.price,
                totalInvestment: totalCost
            });
        }
        
        user.transactions.unshift({
            date: new Date().toLocaleString(),
            type: 'BUY',
            stock: stock.name,
            shares: quantity,
            price: stock.price,
            total: totalCost,
            paymentMethod: paymentMethod,
            status: 'completed'
        });
        
        await user.save();
        res.json({ success: true, balance: user.balance });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Sell stock
app.post('/api/sell', auth, async (req, res) => {
    try {
        const { stockId, quantity } = req.body;
        const user = await User.findById(req.userId);
        const stock = await Stock.findOne({ id: stockId });
        
        const holdingIndex = user.holdings.findIndex(h => h.stockId === stockId);
        if (holdingIndex === -1) {
            return res.status(400).json({ error: 'No shares to sell' });
        }
        
        const holding = user.holdings[holdingIndex];
        if (holding.quantity < quantity) {
            return res.status(400).json({ error: 'Not enough shares' });
        }
        
        const totalValue = stock.price * quantity;
        const profitLoss = totalValue - (holding.avgPrice * quantity);
        
        user.balance += totalValue;
        
        if (holding.quantity === quantity) {
            user.holdings.splice(holdingIndex, 1);
        } else {
            holding.quantity -= quantity;
            holding.totalInvestment -= holding.avgPrice * quantity;
        }
        
        user.transactions.unshift({
            date: new Date().toLocaleString(),
            type: 'SELL',
            stock: stock.name,
            shares: quantity,
            price: stock.price,
            total: totalValue,
            profitLoss: profitLoss,
            status: 'completed'
        });
        
        await user.save();
        res.json({ success: true, balance: user.balance });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Request withdrawal
app.post('/api/withdraw', auth, async (req, res) => {
    try {
        const { amount, bankName, accountNumber, accountHolder, ifscCode } = req.body;
        const user = await User.findById(req.userId);
        
        if (amount < 10) {
            return res.status(400).json({ error: 'Minimum withdrawal amount is $10' });
        }
        
        if (amount > user.balance) {
            return res.status(400).json({ error: 'Insufficient balance' });
        }
        
        const withdrawalRequest = {
            id: Date.now(),
            userId: user._id,
            username: user.username,
            amount: amount,
            bankName: bankName,
            accountNumber: accountNumber,
            accountHolder: accountHolder,
            ifscCode: ifscCode,
            status: 'pending',
            date: new Date().toLocaleString()
        };
        
        user.withdrawalRequests.push(withdrawalRequest);
        await user.save();
        
        res.json({ success: true, message: 'Withdrawal request submitted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get user's withdrawal requests
app.get('/api/my-withdrawals', auth, async (req, res) => {
    const user = await User.findById(req.userId);
    res.json(user.withdrawalRequests || []);
});

// ============ ADMIN ROUTES ============

// Get all users
app.get('/api/admin/users', auth, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin only' });
    }
    const users = await User.find().select('-password');
    res.json(users);
});

// Get all user sessions (for admin)
app.get('/api/admin/sessions', auth, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin only' });
    }
    const sessions = await UserSession.find().populate('userId', 'username email');
    res.json(sessions);
});

// Remove specific device session (admin)
app.delete('/api/admin/remove-session', auth, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin only' });
    }
    
    const { sessionId } = req.body;
    await UserSession.findByIdAndDelete(sessionId);
    res.json({ success: true });
});

// Clear all sessions for a user (admin)
app.delete('/api/admin/clear-user-sessions', auth, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin only' });
    }
    
    const { userId } = req.body;
    await UserSession.deleteMany({ userId });
    res.json({ success: true });
});

// Create user
app.post('/api/admin/create-user', auth, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin only' });
    }
    
    const { username, password, email, initialBalance } = req.body;
    
    const existing = await User.findOne({ username });
    if (existing) {
        return res.status(400).json({ error: 'Username exists' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await User.create({
        username,
        password: hashedPassword,
        email,
        balance: initialBalance || 50000,
        role: 'user',
        isActive: true
    });
    
    res.json({ success: true, user: newUser });
});

// Update balance
app.post('/api/admin/update-balance', auth, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin only' });
    }
    
    const { userId, newBalance } = req.body;
    await User.findByIdAndUpdate(userId, { balance: newBalance });
    res.json({ success: true });
});

// Add funds
app.post('/api/admin/add-funds', auth, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin only' });
    }
    
    const { userId, amount } = req.body;
    const user = await User.findById(userId);
    user.balance += amount;
    await user.save();
    res.json({ success: true });
});

// Give profit to all
app.post('/api/admin/give-profit', auth, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin only' });
    }
    
    const { percentage } = req.body;
    const users = await User.find({ role: 'user' });
    
    for (let user of users) {
        const profit = user.balance * (percentage / 100);
        user.balance += profit;
        await user.save();
    }
    res.json({ success: true });
});

// Update stock price
app.post('/api/admin/update-stock', auth, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin only' });
    }
    
    const { stockId, newPrice } = req.body;
    const stock = await Stock.findOne({ id: stockId });
    if (stock) {
        const oldPrice = stock.price;
        stock.price = newPrice;
        stock.change = ((newPrice - oldPrice) / oldPrice * 100).toFixed(1);
        await stock.save();
    }
    res.json({ success: true });
});

// Skyrocket stock
app.post('/api/admin/skyrocket', auth, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin only' });
    }
    
    const { stockId } = req.body;
    const stock = await Stock.findOne({ id: stockId });
    if (stock) {
        const newPrice = stock.price * 1.25;
        const oldPrice = stock.price;
        stock.price = newPrice;
        stock.change = ((newPrice - oldPrice) / oldPrice * 100).toFixed(1);
        await stock.save();
    }
    res.json({ success: true });
});

// Disable/enable user
app.post('/api/admin/disable-user', auth, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin only' });
    }
    
    const { userId, isActive } = req.body;
    await User.findByIdAndUpdate(userId, { isActive });
    res.json({ success: true });
});

// Change password for any user (admin)
app.post('/api/admin/change-password', auth, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin only' });
    }
    
    const { userId, newPassword } = req.body;
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await User.findByIdAndUpdate(userId, { password: hashedPassword });
    res.json({ success: true });
});

// Get all withdrawal requests (admin)
app.get('/api/admin/withdrawals', auth, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin only' });
    }
    
    const users = await User.find({ role: 'user' });
    let allWithdrawals = [];
    
    for (let user of users) {
        if (user.withdrawalRequests && user.withdrawalRequests.length > 0) {
            allWithdrawals.push(...user.withdrawalRequests);
        }
    }
    
    allWithdrawals.sort((a, b) => b.id - a.id);
    res.json(allWithdrawals);
});

// Approve withdrawal (admin)
app.post('/api/admin/approve-withdrawal', auth, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin only' });
    }
    
    const { withdrawalId } = req.body;
    
    const user = await User.findOne({ 'withdrawalRequests.id': withdrawalId });
    if (!user) {
        return res.status(404).json({ error: 'Withdrawal not found' });
    }
    
    const withdrawal = user.withdrawalRequests.find(w => w.id === withdrawalId);
    if (!withdrawal) {
        return res.status(404).json({ error: 'Withdrawal not found' });
    }
    
    withdrawal.status = 'approved';
    withdrawal.processedAt = new Date().toLocaleString();
    
    user.balance -= withdrawal.amount;
    
    user.transactions.unshift({
        date: new Date().toLocaleString(),
        type: 'WITHDRAWAL',
        stock: 'Cash',
        shares: '-',
        price: '-',
        total: -withdrawal.amount,
        status: 'approved',
        bankDetails: {
            bankName: withdrawal.bankName,
            accountNumber: withdrawal.accountNumber,
            accountHolder: withdrawal.accountHolder
        }
    });
    
    await user.save();
    res.json({ success: true });
});

// Reject withdrawal (admin)
app.post('/api/admin/reject-withdrawal', auth, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin only' });
    }
    
    const { withdrawalId, reason } = req.body;
    
    const user = await User.findOne({ 'withdrawalRequests.id': withdrawalId });
    if (!user) {
        return res.status(404).json({ error: 'Withdrawal not found' });
    }
    
    const withdrawal = user.withdrawalRequests.find(w => w.id === withdrawalId);
    if (!withdrawal) {
        return res.status(404).json({ error: 'Withdrawal not found' });
    }
    
    withdrawal.status = 'rejected';
    withdrawal.rejectionReason = reason || 'No reason provided';
    withdrawal.processedAt = new Date().toLocaleString();
    
    await user.save();
    res.json({ success: true });
});

// Update crypto wallets (admin)
app.post('/api/admin/update-crypto-wallets', auth, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin only' });
    }
    
    const { btc, usdt_trc20, usdt_erc20 } = req.body;
    
    await Setting.findOneAndUpdate(
        { key: 'crypto_wallets' },
        { 
            key: 'crypto_wallets',
            value: { btc, usdt_trc20, usdt_erc20 },
            updatedAt: new Date()
        },
        { upsert: true }
    );
    
    res.json({ success: true });
});

// Update bank info (admin)
app.post('/api/admin/update-bank-info', auth, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin only' });
    }
    
    const { bankName, accountName, accountNumber, routingNumber, swiftCode, wireInstructions } = req.body;
    
    await Setting.findOneAndUpdate(
        { key: 'bank_info' },
        { 
            key: 'bank_info',
            value: { bankName, accountName, accountNumber, routingNumber, swiftCode, wireInstructions },
            updatedAt: new Date()
        },
        { upsert: true }
    );
    
    res.json({ success: true });
});

// Get payment settings (admin)
app.get('/api/admin/payment-settings', auth, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin only' });
    }
    
    const cryptoWallets = await Setting.findOne({ key: 'crypto_wallets' });
    const bankInfo = await Setting.findOne({ key: 'bank_info' });
    
    res.json({
        crypto: cryptoWallets?.value || {},
        bank: bankInfo?.value || {}
    });
});

// ============ ADMIN PROFILE SETTINGS ============

// Get admin profile
app.get('/api/admin/profile', auth, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin only' });
    }
    res.json({
        username: req.user.username,
        email: req.user.email
    });
});

// Change admin username
app.post('/api/admin/change-username', auth, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin only' });
    }
    
    const { newUsername } = req.body;
    
    const existing = await User.findOne({ username: newUsername });
    if (existing && existing._id.toString() !== req.userId) {
        return res.status(400).json({ error: 'Username already taken' });
    }
    
    await User.findByIdAndUpdate(req.userId, { username: newUsername });
    res.json({ success: true, newUsername });
});

// Change admin password
app.post('/api/admin/change-password-self', auth, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin only' });
    }
    
    const { currentPassword, newPassword } = req.body;
    
    const user = await User.findById(req.userId);
    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) {
        return res.status(400).json({ error: 'Current password is incorrect' });
    }
    
    if (newPassword.length < 6) {
        return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }
    
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await User.findByIdAndUpdate(req.userId, { password: hashedPassword });
    res.json({ success: true });
});

// Serve HTML files
app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/admin.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/dashboard.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/', (req, res) => {
    res.redirect('/login.html');
});

// Keep-alive endpoint for Render
app.get('/api/health', (req, res) => {
    res.json({ status: 'alive', timestamp: new Date() });
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║              INVESTMENT BROKER PLATFORM                      ║
╠══════════════════════════════════════════════════════════════╣
║  🚀 Server: http://localhost:${PORT}                          ║
║  👤 Admin:  admin / admin123                                 ║
║  👤 Demo:   demo / demo123                                   ║
║                                                              ║
║  🔐 NEW FEATURE: 2-Device Limit Per User                     ║
║  📊 Sessions stored in MongoDB                               ║
╚══════════════════════════════════════════════════════════════╝
    `);
});